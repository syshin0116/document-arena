import assert from "node:assert/strict";
import test from "node:test";
import {
  blockLabel,
  buildReadingNodes,
  evidenceIdForBlock,
  isRenderableBlock,
  toEvidenceRegions,
} from "../app/local-runner";

const nativeRegion = (pageNumber, bbox) => ({
  pageNumber,
  bbox,
  provenance: "native",
  native: {
    bbox: [72, 671, 474, 700],
    coordinateSystem: "pdf-bottom-left-points",
    artifactId: "raw:stage-1:parser-output",
    jsonPointer: "/kids/0",
  },
});

test("toEvidenceRegions maps only valid native regions and never invents geometry", () => {
  const parsed = {
    apiVersion: "document-arena.dev/parsed-document/v1alpha1",
    parser: { id: "opendataloader-pdf" },
    pages: [
      {
        pageNumber: 1,
        width: 612,
        height: 792,
        blocks: [
          {
            id: "b-1",
            kind: "heading",
            text: "Title",
            sourceRegions: [nativeRegion(1, [0.1, 0.1, 0.8, 0.2])],
          },
          { id: "b-2", kind: "paragraph", text: "No geometry here." },
          {
            id: "b-2b",
            kind: "table-cell",
            sourceRegions: [nativeRegion(1, [0.1, 0.5, 0.4, 0.6])],
          },
          {
            id: "b-3",
            kind: "table",
            sourceRegions: [nativeRegion(1, [0.9, 0.9, 0.1, 0.95])],
          },
        ],
      },
      {
        pageNumber: 2,
        width: 612,
        height: 792,
        blocks: [
          {
            id: "b-4",
            kind: "paragraph",
            text: "x".repeat(60),
            sourceRegions: [nativeRegion(2, [0.2, 0.3, 0.7, 0.4])],
          },
        ],
      },
    ],
  };

  const regions = toEvidenceRegions(parsed, "opendataloader");
  assert.deepEqual(
    regions.map((region) => region.id),
    ["b-1", "b-4"],
    "textless structural cells, missing geometry, and invalid bboxes must be skipped",
  );
  assert.equal(regions[0].parserId, "opendataloader");
  assert.equal(regions[0].pageNumber, 1);
  assert.equal(regions[1].pageNumber, 2);
  assert.equal(regions[0].provenance, "native");
  assert.equal(regions[0].jsonPointer, "/kids/0");
});

test("isRenderableBlock hides only textless structural rows and cells", () => {
  assert.equal(isRenderableBlock({ id: "a", kind: "table-row" }), false);
  assert.equal(isRenderableBlock({ id: "a", kind: "table-cell" }), false);
  assert.equal(isRenderableBlock({ id: "a", kind: "table-cell", text: "5" }), true);
  assert.equal(isRenderableBlock({ id: "a", kind: "table" }), true);
  assert.equal(isRenderableBlock({ id: "a", kind: "image" }), true);
});

test("buildReadingNodes reconstructs table grids from raw JSON pointers", () => {
  const blocks = [
    { id: "h1", kind: "heading", text: "Title", headingLevel: 1, rawJsonPointer: "/kids/0" },
    { id: "t1", kind: "table", rawJsonPointer: "/kids/1" },
    { id: "r1", kind: "table-row", rawJsonPointer: "/kids/1/rows/0" },
    { id: "c11", kind: "table-cell", rawJsonPointer: "/kids/1/rows/0/cells/0" },
    { id: "p11", kind: "paragraph", text: "Metric", rawJsonPointer: "/kids/1/rows/0/cells/0/kids/0" },
    { id: "c12", kind: "table-cell", rawJsonPointer: "/kids/1/rows/0/cells/1" },
    { id: "p12", kind: "paragraph", text: "Value", rawJsonPointer: "/kids/1/rows/0/cells/1/kids/0" },
    { id: "r2", kind: "table-row", rawJsonPointer: "/kids/1/rows/1" },
    { id: "p21", kind: "paragraph", text: "bbox", rawJsonPointer: "/kids/1/rows/1/cells/0/kids/0" },
    { id: "p22", kind: "paragraph", text: "enabled", rawJsonPointer: "/kids/1/rows/1/cells/1/kids/0" },
    { id: "after", kind: "paragraph", text: "After the table." },
  ];

  const nodes = buildReadingNodes(blocks);
  assert.deepEqual(
    nodes.map((node) => node.type),
    ["block", "table", "block"],
    "table children must be consumed into the table node",
  );

  const table = nodes[1];
  assert.equal(table.block.id, "t1");
  assert.deepEqual(
    table.rows.map((row) => row.map((cell) => cell.text)),
    [
      ["Metric", "Value"],
      ["bbox", "enabled"],
    ],
  );
  assert.deepEqual(
    table.rows.map((row) => row.map((cell) => cell.evidenceBlockId)),
    [
      ["p11", "p12"],
      ["p21", "p22"],
    ],
    "cell hover must target the text block that carries the native region",
  );
});

test("blockLabel truncates long text and falls back to the kind", () => {
  assert.equal(blockLabel({ id: "a", kind: "table" }), "Table");
  assert.equal(
    blockLabel({ id: "a", kind: "heading", text: "Short" }),
    "Heading · Short",
  );
  const long = blockLabel({ id: "a", kind: "paragraph", text: "y".repeat(80) });
  assert.ok(long.endsWith("…") && long.length < 60);
});


test("merged mode unions one table's native boxes into a single region", () => {
  const region = (bbox) => ({
    pageNumber: 1,
    bbox,
    provenance: "native",
    native: {
      bbox: [0, 0, 0, 0],
      coordinateSystem: "pdf-top-left-points",
      artifactId: "raw",
      jsonPointer: "/x",
    },
  });
  const parsed = {
    apiVersion: "document-arena.dev/parsed-document/v1alpha1",
    parser: { id: "opendataloader-pdf" },
    pages: [
      {
        pageNumber: 1,
        width: 600,
        height: 800,
        blocks: [
          {
            id: "h",
            kind: "heading",
            text: "Title",
            rawJsonPointer: "/kids/0",
            sourceRegions: [region([0.1, 0.05, 0.5, 0.09])],
          },
          {
            id: "t",
            kind: "table",
            rawJsonPointer: "/kids/1",
            sourceRegions: [region([0.1, 0.2, 0.9, 0.5])],
          },
          {
            id: "c1",
            kind: "table-cell",
            rawJsonPointer: "/kids/1/rows/0/cells/0",
            sourceRegions: [region([0.1, 0.2, 0.4, 0.3])],
          },
          {
            id: "p1",
            kind: "paragraph",
            text: "Metric",
            rawJsonPointer: "/kids/1/rows/0/cells/0/kids/0",
            sourceRegions: [region([0.12, 0.22, 0.38, 0.28])],
          },
          {
            id: "c2",
            kind: "table-cell",
            rawJsonPointer: "/kids/1/rows/1/cells/1",
            sourceRegions: [region([0.5, 0.4, 0.9, 0.5])],
          },
        ],
      },
    ],
  };

  const native = toEvidenceRegions(parsed, "odl");
  // native: heading + table + the one cell-text paragraph. Textless structural
  // cells (c1, c2) are skipped by isRenderableBlock, so each block keeps its
  // own box and nothing is joined.
  assert.deepEqual(
    native.map((r) => r.id).sort(),
    ["h", "p1", "t"],
    "native mode keeps each block's own region",
  );

  const merged = toEvidenceRegions(parsed, "odl", { merge: true });
  const tableRegion = merged.find((r) => r.id === "table:/kids/1");
  assert.ok(tableRegion, "table blocks collapse to one table: region");
  // union of all table boxes: x 0.1..0.9, y 0.2..0.5
  assert.deepEqual(tableRegion.bbox, [0.1, 0.2, 0.9, 0.5]);
  assert.equal(
    merged.filter((r) => r.id.startsWith("table:")).length,
    1,
    "one merged region per table",
  );
  assert.ok(
    merged.some((r) => r.id === "h"),
    "non-table blocks stay native in merged mode",
  );

  assert.equal(evidenceIdForBlock({ id: "p1", kind: "paragraph", rawJsonPointer: "/kids/1/rows/0/cells/0/kids/0" }, true), "table:/kids/1");
  assert.equal(evidenceIdForBlock({ id: "h", kind: "heading", rawJsonPointer: "/kids/0" }, true), "h");
  assert.equal(evidenceIdForBlock({ id: "p1", kind: "paragraph", rawJsonPointer: "/kids/1/rows/0/cells/0/kids/0" }, false), "p1");
});

test("native mode expands Azure DI word boxes; merged keeps the line union", () => {
  const parsed = {
    apiVersion: "document-arena.dev/parsed-document/v1alpha1",
    parser: { id: "azure-di" },
    pages: [
      {
        pageNumber: 1,
        width: 8.5,
        height: 11,
        blocks: [
          {
            id: "azuredi-p1-l0",
            kind: "paragraph",
            text: "two words",
            rawJsonPointer: "/pages/0/lines/0",
            sourceRegions: [
              {
                pageNumber: 1,
                bbox: [0.1, 0.2, 0.6, 0.24],
                provenance: "native",
                native: {
                  bbox: [1, 2, 5, 3],
                  coordinateSystem: "azure-di-page-points-union",
                  artifactId: "raw",
                  jsonPointer: "/pages/0/lines/0",
                  words: [
                    [0.1, 0.2, 0.3, 0.24],
                    [0.35, 0.2, 0.6, 0.24],
                  ],
                },
              },
            ],
          },
        ],
      },
    ],
  };

  const native = toEvidenceRegions(parsed, "azuredi");
  assert.equal(native.length, 2, "native mode draws one box per word");
  assert.ok(native.every((r) => r.id === "azuredi-p1-l0"), "words share the line id");
  assert.deepEqual(native[0].bbox, [0.1, 0.2, 0.3, 0.24]);
  assert.deepEqual(native[1].bbox, [0.35, 0.2, 0.6, 0.24]);

  const merged = toEvidenceRegions(parsed, "azuredi", { merge: true });
  assert.equal(merged.length, 1, "merged mode keeps the line union");
  assert.deepEqual(merged[0].bbox, [0.1, 0.2, 0.6, 0.24]);
});
