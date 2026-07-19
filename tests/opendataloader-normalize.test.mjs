import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeNativeBbox,
  normalizeOdlDocument,
} from "../extensions/opendataloader-pdf/adapter/normalize.mjs";

const page = {
  pageNumber: 1,
  width: 612,
  height: 792,
  rotation: 0,
  view: [0, 0, 612, 792],
  transform: [1, 0, 0, -1, 0, 792],
};

const nativeBbox = [72, 700, 540, 730];
const expectedBbox = [72 / 612, 62 / 792, 540 / 612, 92 / 792];

function assertClose(actual, expected, tolerance = 1e-12) {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) => {
    assert.ok(
      Math.abs(value - expected[index]) <= tolerance,
      `Expected ${value} to be within ${tolerance} of ${expected[index]}`,
    );
  });
}

test("normalizeNativeBbox maps PDF bottom-left points to normalized top-left coordinates", () => {
  const normalized = normalizeNativeBbox(nativeBbox, page);

  assert.ok(normalized);
  assertClose(normalized, expectedBbox);
});

test("normalizeOdlDocument preserves native geometry and nested table provenance", () => {
  const raw = {
    "file name": "fixture.pdf",
    "number of pages": 1,
    kids: [
      {
        id: 10,
        type: "paragraph",
        "page number": 1,
        content: "A paragraph before the table.",
        "bounding box": nativeBbox,
      },
      {
        id: 20,
        type: "table",
        "page number": 1,
        "bounding box": [72, 500, 540, 680],
        rows: [
          {
            id: 21,
            type: "table row",
            "row number": 0,
            "bounding box": [72, 620, 540, 680],
            cells: [
              {
                id: 22,
                type: "table cell",
                "row number": 0,
                "column number": 0,
                content: "Metric",
                "bounding box": [72, 620, 306, 680],
              },
            ],
          },
        ],
      },
    ],
  };

  const document = normalizeOdlDocument({
    raw,
    markdown: "A paragraph before the table.\n\n| Metric |\n| --- |",
    pages: [page],
    rawArtifactId: "artifact:raw-opendataloader-json",
    sourceArtifactId: "artifact:source-pdf",
  });

  assert.equal(document.apiVersion, "document-arena.dev/parsed-document/v1alpha1");
  assert.equal(document.sourceArtifactRef, "artifact:source-pdf");
  assert.deepEqual(document.rawArtifactRefs, [
    "artifact:raw-opendataloader-json",
  ]);

  const blocks = document.pages[0].blocks;
  assert.deepEqual(
    blocks.map((block) => block.kind),
    ["paragraph", "table", "table-row", "table-cell"],
  );

  const paragraph = blocks[0];
  const table = blocks[1];
  const row = blocks[2];
  const cell = blocks[3];

  assert.equal(paragraph.rawJsonPointer, "/kids/0");
  assert.equal(table.rawJsonPointer, "/kids/1");
  assert.equal(row.rawJsonPointer, "/kids/1/rows/0");
  assert.equal(cell.rawJsonPointer, "/kids/1/rows/0/cells/0");
  assert.equal(row.parentId, table.id);
  assert.equal(cell.parentId, row.id);
  assert.equal(cell.text, "Metric");
  assert.equal(cell.rowNumber, 0);
  assert.equal(cell.columnNumber, 0);

  const paragraphRegion = paragraph.sourceRegions[0];
  assertClose(paragraphRegion.bbox, expectedBbox);
  assert.equal(paragraphRegion.provenance, "native");
  assert.deepEqual(paragraphRegion.native, {
    bbox: nativeBbox,
    coordinateSystem: "pdf-bottom-left-points",
    artifactId: "artifact:raw-opendataloader-json",
    jsonPointer: "/kids/0",
  });

  const cellRegion = cell.sourceRegions[0];
  assert.equal(cellRegion.provenance, "native");
  assert.equal(cellRegion.native.jsonPointer, "/kids/1/rows/0/cells/0");
  assert.deepEqual(cellRegion.native.bbox, [72, 620, 306, 680]);
});
