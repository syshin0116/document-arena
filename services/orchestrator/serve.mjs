#!/usr/bin/env bun

const REQUIRED_HOSTED_SETTINGS = Object.freeze([
  "DATABASE_URL",
  "DOCUMENT_ARENA_BLOBSTORE_ENDPOINT",
  "DOCUMENT_ARENA_BLOBSTORE_BUCKET",
  "DOCUMENT_ARENA_BLOBSTORE_ACCESS_KEY_ID",
  "DOCUMENT_ARENA_BLOBSTORE_SECRET_ACCESS_KEY",
  "DOCUMENT_ARENA_GCP_PROJECT",
  "DOCUMENT_ARENA_GCP_REGION",
  "DOCUMENT_ARENA_GCP_BATCH_SERVICE_ACCOUNT",
]);

// Flip this only in the change that lands the authenticated execution-job API
// and the Batch submit/poll/cancel adapter. Environment variables alone must
// never make an unfinished hosted path appear ready.
const HOSTED_EXECUTION_IMPLEMENTED = false;

export function hostedReadiness(env = process.env) {
  const enabled = env.DOCUMENT_ARENA_HOSTED_EXECUTION_ENABLED === "true";
  const missing = REQUIRED_HOSTED_SETTINGS.filter((name) => !env[name]?.trim());
  return {
    implemented: HOSTED_EXECUTION_IMPLEMENTED,
    enabled,
    ready: HOSTED_EXECUTION_IMPLEMENTED && enabled && missing.length === 0,
    missing,
  };
}

function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export function createOrchestratorServer({
  env = process.env,
  hostname = env.HOST ?? "0.0.0.0",
  port = Number(env.PORT ?? env.DOCUMENT_ARENA_ORCHESTRATOR_PORT ?? 8788),
} = {}) {
  return Bun.serve({
    hostname,
    port,
    fetch(request) {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/healthz") {
        return json({ ok: true, service: "document-arena-orchestrator" });
      }
      if (request.method === "GET" && url.pathname === "/readyz") {
        const hosted = hostedReadiness(env);
        return json(
          { ok: hosted.ready, hostedExecution: hosted },
          hosted.ready ? 200 : 503,
        );
      }
      if (request.method === "GET" && url.pathname === "/v1/status") {
        const hosted = hostedReadiness(env);
        return json({
          service: "document-arena-orchestrator",
          hostedExecution: {
            implemented: hosted.implemented,
            enabled: hosted.enabled,
            ready: hosted.ready,
          },
        });
      }
      return json({ error: "Not found." }, 404);
    },
  });
}

if (import.meta.main) {
  const server = createOrchestratorServer();
  console.log(
    `Document Arena orchestrator listening on http://${server.hostname}:${server.port}`,
  );
  const readiness = hostedReadiness();
  if (!readiness.ready) {
    console.log("Hosted execution is disabled or incomplete (fail-closed).");
  }
}
