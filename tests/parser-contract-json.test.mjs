import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { basename, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const schemaDirectory = resolve(root, "packages/contracts/schemas");

async function parseJson(path) {
  const source = await readFile(path, "utf8");
  const parsed = JSON.parse(source);
  assert.ok(parsed && typeof parsed === "object" && !Array.isArray(parsed));
  return parsed;
}

test("every parser contract schema and extension manifest is valid JSON", async () => {
  const schemaNames = (await readdir(schemaDirectory))
    .filter((name) => name.endsWith(".json"))
    .sort();

  assert.ok(schemaNames.length > 0, "at least one contract schema must exist");

  for (const name of schemaNames) {
    const schema = await parseJson(resolve(schemaDirectory, name));
    assert.equal(
      schema.$schema,
      "https://json-schema.org/draft/2020-12/schema",
      `${name} must declare the expected JSON Schema dialect`,
    );
  }

  const manifestPaths = [
    resolve(root, "extensions/opendataloader-pdf/component.json"),
    resolve(root, "extensions/opendataloader-pdf/options.schema.json"),
    resolve(root, "extensions/mineru-pipeline/component.json"),
    resolve(root, "extensions/mineru-pipeline/options.schema.json"),
    resolve(root, "extensions/azure-di/component.json"),
    resolve(root, "extensions/azure-di/options.schema.json"),
  ];

  for (const path of manifestPaths) {
    const document = await parseJson(path);
    assert.ok(
      document.apiVersion || document.$schema,
      `${basename(path)} must identify its contract`,
    );
  }
});

test("the example catalog entry matches the catalog contract's key rules", async () => {
  const schema = await parseJson(
    resolve(schemaDirectory, "catalog-entry.v1alpha1.schema.json"),
  );
  const entry = await parseJson(
    resolve(root, "packages/contracts/examples/catalog-entry.opendataloader.json"),
  );

  assert.equal(entry.apiVersion, "document-arena.dev/catalog/v1alpha1");
  assert.equal(entry.kind, "CatalogEntry");

  for (const field of schema.required) {
    assert.ok(field in entry, `example entry must contain required field ${field}`);
  }

  assert.match(entry.imageDigest, /^sha256:[a-f0-9]{64}$/);
  assert.ok(
    ["stable", "experimental", "license-gated"].includes(entry.maturity),
  );
  assert.ok(Array.isArray(entry.availability) && entry.availability.length > 0);
  assert.ok(Array.isArray(entry.profiles) && entry.profiles.length > 0);
  for (const profile of entry.profiles) {
    assert.ok(profile.id && Number.isInteger(profile.revision) && profile.revision >= 1);
  }
  assert.equal(typeof entry.license.reviewed, "boolean");
});
