import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { basename, resolve } from "node:path";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";

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

test("every component manifest satisfies the executable v1alpha1 schema", async () => {
  const schema = await parseJson(
    resolve(schemaDirectory, "component-manifest.v1alpha1.schema.json"),
  );
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  const manifestPaths = [
    resolve(root, "extensions/opendataloader-pdf/component.json"),
    resolve(root, "extensions/mineru-pipeline/component.json"),
    resolve(root, "extensions/azure-di/component.json"),
  ];

  for (const path of manifestPaths) {
    const manifest = await parseJson(path);
    assert.equal(
      validate(manifest),
      true,
      `${basename(path)}: ${JSON.stringify(validate.errors)}`,
    );
  }

  const invalidRemote = structuredClone(await parseJson(manifestPaths[0]));
  invalidRemote.spec.requirements.network = "remote";
  delete invalidRemote.spec.requirements.connection;
  assert.equal(validate(invalidRemote), false);
  assert.ok(
    validate.errors.some(
      (error) =>
        error.instancePath === "/spec/requirements" &&
        error.keyword === "required",
    ),
  );

  const azure = await parseJson(manifestPaths[2]);
  const invalidCases = [];

  const reservedEnv = structuredClone(azure);
  reservedEnv.spec.requirements.connection.env.endpoint = "DOCKER_HOST";
  invalidCases.push(reservedEnv);

  const missingUriPolicy = structuredClone(azure);
  delete missingUriPolicy.spec.requirements.connection.fields[0]
    .allowedHostSuffixes;
  invalidCases.push(missingUriPolicy);

  const localWithConnection = structuredClone(azure);
  localWithConnection.spec.requirements.network = "none";
  invalidCases.push(localWithConnection);

  const misspelledRequirement = structuredClone(azure);
  misspelledRequirement.spec.requirements.memroyMiB = 4096;
  invalidCases.push(misspelledRequirement);

  const unsupportedFieldPolicy = structuredClone(azure);
  unsupportedFieldPolicy.spec.requirements.connection.fields[1].pattern =
    "(a+)+$";
  invalidCases.push(unsupportedFieldPolicy);

  for (const invalidManifest of invalidCases) {
    assert.equal(validate(invalidManifest), false, JSON.stringify(validate.errors));
  }
});

test("parsed-document schema accepts provider-native geometry and explicit table metadata", async () => {
  const schema = await parseJson(
    resolve(schemaDirectory, "parsed-document.v1alpha1.schema.json"),
  );
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  const document = {
    apiVersion: "document-arena.dev/parsed-document/v1alpha1",
    sourceArtifactRef: "source:1",
    parser: { id: "azure-di", upstreamVersion: "1.0.2" },
    metadata: { fileName: "fixture.pdf", numberOfPages: 1 },
    markdown: "Cell",
    rawArtifactRefs: ["raw:1"],
    pages: [
      {
        pageNumber: 1,
        width: 8.5,
        height: 11,
        blocks: [
          {
            id: "table-1",
            kind: "table",
            readingOrder: 0,
            rawArtifactRef: "raw:1",
            rawJsonPointer: "/tables/0",
            tableBlockId: "table-1",
          },
          {
            id: "cell-1",
            kind: "table-cell",
            readingOrder: 1,
            rawArtifactRef: "raw:1",
            rawJsonPointer: "/tables/0/cells/0",
            tableBlockId: "table-1",
            tableCell: { rowIndex: 0, columnIndex: 0 },
            text: "Cell",
            sourceRegions: [
              {
                pageNumber: 1,
                bbox: [0.1, 0.2, 0.4, 0.3],
                provenance: "native",
                native: {
                  bbox: [0.85, 2.2, 3.4, 3.3],
                  coordinateSystem: "azure-di-inch-top-left",
                  artifactId: "raw:1",
                  jsonPointer: "/tables/0/cells/0",
                },
              },
            ],
          },
        ],
      },
    ],
  };

  assert.equal(validate(document), true, JSON.stringify(validate.errors));

  const missingParent = structuredClone(document);
  delete missingParent.pages[0].blocks[1].tableBlockId;
  assert.equal(validate(missingParent), false);
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
