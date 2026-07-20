import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  BlobAlreadyExistsError,
  BlobNotFoundError,
  DEFAULT_BLOB_RETENTION_SECONDS,
  defaultBlobExpiresAt,
  signedRequestTtlSeconds,
} from "../services/storage/blob-store.ts";
import { createR2BlobStore } from "../services/storage/r2-blob-store.ts";
import { S3CompatibleBlobStore } from "../services/storage/s3-compatible-blob-store.ts";

const NOW = new Date("2026-07-20T01:02:03.000Z");
const REF = {
  bucket: "document-arena-execution",
  key: "jobs/job_01/input/source.pdf",
};
const METADATA = {
  mediaType: "application/pdf",
  expiresAt: "2026-07-21T01:02:03.000Z",
  sha256: "a".repeat(64),
};

test("the core BlobStore contract keeps 24-hour retention separate from URL TTL", async () => {
  assert.equal(DEFAULT_BLOB_RETENTION_SECONDS, 86_400);
  assert.equal(defaultBlobExpiresAt(NOW), METADATA.expiresAt);
  assert.equal(signedRequestTtlSeconds(), 900);
  assert.equal(signedRequestTtlSeconds({ ttlSeconds: 1 }), 1);
  assert.throws(
    () => signedRequestTtlSeconds({ ttlSeconds: 604_801 }),
    /between 1 and 604800/,
  );

  const source = await readFile(
    new URL("../services/storage/blob-store.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /cloudflare|\br2\b|\baws\b/i);
});

test("R2 signs method-scoped upload, download, and delete bearer requests", async () => {
  const store = createR2BlobStore({
    accountId: "1".repeat(32),
    bucket: REF.bucket,
    accessKeyId: "CFEXAMPLEACCESSKEY",
    secretAccessKey: "example-secret-key",
    now: () => NOW,
  });

  const upload = await store.signPut(
    { ref: REF, metadata: METADATA },
    { ttlSeconds: 300 },
  );
  assert.equal(upload.method, "PUT");
  assert.equal(upload.urlExpiresAt, "2026-07-20T01:07:03.000Z");
  assert.deepEqual(upload.headers, {
    "content-type": "application/pdf",
    "if-none-match": "*",
    "x-amz-meta-document-arena-expires-at": METADATA.expiresAt,
    "x-amz-meta-document-arena-sha256": METADATA.sha256,
  });

  const uploadUrl = new URL(upload.url);
  assert.equal(
    uploadUrl.host,
    `${"1".repeat(32)}.r2.cloudflarestorage.com`,
  );
  assert.equal(
    uploadUrl.pathname,
    "/document-arena-execution/jobs/job_01/input/source.pdf",
  );
  assert.equal(uploadUrl.searchParams.get("X-Amz-Algorithm"), "AWS4-HMAC-SHA256");
  assert.equal(uploadUrl.searchParams.get("X-Amz-Content-Sha256"), "UNSIGNED-PAYLOAD");
  assert.equal(uploadUrl.searchParams.get("X-Amz-Date"), "20260720T010203Z");
  assert.equal(uploadUrl.searchParams.get("X-Amz-Expires"), "300");
  assert.equal(
    uploadUrl.searchParams.get("X-Amz-Credential"),
    "CFEXAMPLEACCESSKEY/20260720/auto/s3/aws4_request",
  );
  assert.equal(
    uploadUrl.searchParams.get("X-Amz-SignedHeaders"),
    "content-type;host;if-none-match;x-amz-meta-document-arena-expires-at;x-amz-meta-document-arena-sha256",
  );
  assert.equal(
    uploadUrl.searchParams.get("X-Amz-Signature"),
    "dcab565128ec7165207a6b8be79c3f0dd0abff5a575e23e14673d4a5eec037c9",
  );
  assert.doesNotMatch(upload.url, /example-secret-key/);

  const download = await store.signGet(REF, { ttlSeconds: 60 });
  const deletion = await store.signDelete(REF, { ttlSeconds: 60 });
  assert.equal(download.method, "GET");
  assert.equal(deletion.method, "DELETE");
  assert.deepEqual(download.headers, {});
  assert.deepEqual(deletion.headers, {});
  assert.notEqual(download.url, deletion.url);
  assert.equal(new URL(download.url).searchParams.get("X-Amz-Expires"), "60");
});

test("the shared adapter maps put, head, range-open, and idempotent delete", async () => {
  const calls = [];
  const responses = [
    new Response(null, { status: 200, headers: { etag: '"put-etag"' } }),
    new Response(null, {
      status: 200,
      headers: {
        "content-length": "4",
        "content-type": "application/pdf",
        etag: '"head-etag"',
        "last-modified": "Mon, 20 Jul 2026 01:02:03 GMT",
        "x-amz-meta-document-arena-expires-at": METADATA.expiresAt,
        "x-amz-meta-document-arena-sha256": METADATA.sha256,
      },
    }),
    new Response(new Uint8Array([2, 3]), {
      status: 206,
      headers: {
        "content-length": "2",
        "content-range": "bytes 1-2/4",
        "content-type": "application/pdf",
        etag: '"head-etag"',
      },
    }),
    new Response(null, { status: 204 }),
    new Response(null, { status: 204 }),
  ];
  const fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const response = responses.shift();
    assert.ok(response, "unexpected fetch call");
    return response;
  };
  const store = new S3CompatibleBlobStore({
    endpoint: "https://storage.example.test",
    region: "auto",
    bucket: REF.bucket,
    accessKeyId: "access-key",
    secretAccessKey: "secret-key",
    fetch,
    now: () => NOW,
  });

  const receipt = await store.put({
    ref: REF,
    metadata: METADATA,
    body: new Uint8Array([1, 2, 3, 4]),
  });
  assert.equal(receipt.etag, '"put-etag"');
  const putHeaders = new Headers(calls[0].init.headers);
  assert.equal(putHeaders.get("content-type"), METADATA.mediaType);
  assert.equal(putHeaders.get("if-none-match"), "*");
  assert.equal(
    putHeaders.get("x-amz-meta-document-arena-expires-at"),
    METADATA.expiresAt,
  );

  assert.deepEqual(await store.head(REF), {
    ref: REF,
    sizeBytes: 4,
    etag: '"head-etag"',
    mediaType: "application/pdf",
    lastModified: "Mon, 20 Jul 2026 01:02:03 GMT",
    expiresAt: METADATA.expiresAt,
    sha256: METADATA.sha256,
  });

  const opened = await store.open(REF, { offset: 1, length: 2 });
  assert.equal(opened.status, 206);
  assert.equal(opened.contentLength, 2);
  assert.equal(opened.contentRange, "bytes 1-2/4");
  assert.deepEqual(
    new Uint8Array(await new Response(opened.body).arrayBuffer()),
    new Uint8Array([2, 3]),
  );
  assert.equal(new Headers(calls[2].init.headers).get("range"), "bytes=1-2");

  await store.delete(REF);
  await store.delete(REF);
  assert.equal(calls[3].init.method, "DELETE");
  assert.equal(calls[4].init.method, "DELETE");
  assert.equal(responses.length, 0);
});

test("immutable puts surface a provider-neutral conflict", async () => {
  const fetch = async (_url, init = {}) => {
    assert.equal(new Headers(init.headers).get("if-none-match"), "*");
    return new Response(null, { status: 412 });
  };
  const store = new S3CompatibleBlobStore({
    endpoint: "https://storage.example.test",
    region: "auto",
    bucket: REF.bucket,
    accessKeyId: "access-key",
    secretAccessKey: "secret-key",
    fetch,
    now: () => NOW,
  });

  await assert.rejects(
    store.put({
      ref: REF,
      metadata: METADATA,
      body: new Uint8Array([1]),
    }),
    (error) => {
      assert.ok(error instanceof BlobAlreadyExistsError);
      assert.deepEqual(error.ref, REF);
      return true;
    },
  );
});

test("missing objects have provider-neutral behavior", async () => {
  const fetch = async () => new Response(null, { status: 404 });
  const store = new S3CompatibleBlobStore({
    endpoint: "https://storage.example.test",
    region: "auto",
    bucket: REF.bucket,
    accessKeyId: "access-key",
    secretAccessKey: "secret-key",
    fetch,
    now: () => NOW,
  });

  assert.equal(await store.head(REF), null);
  await assert.rejects(store.open(REF), (error) => {
    assert.ok(error instanceof BlobNotFoundError);
    assert.deepEqual(error.ref, REF);
    return true;
  });
});
