"""MinerU Pipeline adapter for the Document Arena oci-batch/v1 protocol.

Runs the pinned MinerU CLI in pipeline mode on CPU with baked local models,
preserves the raw Markdown / middle.json / content_list.json untouched, and
emits a canonical parsed document whose source regions carry only MinerU's
native geometry (top-left page coordinates, normalized reversibly).
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from html.parser import HTMLParser
from pathlib import Path, PurePosixPath

REQUEST_PATH = Path(os.environ.get("ARENA_REQUEST_PATH", "/arena/request.json"))
INPUT_ROOT = Path(os.environ.get("ARENA_INPUT_DIR", "/arena/input")).resolve()
OUTPUT_ROOT = Path(os.environ.get("ARENA_OUTPUT_DIR", "/arena/output")).resolve()
MODEL_REVISION_PATH = Path(
    os.environ.get(
        "MINERU_MODEL_REVISION_PATH",
        "/opt/mineru-home/model-revision.json",
    )
)

COMPONENT_ID = "mineru-pipeline"
ADAPTER_VERSION = "0.1.0"
UPSTREAM_VERSION = "3.4.4"

# MinerU's _content_list.json normalizes every bbox to a top-left 0..1000 range
# per axis, independent of the PDF point size in middle.json's page_size.
CONTENT_LIST_SCALE = 1000.0

KIND_BY_TYPE = {
    "text": "paragraph",
    "title": "heading",
    "table": "table",
    "image": "image",
    "equation": "formula",
    "interline_equation": "formula",
    "list": "list",
    "index": "list",
    "code": "code",
    "algorithm": "code",
}

ALLOWED_METHODS = {"auto", "txt", "ocr"}
ALLOWED_LANGS = {
    "ch",
    "ch_server",
    "korean",
    "ta",
    "te",
    "ka",
    "th",
    "el",
    "arabic",
    "east_slavic",
    "cyrillic",
    "devanagari",
}
FIXED_OPTIONS = {
    "inputPath": "stage-source",
    "outputDirectory": "runner-workspace",
    "backend": "pipeline",
    "device": "cpu",
    "modelSource": "local",
    "modelRevision": (
        "hf:opendatalab/PDF-Extract-Kit-1.0"
        "@ed6b654c018d742e65a17671e379c5e6ecc87ec9"
    ),
}
UNAVAILABLE_OPTIONS = {
    "apiUrl",
    "effort",
    "serverUrl",
    "startPage",
    "endPage",
    "imageAnalysis",
    "clientSideOutputGeneration",
}


def emit(event_type: str, **fields: object) -> None:
    payload = {
        "apiVersion": "document-arena.dev/job-event/v1alpha1",
        "type": event_type,
        **fields,
    }
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def file_descriptor(path: Path, media_type: str) -> dict:
    return {
        "path": str(PurePosixPath(path.relative_to(OUTPUT_ROOT))),
        "mediaType": media_type,
        "sizeBytes": path.stat().st_size,
        "sha256": sha256_file(path),
    }


def artifact_media_type(path: Path) -> str:
    return {
        ".json": "application/json",
        ".md": "text/markdown",
        ".pdf": "application/pdf",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
    }.get(path.suffix.lower(), "application/octet-stream")


def copy_raw_outputs(source_directory: Path, raw_directory: Path) -> list[Path]:
    """Copy every regular MinerU output without following parser-made links."""
    destination_root = raw_directory / "mineru-output"
    copied: list[Path] = []
    for current_root, directory_names, file_names in os.walk(
        source_directory,
        followlinks=False,
    ):
        current = Path(current_root)
        for directory_name in directory_names:
            if (current / directory_name).is_symlink():
                raise RuntimeError("MinerU output contains a symbolic link.")
        for file_name in file_names:
            source = current / file_name
            if source.is_symlink() or not source.is_file():
                raise RuntimeError("MinerU output contains a non-regular file.")
            relative = source.relative_to(source_directory)
            destination = destination_root / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, destination)
            copied.append(destination)
    if not copied:
        raise RuntimeError("MinerU produced no raw output files.")
    return sorted(copied)


def load_model_revision() -> str:
    try:
        metadata = json.loads(MODEL_REVISION_PATH.read_text("utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError("Pinned MinerU model revision metadata is unavailable.") from error
    repository = metadata.get("repository") if isinstance(metadata, dict) else None
    revision = metadata.get("revision") if isinstance(metadata, dict) else None
    identity = f"hf:{repository}@{revision}"
    if identity != FIXED_OPTIONS["modelRevision"]:
        raise RuntimeError("MinerU model revision does not match the component profile.")
    return identity


def safe_input_path(relative: object) -> Path:
    if not isinstance(relative, str) or not relative:
        raise ValueError("Request source.path must be a non-empty string.")
    absolute = (INPUT_ROOT / relative).resolve()
    if absolute != INPUT_ROOT and INPUT_ROOT not in absolute.parents:
        raise ValueError("Request source.path escapes the input directory.")
    return absolute


def resolve_options(raw: object) -> dict:
    options = raw or {}
    if not isinstance(options, dict):
        raise ValueError("Request options must be an object.")
    configurable = {
        "method",
        "lang",
        "formula",
        "table",
        "chineseFormula",
        "mergeCrossPageTables",
        "pdfRenderTimeoutSeconds",
        "pdfRenderThreads",
        "processingWindowSize",
        "intraOpThreads",
        "interOpThreads",
    }
    allowed = configurable | FIXED_OPTIONS.keys() | UNAVAILABLE_OPTIONS
    for key in options:
        if key not in allowed:
            raise ValueError(f"Unsupported option: {key}")

    selected_unavailable = sorted(UNAVAILABLE_OPTIONS.intersection(options))
    if selected_unavailable:
        raise ValueError(
            "Options unavailable in the pipeline profile: "
            + ", ".join(selected_unavailable)
        )

    for key, fixed_value in FIXED_OPTIONS.items():
        if key in options and options[key] != fixed_value:
            raise ValueError(f"Option {key} is fixed to {fixed_value}.")

    method = options.get("method", "auto")
    if method not in ALLOWED_METHODS:
        raise ValueError("Invalid method option.")

    lang = options.get("lang", "ch")
    if lang not in ALLOWED_LANGS:
        raise ValueError("Invalid lang option.")
    formula = options.get("formula", True)
    table = options.get("table", True)
    chinese_formula = options.get("chineseFormula", False)
    merge_cross_page_tables = options.get("mergeCrossPageTables", True)
    boolean_options = {
        "formula": formula,
        "table": table,
        "chineseFormula": chinese_formula,
        "mergeCrossPageTables": merge_cross_page_tables,
    }
    if any(not isinstance(value, bool) for value in boolean_options.values()):
        raise ValueError("Invalid boolean option.")

    positive_integers = {
        "pdfRenderTimeoutSeconds": options.get("pdfRenderTimeoutSeconds", 300),
        "pdfRenderThreads": options.get("pdfRenderThreads", 3),
        "processingWindowSize": options.get("processingWindowSize", 64),
    }
    if any(
        type(value) is not int or value < 1
        for value in positive_integers.values()
    ):
        raise ValueError("Render and processing values must be positive integers.")

    runtime_threads = {
        "intraOpThreads": options.get("intraOpThreads", -1),
        "interOpThreads": options.get("interOpThreads", -1),
    }
    if any(
        type(value) is not int or value == 0 or value < -1
        for value in runtime_threads.values()
    ):
        raise ValueError("Runtime thread values must be -1 or positive integers.")

    return {
        **FIXED_OPTIONS,
        "method": method,
        "lang": lang,
        **boolean_options,
        **positive_integers,
        **runtime_threads,
    }


def find_method_dir(work_dir: Path, method: str) -> Path:
    candidates = [path for path in work_dir.glob(f"*/{method}") if path.is_dir()]
    if len(candidates) != 1:
        raise RuntimeError(
            f"Expected exactly one MinerU {method} output directory, "
            f"found {len(candidates)}."
        )
    return candidates[0]


def single_output(directory: Path, suffix: str) -> Path:
    matches = [
        path
        for path in directory.iterdir()
        if path.is_file() and path.name.lower().endswith(suffix)
    ]
    if len(matches) != 1:
        raise RuntimeError(
            f"Expected exactly one {suffix} output, found {len(matches)}."
        )
    return matches[0]


def normalize_bbox(bbox: object, width: float, height: float):
    if (
        not isinstance(bbox, (list, tuple))
        or len(bbox) != 4
        or not all(isinstance(value, (int, float)) for value in bbox)
        or width <= 0
        or height <= 0
    ):
        return None
    x_min = max(0.0, min(1.0, bbox[0] / width))
    y_min = max(0.0, min(1.0, bbox[1] / height))
    x_max = max(0.0, min(1.0, bbox[2] / width))
    y_max = max(0.0, min(1.0, bbox[3] / height))
    if x_max <= x_min or y_max <= y_min:
        return None
    return [x_min, y_min, x_max, y_max]


class _TableHTMLParser(HTMLParser):
    """Collects a MinerU table_body <table> into a list of text rows.

    MinerU emits recognised tables as an HTML string rather than as structured
    cells, so we flatten it into a simple grid. colspan/rowspan are not
    expanded; each <td>/<th> becomes one cell.
    """

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.rows: list[list[str]] = []
        self._row: list[str] | None = None
        self._cell: list[str] | None = None

    def handle_starttag(self, tag, attrs):
        if tag == "tr":
            self._row = []
        elif tag in ("td", "th"):
            self._cell = []

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self._cell is not None and self._row is not None:
            self._row.append("".join(self._cell).strip())
            self._cell = None
        elif tag == "tr" and self._row is not None:
            self.rows.append(self._row)
            self._row = None

    def handle_data(self, data):
        if self._cell is not None:
            self._cell.append(data)


def parse_html_table(html: object) -> list[list[str]]:
    if not isinstance(html, str) or "<tr" not in html.lower():
        return []
    parser = _TableHTMLParser()
    try:
        parser.feed(html)
    except Exception:
        return []
    # Drop trailing empty rows and normalise ragged rows to a common width.
    rows = [row for row in parser.rows if any(cell for cell in row)]
    if not rows:
        return []
    width = max(len(row) for row in rows)
    return [row + [""] * (width - len(row)) for row in rows]


def build_canonical(
    *,
    middle: dict,
    content_list: list,
    markdown: str,
    source_artifact_id: str,
    raw_artifact_id: str,
    file_name: str,
) -> tuple[dict, int, int]:
    pdf_info = middle.get("pdf_info")
    if not isinstance(pdf_info, list) or not pdf_info:
        raise RuntimeError("MinerU middle.json has no pdf_info pages.")

    page_sizes: dict[int, tuple[float, float]] = {}
    for index, page in enumerate(pdf_info):
        if not isinstance(page, dict):
            continue
        size = page.get("page_size")
        page_idx = page.get("page_idx", index)
        if (
            isinstance(size, (list, tuple))
            and len(size) == 2
            and all(isinstance(value, (int, float)) and value > 0 for value in size)
            and isinstance(page_idx, int)
        ):
            page_sizes[page_idx] = (float(size[0]), float(size[1]))

    pages: dict[int, dict] = {}
    for page_idx, (width, height) in sorted(page_sizes.items()):
        pages[page_idx] = {
            "pageNumber": page_idx + 1,
            "width": width,
            "height": height,
            "blocks": [],
        }

    block_count = 0
    region_count = 0
    for index, item in enumerate(content_list):
        if not isinstance(item, dict):
            continue
        page_idx = item.get("page_idx")
        if not isinstance(page_idx, int) or page_idx not in pages:
            continue
        page = pages[page_idx]
        item_type = str(item.get("type", "unknown")).strip().lower()
        kind = KIND_BY_TYPE.get(item_type, item_type or "unknown")
        text = item.get("text")
        text = text.strip() if isinstance(text, str) else ""
        text_level = item.get("text_level")
        block: dict = {
            "id": f"mineru-p{page_idx + 1}-i{index}",
            "kind": "heading" if kind == "paragraph" and isinstance(text_level, int) and text_level >= 1 else kind,
            "readingOrder": len(page["blocks"]),
            "rawArtifactRef": raw_artifact_id,
            "rawJsonPointer": f"/{index}",
        }
        if text:
            block["text"] = text
        if block["kind"] == "heading" and isinstance(text_level, int) and text_level >= 1:
            block["headingLevel"] = min(text_level, 6)

        # MinerU's _content_list.json bboxes are normalized to a fixed
        # top-left 0..1000 range on each axis (independent of the PDF point
        # size), so divide by 1000, not by page_size. See CONTENT_LIST_SCALE.
        normalized = normalize_bbox(
            item.get("bbox"), CONTENT_LIST_SCALE, CONTENT_LIST_SCALE
        )
        if normalized is not None:
            block["sourceRegions"] = [
                {
                    "pageNumber": page_idx + 1,
                    "bbox": normalized,
                    "provenance": "native",
                    "native": {
                        "bbox": list(item.get("bbox")),
                        "coordinateSystem": "mineru-content-list-permille",
                        "artifactId": raw_artifact_id,
                        "jsonPointer": f"/{index}",
                    },
                }
            ]
            region_count += 1
        page["blocks"].append(block)
        block_count += 1

        # MinerU emits recognised tables as an HTML string in `table_body`
        # rather than as structured cells, so the block itself carries no
        # text. Flatten the HTML into synthetic table-cell blocks whose
        # rawJsonPointer encodes the grid, so the reading view reconstructs
        # the table exactly like the structured parsers. Cells share the
        # table's single native region (no per-cell geometry from MinerU).
        if block["kind"] == "table":
            grid = parse_html_table(item.get("table_body"))
            for row_index, row in enumerate(grid):
                for column_index, cell_text in enumerate(row):
                    cell_pointer = f"/{index}/rows/{row_index}/cells/{column_index}"
                    cell_block: dict = {
                        "id": f"mineru-p{page_idx + 1}-i{index}-r{row_index}-c{column_index}",
                        "kind": "table-cell",
                        "readingOrder": len(page["blocks"]),
                        "rawArtifactRef": raw_artifact_id,
                        "rawJsonPointer": cell_pointer,
                    }
                    if cell_text:
                        cell_block["text"] = cell_text
                    page["blocks"].append(cell_block)
                    block_count += 1

    canonical = {
        "apiVersion": "document-arena.dev/parsed-document/v1alpha1",
        "sourceArtifactRef": source_artifact_id,
        "parser": {"id": COMPONENT_ID, "upstreamVersion": UPSTREAM_VERSION},
        "metadata": {
            "fileName": file_name,
            "numberOfPages": len(pages),
            "title": None,
            "author": None,
        },
        "markdown": markdown,
        "pages": [pages[key] for key in sorted(pages)],
    }
    return canonical, block_count, region_count


def run() -> None:
    from datetime import datetime, timezone

    started_at = datetime.now(timezone.utc)
    request = json.loads(REQUEST_PATH.read_text("utf-8"))
    if request.get("apiVersion") != "document-arena.dev/stage-request/v1alpha1":
        raise ValueError("Unsupported stage request apiVersion.")
    component = request.get("component") or {}
    if component.get("id") != COMPONENT_ID:
        raise ValueError("Stage request component does not match this extension.")
    source = request.get("source") or {}
    source_artifact_id = source.get("artifactId")
    if not isinstance(source_artifact_id, str) or not source_artifact_id:
        raise ValueError("Stage request source.artifactId is required.")

    source_path = safe_input_path(source.get("path"))
    if source_path.suffix.lower() != ".pdf":
        raise ValueError("MinerU extension accepts PDF inputs only.")
    source_sha256 = sha256_file(source_path)
    if source.get("sha256") and source.get("sha256") != source_sha256:
        raise ValueError("Source SHA-256 does not match the stage request.")

    options = resolve_options(request.get("options"))
    model_revision = load_model_revision()
    job_id = request.get("jobId")
    stage_run_id = request.get("stageRunId")
    raw_artifact_id = request.get("rawArtifactId") or f"raw:{stage_run_id}:parser-output"

    raw_dir = OUTPUT_ROOT / "raw"
    primary_dir = OUTPUT_ROOT / "primary"
    raw_dir.mkdir(parents=True, exist_ok=True)
    primary_dir.mkdir(parents=True, exist_ok=True)

    emit("stage.phase", jobId=job_id, stageRunId=stage_run_id, phase="parsing")
    work_dir = Path(tempfile.mkdtemp(prefix="mineru-", dir="/tmp"))
    command = [
        "mineru",
        "-p",
        str(source_path),
        "-o",
        str(work_dir),
        "-b",
        options["backend"],
        "-m",
        options["method"],
        "-f",
        "true" if options["formula"] else "false",
        "-t",
        "true" if options["table"] else "false",
        "-l",
        options["lang"],
    ]

    process_env = os.environ.copy()
    process_env.update(
        {
            "MINERU_DEVICE_MODE": options["device"],
            "MINERU_MODEL_SOURCE": options["modelSource"],
            "MINERU_FORMULA_CH_SUPPORT": str(options["chineseFormula"]).lower(),
            "MINERU_TABLE_MERGE_ENABLE": str(
                options["mergeCrossPageTables"]
            ).lower(),
            "MINERU_PDF_RENDER_TIMEOUT": str(options["pdfRenderTimeoutSeconds"]),
            "MINERU_PDF_RENDER_THREADS": str(options["pdfRenderThreads"]),
            "MINERU_PROCESSING_WINDOW_SIZE": str(options["processingWindowSize"]),
            "MINERU_INTRA_OP_NUM_THREADS": str(options["intraOpThreads"]),
            "MINERU_INTER_OP_NUM_THREADS": str(options["interOpThreads"]),
        }
    )

    # Stream MinerU's own progress lines (tqdm stage bars such as
    # "Layout Predict: ... 3/10") and relay them as stage.progress events.
    # This is a truthful relay of the parser's log, never an invented number.
    import re

    progress_pattern = re.compile(
        r"([A-Za-z][A-Za-z0-9 _-]{2,32}?):?\s+\d+%\|[^|]*\|\s*(\d+)/(\d+)"
    )
    process = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        env=process_env,
    )
    tail: list[str] = []
    last_progress = None
    assert process.stdout is not None
    buffer = ""
    while True:
        chunk = process.stdout.read(256)
        if chunk == "":
            break
        buffer += chunk
        while True:
            cut = min(
                (index for index in (buffer.find("\n"), buffer.find("\r")) if index != -1),
                default=-1,
            )
            if cut == -1:
                break
            line = buffer[:cut].strip()
            buffer = buffer[cut + 1 :]
            if not line:
                continue
            tail.append(line)
            if len(tail) > 12:
                tail.pop(0)
            match = progress_pattern.search(line)
            if match:
                stage = match.group(1).strip()
                current, total = match.group(2), match.group(3)
                key = (stage, current, total)
                if key != last_progress:
                    last_progress = key
                    emit(
                        "stage.progress",
                        jobId=job_id,
                        stageRunId=stage_run_id,
                        phase="parsing",
                        stage=stage,
                        current=int(current),
                        total=int(total),
                        detail=f"{stage} {current}/{total}",
                    )
    process.wait()
    if process.returncode != 0:
        raise RuntimeError(
            f"MinerU exited with {process.returncode}: " + "\n".join(tail[-8:])
        )

    emit("stage.phase", jobId=job_id, stageRunId=stage_run_id, phase="normalizing")
    method_dir = find_method_dir(work_dir, options["method"])
    raw_output_files = copy_raw_outputs(method_dir, raw_dir)
    raw_output_dir = raw_dir / "mineru-output"
    raw_markdown = single_output(raw_output_dir, ".md")
    raw_middle = single_output(raw_output_dir, "_middle.json")
    raw_content = single_output(raw_output_dir, "_content_list.json")

    middle = json.loads(raw_middle.read_text("utf-8"))
    content_list = json.loads(raw_content.read_text("utf-8"))
    if not isinstance(content_list, list):
        raise RuntimeError("MinerU content_list.json is not a list.")
    markdown = raw_markdown.read_text("utf-8")

    canonical, block_count, region_count = build_canonical(
        middle=middle,
        content_list=content_list,
        markdown=markdown,
        source_artifact_id=source_artifact_id,
        raw_artifact_id=raw_artifact_id,
        file_name=source_path.name,
    )
    if block_count == 0:
        raise RuntimeError("MinerU produced no content blocks.")

    primary_path = primary_dir / "parsed-document.json"
    primary_path.write_text(
        json.dumps(canonical, ensure_ascii=False, indent=2) + "\n", "utf-8"
    )

    completed_at = datetime.now(timezone.utc)
    bundle = {
        "apiVersion": "document-arena.dev/result-bundle/v1alpha1",
        "status": "completed",
        "jobId": job_id,
        "stageRunId": stage_run_id,
        "component": {
            "id": COMPONENT_ID,
            "adapterVersion": ADAPTER_VERSION,
            "upstreamVersion": UPSTREAM_VERSION,
            "modelRevision": model_revision,
            "image": component.get("image"),
            "imageDigest": component.get("imageDigest"),
        },
        "source": {"artifactId": source_artifact_id, "sha256": source_sha256},
        "options": options,
        "progress": {"mode": "phase", "partialResults": "none"},
        "primary": file_descriptor(
            primary_path, "application/vnd.document-arena.parsed-document+json"
        ),
        "rawArtifacts": [
            file_descriptor(path, artifact_media_type(path))
            for path in raw_output_files
        ],
        "timing": {
            "startedAt": started_at.isoformat(),
            "completedAt": completed_at.isoformat(),
            "durationMs": int((completed_at - started_at).total_seconds() * 1000),
        },
    }
    (OUTPUT_ROOT / "bundle.json").write_text(
        json.dumps(bundle, ensure_ascii=False, indent=2) + "\n", "utf-8"
    )
    emit(
        "stage.completed",
        jobId=job_id,
        stageRunId=stage_run_id,
        bundlePath="bundle.json",
    )


if __name__ == "__main__":
    try:
        run()
    except Exception as error:  # noqa: BLE001 - single top-level failure boundary
        message = str(error) or error.__class__.__name__
        try:
            OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
            (OUTPUT_ROOT / "failure.json").write_text(
                json.dumps(
                    {
                        "apiVersion": "document-arena.dev/stage-failure/v1alpha1",
                        "status": "failed",
                        "error": {"type": error.__class__.__name__, "message": message},
                    },
                    indent=2,
                )
                + "\n",
                "utf-8",
            )
        except OSError:
            pass
        emit("stage.failed", message=message)
        sys.exit(1)
