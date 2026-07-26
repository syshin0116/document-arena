import { describe, expect, test } from "bun:test";
import { resolveNeonAuthConfiguration } from "../lib/auth/config.ts";
import { hostedIdentityFromSession } from "../lib/auth/session.ts";

describe("Neon Auth configuration", () => {
  test("missing environment keeps hosted authentication disabled", () => {
    expect(resolveNeonAuthConfiguration({})).toEqual({
      configured: false,
      reason: "missing",
    });
  });

  test("partial environment keeps hosted authentication disabled", () => {
    expect(
      resolveNeonAuthConfiguration({
        NEON_AUTH_BASE_URL: "https://auth.example.test",
      }),
    ).toEqual({
      configured: false,
      reason: "missing",
    });
  });

  test("non-origin or non-https base URL is rejected", () => {
    const secret = "x".repeat(32);

    expect(
      resolveNeonAuthConfiguration({
        NEON_AUTH_BASE_URL: "http://auth.example.test",
        NEON_AUTH_COOKIE_SECRET: secret,
      }),
    ).toEqual({ configured: false, reason: "invalid-url" });

    expect(
      resolveNeonAuthConfiguration({
        NEON_AUTH_BASE_URL: "https://auth.example.test/path",
        NEON_AUTH_COOKIE_SECRET: secret,
      }),
    ).toEqual({ configured: false, reason: "invalid-url" });
  });

  test("cookie secret shorter than 32 characters is rejected", () => {
    expect(
      resolveNeonAuthConfiguration({
        NEON_AUTH_BASE_URL: "https://auth.example.test",
        NEON_AUTH_COOKIE_SECRET: "x".repeat(31),
      }),
    ).toEqual({
      configured: false,
      reason: "weak-cookie-secret",
    });
  });

  test("valid environment resolves to an origin and preserves the secret", () => {
    const secret = "x".repeat(32);

    expect(
      resolveNeonAuthConfiguration({
        NEON_AUTH_BASE_URL: "https://auth.example.test/",
        NEON_AUTH_COOKIE_SECRET: secret,
      }),
    ).toEqual({
      configured: true,
      baseUrl: "https://auth.example.test",
      cookieSecret: secret,
    });
  });
});

describe("hosted session identity", () => {
  test("valid session exposes only the stable subject and display fields", () => {
    expect(
      hostedIdentityFromSession({
        user: {
          id: "user_123",
          name: "Ada",
          email: "ada@example.test",
          ignored: "not projected",
        },
      }),
    ).toEqual({
      subject: "user_123",
      name: "Ada",
      email: "ada@example.test",
    });
  });

  test("missing or malformed user id is unauthenticated", () => {
    expect(hostedIdentityFromSession(null)).toBeNull();
    expect(hostedIdentityFromSession({ user: null })).toBeNull();
    expect(hostedIdentityFromSession({ user: { id: " user_123" } })).toBeNull();
    expect(hostedIdentityFromSession({ user: { id: 123 } })).toBeNull();
  });
});
