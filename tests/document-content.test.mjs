import assert from "node:assert/strict";
import test from "node:test";
import {
  getSamplePdf,
  SAMPLE_PAGE_COUNT,
} from "../app/lib/sample-document.ts";
import {
  parseSingleByteRange,
  respondWithDocumentContent,
} from "../services/http/document-content.ts";

function createSource() {
  const bytes = getSamplePdf();
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

// The sample is a real licensed PDF read from disk rather than one drawn at
// runtime from text operators, so this asserts we shipped the document and
// that reads are cached, not that a generator emitted a known string.
test("the sample document is the real licensed PDF on disk", () => {
  const bytes = getSamplePdf();
  const header = new TextDecoder().decode(bytes.slice(0, 8));

  assert.match(header, /^%PDF-1\.\d/);
  assert.ok(bytes.byteLength > 500_000, "sample PDF looks truncated");
  assert.equal(SAMPLE_PAGE_COUNT, 27);
  assert.deepEqual(getSamplePdf(), bytes);
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
  assert.match(
    new TextDecoder().decode(await response.arrayBuffer()),
    /^%PDF-1\.\d$/,
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
