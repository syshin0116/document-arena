import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const extensionRoot = resolve(root, "extensions/azure-di");

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

test("Azure options mirror the pinned SDK surface", async () => {
  const schema = await readJson(resolve(extensionRoot, "options.schema.json"));

  assert.deepEqual(Object.keys(schema.properties), [
    "modelId",
    "apiVersion",
    "pages",
    "locale",
    "stringIndexType",
    "features",
    "queryFields",
    "outputContentFormat",
    "output",
  ]);
  assert.deepEqual(
    schema.properties.features.items.oneOf.map((choice) => choice.const),
    [
      "ocrHighResolution",
      "languages",
      "barcodes",
      "formulas",
      "keyValuePairs",
      "styleFont",
      "queryFields",
    ],
  );
  assert.deepEqual(
    schema.properties.stringIndexType.oneOf.map((choice) => choice.const),
    ["unicodeCodePoint", "textElements", "utf16CodeUnit"],
  );
  assert.match(
    schema.properties.stringIndexType.oneOf[1]["x-parser-arena"].disabledReason,
    /normalizer/i,
  );
  assert.deepEqual(
    schema.properties.output.items.oneOf.map((choice) => choice.const),
    ["figures", "pdf"],
  );
  assert.match(
    schema.properties.output.items.oneOf[1]["x-parser-arena"].disabledReason,
    /prebuilt-layout/i,
  );
  assert.equal(
    schema.properties.modelId["x-parser-arena"].availability.state,
    "fixed",
  );
  assert.equal(
    schema.properties.apiVersion["x-parser-arena"].availability.state,
    "fixed",
  );
  assert.match(schema.properties.locale.pattern, /auto/);
});

test("Azure adapter preserves the complete service result and effective options", async () => {
  const source = await readFile(resolve(extensionRoot, "adapter/main.py"), "utf8");

  assert.match(source, /json\.dumps\(result\.as_dict\(\)/);
  assert.match(source, /StringIndexType\(options\["stringIndexType"\]\)/);
  assert.match(source, /DocumentAnalysisFeature\(value\)/);
  assert.match(source, /get_analyze_result_figure/);
  assert.match(source, /"options": options/);
  assert.match(source, /"modelId",\s*\n\s*"apiVersion"/);
  assert.ok(
    source.indexOf("query_fields = [value.strip()") <
      source.indexOf("len(query_fields) != len(set(query_fields))"),
    "query fields must be normalized before duplicate validation",
  );
});

test("Azure SDK dependency is pinned to the researched release", async () => {
  const pyproject = await readFile(resolve(extensionRoot, "pyproject.toml"), "utf8");
  const component = await readJson(resolve(extensionRoot, "component.json"));

  assert.match(pyproject, /azure-ai-documentintelligence==1\.0\.2/);
  assert.equal(
    component.metadata.upstreamVersion,
    "azure-ai-documentintelligence@1.0.2",
  );
});
