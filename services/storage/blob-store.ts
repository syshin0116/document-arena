import { createHash } from "node:crypto";

export const DEFAULT_BLOB_RETENTION_SECONDS = 24 * 60 * 60;

export const DEFAULT_SIGNED_REQUEST_TTL_SECONDS = 15 * 60;

export const MAX_SIGNED_REQUEST_TTL_SECONDS = 60 * 60;

export type BlobRef = Readonly<{
  bucket: string;
  key: string;
}>;

export type BlobByteRange = Readonly<{
  offset: number;
  length: number;
}>;

/**
 * Metadata recorded alongside immutable temporary bytes. `expiresAt` mirrors
 * the transfer ledger's retention deadline; explicit cleanup and the bucket
 * lifecycle remain responsible for deletion. It is deliberately separate from
 * a signed request's short TTL.
 */
export type BlobWriteMetadata = Readonly<{
  mediaType: string;
  expiresAt: string;
}>;

export type BlobWriteDescriptor = Readonly<{
  ref: BlobRef;
  metadata: BlobWriteMetadata;
}>;

export type BlobPutRequest = BlobWriteDescriptor &
  Readonly<{
    body: BodyInit;
  }>;

export type BlobWriteReceipt = BlobWriteDescriptor &
  Readonly<{
    etag?: string;
  }>;

export type BlobHead = Readonly<{
  ref: BlobRef;
  sizeBytes: number;
  etag: string;
  mediaType?: string;
  lastModified?: string;
  expiresAt?: string;
}>;

export type BlobRead = Readonly<{
  ref: BlobRef;
  body: ReadableStream<Uint8Array>;
  status: 200 | 206;
  contentLength: number;
  etag?: string;
  mediaType?: string;
  contentRange?: string;
}>;

export type SignedRequestOptions = Readonly<{
  ttlSeconds?: number;
}>;

/**
 * A bearer capability. Durable records store only BlobRef; this value must
 * never be persisted, logged, or returned from a long-lived domain record.
 */
export type SignedBlobRequest = Readonly<{
  method: "PUT" | "GET";
  url: string;
  headers: Readonly<Record<string, string>>;
  urlExpiresAt: string;
}>;

export type BlobIntegrityReceipt = Readonly<{
  ref: BlobRef;
  algorithm: "sha256";
  sha256: string;
  sizeBytes: number;
}>;

export interface BlobStore {
  /**
   * Initial single-object control-plane subset. Multipart completion/abort and
   * provider-side prefix listing/deletion remain deferred until their shared
   * compatibility tests land. `deleteMany` deletes authoritative domain refs;
   * it must not discover artifacts by treating object listing as an index.
   */
  put(request: BlobPutRequest): Promise<BlobWriteReceipt>;
  head(ref: BlobRef): Promise<BlobHead | null>;
  open(ref: BlobRef, range?: BlobByteRange): Promise<BlobRead>;
  signPut(
    descriptor: BlobWriteDescriptor,
    options?: SignedRequestOptions,
  ): Promise<SignedBlobRequest>;
  signGet(
    ref: BlobRef,
    options?: SignedRequestOptions,
  ): Promise<SignedBlobRequest>;
  delete(ref: BlobRef): Promise<void>;
  deleteMany(refs: readonly BlobRef[]): Promise<void>;
}

export class BlobNotFoundError extends Error {
  readonly ref: BlobRef;

  constructor(ref: BlobRef) {
    super("Blob not found.");
    this.name = "BlobNotFoundError";
    this.ref = ref;
  }
}

export class BlobAlreadyExistsError extends Error {
  readonly ref: BlobRef;

  constructor(ref: BlobRef) {
    super("Blob already exists; immutable writes cannot replace it.");
    this.name = "BlobAlreadyExistsError";
    this.ref = ref;
  }
}

export class BlobIntegrityError extends Error {
  readonly ref: BlobRef;
  readonly expectedSha256: string;
  readonly actualSha256: string;

  constructor(ref: BlobRef, expectedSha256: string, actualSha256: string) {
    super("Blob SHA-256 verification failed.");
    this.name = "BlobIntegrityError";
    this.ref = ref;
    this.expectedSha256 = expectedSha256;
    this.actualSha256 = actualSha256;
  }
}

/**
 * Verifies stored bytes rather than trusting caller-controlled object metadata.
 * Hosted execution must complete this check before dispatching a job that uses
 * the object.
 */
export async function verifyBlobSha256(
  store: Pick<BlobStore, "open">,
  ref: BlobRef,
  expectedSha256: string,
): Promise<BlobIntegrityReceipt> {
  validateBlobRef(ref);
  if (!/^[a-f0-9]{64}$/.test(expectedSha256)) {
    throw new TypeError(
      "Expected Blob SHA-256 must be 64 lowercase hexadecimal characters.",
    );
  }

  const read = await store.open(ref);
  const reader = read.body.getReader();
  const hash = createHash("sha256");
  let sizeBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      if (!Number.isSafeInteger(sizeBytes + value.byteLength)) {
        throw new RangeError("Blob size exceeds the safe integer range.");
      }
      sizeBytes += value.byteLength;
      hash.update(value);
    }
  } finally {
    reader.releaseLock();
  }

  const actualSha256 = hash.digest("hex");
  if (actualSha256 !== expectedSha256) {
    throw new BlobIntegrityError(ref, expectedSha256, actualSha256);
  }

  return {
    ref,
    algorithm: "sha256",
    sha256: actualSha256,
    sizeBytes,
  };
}

export function defaultBlobExpiresAt(now = new Date()): string {
  if (!Number.isFinite(now.getTime())) {
    throw new TypeError("now must be a valid Date.");
  }
  return new Date(
    now.getTime() + DEFAULT_BLOB_RETENTION_SECONDS * 1_000,
  ).toISOString();
}

export function validateBlobRef(ref: BlobRef): void {
  if (
    !ref.bucket ||
    ref.bucket.trim() !== ref.bucket ||
    /[/\\\u0000-\u001f\u007f]/.test(ref.bucket)
  ) {
    throw new TypeError("Blob bucket must be a non-empty trimmed string.");
  }
  const keySegments = ref.key.split("/");
  if (
    !ref.key ||
    ref.key.startsWith("/") ||
    ref.key.endsWith("/") ||
    /[\u0000-\u001f\u007f]/.test(ref.key) ||
    keySegments.some((segment) => segment === "." || segment === "..")
  ) {
    throw new TypeError(
      "Blob key must be a non-empty object key without a leading slash, trailing slash, dot segment, or control character.",
    );
  }
}

export function validateBlobWriteMetadata(metadata: BlobWriteMetadata): void {
  if (
    !metadata.mediaType ||
    metadata.mediaType.trim() !== metadata.mediaType ||
    /[\r\n]/.test(metadata.mediaType)
  ) {
    throw new TypeError("Blob mediaType must be a non-empty MIME type.");
  }
  if (!Number.isFinite(Date.parse(metadata.expiresAt))) {
    throw new TypeError("Blob expiresAt must be an ISO-8601 timestamp.");
  }
}

export function signedRequestTtlSeconds(options?: SignedRequestOptions): number {
  const ttl = options?.ttlSeconds ?? DEFAULT_SIGNED_REQUEST_TTL_SECONDS;
  if (
    !Number.isSafeInteger(ttl) ||
    ttl < 1 ||
    ttl > MAX_SIGNED_REQUEST_TTL_SECONDS
  ) {
    throw new RangeError(
      `Signed request ttlSeconds must be between 1 and ${MAX_SIGNED_REQUEST_TTL_SECONDS}.`,
    );
  }
  return ttl;
}
