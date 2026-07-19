import assert from "node:assert/strict";
import test from "node:test";
import { thumbnailRenderPages } from "../app/pdf-thumbnail-pages.ts";

test("the active PDF page always has a rendered thumbnail window", () => {
  assert.deepEqual(
    thumbnailRenderPages({
      pageCount: 12,
      activePage: 7,
      visiblePages: [],
    }),
    [6, 7, 8],
  );
});

test("visible thumbnail windows are normalized, deduplicated, and bounded", () => {
  assert.deepEqual(
    thumbnailRenderPages({
      pageCount: 8,
      activePage: 1,
      visiblePages: [-2, 1, 2, 2, 8, 99, Number.NaN],
      overscan: 1,
    }),
    [1, 2, 3, 7, 8],
  );
});

test("large PDFs keep the live thumbnail render set small", () => {
  const rendered = thumbnailRenderPages({
    pageCount: 500,
    activePage: 250,
    visiblePages: [248, 249, 250],
    overscan: 1,
  });

  assert.deepEqual(rendered, [247, 248, 249, 250, 251]);
  assert.ok(rendered.length < 10);
  assert.equal(rendered.includes(1), false);
  assert.equal(rendered.includes(500), false);
});
