import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "bun:test";

import {
  conversionOptions,
  resolveOptions,
} from "../extensions/opendataloader-pdf/adapter/options.mjs";

const root = resolve(import.meta.dirname, "..");
const extensionRoot = resolve(root, "extensions/opendataloader-pdf");

const defaultOptions = {
  outputDir: "raw",
  format: ["json", "markdown"],
  imageOutput: "off",
  quiet: true,
  threads: "1",
  hybrid: "off",
  tableMethod: "default",
  readingOrder: "xycut",
  includeHeaderFooter: false,
  useStructTree: false,
  detectStrikethrough: false,
  sanitize: false,
  keepLineBreaks: false,
  replaceInvalidChars: " ",
  markdownPageSeparator: "",
  markdownWithHtml: false,
};

test("OpenDataLoader resolver records reviewed defaults and safe local options", () => {
  assert.deepEqual(resolveOptions({}), defaultOptions);

  assert.deepEqual(
    resolveOptions({
      pages: " 1, 3, 5 - 7 ",
      tableMethod: "cluster",
      readingOrder: "off",
      includeHeaderFooter: true,
      useStructTree: true,
      detectStrikethrough: true,
      sanitize: true,
      keepLineBreaks: true,
      replaceInvalidChars: "_",
      markdownPageSeparator: "--- page %page-number% ---",
      markdownWithHtml: true,
    }),
    {
      ...defaultOptions,
      pages: "1,3,5-7",
      tableMethod: "cluster",
      readingOrder: "off",
      includeHeaderFooter: true,
      useStructTree: true,
      detectStrikethrough: true,
      sanitize: true,
      keepLineBreaks: true,
      replaceInvalidChars: "_",
      markdownPageSeparator: "--- page %page-number% ---",
      markdownWithHtml: true,
    },
  );
});

test("OpenDataLoader resolver accepts only exact schema-valid fixed values", () => {
  assert.deepEqual(
    resolveOptions({
      outputDir: "raw",
      format: ["json", "markdown"],
      imageOutput: "off",
      quiet: true,
      threads: "1",
      hybrid: "off",
    }),
    defaultOptions,
  );

  for (const [key, value] of Object.entries({
    outputDir: "/arena/output/raw",
    format: ["json"],
    imageOutput: "embedded",
    quiet: false,
    threads: "2",
    hybrid: "docling-fast",
  })) {
    assert.throws(
      () => resolveOptions({ [key]: value }),
      new RegExp(`Invalid fixed ${key}`),
    );
  }
});

test("OpenDataLoader resolver validates positive ascending Java page ranges", () => {
  for (const [input, expected] of [
    ["1", "1"],
    ["1,3,5-7", "1,3,5-7"],
    [" 1, 3, 5 - 7 ", "1,3,5-7"],
    ["2147483647", "2147483647"],
  ]) {
    assert.equal(resolveOptions({ pages: input }).pages, expected);
  }

  for (const input of [
    "",
    "0",
    "-",
    "1,,2",
    "3-1",
    "1-",
    "-2",
    "1.5",
    "2147483648",
    null,
    1,
  ]) {
    assert.throws(() => resolveOptions({ pages: input }), /Invalid pages option/);
  }
});

test("OpenDataLoader resolver rejects unavailable, unknown, null, and mistyped options", () => {
  const unavailableValues = {
    password: "secret",
    contentSafetyOff: ["all"],
    textPageSeparator: "---",
    htmlPageSeparator: "<hr>",
    imageFormat: "png",
    imageDir: "images",
    hybridMode: "auto",
    hybridUrl: "http://localhost:5002",
    hybridTimeout: "0",
    hybridFallback: false,
    hybridHancomAiRegionlistStrategy: "table-first",
    hybridHancomAiOcrStrategy: "auto",
    hybridHancomAiImageCache: "memory",
    toStdout: false,
  };
  for (const [key, value] of Object.entries(unavailableValues)) {
    assert.throws(
      () => resolveOptions({ [key]: value }),
      new RegExp(`Unsupported option: ${key}`),
    );
  }

  assert.throws(() => resolveOptions({ futureOption: true }), /Unsupported option/);
  assert.throws(() => resolveOptions(null), /must be an object/);
  assert.throws(() => resolveOptions([]), /must be an object/);
  assert.throws(() => resolveOptions("options"), /must be an object/);
  assert.throws(() => resolveOptions({ tableMethod: null }), /Invalid tableMethod/);
  assert.throws(() => resolveOptions({ readingOrder: null }), /Invalid readingOrder/);
  assert.throws(() => resolveOptions({ sanitize: null }), /Invalid sanitize/);
  assert.throws(
    () => resolveOptions({ includeHeaderFooter: "true" }),
    /Invalid includeHeaderFooter/,
  );
  assert.throws(
    () => resolveOptions({ replaceInvalidChars: "" }),
    /Invalid replaceInvalidChars/,
  );
  assert.throws(
    () => resolveOptions({ markdownPageSeparator: null }),
    /Invalid markdownPageSeparator/,
  );
});

test("OpenDataLoader conversion replaces only the recorded relative output directory", () => {
  const recorded = resolveOptions({
    sanitize: true,
    markdownPageSeparator: "---",
  });
  const snapshot = structuredClone(recorded);
  const actual = conversionOptions(recorded, "/arena/output/raw");

  assert.deepEqual(actual, {
    ...recorded,
    outputDir: "/arena/output/raw",
  });
  assert.deepEqual(recorded, snapshot);
  assert.equal(recorded.outputDir, "raw");
  assert.equal("password" in actual, false);
  assert.equal("contentSafetyOff" in actual, false);

  assert.throws(() => conversionOptions(null, "/arena/output/raw"), /object/);
  assert.throws(() => conversionOptions([], "/arena/output/raw"), /object/);
  assert.throws(() => conversionOptions(recorded, ""), /absolute path/);
  assert.throws(() => conversionOptions(recorded, "raw"), /absolute path/);
  assert.throws(() => conversionOptions(recorded, null), /absolute path/);
});

test("OpenDataLoader main passes absolute execution options but records resolved options", async () => {
  const source = await readFile(resolve(extensionRoot, "adapter/main.mjs"), "utf8");

  assert.match(
    source,
    /import \{ conversionOptions, resolveOptions \} from "\.\/options\.mjs";/,
  );
  assert.match(source, /const options = resolveOptions\(request\.options\);/);
  assert.match(
    source,
    /await convert\(sourcePath, conversionOptions\(options, rawDirectory\)\);/,
  );
  assert.match(source, /\n\s+options,\n\s+progress:/);
});
