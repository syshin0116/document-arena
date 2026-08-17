import { afterEach, describe, expect, test } from "bun:test";

import {
  createOrchestratorServer,
  hostedReadiness,
} from "../services/orchestrator/serve.mjs";

let server;

afterEach(() => {
  server?.stop(true);
  server = undefined;
});

describe("hosted orchestrator readiness", () => {
  test("disabled execution remains fail-closed even when settings exist", () => {
    const env = completeHostedEnvironment();
    env.DOCUMENT_ARENA_HOSTED_EXECUTION_ENABLED = "false";

    expect(hostedReadiness(env)).toEqual({
      implemented: false,
      enabled: false,
      ready: false,
      missing: [],
    });
  });

  test("enabled execution reports every missing prerequisite", () => {
    const readiness = hostedReadiness({
      DOCUMENT_ARENA_HOSTED_EXECUTION_ENABLED: "true",
    });

    expect(readiness.enabled).toBe(true);
    expect(readiness.implemented).toBe(false);
    expect(readiness.ready).toBe(false);
    expect(readiness.missing).toEqual([
      "DATABASE_URL",
      "DOCUMENT_ARENA_BLOBSTORE_ENDPOINT",
      "DOCUMENT_ARENA_BLOBSTORE_BUCKET",
      "DOCUMENT_ARENA_BLOBSTORE_ACCESS_KEY_ID",
      "DOCUMENT_ARENA_BLOBSTORE_SECRET_ACCESS_KEY",
      "DOCUMENT_ARENA_GCP_PROJECT",
      "DOCUMENT_ARENA_GCP_REGION",
      "DOCUMENT_ARENA_GCP_BATCH_SERVICE_ACCOUNT",
    ]);
  });

  test("readiness endpoint returns 503 while hosted execution is disabled", async () => {
    server = createOrchestratorServer({ env: {}, hostname: "127.0.0.1", port: 0 });

    const response = await fetch(`http://127.0.0.1:${server.port}/readyz`);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      hostedExecution: {
        implemented: false,
        enabled: false,
        ready: false,
        missing: [
          "DATABASE_URL",
          "DOCUMENT_ARENA_BLOBSTORE_ENDPOINT",
          "DOCUMENT_ARENA_BLOBSTORE_BUCKET",
          "DOCUMENT_ARENA_BLOBSTORE_ACCESS_KEY_ID",
          "DOCUMENT_ARENA_BLOBSTORE_SECRET_ACCESS_KEY",
          "DOCUMENT_ARENA_GCP_PROJECT",
          "DOCUMENT_ARENA_GCP_REGION",
          "DOCUMENT_ARENA_GCP_BATCH_SERVICE_ACCOUNT",
        ],
      },
    });
  });
});

function completeHostedEnvironment() {
  return {
    DATABASE_URL: "postgresql://example.invalid/document-arena",
    DOCUMENT_ARENA_BLOBSTORE_ENDPOINT: "https://example.invalid",
    DOCUMENT_ARENA_BLOBSTORE_BUCKET: "temporary",
    DOCUMENT_ARENA_BLOBSTORE_ACCESS_KEY_ID: "example",
    DOCUMENT_ARENA_BLOBSTORE_SECRET_ACCESS_KEY: "example",
    DOCUMENT_ARENA_GCP_PROJECT: "example-project",
    DOCUMENT_ARENA_GCP_REGION: "asia-northeast3",
    DOCUMENT_ARENA_GCP_BATCH_SERVICE_ACCOUNT: "batch@example.invalid",
  };
}
