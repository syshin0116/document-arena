import { S3CompatibleBlobStore } from "./s3-compatible-blob-store";
import type { BlobStore } from "./blob-store";

export type R2BlobStoreConfig = Readonly<{
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  jurisdiction?: "default" | "eu" | "fedramp";
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
}>;

function r2Endpoint(
  accountId: string,
  jurisdiction: R2BlobStoreConfig["jurisdiction"],
): string {
  if (!/^[a-f0-9]{32}$/.test(accountId)) {
    throw new TypeError("R2 accountId must be 32 lowercase hexadecimal characters.");
  }
  const suffix =
    jurisdiction && jurisdiction !== "default" ? `.${jurisdiction}` : "";
  return `https://${accountId}${suffix}.r2.cloudflarestorage.com`;
}

/**
 * Deployment composition calls this factory; application and runner code use
 * only the BlobStore interface and provider-neutral BlobRef values.
 */
export function createR2BlobStore(config: R2BlobStoreConfig): BlobStore {
  return new S3CompatibleBlobStore({
    endpoint: r2Endpoint(config.accountId, config.jurisdiction),
    region: "auto",
    bucket: config.bucket,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    fetch: config.fetch,
    now: config.now,
  });
}
