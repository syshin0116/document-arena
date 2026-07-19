import assert from "node:assert/strict";
import test from "node:test";
import { getDemoPdf } from "../app/lib/demo-pdf.ts";
import {
  parseSingleByteRange,
  respondWithDocumentContent,
} from "../services/http/document-content.ts";

function createSource() {
  const bytes = getDemoPdf();
  const reads = [];
  return {
    bytes,
    reads,
    source: {
      size: bytes.byteLength,
      etag: '"demo-v1"',
      fileName: "demo source.pdf",
      mediaType: "application/pdf",
      async read(range) {
        reads.push(range);
        return bytes.slice(range.offset, range.offset + range.length);
      },
    },
  };
}

test("the generated demo is a deterministic twelve-page PDF", () => {
  const bytes = getDemoPdf();
  const decoded = new TextDecoder().decode(bytes);

  assert.match(decoded, /^%PDF-1\.4/);
  assert.match(decoded, /\/Count 12\b/);
  assert.match(decoded, /DOCUMENT ARENA \/ SOURCE-LINKED DEMO/);
  assert.doesNotMatch(decoded, /PARSER ARENA/);
  assert.match(decoded, /Attention Is All You Need/);
  assert.deepEqual(getDemoPdf(), bytes);
});

test("single byte ranges support bounded, open-ended, and suffix forms", () => {
  assert.deepEqual(parseSingleByteRange(null, 100), { kind: "none" });
  assert.deepEqual(parseSingleByteRange("bytes=10-19", 100), {
    kind: "range",
    start: 10,
    end: 19,
  });
  assert.deepEqual(parseSingleByteRange("bytes=95-", 100), {
    kind: "range",
    start: 95,
    end: 99,
  });
  assert.deepEqual(parseSingleByteRange("bytes=-8", 100), {
    kind: "range",
    start: 92,
    end: 99,
  });
  assert.deepEqual(parseSingleByteRange("bytes=100-101", 100), {
    kind: "invalid",
  });
  assert.deepEqual(parseSingleByteRange("bytes=0-1,4-5", 100), {
    kind: "invalid",
  });
});

test("HEAD advertises PDF metadata without reading the document", async () => {
  const { source, reads } = createSource();
  const response = await respondWithDocumentContent(
    new Request("http://localhost/document", { method: "HEAD" }),
    source,
    { head: true },
  );

  assert.equal(response.status, 200);
  assert.equal(response.body, null);
  assert.equal(response.headers.get("accept-ranges"), "bytes");
  assert.equal(response.headers.get("content-type"), "application/pdf");
  assert.equal(response.headers.get("content-length"), String(source.size));
  assert.equal(response.headers.get("etag"), source.etag);
  assert.match(
    response.headers.get("content-disposition") ?? "",
    /demo%20source\.pdf/,
  );
  assert.deepEqual(reads, []);
});

test("GET returns the full document when no valid range is requested", async () => {
  const { source, bytes, reads } = createSource();
  const response = await respondWithDocumentContent(
    new Request("http://localhost/document"),
    source,
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-length"), String(bytes.length));
  assert.deepEqual(reads, [{ offset: 0, length: bytes.length }]);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
});

test("GET serves a single satisfiable range and rejects invalid ranges", async () => {
  const ranged = createSource();
  const response = await respondWithDocumentContent(
    new Request("http://localhost/document", {
      headers: { range: "bytes=0-7" },
    }),
    ranged.source,
  );

  assert.equal(response.status, 206);
  assert.equal(
    response.headers.get("content-range"),
    `bytes 0-7/${ranged.bytes.length}`,
  );
  assert.equal(response.headers.get("content-length"), "8");
  assert.deepEqual(ranged.reads, [{ offset: 0, length: 8 }]);
  assert.equal(
    new TextDecoder().decode(await response.arrayBuffer()),
    "%PDF-1.4",
  );

  const invalid = createSource();
  const rejected = await respondWithDocumentContent(
    new Request("http://localhost/document", {
      headers: { range: "bytes=0-1,4-5" },
    }),
    invalid.source,
  );
  assert.equal(rejected.status, 416);
  assert.equal(
    rejected.headers.get("content-range"),
    `bytes */${invalid.bytes.length}`,
  );
  assert.deepEqual(invalid.reads, []);
});

test("If-Range only honors the range for the current entity tag", async () => {
  const matching = createSource();
  const partial = await respondWithDocumentContent(
    new Request("http://localhost/document", {
      headers: { range: "bytes=10-19", "if-range": matching.source.etag },
    }),
    matching.source,
  );
  assert.equal(partial.status, 206);
  assert.deepEqual(matching.reads, [{ offset: 10, length: 10 }]);

  const stale = createSource();
  const full = await respondWithDocumentContent(
    new Request("http://localhost/document", {
      headers: { range: "bytes=10-19", "if-range": '"stale"' },
    }),
    stale.source,
  );
  assert.equal(full.status, 200);
  assert.equal(full.headers.get("content-range"), null);
  assert.deepEqual(stale.reads, [{ offset: 0, length: stale.bytes.length }]);
});
