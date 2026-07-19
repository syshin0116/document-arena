"""Azure DI markdown + word polygons -> line segments with a native word list.

Ported from the mirae-poc reference (apps/ai/src/mirae_ai/ingestion/webview.py),
adapted to Document Arena's canonical block shape. Azure DI tokenizes Korean text
almost per-character, so each markdown line is matched back to its reading-order
words; the line keeps every matched word box (native) and their union (merged).
Nothing is inferred: a line whose text cannot be aligned to words emits no
geometry.
"""

from __future__ import annotations

import html as html_lib
import re
from dataclasses import dataclass, field
from typing import Any

# Character coverage below this is treated as a mis-match; the line drops its
# geometry rather than pointing somewhere wrong.
_MIN_COVERAGE = 0.6
_START_LOOKAHEAD = 40
_MAX_MISSES = 3

_COMMENT_RE = re.compile(r"<!--.*?-->", re.DOTALL)
_HEADING_RE = re.compile(r"^#{1,6}\s+\S")
_TABLE_RE = re.compile(r"<table[^>]*>.*?</table>", re.DOTALL | re.IGNORECASE)
_TR_RE = re.compile(r"<tr[^>]*>(.*?)</tr>", re.DOTALL | re.IGNORECASE)
_CELL_RE = re.compile(r"<t[hd][^>]*>(.*?)</t[hd]>", re.DOTALL | re.IGNORECASE)
# Only strip known HTML tags; a broad <[^>]+> would also delete literal angle
# brackets common in reports (<표 3.1>, <주1>) and break matching.
_TAG_RE = re.compile(
    r"</?(?:table|thead|tbody|tfoot|tr|td|th|caption|p|br|hr|span|div|section"
    r"|figure|figcaption|img|a|ul|ol|li|em|strong|b|i|u|sup|sub|h[1-6])\b[^>]*/?>",
    re.IGNORECASE,
)
_MD_SEP_CELL_RE = re.compile(r":?-{2,}:?")
_SELECTION_RE = re.compile(r":(?:un)?selected:")
_MD_ESCAPE_RE = re.compile(r"\\([\\`*_{}\[\]()#+.!|-])")


@dataclass
class Line:
    """One segment candidate. display is for reading; match is for alignment."""

    display: str
    match: str
    heading: bool = False
    heading_level: int = 0


@dataclass
class Cell:
    """One table cell. display is for reading; match is for word alignment."""

    display: str
    match: str


@dataclass
class Table:
    """A structured table segment: rows of cells, kept as a grid rather than
    flattened to pipe text so the canonical document carries real table blocks."""

    rows: list[list[Cell]] = field(default_factory=list)


def _norm_chars(text: str) -> str:
    return "".join(text.split())


def _clean_inline(text: str) -> str:
    text = _COMMENT_RE.sub(" ", text)
    text = _SELECTION_RE.sub(" ", text)
    text = _TAG_RE.sub(" ", text)
    text = html_lib.unescape(text)
    text = _MD_ESCAPE_RE.sub(r"\1", text)
    return " ".join(text.split())


def _table_segment(table_html: str) -> Table | None:
    rows: list[list[Cell]] = []
    for row_html in _TR_RE.findall(table_html):
        cells = [
            Cell(display=text, match=text)
            for text in (_clean_inline(c) for c in _CELL_RE.findall(row_html))
        ]
        if any(cell.display for cell in cells):
            rows.append(cells)
    if not rows:
        return None
    # Pad ragged rows so every row has the same column count.
    width = max(len(row) for row in rows)
    for row in rows:
        row.extend(Cell(display="", match="") for _ in range(width - len(row)))
    return Table(rows=rows)


def _is_md_separator(line: str) -> bool:
    cells = [c.strip() for c in line.strip().strip("|").split("|")]
    cells = [c for c in cells if c]
    return bool(cells) and all(_MD_SEP_CELL_RE.fullmatch(c) for c in cells)


def _md_table_line(line: str) -> Line | None:
    if _is_md_separator(line):
        return None
    cells = [_clean_inline(c) for c in line.strip().strip("|").split("|")]
    cells = [c for c in cells if c]
    if not cells:
        return None
    return Line(display=" | ".join(cells), match="".join(cells))


def page_lines(markdown: str) -> list[Line | Table]:
    segments: list[Line | Table] = []
    cursor = 0
    for m in _TABLE_RE.finditer(markdown):
        segments.extend(_plain_lines(markdown[cursor : m.start()]))
        table = _table_segment(m.group(0))
        if table:
            segments.append(table)
        cursor = m.end()
    segments.extend(_plain_lines(markdown[cursor:]))
    return segments


def _plain_lines(chunk: str) -> list[Line]:
    lines: list[Line] = []
    for raw in chunk.splitlines():
        stripped = _COMMENT_RE.sub(" ", raw).strip()
        if not stripped:
            continue
        if stripped.startswith("|"):
            md_row = _md_table_line(stripped)
            if md_row:
                lines.append(md_row)
            continue
        if _HEADING_RE.match(stripped):
            title = _clean_inline(stripped.lstrip("#").strip())
            if not title:
                continue
            level = len(stripped) - len(stripped.lstrip("#"))
            lines.append(
                Line(display=title, match=title, heading=True, heading_level=level)
            )
            continue
        cleaned = _clean_inline(stripped)
        if cleaned:
            lines.append(Line(display=cleaned, match=cleaned))
    return lines


class WordMatcher:
    """Greedy alignment of segment text onto the page's reading-order words."""

    def __init__(self, words: list[dict[str, Any]]) -> None:
        self._words = [w for w in words if w.get("polygon") and w.get("content")]
        self._norms = [_norm_chars(str(w["content"])) for w in self._words]
        self._pos = 0

    def match(self, text: str) -> list[dict[str, Any]]:
        target = _norm_chars(text)
        if not target:
            return []
        end = min(self._pos + _START_LOOKAHEAD, len(self._words))
        for start in range(self._pos, end):
            norm = self._norms[start]
            if not norm:
                continue
            if target.startswith(norm) or norm.startswith(target):
                used, next_pos, covered = self._consume(start, target)
                if used and covered >= _MIN_COVERAGE:
                    self._pos = next_pos
                    return used
        return []

    def _consume(
        self, start: int, target: str
    ) -> tuple[list[dict[str, Any]], int, float]:
        used: list[dict[str, Any]] = []
        i, p, misses = start, 0, 0
        while i < len(self._words) and p < len(target):
            norm = self._norms[i]
            if norm and target.startswith(norm, p):
                used.append(self._words[i])
                p += len(norm)
                i += 1
                misses = 0
            elif (
                norm
                and norm.startswith(target[p:])
                and 2 * (len(target) - p) >= len(norm)
            ):
                used.append(self._words[i])
                p = len(target)
                i += 1
            else:
                misses += 1
                i += 1
                if misses > _MAX_MISSES:
                    break
        return used, i, p / len(target)


def word_boxes(
    words: list[dict[str, Any]], width: float, height: float
) -> list[list[float]] | None:
    """Normalized (0-1) rectangles for each word polygon; None if unusable."""
    if not words or not width or not height:
        return None
    boxes: list[list[float]] = []
    for w in words:
        poly = w.get("polygon")
        if not poly:
            continue
        xs = poly[0::2]
        ys = poly[1::2]
        x0, x1 = min(xs) / width, max(xs) / width
        y0, y1 = min(ys) / height, max(ys) / height
        if x1 <= x0 or y1 <= y0:
            continue
        boxes.append([round(x0, 4), round(y0, 4), round(x1, 4), round(y1, 4)])
    return boxes or None
