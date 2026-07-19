import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const extensionRoot = resolve(root, "extensions/opendataloader-pdf");
const pythonExtensionRoots = [
  resolve(root, "extensions/mineru-pipeline"),
  resolve(root, "extensions/azure-di"),
];

test("Bun owns JavaScript dependency installation and lockfiles", async () => {
  for (const directory of [root, extensionRoot]) {
    const packageJson = JSON.parse(
      await readFile(resolve(directory, "package.json"), "utf8"),
    );
    assert.equal(packageJson.packageManager, "bun@1.3.10");
    await access(resolve(directory, "bun.lock"));
    await assert.rejects(access(resolve(directory, "package-lock.json")));
  }

  const dockerfile = await readFile(
    resolve(extensionRoot, "Dockerfile"),
    "utf8",
  );
  assert.match(dockerfile, /bun install --frozen-lockfile/);
  assert.doesNotMatch(dockerfile, /\bnpm (?:ci|install)\b/);
});

test("Python extension images install only from their committed uv locks", async () => {
  for (const directory of pythonExtensionRoots) {
    await access(resolve(directory, "pyproject.toml"));
    await access(resolve(directory, "uv.lock"));
    const dockerfile = await readFile(resolve(directory, "Dockerfile"), "utf8");

    assert.match(dockerfile, /COPY pyproject\.toml uv\.lock/);
    assert.match(dockerfile, /uv sync --locked --no-dev --no-install-project/);
    assert.doesNotMatch(dockerfile, /(?:uv\s+pip|pip\s+install)/);
  }
});
