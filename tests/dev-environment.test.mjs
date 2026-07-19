import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");

test("Make and Compose expose the minimal safe development paths", async () => {
  const [makefile, compose, entrypoint] = await Promise.all([
    readFile(resolve(root, "Makefile"), "utf8"),
    readFile(resolve(root, "compose.yaml"), "utf8"),
    readFile(resolve(root, "infra/scripts/web-dev.sh"), "utf8"),
  ]);

  assert.match(makefile, /^dev: deps /m);
  assert.match(makefile, /^up: /m);
  assert.match(makefile, /docker compose/);
  assert.match(makefile, /command -v node/);
  assert.match(compose, /healthcheck:/);
  assert.match(compose, /- \.\:\/workspace(?:\s|$)/m);
  assert.match(compose, /web-next:\/workspace\/\.next/);
  assert.match(compose, /user: "\$\{DOCUMENT_ARENA_UID/);
  assert.doesNotMatch(compose, /docker\.sock/);
  assert.doesNotMatch(compose, /\/root\//);
  assert.match(entrypoint, /bun install --frozen-lockfile/);
  assert.doesNotMatch(entrypoint, /\bnpm\b/);
});
