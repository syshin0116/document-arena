import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizedBboxStyle,
  regionsForPage,
} from "../app/evidence-regions.ts";

test("native normalized geometry maps directly to percentage overlay styles", () => {
  assert.deepEqual(normalizedBboxStyle([0.125, 0.2, 0.875, 0.65]), {
    left: "12.5%",
    top: "20%",
    width: "75%",
    height: "45%",
  });
});

test("source evidence is selected by its parser-native page number", () => {
  const pageOne = {
    id: "title",
    parserId: "opendataloader",
    label: "Document title",
    pageNumber: 1,
    bbox: [0.1, 0.1, 0.8, 0.2],
    provenance: "native",
    artifactId: "blocks.json",
    jsonPointer: "/blocks/0",
  };
  const pageTwo = {
    ...pageOne,
    id: "paragraph",
    pageNumber: 2,
    jsonPointer: "/blocks/1",
  };

  assert.deepEqual(
    regionsForPage([pageOne, pageTwo], "opendataloader", 2),
    [pageTwo],
  );
  assert.deepEqual(regionsForPage([pageOne], "mineru", 1), []);
});

test("non-native source geometry is never exposed by the overlay boundary", () => {
  const inferred = {
    id: "ocr-match",
    parserId: "mineru",
    label: "OCR alignment",
    pageNumber: 1,
    bbox: [0.1, 0.1, 0.8, 0.2],
    provenance: "inferred",
    artifactId: "alignment.json",
    jsonPointer: "/matches/0",
  };

  assert.deepEqual(regionsForPage([inferred], "mineru", 1), []);
});

test("invalid or inferred-looking geometry is rejected before rendering", () => {
  const invalidBoxes = [
    [-0.01, 0, 0.5, 0.5],
    [0, 0, 1.01, 0.5],
    [0.7, 0, 0.6, 0.5],
    [0, 0.6, 0.5, 0.6],
    [0, 0, Number.NaN, 0.5],
  ];

  for (const bbox of invalidBoxes) {
    assert.throws(
      () => normalizedBboxStyle(bbox),
      /normalized top-left geometry/,
    );
  }
});
