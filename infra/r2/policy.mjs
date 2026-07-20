import { readFileSync } from "node:fs";

const lifecyclePolicy = JSON.parse(
  readFileSync(new URL("./lifecycle.json", import.meta.url), "utf8"),
);

export const R2_CORS_RULE_ID = "document-arena-presigned-transfer";

export const R2_CORS_METHODS = Object.freeze(["GET", "PUT"]);

export const R2_CORS_ALLOWED_HEADERS = Object.freeze([
  "Content-Type",
  "If-None-Match",
  "Range",
  "x-amz-meta-document-arena-expires-at",
]);

export const R2_CORS_EXPOSE_HEADERS = Object.freeze([
  "Content-Range",
  "ETag",
  "x-amz-expiration",
]);

export const R2_CORS_MAX_AGE_SECONDS = 3_600;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sorted(values, normalize = (value) => value) {
  return [...values].map(normalize).sort();
}

function sameSet(actual, expected, normalize = (value) => value) {
  if (!Array.isArray(actual)) return false;
  return JSON.stringify(sorted(actual, normalize)) === JSON.stringify(sorted(expected, normalize));
}

function unwrapResult(response, name) {
  if (!response || typeof response !== "object") {
    throw new Error(`${name} response is not an object.`);
  }
  if ("success" in response && response.success !== true) {
    throw new Error(`${name} API response was not successful.`);
  }
  return "result" in response ? response.result : response;
}

export function lifecyclePolicyBody() {
  return clone(lifecyclePolicy);
}

export function normalizeAllowedOrigins(origins) {
  const values = Array.isArray(origins) ? origins : String(origins).split(",");
  const normalized = values.map((value) => {
    const candidate = String(value).trim();
    if (!candidate || candidate === "*") {
      throw new TypeError("R2 CORS origins must be explicit HTTP(S) origins.");
    }

    let url;
    try {
      url = new URL(candidate);
    } catch {
      throw new TypeError(`Invalid R2 CORS origin: ${candidate}`);
    }

    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      throw new TypeError(`R2 CORS value must be an origin without a path: ${candidate}`);
    }
    return url.origin;
  });

  const unique = [...new Set(normalized)].sort();
  if (unique.length === 0) {
    throw new TypeError("At least one R2 CORS origin is required.");
  }
  return unique;
}

export function corsPolicyBody(origins) {
  return {
    rules: [
      {
        id: R2_CORS_RULE_ID,
        allowed: {
          origins: normalizeAllowedOrigins(origins),
          methods: [...R2_CORS_METHODS],
          headers: [...R2_CORS_ALLOWED_HEADERS],
        },
        exposeHeaders: [...R2_CORS_EXPOSE_HEADERS],
        maxAgeSeconds: R2_CORS_MAX_AGE_SECONDS,
      },
    ],
  };
}

export function assertR2PoliciesReady({ lifecycle, cors, locks, origins }) {
  const expectedLifecycle = lifecyclePolicyBody().rules[0];
  const lifecycleResult = unwrapResult(lifecycle, "Lifecycle");
  const lifecycleRules = lifecycleResult?.rules;
  if (!Array.isArray(lifecycleRules)) {
    throw new Error("Lifecycle response is missing rules.");
  }

  const lifecycleRule = lifecycleRules.find(
    (rule) => rule?.id === expectedLifecycle.id,
  );
  if (
    !lifecycleRule ||
    lifecycleRule.enabled !== true ||
    lifecycleRule.conditions?.prefix !== "" ||
    lifecycleRule.deleteObjectsTransition?.condition?.type !== "Age" ||
    lifecycleRule.deleteObjectsTransition?.condition?.maxAge !== 86_400 ||
    lifecycleRule.abortMultipartUploadsTransition?.condition?.type !== "Age" ||
    lifecycleRule.abortMultipartUploadsTransition?.condition?.maxAge !== 86_400
  ) {
    throw new Error("R2 does not have the required bucket-wide one-day lifecycle rule.");
  }

  const expectedCors = corsPolicyBody(origins).rules[0];
  const corsResult = unwrapResult(cors, "CORS");
  const corsRules = corsResult?.rules;
  if (!Array.isArray(corsRules) || corsRules.length !== 1) {
    throw new Error("R2 must have exactly one least-privilege browser CORS rule.");
  }

  const corsRule = corsRules[0];
  if (
    corsRule?.id !== expectedCors.id ||
    !sameSet(corsRule.allowed?.origins, expectedCors.allowed.origins) ||
    !sameSet(corsRule.allowed?.methods, expectedCors.allowed.methods) ||
    !sameSet(
      corsRule.allowed?.headers,
      expectedCors.allowed.headers,
      (value) => String(value).toLowerCase(),
    ) ||
    !sameSet(
      corsRule.exposeHeaders,
      expectedCors.exposeHeaders,
      (value) => String(value).toLowerCase(),
    ) ||
    corsRule.maxAgeSeconds !== expectedCors.maxAgeSeconds
  ) {
    throw new Error("R2 browser CORS policy does not match the checked-in policy.");
  }

  const lockResult = unwrapResult(locks, "Bucket lock");
  const lockRules = lockResult?.rules;
  if (!Array.isArray(lockRules)) {
    throw new Error("Bucket lock response is missing rules.");
  }
  if (lockRules.some((rule) => rule?.enabled === true)) {
    throw new Error("R2 bucket lock would override one-day lifecycle deletion.");
  }

  return {
    ready: true,
    lifecycleRuleId: lifecycleRule.id,
    corsRuleId: corsRule.id,
    origins: expectedCors.allowed.origins,
  };
}
