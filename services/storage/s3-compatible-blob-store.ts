import {
  BlobAlreadyExistsError,
  BlobNotFoundError,
  signedRequestTtlSeconds,
  validateBlobRef,
  validateBlobWriteMetadata,
  type BlobByteRange,
  type BlobHead,
  type BlobPutRequest,
  type BlobRead,
  type BlobRef,
  type BlobStore,
  type BlobWriteDescriptor,
  type BlobWriteReceipt,
  type SignedBlobRequest,
  type SignedRequestOptions,
} from "./blob-store";

const SIGNING_ALGORITHM = "AWS4-HMAC-SHA256";
const SIGNING_SERVICE = "s3";
const UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";
const EXPIRES_AT_METADATA_HEADER = "x-amz-meta-document-arena-expires-at";

type Fetch = typeof globalThis.fetch;

export type S3CompatibleBlobStoreConfig = Readonly<{
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  fetch?: Fetch;
  now?: () => Date;
}>;

type PresignInput = Readonly<{
  method: "PUT" | "GET" | "HEAD" | "DELETE";
  ref: BlobRef;
  headers?: Readonly<Record<string, string>>;
  ttlSeconds: number;
}>;

type PublicPresignInput = PresignInput &
  Readonly<{
    method: "PUT" | "GET";
  }>;

function utf8(value: string): ArrayBuffer {
  return new TextEncoder().encode(value).buffer as ArrayBuffer;
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256(value: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", utf8(value)));
}

async function hmac(key: BufferSource, value: string): Promise<ArrayBuffer> {
  const imported = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", imported, utf8(value));
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function canonicalObjectPath(endpoint: URL, ref: BlobRef): string {
  const endpointPrefix = endpoint.pathname.replace(/\/$/, "");
  const bucket = encodeRfc3986(ref.bucket);
  const key = ref.key.split("/").map(encodeRfc3986).join("/");
  return `${endpointPrefix}/${bucket}/${key}`;
}

function canonicalQuery(entries: Readonly<Record<string, string>>): string {
  return Object.entries(entries)
    .map(([name, value]) => [encodeRfc3986(name), encodeRfc3986(value)] as const)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([name, value]) => `${name}=${value}`)
    .join("&");
}

function signingTime(date: Date): { amzDate: string; shortDate: string } {
  const amzDate = date
    .toISOString()
    .replace(/[:-]|\.\d{3}/g, "");
  return { amzDate, shortDate: amzDate.slice(0, 8) };
}

function canonicalHeaders(
  endpoint: URL,
  headers: Readonly<Record<string, string>>,
): { block: string; names: string } {
  const normalized = new Map<string, string>();
  normalized.set("host", endpoint.host);
  for (const [name, value] of Object.entries(headers)) {
    const normalizedName = name.trim().toLowerCase();
    if (!normalizedName || normalizedName === "host" || /[\r\n]/.test(value)) {
      throw new TypeError("Signed request headers must be valid single-line headers.");
    }
    normalized.set(normalizedName, value.trim().replace(/\s+/g, " "));
  }
  const entries = [...normalized.entries()].sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  return {
    block: `${entries.map(([name, value]) => `${name}:${value}`).join("\n")}\n`,
    names: entries.map(([name]) => name).join(";"),
  };
}

function responseError(operation: string, response: Response): Error {
  return new Error(`Blob ${operation} failed with HTTP ${response.status}.`);
}

function requiredHeader(response: Response, name: string): string {
  const value = response.headers.get(name);
  if (!value) {
    throw new Error(`Blob response is missing ${name}.`);
  }
  return value;
}

function responseBody(response: Response): ReadableStream<Uint8Array> {
  if (!response.body) throw new Error("Blob response is missing its body.");
  return response.body;
}

function assertRange(range: BlobByteRange): void {
  if (
    !Number.isSafeInteger(range.offset) ||
    !Number.isSafeInteger(range.length) ||
    range.offset < 0 ||
    range.length < 1
  ) {
    throw new RangeError("Blob range offset and length must be positive integers.");
  }
}

export class S3CompatibleBlobStore implements BlobStore {
  readonly #endpoint: URL;
  readonly #region: string;
  readonly #bucket: string;
  readonly #accessKeyId: string;
  readonly #secretAccessKey: string;
  readonly #fetch: Fetch;
  readonly #now: () => Date;

  constructor(config: S3CompatibleBlobStoreConfig) {
    const endpoint = new URL(config.endpoint);
    if (endpoint.protocol !== "https:" && endpoint.hostname !== "localhost") {
      throw new TypeError("Blob endpoint must use HTTPS.");
    }
    if (endpoint.search || endpoint.hash) {
      throw new TypeError("Blob endpoint cannot contain a query or fragment.");
    }
    if (
      !config.region ||
      !config.bucket ||
      !config.accessKeyId ||
      !config.secretAccessKey
    ) {
      throw new TypeError("Blob endpoint, region, bucket, and credentials are required.");
    }
    validateBlobRef({ bucket: config.bucket, key: "configuration-check" });

    this.#endpoint = endpoint;
    this.#region = config.region;
    this.#bucket = config.bucket;
    this.#accessKeyId = config.accessKeyId;
    this.#secretAccessKey = config.secretAccessKey;
    this.#fetch = config.fetch ?? globalThis.fetch;
    this.#now = config.now ?? (() => new Date());
  }

  #validateRef(ref: BlobRef): void {
    validateBlobRef(ref);
    if (ref.bucket !== this.#bucket) {
      throw new TypeError("Blob ref is outside this store's configured bucket.");
    }
  }

  async #presignInternal(input: PresignInput): Promise<{
    method: PresignInput["method"];
    url: string;
    headers: Readonly<Record<string, string>>;
    urlExpiresAt: string;
  }> {
    this.#validateRef(input.ref);
    const now = this.#now();
    if (!Number.isFinite(now.getTime())) {
      throw new TypeError("Blob signing clock returned an invalid Date.");
    }
    const { amzDate, shortDate } = signingTime(now);
    const credentialScope = `${shortDate}/${this.#region}/${SIGNING_SERVICE}/aws4_request`;
    const headers = input.headers ?? {};
    const canonicalHeaderValues = canonicalHeaders(this.#endpoint, headers);
    const query = canonicalQuery({
      "X-Amz-Algorithm": SIGNING_ALGORITHM,
      "X-Amz-Content-Sha256": UNSIGNED_PAYLOAD,
      "X-Amz-Credential": `${this.#accessKeyId}/${credentialScope}`,
      "X-Amz-Date": amzDate,
      "X-Amz-Expires": String(input.ttlSeconds),
      "X-Amz-SignedHeaders": canonicalHeaderValues.names,
    });
    const path = canonicalObjectPath(this.#endpoint, input.ref);
    const canonicalRequest = [
      input.method,
      path,
      query,
      canonicalHeaderValues.block,
      canonicalHeaderValues.names,
      UNSIGNED_PAYLOAD,
    ].join("\n");
    const stringToSign = [
      SIGNING_ALGORITHM,
      amzDate,
      credentialScope,
      await sha256(canonicalRequest),
    ].join("\n");
    const dateKey = await hmac(utf8(`AWS4${this.#secretAccessKey}`), shortDate);
    const regionKey = await hmac(dateKey, this.#region);
    const serviceKey = await hmac(regionKey, SIGNING_SERVICE);
    const signingKey = await hmac(serviceKey, "aws4_request");
    const signature = hex(await hmac(signingKey, stringToSign));
    const url = new URL(this.#endpoint);
    url.pathname = path;
    url.search = `${query}&X-Amz-Signature=${signature}`;

    return {
      method: input.method,
      url: url.toString(),
      headers,
      urlExpiresAt: new Date(
        now.getTime() + input.ttlSeconds * 1_000,
      ).toISOString(),
    };
  }

  async #presign(input: PublicPresignInput): Promise<SignedBlobRequest> {
    const signed = await this.#presignInternal(input);
    return {
      method: input.method,
      url: signed.url,
      headers: signed.headers,
      urlExpiresAt: signed.urlExpiresAt,
    };
  }

  async put(request: BlobPutRequest): Promise<BlobWriteReceipt> {
    const signed = await this.signPut(request, { ttlSeconds: 60 });
    const init: RequestInit & { duplex?: "half" } = {
      method: signed.method,
      headers: signed.headers,
      body: request.body,
      duplex: "half",
    };
    const response = await this.#fetch(signed.url, init);
    if (response.status === 412) {
      throw new BlobAlreadyExistsError(request.ref);
    }
    if (!response.ok) throw responseError("put", response);
    return {
      ref: request.ref,
      metadata: request.metadata,
      etag: response.headers.get("etag") ?? undefined,
    };
  }

  async head(ref: BlobRef): Promise<BlobHead | null> {
    const signed = await this.#presignInternal({
      method: "HEAD",
      ref,
      ttlSeconds: 60,
    });
    const response = await this.#fetch(signed.url, { method: "HEAD" });
    if (response.status === 404) return null;
    if (!response.ok) throw responseError("head", response);
    const sizeBytes = Number(requiredHeader(response, "content-length"));
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
      throw new Error("Blob response contains an invalid content-length.");
    }
    return {
      ref,
      sizeBytes,
      etag: requiredHeader(response, "etag"),
      mediaType: response.headers.get("content-type") ?? undefined,
      lastModified: response.headers.get("last-modified") ?? undefined,
      expiresAt:
        response.headers.get(EXPIRES_AT_METADATA_HEADER) ?? undefined,
    };
  }

  async open(ref: BlobRef, range?: BlobByteRange): Promise<BlobRead> {
    if (range) assertRange(range);
    if (range && !Number.isSafeInteger(range.offset + range.length - 1)) {
      throw new RangeError("Blob range end must be a safe integer.");
    }
    const signed = await this.signGet(ref, { ttlSeconds: 60 });
    const headers = new Headers(signed.headers);
    if (range) {
      headers.set(
        "range",
        `bytes=${range.offset}-${range.offset + range.length - 1}`,
      );
    }
    const response = await this.#fetch(signed.url, {
      method: signed.method,
      headers,
    });
    if (response.status === 404) throw new BlobNotFoundError(ref);
    if (response.status !== 200 && response.status !== 206) {
      throw responseError("open", response);
    }
    if (range && response.status !== 206) {
      throw new Error("Blob range response did not return HTTP 206.");
    }
    const contentLength = Number(requiredHeader(response, "content-length"));
    if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
      throw new Error("Blob response contains an invalid content-length.");
    }
    return {
      ref,
      body: responseBody(response),
      status: response.status,
      contentLength,
      etag: response.headers.get("etag") ?? undefined,
      mediaType: response.headers.get("content-type") ?? undefined,
      contentRange: response.headers.get("content-range") ?? undefined,
    };
  }

  async signPut(
    descriptor: BlobWriteDescriptor,
    options?: SignedRequestOptions,
  ): Promise<SignedBlobRequest> {
    validateBlobWriteMetadata(descriptor.metadata);
    const headers: Record<string, string> = {
      "content-type": descriptor.metadata.mediaType,
      "if-none-match": "*",
      [EXPIRES_AT_METADATA_HEADER]: descriptor.metadata.expiresAt,
    };
    return this.#presign({
      method: "PUT",
      ref: descriptor.ref,
      headers,
      ttlSeconds: signedRequestTtlSeconds(options),
    });
  }

  signGet(
    ref: BlobRef,
    options?: SignedRequestOptions,
  ): Promise<SignedBlobRequest> {
    return this.#presign({
      method: "GET",
      ref,
      ttlSeconds: signedRequestTtlSeconds(options),
    });
  }

  async delete(ref: BlobRef): Promise<void> {
    const signed = await this.#presignInternal({
      method: "DELETE",
      ref,
      ttlSeconds: 60,
    });
    const response = await this.#fetch(signed.url, { method: "DELETE" });
    if (!response.ok) throw responseError("delete", response);
  }

  async deleteMany(refs: readonly BlobRef[]): Promise<void> {
    await Promise.all(refs.map((ref) => this.delete(ref)));
  }
}
