import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  cleanRunOptionValues,
  defaultRunOptionValues,
  localComponentRunAvailability,
  optionChoices,
  parseStringArray,
  runOptionsInvalidReason,
} from "../app/run-options";
import { RunOptionsDialog } from "../app/ui/RunOptionsDialog";

const [css, workspaceSource] = await Promise.all([
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  readFile(new URL("../app/ui/Workspace.tsx", import.meta.url), "utf8"),
]);

const unavailable = (reason) => ({
  "x-parser-arena": { disabledReason: reason },
});

const fixed = (reason, sourceUrl) => ({
  "x-parser-arena": {
    availability: { state: "fixed", reason, reasonCode: "fixed-upstream" },
    sourceUrl,
  },
});

test("defaults and cleaned submissions preserve primitive types and omit disabled values", () => {
  const properties = {
    locale: { type: "string", default: "ko-KR" },
    highResolution: { type: "boolean", default: false },
    threshold: { type: "number", default: 0.5 },
    attempts: { type: "integer", default: 2 },
    engines: {
      type: "array",
      default: ["cpu", "gpu"],
      items: {
        oneOf: [
          { const: "cpu", title: "CPU" },
          { const: "gpu", title: "GPU", ...unavailable("No GPU detected") },
        ],
      },
    },
    tags: { type: "array", items: { type: "string" }, default: ["ocr"] },
    pinnedModel: {
      type: "string",
      default: "v1",
      ...fixed("The adapter pins this model", "https://example.com/model"),
    },
    legacyMode: {
      type: "boolean",
      default: true,
      ...unavailable("Removed by this runtime"),
    },
  };

  assert.deepEqual(defaultRunOptionValues(properties), {
    locale: "ko-KR",
    highResolution: false,
    threshold: 0.5,
    attempts: 2,
    engines: ["cpu"],
    tags: ["ocr"],
  });

  assert.deepEqual(
    cleanRunOptionValues(properties, {
      locale: "en-US",
      highResolution: true,
      threshold: "0.75",
      attempts: "3",
      engines: ["cpu", "gpu"],
      tags: "korean, tables\nocr",
      pinnedModel: "v1",
      legacyMode: true,
    }),
    {
      locale: "en-US",
      highResolution: true,
      threshold: 0.75,
      attempts: 3,
      engines: ["cpu"],
      tags: ["korean", "tables", "ocr"],
    },
  );
  assert.deepEqual(parseStringArray(" a, b\nc "), ["a", "b", "c"]);
});

test("oneOf normalization keeps every fixed and unavailable choice visible", () => {
  const choices = optionChoices({
    oneOf: [
      { const: "auto", title: "Automatic" },
      {
        const: "exact",
        title: "Exact upstream tag",
        ...fixed("Pinned by the adapter", "https://example.com/tags"),
      },
      {
        const: "cuda",
        title: "CUDA",
        description: "GPU execution",
        ...unavailable("CUDA is not installed"),
      },
    ],
  });

  assert.equal(choices.length, 3);
  assert.deepEqual(
    choices.map((choice) => [choice.value, choice.disablement?.state]),
    [
      ["auto", undefined],
      ["exact", "fixed"],
      ["cuda", "unavailable"],
    ],
  );
  assert.equal(choices[1].sourceUrl, "https://example.com/tags");
  assert.equal(choices[2].description, "GPU execution");
});

test("validation blocks choice groups with no valid available value", () => {
  const properties = {
    engine: {
      type: "string",
      oneOf: [
        { const: "cuda", ...unavailable("No GPU") },
        { const: "metal", ...fixed("Fixed outside this environment") },
      ],
    },
  };

  assert.equal(
    runOptionsInvalidReason(properties, {}),
    "No available choice exists for Engine.",
  );
});

test("validation honors excluded values and array item constraints", () => {
  const properties = {
    threads: {
      type: "integer",
      minimum: -1,
      not: { const: 0 },
      default: -1,
    },
    queryFields: {
      type: "array",
      uniqueItems: true,
      maxItems: 2,
      items: { type: "string", minLength: 2, maxLength: 8 },
    },
  };

  assert.equal(
    runOptionsInvalidReason(properties, { threads: "0" }),
    "Threads cannot be 0.",
  );
  assert.equal(
    runOptionsInvalidReason(properties, {
      threads: "1",
      queryFields: "Name, Name",
    }),
    "Query Fields cannot contain duplicate values.",
  );
  assert.equal(
    runOptionsInvalidReason(properties, {
      threads: "1",
      queryFields: "A",
    }),
    "Query Fields values need at least 2 characters.",
  );
});

test("component availability is generic and only false images are unavailable", () => {
  const component = {
    id: "future-parser",
    version: "1.0.0",
    image: "example.invalid/future@sha256:test",
  };
  assert.deepEqual(localComponentRunAvailability(component), { available: true });
  assert.deepEqual(localComponentRunAvailability({
    ...component,
    imageAvailable: false,
  }), {
    available: false,
    disabledReason:
      "This component image is not available in the current runner environment.",
  });
  assert.deepEqual(
    localComponentRunAvailability({
      ...component,
      imageAvailable: true,
      availability: {
        runnable: false,
        reasons: [
          {
            code: "connection-unavailable",
            message: "A remote connection is not configured.",
          },
        ],
      },
    }),
    {
      available: false,
      disabledReason: "A remote connection is not configured.",
      reasons: [
        {
          code: "connection-unavailable",
          message: "A remote connection is not configured.",
        },
      ],
    },
  );
  assert.deepEqual(
    localComponentRunAvailability({
      ...component,
      imageAvailable: false,
      availability: { runnable: true, reasons: [] },
    }),
    { available: true },
    "the runner's aggregated readiness takes precedence over legacy imageAvailable",
  );
});

test("run options dialog renders every schema field, choice, default, and reason", () => {
  const html = renderToStaticMarkup(
    createElement(RunOptionsDialog, {
      componentName: "Partner parser",
      availability: { available: true },
      schema: {
        title: "Partner parser options",
        properties: {
          pages: {
            type: "string",
            description: "Pages to parse",
            pattern: "^[0-9,-]+$",
            default: "1-3",
          },
          threshold: {
            type: "number",
            description: "Confidence floor",
            minimum: 0,
            maximum: 1,
            default: 0.5,
          },
          mode: {
            type: "string",
            description: "Execution strategy",
            default: "auto",
            oneOf: [
              { const: "auto", title: "Automatic" },
              {
                const: "exact",
                title: "Exact tag",
                ...fixed("Pinned by upstream", "https://example.com/exact"),
              },
              {
                const: "cuda",
                title: "CUDA",
                ...unavailable("No compatible GPU"),
              },
            ],
          },
          stages: {
            type: "array",
            description: "Pipeline stages",
            default: ["layout"],
            items: {
              oneOf: [
                { const: "layout", title: "Layout" },
                {
                  const: "formula",
                  title: "Formula",
                  ...unavailable("Model is not installed"),
                },
              ],
            },
          },
          tags: {
            type: "array",
            description: "Free-form query fields",
            uniqueItems: true,
            maxItems: 20,
            items: { type: "string", minLength: 1, maxLength: 128 },
          },
          threads: {
            type: "integer",
            description: "Worker threads; zero is invalid",
            minimum: -1,
            not: { const: 0 },
            default: -1,
          },
          pinnedModel: {
            type: "string",
            default: "v1",
            ...fixed("Adapter-controlled", "javascript:alert(1)"),
          },
        },
      },
      onCancel() {},
      onConfirm() {},
    }),
  );

  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /Run Partner parser/);
  assert.match(html, /Partner parser options/);
  assert.match(html, /Pages to parse/);
  assert.match(html, /pattern="\^\[0-9,-\]\+\$"/);
  assert.match(html, /Confidence floor/);
  assert.match(html, /min="0"/);
  assert.match(html, /max="1"/);
  assert.match(html, /Default: 0\.5/);
  assert.match(html, /Automatic/);
  assert.match(html, /Exact tag/);
  assert.match(html, /Pinned by upstream/);
  assert.match(html, />Fixed</);
  assert.match(html, /CUDA/);
  assert.match(html, /No compatible GPU/);
  assert.match(html, />Unavailable</);
  assert.match(html, /type="checkbox"/);
  assert.match(html, /Formula/);
  assert.match(html, /Model is not installed/);
  assert.match(html, /<textarea/);
  assert.match(html, /Free-form query fields/);
  assert.match(html, /Maximum values: 20/);
  assert.match(html, /Item minimum length: 1/);
  assert.match(html, /Item maximum length: 128/);
  assert.match(html, /Unique values/);
  assert.match(html, /Excluded value: 0/);
  assert.match(html, /Adapter-controlled/);
  assert.doesNotMatch(html, /javascript:alert/);
  assert.match(html, />Cancel</);
  assert.match(html, />Run Partner parser</);
});

test("the final Run stays disabled for an unavailable component", () => {
  const html = renderToStaticMarkup(
    createElement(RunOptionsDialog, {
      componentName: "Unavailable parser",
      availability: {
        available: false,
        disabledReason: "Image missing from this runner",
      },
      schema: {
        properties: { enabled: { type: "boolean", default: true } },
      },
      onCancel() {},
      onConfirm() {},
    }),
  );

  assert.match(html, /Unavailable in this environment/);
  assert.match(html, /Image missing from this runner/);
  assert.equal((html.match(/disabled=""/g) ?? []).length, 2);
});

test("the final Run stays disabled while all declared choices remain visible but unavailable", () => {
  const html = renderToStaticMarkup(
    createElement(RunOptionsDialog, {
      componentName: "Choice-bound parser",
      availability: { available: true },
      schema: {
        properties: {
          engine: {
            type: "string",
            oneOf: [
              { const: "cuda", title: "CUDA", ...unavailable("No GPU") },
              { const: "metal", title: "Metal", ...unavailable("No Metal") },
            ],
          },
        },
      },
      onCancel() {},
      onConfirm() {},
    }),
  );

  assert.match(html, /CUDA/);
  assert.match(html, /No GPU/);
  assert.match(html, /Metal/);
  assert.match(html, /No Metal/);
  assert.match(html, /No available choice exists for Engine/);
  assert.equal((html.match(/disabled=""/g) ?? []).length, 3);
});

test("runner strip uses the modal path and no longer contains the gear popover", () => {
  assert.doesNotMatch(workspaceSource, /strip-options-popover/);
  assert.doesNotMatch(workspaceSource, /className="strip-options"/);
  assert.match(workspaceSource, /onRequestRun/);
  assert.match(workspaceSource, /Object\.keys\(properties\)\.length === 0/);
  assert.match(workspaceSource, /All parsers…/);
  assert.match(workspaceSource, /const disabled = !inspectable\(entry\)/);
  assert.match(
    workspaceSource,
    /componentDisabled=\{!selectedAvailability\.available\}/,
  );

  const backdrop = /\.run-options-backdrop\s*\{([^}]*)\}/.exec(css)?.[1];
  const dialog = /\.run-options-dialog\s*\{([^}]*)\}/.exec(css)?.[1];
  assert.ok(backdrop);
  assert.match(backdrop, /position:\s*fixed/);
  assert.match(backdrop, /inset:\s*0/);
  assert.ok(dialog);
  assert.match(dialog, /max-height:\s*calc\(100dvh - 48px\)/);
  assert.doesNotMatch(`${backdrop}${dialog}`, /animation|transition/);
});
