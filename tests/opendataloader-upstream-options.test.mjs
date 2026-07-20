import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "bun:test";

const root = resolve(import.meta.dirname, "..");
const schemaPath = resolve(
  root,
  "extensions/opendataloader-pdf/options.schema.json",
);

async function readSchema() {
  return JSON.parse(await readFile(schemaPath, "utf8"));
}

function choiceValues(property) {
  const choices = property.type === "array" ? property.items : property;
  if (Array.isArray(choices.oneOf)) {
    return choices.oneOf.map((choice) => choice.const);
  }
  return choices.enum;
}

test("OpenDataLoader schema mirrors the complete v2.5.0 public convert surface", async () => {
  const schema = await readSchema();

  assert.deepEqual(Object.keys(schema.properties), [
    "outputDir",
    "password",
    "format",
    "quiet",
    "contentSafetyOff",
    "sanitize",
    "keepLineBreaks",
    "replaceInvalidChars",
    "useStructTree",
    "tableMethod",
    "readingOrder",
    "markdownPageSeparator",
    "markdownWithHtml",
    "textPageSeparator",
    "htmlPageSeparator",
    "imageOutput",
    "imageFormat",
    "imageDir",
    "pages",
    "includeHeaderFooter",
    "detectStrikethrough",
    "hybrid",
    "hybridMode",
    "hybridUrl",
    "hybridTimeout",
    "hybridFallback",
    "hybridHancomAiRegionlistStrategy",
    "hybridHancomAiOcrStrategy",
    "hybridHancomAiImageCache",
    "toStdout",
    "threads",
  ]);

  const expectedChoices = {
    format: ["json", "text", "html", "pdf", "markdown", "tagged-pdf"],
    contentSafetyOff: [
      "all",
      "hidden-text",
      "off-page",
      "tiny",
      "hidden-ocg",
    ],
    tableMethod: ["default", "cluster"],
    readingOrder: ["off", "xycut"],
    imageOutput: ["off", "embedded", "external"],
    imageFormat: ["png", "jpeg"],
    hybrid: ["off", "docling-fast", "hancom-ai"],
    hybridMode: ["auto", "full"],
    hybridHancomAiRegionlistStrategy: ["table-first", "list-only"],
    hybridHancomAiOcrStrategy: ["off", "auto", "force"],
    hybridHancomAiImageCache: ["memory", "disk"],
  };
  for (const [name, expected] of Object.entries(expectedChoices)) {
    assert.deepEqual(
      choiceValues(schema.properties[name]),
      expected,
      `${name} choices must match upstream v2.5.0`,
    );
  }
});

test("OpenDataLoader schema declares generic availability and exact-tag sources", async () => {
  const schema = await readSchema();
  const editable = new Set([
    "pages",
    "tableMethod",
    "readingOrder",
    "includeHeaderFooter",
    "useStructTree",
    "detectStrikethrough",
    "sanitize",
    "keepLineBreaks",
    "replaceInvalidChars",
    "markdownPageSeparator",
    "markdownWithHtml",
  ]);
  const fixed = new Set([
    "outputDir",
    "format",
    "quiet",
    "imageOutput",
    "hybrid",
    "threads",
  ]);
  const unavailable = new Set([
    "password",
    "contentSafetyOff",
    "textPageSeparator",
    "htmlPageSeparator",
    "imageFormat",
    "imageDir",
    "hybridMode",
    "hybridUrl",
    "hybridTimeout",
    "hybridFallback",
    "hybridHancomAiRegionlistStrategy",
    "hybridHancomAiOcrStrategy",
    "hybridHancomAiImageCache",
    "toStdout",
  ]);

  assert.equal(editable.size + fixed.size + unavailable.size, 31);
  for (const [name, property] of Object.entries(schema.properties)) {
    assert.ok(property.description?.trim(), `${name} needs a description`);
    const annotation = property["x-document-arena"];
    assert.match(
      annotation?.sourceUrl ?? "",
      /^https:\/\/github\.com\/opendataloader-project\/opendataloader-pdf\/blob\/2bd7466d4742491b05920483bdf2ea7395444a16\//,
      `${name} needs an exact-commit source URL`,
    );

    const availability = annotation?.availability;
    if (editable.has(name)) {
      assert.equal(
        availability,
        undefined,
        `${name} must remain user-editable`,
      );
      continue;
    }
    const expectedState = fixed.has(name) ? "fixed" : "unavailable";
    assert.ok(unavailable.has(name) || fixed.has(name));
    assert.equal(availability?.state, expectedState, `${name} state`);
    assert.ok(availability?.reason?.trim(), `${name} needs a reason`);
    assert.ok(availability?.reasonCode?.trim(), `${name} needs a reason code`);
  }

  assert.equal(
    schema.properties.password["x-document-arena"].availability.reasonCode,
    "secret-channel-required",
  );
  assert.equal(
    schema.properties.contentSafetyOff["x-document-arena"].availability
      .reasonCode,
    "safety-policy",
  );
  assert.equal(
    schema.properties.threads["x-document-arena"].availability.reasonCode,
    "deterministic-output",
  );
});

test("OpenDataLoader fixed choices retain unavailable alternatives and reasons", async () => {
  const schema = await readSchema();

  const formatChoices = schema.properties.format.items.oneOf;
  assert.deepEqual(
    formatChoices.map((choice) => [
      choice.const,
      choice["x-document-arena"].availability.state,
    ]),
    [
      ["json", "fixed"],
      ["text", "unavailable"],
      ["html", "unavailable"],
      ["pdf", "unavailable"],
      ["markdown", "fixed"],
      ["tagged-pdf", "unavailable"],
    ],
  );
  assert.deepEqual(
    schema.properties.imageOutput.oneOf.map((choice) => [
      choice.const,
      choice["x-document-arena"].availability.state,
    ]),
    [
      ["off", "fixed"],
      ["embedded", "unavailable"],
      ["external", "unavailable"],
    ],
  );
  assert.deepEqual(
    schema.properties.hybrid.oneOf.map((choice) => [
      choice.const,
      choice["x-document-arena"].availability.state,
    ]),
    [
      ["off", "fixed"],
      ["docling-fast", "unavailable"],
      ["hancom-ai", "unavailable"],
    ],
  );
});
