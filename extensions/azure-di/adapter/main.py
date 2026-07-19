"""Azure Document Intelligence adapter for the Document Arena oci-batch/v1 protocol.

Calls the pinned prebuilt-layout profile, preserves the complete SDK result,
then maps Azure DI's own line, word, paragraph, table, span, and polygon models
to canonical blocks. No text alignment or inferred geometry is used. Each line
keeps its parser-native polygon plus any words selected by Azure content-span
overlap, so the viewer can show either the line union or the raw word boxes.
Endpoint and key arrive as env vars injected by the runner from a local
connection; they are never written to any artifact.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any

from azure.ai.documentintelligence import DocumentIntelligenceClient
from azure.ai.documentintelligence.models import (
    AnalyzeOutputOption,
    DocumentAnalysisFeature,
    DocumentContentFormat,
    StringIndexType,
)
from azure.core.credentials import AzureKeyCredential

REQUEST_PATH = Path(os.environ.get("ARENA_REQUEST_PATH", "/arena/request.json"))
INPUT_ROOT = Path(os.environ.get("ARENA_INPUT_DIR", "/arena/input")).resolve()
OUTPUT_ROOT = Path(os.environ.get("ARENA_OUTPUT_DIR", "/arena/output")).resolve()

COMPONENT_ID = "azure-di"
ADAPTER_VERSION = "0.1.0"
UPSTREAM_VERSION = "azure-ai-documentintelligence@1.0.2"
MODEL_ID = "prebuilt-layout"
API_VERSION = "2024-11-30"
DEFAULT_FEATURES = [DocumentAnalysisFeature.OCR_HIGH_RESOLUTION.value]
ALLOWED_FEATURES = {feature.value for feature in DocumentAnalysisFeature}
ALLOWED_OUTPUTS = {AnalyzeOutputOption.FIGURES.value}
PAGES_PATTERN = re.compile(
    r"^[1-9][0-9]*(?:-[1-9][0-9]*)?(?:,[1-9][0-9]*(?:-[1-9][0-9]*)?)*$"
)
LOCALE_PATTERN = re.compile(r"^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$")


def emit(event_type: str, **fields: object) -> None:
    sys.stdout.write(
        json.dumps(
            {
                "apiVersion": "document-arena.dev/job-event/v1alpha1",
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
    allowed = {
        "modelId",
        "apiVersion",
        "pages",
        "locale",
        "stringIndexType",
        "features",
        "queryFields",
        "outputContentFormat",
        "output",
    }
    for key in options:
        if key not in allowed:
            raise ValueError(f"Unsupported option: {key}")

    if options.get("modelId", MODEL_ID) != MODEL_ID:
        raise ValueError(f"Option modelId is fixed to {MODEL_ID}.")
    if options.get("apiVersion", API_VERSION) != API_VERSION:
        raise ValueError(f"Option apiVersion is fixed to {API_VERSION}.")

    pages = options.get("pages")
    if pages is not None and (
        not isinstance(pages, str) or PAGES_PATTERN.fullmatch(pages) is None
    ):
        raise ValueError("Invalid pages option.")

    locale = options.get("locale", "auto")
    if not isinstance(locale, str) or (
        locale != "auto" and LOCALE_PATTERN.fullmatch(locale) is None
    ):
        raise ValueError("Invalid locale option.")

    string_index_type = options.get("stringIndexType", "unicodeCodePoint")
    if string_index_type != StringIndexType.UNICODE_CODE_POINT.value:
        raise ValueError(
            "This adapter requires unicodeCodePoint offsets for Python slicing."
        )

    features = options.get("features", DEFAULT_FEATURES)
    if (
        not isinstance(features, list)
        or any(not isinstance(value, str) for value in features)
        or len(features) != len(set(features))
        or any(value not in ALLOWED_FEATURES for value in features)
    ):
        raise ValueError("Invalid features option.")

    query_fields_input = options.get("queryFields", [])
    if not isinstance(query_fields_input, list) or any(
        not isinstance(value, str) for value in query_fields_input
    ):
        raise ValueError("Invalid queryFields option.")
    query_fields = [value.strip() for value in query_fields_input]
    if (
        len(query_fields) > 20
        or any(not value or len(value) > 128 for value in query_fields)
        or len(query_fields) != len(set(query_fields))
    ):
        raise ValueError("Invalid queryFields option.")
    if query_fields and DocumentAnalysisFeature.QUERY_FIELDS.value not in features:
        features = [*features, DocumentAnalysisFeature.QUERY_FIELDS.value]

    output_content_format = options.get("outputContentFormat", "markdown")
    if output_content_format != DocumentContentFormat.MARKDOWN.value:
        raise ValueError("This adapter requires Markdown content for normalization.")

    output = options.get("output", [])
    if (
        not isinstance(output, list)
        or any(not isinstance(value, str) for value in output)
        or len(output) != len(set(output))
        or any(value not in ALLOWED_OUTPUTS for value in output)
    ):
        raise ValueError("Invalid output option.")

    return {
        "modelId": MODEL_ID,
        "apiVersion": API_VERSION,
        **({"pages": pages} if pages else {}),
        "locale": locale,
        "stringIndexType": string_index_type,
        "features": features,
        "queryFields": query_fields,
        "outputContentFormat": output_content_format,
        "output": output,
    }


def _span_ranges(value: object) -> list[tuple[int, int]]:
    """Return valid half-open content ranges from an Azure model object."""
    spans = getattr(value, "spans", None)
    if spans is None:
        single = getattr(value, "span", None)
        spans = [single] if single is not None else []
    ranges: list[tuple[int, int]] = []
    for span in spans or []:
        offset = getattr(span, "offset", None)
        length = getattr(span, "length", None)
        if (
            isinstance(offset, int)
            and isinstance(length, int)
            and offset >= 0
            and length > 0
        ):
            ranges.append((offset, offset + length))
    return ranges


def _span_start(value: object) -> int:
    ranges = _span_ranges(value)
    return min((start for start, _end in ranges), default=sys.maxsize)


def _span_start_on_page(value: object, page_ranges: list[tuple[int, int]]) -> int:
    starts = [
        max(start, page_start)
        for start, end in _span_ranges(value)
        for page_start, page_end in page_ranges
        if start < page_end and page_start < end
    ]
    return min(starts, default=sys.maxsize)


def _ranges_overlap(left: list[tuple[int, int]], right: list[tuple[int, int]]) -> bool:
    return any(
        a_start < b_end and b_start < a_end
        for a_start, a_end in left
        for b_start, b_end in right
    )


def _enum_value(value: object) -> str | None:
    if value is None:
        return None
    raw = getattr(value, "value", value)
    return str(raw)


def _bounding_polygons(value: object, page_number: int) -> list[list[float]]:
    polygons: list[list[float]] = []
    for region in getattr(value, "bounding_regions", None) or []:
        if getattr(region, "page_number", None) != page_number:
            continue
        polygon = getattr(region, "polygon", None)
        if polygon:
            polygons.append(list(polygon))
    return polygons


def _belongs_to_page(
    value: object, page_ranges: list[tuple[int, int]], page_number: int
) -> bool:
    value_ranges = _span_ranges(value)
    if page_ranges and value_ranges:
        return _ranges_overlap(value_ranges, page_ranges)
    return bool(_bounding_polygons(value, page_number))


def _nonnegative_int(value: object) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        return None
    return value


def _positive_finite_float(value: object) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0
    return number if math.isfinite(number) and number > 0 else 0


def _polygon_rect(
    polygons: list[list[float]], width: float, height: float
) -> tuple[list[float], list[float]] | None:
    """Return normalized and native union rectangles for valid Azure polygons."""
    if not polygons or width <= 0 or height <= 0:
        return None
    xs: list[float] = []
    ys: list[float] = []
    for polygon in polygons:
        if len(polygon) < 4 or len(polygon) % 2 != 0:
            continue
        try:
            coordinates = [float(value) for value in polygon]
        except (TypeError, ValueError):
            continue
        if not all(math.isfinite(value) for value in coordinates):
            continue
        xs.extend(coordinates[0::2])
        ys.extend(coordinates[1::2])
    if not xs or not ys:
        return None
    x0, x1 = min(xs), max(xs)
    y0, y1 = min(ys), max(ys)
    if x1 <= x0 or y1 <= y0:
        return None
    if x0 < 0 or y0 < 0 or x1 > width or y1 > height:
        return None
    normalized = [
        round(x0 / width, 4),
        round(y0 / height, 4),
        round(x1 / width, 4),
        round(y1 / height, 4),
    ]
    native = [round(x0, 3), round(y0, 3), round(x1, 3), round(y1, 3)]
    return normalized, native


def _word_boxes_for_line(page: object, line: object) -> list[list[float]]:
    """Select native word polygons by Azure content-span overlap, never text inference."""
    width = _positive_finite_float(getattr(page, "width", 0))
    height = _positive_finite_float(getattr(page, "height", 0))
    line_ranges = _span_ranges(line)
    boxes: list[list[float]] = []
    for word in getattr(page, "words", None) or []:
        polygon = getattr(word, "polygon", None)
        if not polygon or not _ranges_overlap(line_ranges, _span_ranges(word)):
            continue
        raw_polygon = list(polygon)
        rect = _polygon_rect([raw_polygon], width, height)
        if rect is None:
            continue
        boxes.append(rect[0])
    return boxes


def _native_region(
    *,
    polygons: list[list[float]],
    page: object,
    raw_artifact_id: str,
    json_pointer: str,
    word_boxes: list[list[float]] | None = None,
) -> dict[str, Any] | None:
    width = _positive_finite_float(getattr(page, "width", 0))
    height = _positive_finite_float(getattr(page, "height", 0))
    rect = _polygon_rect(polygons, width, height)
    if rect is None:
        return None
    normalized, native = rect
    unit = _enum_value(getattr(page, "unit", None)) or "page-unit"
    native_details: dict[str, Any] = {
        "bbox": native,
        "coordinateSystem": f"azure-di-{unit}-top-left",
        "artifactId": raw_artifact_id,
        "jsonPointer": json_pointer,
    }
    if word_boxes:
        native_details["words"] = word_boxes
    return {
        "pageNumber": getattr(page, "page_number"),
        "bbox": normalized,
        "provenance": "native",
        "native": native_details,
    }


def _heading_level(line: object, paragraphs: list[object]) -> int | None:
    line_ranges = _span_ranges(line)
    for paragraph in paragraphs:
        if not _ranges_overlap(line_ranges, _span_ranges(paragraph)):
            continue
        role = _enum_value(getattr(paragraph, "role", None))
        if role == "title":
            return 1
        if role == "sectionHeading":
            return 2
    return None


def build_canonical(
    *,
    content: str,
    pages,
    paragraphs,
    tables,
    source_artifact_id: str,
    raw_artifact_id: str,
    file_name: str,
) -> tuple[dict, str, int, int]:
    canonical_pages = []
    block_count = 0
    region_count = 0
    paragraphs = list(paragraphs or [])
    tables = list(tables or [])
    table_ranges = [
        span
        for table in tables
        for cell in (table.cells or [])
        for span in _span_ranges(cell)
    ]
    table_ranges.extend(
        span
        for table in tables
        if not any(_span_ranges(cell) for cell in (table.cells or []))
        for span in _span_ranges(table)
    )

    for page_index, page in enumerate(pages):
        page_no = page.page_number
        width = _positive_finite_float(page.width)
        height = _positive_finite_float(page.height)
        page_ranges = _span_ranges(page)
        page_paragraphs = [
            paragraph
            for paragraph in paragraphs
            if _belongs_to_page(paragraph, page_ranges, page_no)
        ]

        items: list[tuple[int, int, str, int, object, object]] = []
        for line_index, line in enumerate(page.lines or []):
            text = str(getattr(line, "content", "") or "").strip()
            if not text or _ranges_overlap(_span_ranges(line), table_ranges):
                continue
            items.append((_span_start(line), 1, "line", line_index, line, None))

        for table_index, table in enumerate(tables):
            page_cells = [
                (cell_index, cell)
                for cell_index, cell in enumerate(table.cells or [])
                if _belongs_to_page(cell, page_ranges, page_no)
            ]
            if not page_cells and not _belongs_to_page(table, page_ranges, page_no):
                continue
            starts = [
                _span_start_on_page(cell, page_ranges) for _index, cell in page_cells
            ]
            starts = [start for start in starts if start != sys.maxsize]
            if not starts:
                starts = [_span_start_on_page(table, page_ranges)]
            items.append((min(starts), 0, "table", table_index, table, page_cells))

        items.sort(key=lambda item: (item[0], item[1], item[3]))

        blocks: list[dict[str, Any]] = []
        order = 0
        for _start, _kind_order, item_kind, item_index, value, extra in items:
            if item_kind == "table":
                table = value
                page_cells = extra
                table_ptr = f"/tables/{item_index}"
                table_block: dict = {
                    "id": f"azuredi-p{page_no}-t{item_index}",
                    "kind": "table",
                    "readingOrder": order,
                    "rawArtifactRef": raw_artifact_id,
                    "rawJsonPointer": table_ptr,
                }
                table_block["tableBlockId"] = table_block["id"]
                table_polygons = _bounding_polygons(table, page_no)
                table_region = _native_region(
                    polygons=table_polygons,
                    page=page,
                    raw_artifact_id=raw_artifact_id,
                    json_pointer=table_ptr,
                )
                if table_region is not None:
                    table_block["sourceRegions"] = [table_region]
                    region_count += 1
                blocks.append(table_block)
                order += 1
                block_count += 1

                for cell_index, cell in sorted(
                    page_cells,
                    key=lambda pair: (
                        _nonnegative_int(getattr(pair[1], "row_index", None))
                        if _nonnegative_int(getattr(pair[1], "row_index", None))
                        is not None
                        else sys.maxsize,
                        _nonnegative_int(getattr(pair[1], "column_index", None))
                        if _nonnegative_int(getattr(pair[1], "column_index", None))
                        is not None
                        else sys.maxsize,
                        pair[0],
                    ),
                ):
                    row_index = _nonnegative_int(getattr(cell, "row_index", None))
                    column_index = _nonnegative_int(getattr(cell, "column_index", None))
                    cell_ptr = f"{table_ptr}/cells/{cell_index}"
                    cell_block: dict[str, Any] = {
                        "id": f"azuredi-p{page_no}-t{item_index}-c{cell_index}",
                        "kind": "table-cell",
                        "readingOrder": order,
                        "rawArtifactRef": raw_artifact_id,
                        "rawJsonPointer": cell_ptr,
                        "tableBlockId": table_block["id"],
                    }
                    if row_index is not None and column_index is not None:
                        table_cell: dict[str, int] = {
                            "rowIndex": row_index,
                            "columnIndex": column_index,
                        }
                        row_span = _nonnegative_int(getattr(cell, "row_span", None))
                        column_span = _nonnegative_int(
                            getattr(cell, "column_span", None)
                        )
                        if row_span and row_span > 1:
                            table_cell["rowSpan"] = row_span
                        if column_span and column_span > 1:
                            table_cell["columnSpan"] = column_span
                        cell_block["tableCell"] = table_cell
                    cell_text = str(getattr(cell, "content", "") or "").strip()
                    if cell_text:
                        cell_block["text"] = cell_text
                    cell_region = _native_region(
                        polygons=_bounding_polygons(cell, page_no),
                        page=page,
                        raw_artifact_id=raw_artifact_id,
                        json_pointer=cell_ptr,
                    )
                    if cell_region is not None:
                        cell_block["sourceRegions"] = [cell_region]
                        region_count += 1
                    blocks.append(cell_block)
                    order += 1
                    block_count += 1
                continue

            line = value
            pointer = f"/pages/{page_index}/lines/{item_index}"
            heading_level = _heading_level(line, page_paragraphs)
            block: dict[str, Any] = {
                "id": f"azuredi-p{page_no}-l{item_index}",
                "kind": "heading" if heading_level else "paragraph",
                "readingOrder": order,
                "rawArtifactRef": raw_artifact_id,
                "rawJsonPointer": pointer,
                "text": str(getattr(line, "content", "") or "").strip(),
            }
            if heading_level:
                block["headingLevel"] = heading_level

            word_boxes = _word_boxes_for_line(page, line)
            line_polygon = getattr(line, "polygon", None)
            line_polygons = [list(line_polygon)] if line_polygon else []
            line_region = _native_region(
                polygons=line_polygons,
                page=page,
                raw_artifact_id=raw_artifact_id,
                json_pointer=pointer,
                word_boxes=word_boxes,
            )
            if line_region is not None:
                block["sourceRegions"] = [line_region]
                region_count += 1
            blocks.append(block)
            order += 1
            block_count += 1

        canonical_pages.append(
            {
                "pageNumber": page_no,
                "width": width or 1,
                "height": height or 1,
                "blocks": blocks,
            }
        )

    markdown = content
    canonical = {
        "apiVersion": "document-arena.dev/parsed-document/v1alpha1",
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
        "rawArtifactRefs": [raw_artifact_id],
    }
    return canonical, markdown, block_count, region_count


def run() -> None:
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
    raw_artifact_id = (
        request.get("rawArtifactId") or f"raw:{stage_run_id}:parser-output"
    )

    raw_dir = OUTPUT_ROOT / "raw"
    primary_dir = OUTPUT_ROOT / "primary"
    raw_dir.mkdir(parents=True, exist_ok=True)
    primary_dir.mkdir(parents=True, exist_ok=True)

    emit("stage.phase", jobId=job_id, stageRunId=stage_run_id, phase="inspecting")
    client = DocumentIntelligenceClient(
        endpoint,
        AzureKeyCredential(key),
        api_version=API_VERSION,
    )

    emit("stage.phase", jobId=job_id, stageRunId=stage_run_id, phase="parsing")
    analyze_kwargs = {
        "output_content_format": DocumentContentFormat(options["outputContentFormat"]),
        "string_index_type": StringIndexType(options["stringIndexType"]),
        "features": [DocumentAnalysisFeature(value) for value in options["features"]],
    }
    if options.get("pages"):
        analyze_kwargs["pages"] = options["pages"]
    if options["locale"] != "auto":
        analyze_kwargs["locale"] = options["locale"]
    if options["queryFields"]:
        analyze_kwargs["query_fields"] = options["queryFields"]
    if options["output"]:
        analyze_kwargs["output"] = [
            AnalyzeOutputOption(value) for value in options["output"]
        ]
    with source_path.open("rb") as handle:
        poller = client.begin_analyze_document(
            MODEL_ID,
            body=handle,
            content_type="application/octet-stream",
            **analyze_kwargs,
        )
    result = poller.result()
    content = result.content or ""

    emit("stage.phase", jobId=job_id, stageRunId=stage_run_id, phase="normalizing")

    # Preserve the complete SDK result before normalization. The exact service
    # Markdown and a geometry-focused view remain separate artifacts for direct
    # inspection and stable evidence pointers.
    raw_result = raw_dir / "azure-di-result.json"
    raw_result.write_text(
        json.dumps(result.as_dict(), ensure_ascii=False, indent=2) + "\n",
        "utf-8",
    )
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

    figure_artifacts = []
    if AnalyzeOutputOption.FIGURES.value in options["output"]:
        operation_id = poller.details["operation_id"]
        for index, figure in enumerate(result.figures or []):
            if not figure.id:
                continue
            figure_path = raw_dir / f"azure-di-figure-{index + 1}.png"
            response = client.get_analyze_result_figure(
                model_id=result.model_id,
                result_id=operation_id,
                figure_id=figure.id,
            )
            with figure_path.open("wb") as writer:
                writer.writelines(response)
            figure_artifacts.append(file_descriptor(figure_path, "image/png"))

    canonical, _markdown, block_count, region_count = build_canonical(
        content=content,
        pages=result.pages or [],
        paragraphs=result.paragraphs or [],
        tables=result.tables or [],
        source_artifact_id=source_artifact_id,
        raw_artifact_id=raw_artifact_id,
        file_name=source_path.name,
    )
    if block_count == 0:
        raise RuntimeError("Azure DI produced no content blocks.")

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
            file_descriptor(raw_result, "application/json"),
            file_descriptor(raw_words, "application/json"),
            file_descriptor(raw_markdown, "text/markdown"),
            *figure_artifacts,
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
    except Exception:  # noqa: BLE001 - single top-level failure boundary
        # Provider exceptions may contain endpoint, credential, response, or
        # document material. Keep the adapter failure artifact intentionally
        # generic; the runner also scans every output before retaining it.
        message = "Azure Document Intelligence execution failed."
        try:
            OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
            (OUTPUT_ROOT / "failure.json").write_text(
                json.dumps(
                    {
                        "apiVersion": "document-arena.dev/stage-failure/v1alpha1",
                        "status": "failed",
                        "error": {
                            "type": "ComponentExecutionError",
                            "message": message,
                        },
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
