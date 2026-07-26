import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import SignInPage from "../app/auth/sign-in/page.tsx";

test("sign-in page preserves local access when hosted auth is unconfigured", () => {
  const previousBaseUrl = process.env.NEON_AUTH_BASE_URL;
  const previousSecret = process.env.NEON_AUTH_COOKIE_SECRET;
  delete process.env.NEON_AUTH_BASE_URL;
  delete process.env.NEON_AUTH_COOKIE_SECRET;

  try {
    const html = renderToStaticMarkup(createElement(SignInPage));
    expect(html).toContain(
      "Hosted authentication is not configured in this environment.",
    );
    expect(html).toContain("Continue with local documents");
    expect(html).not.toContain("Continue with GitHub");
  } finally {
    if (previousBaseUrl === undefined) delete process.env.NEON_AUTH_BASE_URL;
    else process.env.NEON_AUTH_BASE_URL = previousBaseUrl;
    if (previousSecret === undefined) {
      delete process.env.NEON_AUTH_COOKIE_SECRET;
    } else {
      process.env.NEON_AUTH_COOKIE_SECRET = previousSecret;
    }
  }
});
