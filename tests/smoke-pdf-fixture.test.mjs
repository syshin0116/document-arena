import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { buildSmokePdf } from "../fixtures/generate-smoke-pdf.mjs";

test("the smoke PDF fixture is deterministic and self-contained", () => {
  const first = buildSmokePdf();
  const second = buildSmokePdf();

  assert.ok(Buffer.isBuffer(first));
  assert.ok(first.length > 0);
  assert.deepEqual(first, second);
  assert.equal(
    createHash("sha256").update(first).digest("hex"),
    "ed302ca6cfe8613419840eff67075887af33be31ca8c4c0d3a58610747a1f2bb",
  );

  const source = first.toString("latin1");
  assert.ok(source.startsWith("%PDF-1.4\n"));
  assert.match(source, /\nxref\n/);
  assert.match(source, /\ntrailer\n/);
  assert.match(source, /\nstartxref\n\d+\n%%EOF\n$/);
  assert.match(source, /PAGE_ONE_SENTINEL: ALPHA-4107/);
  assert.match(source, /PAGE_TWO_SENTINEL: OMEGA-9231/);
});
