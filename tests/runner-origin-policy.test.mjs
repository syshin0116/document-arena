import assert from "node:assert/strict";
import { test } from "bun:test";
import {
  CORS_REQUEST_HEADERS,
  runnerAllowedOrigins,
  runnerCorsPolicy,
} from "../services/runner/origin-policy.mjs";

test("the local runner defaults to the exact localhost web origins", () => {
  assert.deepEqual(
    [...runnerAllowedOrigins({ DOCUMENT_ARENA_WEB_PORT: "4310" })],
    ["http://localhost:4310", "http://127.0.0.1:4310"],
  );
  assert.deepEqual([...runnerAllowedOrigins({})], [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ]);
});

test("the runner accepts the legacy web port during the product rename", () => {
  assert.deepEqual(
    [...runnerAllowedOrigins({ PARSER_ARENA_WEB_PORT: "4311" })],
    ["http://localhost:4311", "http://127.0.0.1:4311"],
  );
});

test("the canonical origin override takes precedence over the legacy name", () => {
  assert.deepEqual(
    [
      ...runnerAllowedOrigins({
        DOCUMENT_ARENA_RUNNER_ALLOWED_ORIGINS: "https://document-arena.test",
        PARSER_ARENA_RUNNER_ALLOWED_ORIGINS: "https://legacy.test",
      }),
    ],
    ["https://document-arena.test"],
  );
});

test("an explicit comma-separated origin list replaces the local defaults", () => {
  const origins = runnerAllowedOrigins({
    DOCUMENT_ARENA_WEB_PORT: "3000",
    DOCUMENT_ARENA_RUNNER_ALLOWED_ORIGINS:
      " https://document-arena.test, http://localhost:4400 ",
  });

  assert.deepEqual([...origins], [
    "https://document-arena.test",
    "http://localhost:4400",
  ]);
  assert.equal(origins.has("http://localhost:3000"), false);
});

test("invalid ports and non-origin overrides fail closed at startup", () => {
  assert.throws(
    () => runnerAllowedOrigins({ DOCUMENT_ARENA_WEB_PORT: "70000" }),
    /integer from 1 to 65535/,
  );
  assert.throws(
    () =>
      runnerAllowedOrigins({
        DOCUMENT_ARENA_RUNNER_ALLOWED_ORIGINS: "https://example.test/path",
      }),
    /without paths/,
  );
  assert.throws(
    () => runnerAllowedOrigins({ DOCUMENT_ARENA_RUNNER_ALLOWED_ORIGINS: "" }),
    /at least one origin/,
  );
});

test("allowed browser origins receive exact per-request CORS headers", () => {
  const origin = "http://localhost:3000";
  const policy = runnerCorsPolicy(origin, runnerAllowedOrigins({}));

  assert.equal(policy.allowed, true);
  assert.equal(policy.headers.get("access-control-allow-origin"), origin);
  assert.equal(
    policy.headers.get("access-control-allow-methods"),
    "GET, POST, PUT, DELETE, OPTIONS",
  );
  const allowedHeaders = new Set(
    policy.headers
      .get("access-control-allow-headers")
      .split(",")
      .map((entry) => entry.trim()),
  );
  assert.deepEqual(allowedHeaders, new Set(CORS_REQUEST_HEADERS));
  assert.equal(policy.headers.get("vary"), "Origin");
});

test("a POST from a disallowed browser origin is rejected without reflection", () => {
  const request = new Request("http://localhost:8799/v1/parse", {
    method: "POST",
    headers: { Origin: "http://localhost.evil.test:3000" },
    body: "%PDF-",
  });
  const policy = runnerCorsPolicy(
    request.headers.get("origin"),
    runnerAllowedOrigins({}),
  );

  assert.equal(policy.allowed, false);
  assert.equal(policy.headers.get("access-control-allow-origin"), null);
  assert.equal(policy.headers.get("vary"), "Origin");
});

test("origin-less CLI and health requests remain allowed without CORS headers", () => {
  const policy = runnerCorsPolicy(null, runnerAllowedOrigins({}));

  assert.equal(policy.allowed, true);
  assert.equal(policy.headers.get("access-control-allow-origin"), null);
  assert.equal(policy.headers.get("vary"), "Origin");
});
