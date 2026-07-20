#!/usr/bin/env bun

import {
  assertR2PoliciesReady,
  corsPolicyBody,
  lifecyclePolicyBody,
  normalizeAllowedOrigins,
} from "./policy.mjs";

const HELP = `Usage: bun infra/r2/configure.mjs [--verify | --apply]

--verify  Read Cloudflare state and fail unless lifecycle and CORS match (default).
--apply   Replace this dedicated bucket's lifecycle and CORS policies, then verify.

Required environment:
  CLOUDFLARE_ACCOUNT_ID
  CLOUDFLARE_API_TOKEN
  DOCUMENT_ARENA_BLOBSTORE_BUCKET
  DOCUMENT_ARENA_R2_ALLOWED_ORIGINS  comma-separated exact browser origins

Optional environment:
  DOCUMENT_ARENA_R2_JURISDICTION    default, eu, or fedramp (default: default)`;

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function loadConfiguration() {
  const accountId = requiredEnvironment("CLOUDFLARE_ACCOUNT_ID");
  const apiToken = requiredEnvironment("CLOUDFLARE_API_TOKEN");
  const bucket = requiredEnvironment("DOCUMENT_ARENA_BLOBSTORE_BUCKET");
  const origins = normalizeAllowedOrigins(
    requiredEnvironment("DOCUMENT_ARENA_R2_ALLOWED_ORIGINS"),
  );
  const jurisdiction =
    process.env.DOCUMENT_ARENA_R2_JURISDICTION?.trim() || "default";

  if (!/^[a-f0-9]{32}$/.test(accountId)) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID must be 32 lowercase hexadecimal characters.");
  }
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) {
    throw new Error("DOCUMENT_ARENA_BLOBSTORE_BUCKET is not a valid R2 bucket name.");
  }
  if (!new Set(["default", "eu", "fedramp"]).has(jurisdiction)) {
    throw new Error("DOCUMENT_ARENA_R2_JURISDICTION must be default, eu, or fedramp.");
  }

  return { accountId, apiToken, bucket, origins, jurisdiction };
}

function errorSummary(payload, status) {
  const messages = Array.isArray(payload?.errors)
    ? payload.errors.map((entry) => entry?.message).filter(Boolean)
    : [];
  return messages.length > 0
    ? messages.join("; ")
    : `Cloudflare API returned HTTP ${status}.`;
}

function createCloudflareClient(configuration) {
  const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(configuration.accountId)}/r2/buckets/${encodeURIComponent(configuration.bucket)}`;
  const headers = {
    Authorization: `Bearer ${configuration.apiToken}`,
    "cf-r2-jurisdiction": configuration.jurisdiction,
  };

  return async function request(path, init = {}) {
    const response = await fetch(`${baseUrl}/${path}`, {
      ...init,
      headers: {
        ...headers,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.success !== true) {
      throw new Error(errorSummary(payload, response.status));
    }
    return payload;
  };
}

function commandMode(arguments_) {
  if (arguments_.includes("--help") || arguments_.includes("-h")) {
    process.stdout.write(`${HELP}\n`);
    return "help";
  }
  const unsupported = arguments_.filter(
    (argument) => argument !== "--verify" && argument !== "--apply",
  );
  if (unsupported.length > 0 || arguments_.includes("--verify") && arguments_.includes("--apply")) {
    throw new Error(`Unsupported arguments: ${arguments_.join(" ")}\n\n${HELP}`);
  }
  return arguments_.includes("--apply") ? "apply" : "verify";
}

async function main() {
  const mode = commandMode(process.argv.slice(2));
  if (mode === "help") return;

  const configuration = loadConfiguration();
  const request = createCloudflareClient(configuration);

  if (mode === "apply") {
    await request("lifecycle", {
      method: "PUT",
      body: JSON.stringify(lifecyclePolicyBody()),
    });
    await request("cors", {
      method: "PUT",
      body: JSON.stringify(corsPolicyBody(configuration.origins)),
    });
  }

  const [lifecycle, cors, locks] = await Promise.all([
    request("lifecycle"),
    request("cors"),
    request("lock"),
  ]);
  const readiness = assertR2PoliciesReady({
    lifecycle,
    cors,
    locks,
    origins: configuration.origins,
  });

  process.stdout.write(
    `R2 policy ready for ${configuration.bucket}: ${readiness.origins.join(", ")}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`R2 policy is not ready: ${error.message}\n`);
  process.exitCode = 1;
});
