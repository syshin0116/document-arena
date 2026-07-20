import { describe, expect, test } from "bun:test";

import {
  assertR2PoliciesReady,
  corsPolicyBody,
  lifecyclePolicyBody,
  normalizeAllowedOrigins,
} from "../infra/r2/policy.mjs";

function apiResponse(result) {
  return { success: true, errors: [], messages: [], result };
}

const noLocks = apiResponse({ rules: [] });

describe("R2 hosted exchange policy", () => {
  test("defines a bucket-wide one-day cleanup rule", () => {
    expect(lifecyclePolicyBody()).toEqual({
      rules: [
        {
          id: "expire-all-temporary-objects-after-one-day",
          conditions: { prefix: "" },
          enabled: true,
          abortMultipartUploadsTransition: {
            condition: { type: "Age", maxAge: 86_400 },
          },
          deleteObjectsTransition: {
            condition: { type: "Age", maxAge: 86_400 },
          },
        },
      ],
    });
  });

  test("builds exact-origin least-privilege browser CORS", () => {
    expect(
      corsPolicyBody("https://app.example, http://localhost:3000"),
    ).toEqual({
      rules: [
        {
          id: "document-arena-presigned-transfer",
          allowed: {
            origins: ["http://localhost:3000", "https://app.example"],
            methods: ["GET", "PUT"],
            headers: [
              "Content-Type",
              "If-None-Match",
              "Range",
              "x-amz-meta-document-arena-expires-at",
            ],
          },
          exposeHeaders: ["Content-Range", "ETag", "x-amz-expiration"],
          maxAgeSeconds: 3_600,
        },
      ],
    });
  });

  test("rejects wildcard and path-scoped CORS values", () => {
    expect(() => normalizeAllowedOrigins("*")).toThrow("explicit HTTP(S)");
    expect(() => normalizeAllowedOrigins("https://app.example/path")).toThrow(
      "without a path",
    );
  });

  test("accepts matching Cloudflare read-back state", () => {
    const origins = ["https://app.example"];
    expect(
      assertR2PoliciesReady({
        lifecycle: apiResponse(lifecyclePolicyBody()),
        cors: apiResponse(corsPolicyBody(origins)),
        locks: noLocks,
        origins,
      }),
    ).toMatchObject({ ready: true, origins });
  });

  test("fails closed when lifecycle or CORS drifts", () => {
    const origins = ["https://app.example"];
    const lifecycle = lifecyclePolicyBody();
    lifecycle.rules[0].deleteObjectsTransition.condition.maxAge = 172_800;
    expect(() =>
      assertR2PoliciesReady({
        lifecycle: apiResponse(lifecycle),
        cors: apiResponse(corsPolicyBody(origins)),
        locks: noLocks,
        origins,
      }),
    ).toThrow("one-day lifecycle");

    const cors = corsPolicyBody(origins);
    cors.rules[0].allowed.origins.push("https://unexpected.example");
    expect(() =>
      assertR2PoliciesReady({
        lifecycle: apiResponse(lifecyclePolicyBody()),
        cors: apiResponse(cors),
        locks: noLocks,
        origins,
      }),
    ).toThrow("does not match");
  });

  test("fails closed when a bucket lock can retain temporary objects", () => {
    const origins = ["https://app.example"];
    expect(() =>
      assertR2PoliciesReady({
        lifecycle: apiResponse(lifecyclePolicyBody()),
        cors: apiResponse(corsPolicyBody(origins)),
        locks: apiResponse({
          rules: [
            {
              id: "retain",
              enabled: true,
              prefix: "",
              condition: { type: "Indefinite" },
            },
          ],
        }),
        origins,
      }),
    ).toThrow("bucket lock");
  });
});
