from __future__ import annotations

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "adapter"))

from main import build_canonical  # noqa: E402


def model(**values):
    return SimpleNamespace(**values)


def span(offset: int, length: int):
    return model(offset=offset, length=length)


def region(page_number: int, polygon: list[float]):
    return model(page_number=page_number, polygon=polygon)


class NativeNormalizationTest(unittest.TestCase):
    def test_uses_native_spans_and_polygons_without_duplicate_table_lines(self):
        title_polygon = [10, 10, 40, 10, 40, 20, 10, 20]
        table_polygon = [10, 50, 90, 50, 90, 90, 10, 90]
        body_polygon = [10, 110, 70, 110, 70, 120, 10, 120]
        lines = [
            model(content="Title", spans=[span(0, 5)], polygon=title_polygon),
            model(content="A B", spans=[span(6, 3)], polygon=table_polygon),
            model(content="Body", spans=[span(10, 4)], polygon=body_polygon),
        ]
        words = [
            model(content="Title", span=span(0, 5), polygon=title_polygon),
            model(content="Body", span=span(10, 4), polygon=body_polygon),
        ]
        page = model(
            page_number=1,
            width=100,
            height=200,
            unit="inch",
            spans=[span(0, 14)],
            lines=lines,
            words=words,
        )
        paragraphs = [
            model(
                role="title",
                spans=[span(0, 5)],
                bounding_regions=[region(1, title_polygon)],
            )
        ]
        cells = [
            model(
                row_index=0,
                column_index=0,
                content="A",
                spans=[span(6, 1)],
                bounding_regions=[region(1, [10, 50, 45, 50, 45, 90, 10, 90])],
            ),
            model(
                row_index=0,
                column_index=1,
                content="B",
                spans=[span(8, 1)],
                bounding_regions=[region(1, [45, 50, 90, 50, 90, 90, 45, 90])],
            ),
        ]
        tables = [
            model(
                spans=[span(6, 3)],
                cells=cells,
                bounding_regions=[region(1, table_polygon)],
            )
        ]

        canonical, markdown, block_count, region_count = build_canonical(
            content="# Title\n\n| A | B |\n\nBody",
            pages=[page],
            paragraphs=paragraphs,
            tables=tables,
            source_artifact_id="source:1",
            raw_artifact_id="raw:1",
            file_name="fixture.pdf",
        )

        blocks = canonical["pages"][0]["blocks"]
        self.assertEqual(
            [block["kind"] for block in blocks],
            ["heading", "table", "table-cell", "table-cell", "paragraph"],
        )
        self.assertEqual([block["readingOrder"] for block in blocks], list(range(5)))
        self.assertEqual(blocks[0]["headingLevel"], 1)
        self.assertEqual(blocks[0]["rawJsonPointer"], "/pages/0/lines/0")
        self.assertEqual(blocks[0]["sourceRegions"][0]["bbox"], [0.1, 0.05, 0.4, 0.1])
        self.assertEqual(
            blocks[0]["sourceRegions"][0]["native"]["words"],
            [[0.1, 0.05, 0.4, 0.1]],
        )
        self.assertEqual(
            blocks[2]["sourceRegions"][0]["native"]["jsonPointer"],
            "/tables/0/cells/0",
        )
        self.assertEqual(blocks[2]["rawJsonPointer"], "/tables/0/cells/0")
        self.assertEqual(blocks[2]["tableCell"], {"rowIndex": 0, "columnIndex": 0})
        self.assertEqual(blocks[2]["tableBlockId"], blocks[1]["id"])
        self.assertNotIn("azuredi-p1-l1", {block["id"] for block in blocks})
        self.assertEqual(markdown, "# Title\n\n| A | B |\n\nBody")
        self.assertEqual(canonical["rawArtifactRefs"], ["raw:1"])
        self.assertEqual(
            blocks[0]["sourceRegions"][0]["native"]["coordinateSystem"],
            "azure-di-inch-top-left",
        )
        self.assertEqual(block_count, 5)
        self.assertEqual(region_count, 5)

    def test_drops_invalid_geometry_instead_of_clamping_or_serializing_it(self):
        invalid_polygons = [
            [-1, 10, 40, 10, 40, 20, -1, 20],
            [float("nan"), 10, 40, 10, 40, 20, 10, 20],
            [10, 10, float("inf"), 10, 40, 20, 10, 20],
        ]

        for polygon in invalid_polygons:
            with self.subTest(polygon=polygon):
                line = model(
                    content="Outside",
                    spans=[span(0, 7)],
                    polygon=polygon,
                )
                page = model(
                    page_number=1,
                    width=100,
                    height=200,
                    unit="inch",
                    spans=[span(0, 7)],
                    lines=[line],
                    words=[],
                )

                canonical, _markdown, _block_count, region_count = build_canonical(
                    content="Outside",
                    pages=[page],
                    paragraphs=[],
                    tables=[],
                    source_artifact_id="source:1",
                    raw_artifact_id="raw:1",
                    file_name="fixture.pdf",
                )

                block = canonical["pages"][0]["blocks"][0]
                self.assertNotIn("sourceRegions", block)
                self.assertEqual(region_count, 0)

    def test_drops_geometry_when_page_dimensions_are_not_finite(self):
        line = model(
            content="Unsafe dimensions",
            spans=[span(0, 17)],
            polygon=[10, 10, 40, 10, 40, 20, 10, 20],
        )
        page = model(
            page_number=1,
            width=float("nan"),
            height=200,
            unit="inch",
            spans=[span(0, 17)],
            lines=[line],
            words=[],
        )

        canonical, _markdown, _block_count, region_count = build_canonical(
            content="Unsafe dimensions",
            pages=[page],
            paragraphs=[],
            tables=[],
            source_artifact_id="source:1",
            raw_artifact_id="raw:1",
            file_name="fixture.pdf",
        )

        canonical_page = canonical["pages"][0]
        self.assertEqual(canonical_page["width"], 1.0)
        self.assertEqual(canonical_page["height"], 200.0)
        self.assertNotIn("sourceRegions", canonical_page["blocks"][0])
        self.assertEqual(region_count, 0)

    def test_logical_structure_does_not_depend_on_geometry(self):
        page = model(
            page_number=1,
            width=100,
            height=200,
            unit="inch",
            spans=[span(0, 12)],
            lines=[
                model(content="Title", spans=[span(0, 5)], polygon=None),
                model(content="Cell", spans=[span(7, 4)], polygon=None),
            ],
            words=[],
        )
        paragraph = model(
            role="title",
            spans=[span(0, 5)],
            bounding_regions=[],
        )
        cell = model(
            row_index=0,
            column_index=0,
            content="Cell",
            spans=[span(7, 4)],
            bounding_regions=[],
        )
        table = model(
            spans=[span(7, 4)],
            cells=[cell],
            bounding_regions=[],
        )

        canonical, _markdown, _block_count, region_count = build_canonical(
            content="Title\nCell",
            pages=[page],
            paragraphs=[paragraph],
            tables=[table],
            source_artifact_id="source:1",
            raw_artifact_id="raw:1",
            file_name="fixture.pdf",
        )

        blocks = canonical["pages"][0]["blocks"]
        self.assertEqual(
            [block["kind"] for block in blocks],
            ["heading", "table", "table-cell"],
        )
        self.assertEqual(blocks[0]["headingLevel"], 1)
        self.assertEqual(blocks[2]["text"], "Cell")
        self.assertTrue(all("sourceRegions" not in block for block in blocks))
        self.assertEqual(region_count, 0)

    def test_orders_multi_page_table_from_page_local_cell_spans(self):
        heading_polygon = [10, 10, 80, 10, 80, 20, 10, 20]
        cell_polygon = [10, 50, 80, 50, 80, 70, 10, 70]
        page = model(
            page_number=2,
            width=100,
            height=200,
            unit="inch",
            spans=[span(90, 40)],
            lines=[
                model(
                    content="Page two heading",
                    spans=[span(90, 16)],
                    polygon=heading_polygon,
                )
            ],
            words=[],
        )
        cell = model(
            row_index=4,
            column_index=0,
            content="Continued",
            spans=[span(110, 9)],
            bounding_regions=[region(2, cell_polygon)],
        )
        table = model(
            spans=[span(0, 120)],
            cells=[cell],
            bounding_regions=[region(1, [10, 10, 80, 10, 80, 80, 10, 80])],
        )

        canonical, _markdown, _block_count, _region_count = build_canonical(
            content="x" * 130,
            pages=[page],
            paragraphs=[],
            tables=[table],
            source_artifact_id="source:1",
            raw_artifact_id="raw:1",
            file_name="fixture.pdf",
        )

        blocks = canonical["pages"][0]["blocks"]
        self.assertEqual(
            [block["kind"] for block in blocks],
            ["paragraph", "table", "table-cell"],
        )


if __name__ == "__main__":
    unittest.main()
