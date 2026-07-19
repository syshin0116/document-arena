"""Azure Document Intelligence adapter for the Parser Arena oci-batch/v1 protocol.

Calls prebuilt-layout (MARKDOWN + OCR_HIGH_RESOLUTION), then folds Azure DI's
near-per-character Korean word polygons into markdown line segments. Each line
block carries the union of its words as its native region and keeps the
individual word boxes under native.words, so the viewer can show either the
merged line or the raw words. Endpoint and key arrive as env vars injected by
the runner from a local connection; they are never written to any artifact.
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

from azure.ai.documentintelligence import DocumentIntelligenceClient
from azure.ai.documentintelligence.models import (
    DocumentAnalysisFeature,
    DocumentContentFormat,
)
from azure.core.credentials import AzureKeyCredential

from webview import Table, WordMatcher, page_lines, word_boxes

REQUEST_PATH = Path(os.environ.get("ARENA_REQUEST_PATH", "/arena/request.json"))
INPUT_ROOT = Path(os.environ.get("ARENA_INPUT_DIR", "/arena/input")).resolve()
OUTPUT_ROOT = Path(os.environ.get("ARENA_OUTPUT_DIR", "/arena/output")).resolve()

COMPONENT_ID = "azure-di"
ADAPTER_VERSION = "0.1.0"
UPSTREAM_VERSION = "prebuilt-layout"
ALLOWED_LOCALES = ["auto", "ko-KR", "en-US", "ja-JP", "zh-Hans"]


def emit(event_type: str, **fields: object) -> None:
    sys.stdout.write(
        json.dumps(
            {
                "apiVersion": "parser-arena.dev/job-event/v1alpha1",
                "type": event_type,
                **fields,
            },
            ensure_ascii=False,
        )
        + "\n"
    )
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
    for key in options:
        if key not in {"locale", "highResolution"}:
            raise ValueError(f"Unsupported option: {key}")
    locale = options.get("locale", "ko-KR")
    if locale not in ALLOWED_LOCALES:
        raise ValueError("Invalid locale option.")
    high_res = options.get("highResolution", True)
    if not isinstance(high_res, bool):
        raise ValueError("Invalid highResolution option.")
    return {"locale": locale, "highResolution": high_res}


def slice_spans(content: str, spans) -> str:
    parts = [content[sp.offset : sp.offset + sp.length] for sp in (spans or [])]
    return "".join(parts).strip()


def union_points(words: list[dict]) -> list[float]:
    xs: list[float] = []
    ys: list[float] = []
    for w in words:
        poly = w["polygon"]
        xs.extend(poly[0::2])
        ys.extend(poly[1::2])
    return [
        round(min(xs), 3),
        round(min(ys), 3),
        round(max(xs), 3),
        round(max(ys), 3),
    ]


def union_norm(boxes: list[list[float]]) -> list[float]:
    return [
        round(min(b[0] for b in boxes), 4),
        round(min(b[1] for b in boxes), 4),
        round(max(b[2] for b in boxes), 4),
        round(max(b[3] for b in boxes), 4),
    ]


def build_canonical(
    *,
    content: str,
    pages,
    source_artifact_id: str,
    raw_artifact_id: str,
    file_name: str,
) -> tuple[dict, str, int, int]:
    canonical_pages = []
    markdown_parts: list[str] = []
    block_count = 0
    region_count = 0

    for page in pages:
        page_no = page.page_number
        width = float(page.width or 0)
        height = float(page.height or 0)
        page_md = slice_spans(content, page.spans)
        markdown_parts.append(page_md)
        words = [
            {"content": w.content, "polygon": list(w.polygon)}
            for w in (page.words or [])
            if getattr(w, "polygon", None)
        ]
        matcher = WordMatcher(words)

        def region_for(matched, pointer):
            """Native source region for a matched run of words, or None."""
            boxes = word_boxes(matched, width, height) if matched else None
            if not boxes:
                return None
            return {
                "pageNumber": page_no,
                "bbox": union_norm(boxes),
                "provenance": "native",
                "native": {
                    "bbox": union_points(matched),
                    "coordinateSystem": "azure-di-page-points-union",
                    "words": boxes,
                    "artifactId": raw_artifact_id,
                    "jsonPointer": pointer,
                },
            }

        blocks = []
        order = 0
        line_index = 0
        table_index = 0
        for segment in page_lines(page_md):
            if isinstance(segment, Table):
                # Emit a structured table: one `table` block plus `table-cell`
                # blocks whose rawJsonPointer encodes the grid, so the reading
                # view reconstructs a real table (not pipe text). Each cell is
                # aligned to its own words in reading order for per-cell geometry.
                table_ptr = f"/pages/{page_no - 1}/tables/{table_index}"
                table_block: dict = {
                    "id": f"azuredi-p{page_no}-t{table_index}",
                    "kind": "table",
                    "readingOrder": order,
                    "rawArtifactRef": raw_artifact_id,
                    "rawJsonPointer": table_ptr,
                }
                blocks.append(table_block)
                order += 1
                block_count += 1

                table_matched: list[dict] = []
                for row_index, row in enumerate(segment.rows):
                    for column_index, cell in enumerate(row):
                        matched = matcher.match(cell.match) if cell.match else []
                        cell_ptr = (
                            f"{table_ptr}/rows/{row_index}/cells/{column_index}"
                        )
                        cell_block: dict = {
                            "id": (
                                f"azuredi-p{page_no}-t{table_index}"
                                f"-r{row_index}-c{column_index}"
                            ),
                            "kind": "table-cell",
                            "readingOrder": order,
                            "rawArtifactRef": raw_artifact_id,
                            "rawJsonPointer": cell_ptr,
                        }
                        if cell.display:
                            cell_block["text"] = cell.display
                        region = region_for(matched, cell_ptr)
                        if region is not None:
                            cell_block["sourceRegions"] = [region]
                            region_count += 1
                            table_matched.extend(matched)
                        blocks.append(cell_block)
                        order += 1
                        block_count += 1

                # Give the table a whole-table region (union of its cells) so it
                # highlights as one unit in merged mode and the blocks view.
                table_region = region_for(table_matched, table_ptr)
                if table_region is not None:
                    table_block["sourceRegions"] = [table_region]
                    region_count += 1
                table_index += 1
                continue

            line = segment
            pointer = f"/pages/{page_no - 1}/lines/{line_index}"
            matched = matcher.match(line.match)
            block: dict = {
                "id": f"azuredi-p{page_no}-l{line_index}",
                "kind": "heading" if line.heading else "paragraph",
                "readingOrder": order,
                "rawArtifactRef": raw_artifact_id,
                "rawJsonPointer": pointer,
                "text": line.display,
            }
            if line.heading and line.heading_level:
                block["headingLevel"] = min(line.heading_level, 6)

            region = region_for(matched, pointer)
            if region is not None:
                block["sourceRegions"] = [region]
                region_count += 1
            blocks.append(block)
            order += 1
            line_index += 1
            block_count += 1

        canonical_pages.append(
            {
                "pageNumber": page_no,
                "width": width or 1,
                "height": height or 1,
                "blocks": blocks,
            }
        )

    markdown = "\n\n".join(part for part in markdown_parts if part)
    canonical = {
        "apiVersion": "parser-arena.dev/parsed-document/v1alpha1",
        "sourceArtifactRef": source_artifact_id,
        "parser": {"id": COMPONENT_ID, "upstreamVersion": UPSTREAM_VERSION},
        "metadata": {
            "fileName": file_name,
            "numberOfPages": len(canonical_pages),
            "title": None,
            "author": None,
        },
        "markdown": markdown,
        "pages": canonical_pages,
    }
    return canonical, markdown, block_count, region_count


def run() -> None:
    started_at = datetime.now(timezone.utc)
    request = json.loads(REQUEST_PATH.read_text("utf-8"))
    if request.get("apiVersion") != "parser-arena.dev/stage-request/v1alpha1":
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
        raise ValueError("Azure DI extension accepts PDF inputs only.")
    source_sha256 = sha256_file(source_path)
    if source.get("sha256") and source.get("sha256") != source_sha256:
        raise ValueError("Source SHA-256 does not match the stage request.")

    options = resolve_options(request.get("options"))
    endpoint = os.environ.get("AZURE_DI_ENDPOINT", "").strip()
    key = os.environ.get("AZURE_DI_KEY", "").strip()
    if not endpoint or not key:
        raise RuntimeError(
            "AZURE_DI_ENDPOINT / AZURE_DI_KEY not set — configure the azure-di "
            "connection in your local .env."
        )

    job_id = request.get("jobId")
    stage_run_id = request.get("stageRunId")
    raw_artifact_id = request.get("rawArtifactId") or f"raw:{stage_run_id}:parser-output"

    raw_dir = OUTPUT_ROOT / "raw"
    primary_dir = OUTPUT_ROOT / "primary"
    raw_dir.mkdir(parents=True, exist_ok=True)
    primary_dir.mkdir(parents=True, exist_ok=True)

    emit("stage.phase", jobId=job_id, stageRunId=stage_run_id, phase="inspecting")
    client = DocumentIntelligenceClient(endpoint, AzureKeyCredential(key))

    emit("stage.phase", jobId=job_id, stageRunId=stage_run_id, phase="parsing")
    features = (
        [DocumentAnalysisFeature.OCR_HIGH_RESOLUTION]
        if options["highResolution"]
        else []
    )
    analyze_kwargs = {
        "output_content_format": DocumentContentFormat.MARKDOWN,
        "features": features,
    }
    if options["locale"] != "auto":
        analyze_kwargs["locale"] = options["locale"]
    with source_path.open("rb") as handle:
        poller = client.begin_analyze_document(
            "prebuilt-layout",
            body=handle,
            content_type="application/octet-stream",
            **analyze_kwargs,
        )
    result = poller.result()
    content = result.content or ""

    emit("stage.phase", jobId=job_id, stageRunId=stage_run_id, phase="normalizing")

    # Preserve raw outputs untouched: the markdown Azure returned and the
    # per-page word polygons used for alignment.
    raw_markdown = raw_dir / "azure-di.md"
    raw_markdown.write_text(content, "utf-8")
    raw_words = raw_dir / "azure-di-words.json"
    raw_words.write_text(
        json.dumps(
            {
                "pages": [
                    {
                        "pageNumber": p.page_number,
                        "width": p.width,
                        "height": p.height,
                        "unit": str(p.unit) if p.unit else None,
                        "words": [
                            {"content": w.content, "polygon": list(w.polygon)}
                            for w in (p.words or [])
                            if getattr(w, "polygon", None)
                        ],
                    }
                    for p in (result.pages or [])
                ]
            },
            ensure_ascii=False,
        ),
        "utf-8",
    )

    canonical, _markdown, block_count, region_count = build_canonical(
        content=content,
        pages=result.pages or [],
        source_artifact_id=source_artifact_id,
        raw_artifact_id=raw_artifact_id,
        file_name=source_path.name,
    )
    if block_count == 0:
        raise RuntimeError("Azure DI produced no content lines.")

    primary_path = primary_dir / "parsed-document.json"
    primary_path.write_text(
        json.dumps(canonical, ensure_ascii=False, indent=2) + "\n", "utf-8"
    )

    completed_at = datetime.now(timezone.utc)
    bundle = {
        "apiVersion": "parser-arena.dev/result-bundle/v1alpha1",
        "status": "completed",
        "jobId": job_id,
        "stageRunId": stage_run_id,
        "component": {
            "id": COMPONENT_ID,
            "adapterVersion": ADAPTER_VERSION,
            "upstreamVersion": UPSTREAM_VERSION,
            "image": component.get("image"),
            "imageDigest": component.get("imageDigest"),
        },
        "source": {"artifactId": source_artifact_id, "sha256": source_sha256},
        "options": options,
        "progress": {"mode": "phase", "partialResults": "none"},
        "primary": file_descriptor(
            primary_path, "application/vnd.parser-arena.parsed-document+json"
        ),
        "rawArtifacts": [
            file_descriptor(raw_words, "application/json"),
            file_descriptor(raw_markdown, "text/markdown"),
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
                        "apiVersion": "parser-arena.dev/stage-failure/v1alpha1",
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
