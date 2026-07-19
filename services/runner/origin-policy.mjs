const DEFAULT_WEB_PORT = 3000;

export const CORS_REQUEST_HEADERS = [
  "content-type",
  "x-document-arena-filename",
];

const CORS_METHODS = ["GET", "POST", "OPTIONS"];

function parsePort(value) {
  const port = Number(value ?? DEFAULT_WEB_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("DOCUMENT_ARENA_WEB_PORT must be an integer from 1 to 65535.");
  }
  return port;
}

function parseOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      `DOCUMENT_ARENA_RUNNER_ALLOWED_ORIGINS contains an invalid origin: ${value}`,
    );
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      `DOCUMENT_ARENA_RUNNER_ALLOWED_ORIGINS must contain HTTP(S) origins without paths: ${value}`,
    );
  }
  return url.origin;
}

export function runnerAllowedOrigins(env = process.env) {
  const override =
    env.DOCUMENT_ARENA_RUNNER_ALLOWED_ORIGINS ??
    env.PARSER_ARENA_RUNNER_ALLOWED_ORIGINS;
  if (override !== undefined) {
    const entries = override
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (entries.length === 0) {
      throw new Error(
        "DOCUMENT_ARENA_RUNNER_ALLOWED_ORIGINS must contain at least one origin when set.",
      );
    }
    return new Set(entries.map(parseOrigin));
  }

  const port = parsePort(
    env.DOCUMENT_ARENA_WEB_PORT ?? env.PARSER_ARENA_WEB_PORT,
  );
  return new Set([
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
  ]);
}

export function runnerCorsPolicy(origin, allowedOrigins) {
  const headers = new Headers({ Vary: "Origin" });
  // Native clients and local health checks do not send Origin. CORS is a
  // browser boundary, so those requests remain available without CORS headers.
  if (origin === null) return { allowed: true, headers };

  const allowed = allowedOrigins.has(origin);
  if (allowed) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", CORS_METHODS.join(", "));
    headers.set(
      "Access-Control-Allow-Headers",
      CORS_REQUEST_HEADERS.join(", "),
    );
    headers.set("Access-Control-Max-Age", "600");
  }
  return { allowed, headers };
}
