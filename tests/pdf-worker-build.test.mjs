import assert from "node:assert/strict";
import { access, readFile, readdir, stat } from "node:fs/promises";
import { test } from "bun:test";

test("the Next.js production build emits a non-empty PDF.js worker", async () => {
  await access(new URL("../.next/BUILD_ID", import.meta.url));
  const assetsUrl = new URL("../.next/static/media/", import.meta.url);
  const assets = await readdir(assetsUrl);
  const workers = assets.filter((name) =>
    /^pdf\.worker(?:\.min)?\.[^.]+\.mjs$/.test(name),
  );

  assert.equal(
    workers.length,
    1,
    `expected one hashed PDF.js worker, found: ${workers.join(", ") || "none"}`,
  );
  const workerStats = await stat(new URL(workers[0], assetsUrl));
  assert.equal(workerStats.isFile(), true);
  assert.ok(workerStats.size > 0, "PDF.js worker asset must not be empty");
});

test("the pinned PDF.js support assets use Next.js's public directory", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  const version = packageJson.dependencies["pdfjs-dist"];
  const requiredAssets = [
    "cmaps/Adobe-Japan1-UCS2.bcmap",
    "cmaps/Adobe-Korea1-UCS2.bcmap",
    "standard_fonts/LiberationSans-Regular.ttf",
    "wasm/openjpeg.wasm",
    "wasm/qcms_bg.wasm",
    "iccs/CGATS001Compat-v2-micro.icc",
  ];

  for (const asset of requiredAssets) {
    const publicStats = await stat(
      new URL(`../public/pdfjs/${version}/${asset}`, import.meta.url),
    );
    assert.ok(publicStats.size > 0, `${asset} must be present in public assets`);
  }
});
