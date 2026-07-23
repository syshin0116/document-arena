import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "bun:test";

const workspaceSource = await readFile(
  new URL("../app/ui/Workspace.tsx", import.meta.url),
  "utf8",
);

test("raw table text is rendered through the valid Markdown table component", () => {
  assert.match(
    workspaceSource,
    /const MARKDOWN_COMPONENTS = \{ table: MarkdownTable \}/,
  );
  assert.match(workspaceSource, /<caption>\{caption\}<\/caption>/);
  assert.match(workspaceSource, /components=\{MARKDOWN_COMPONENTS\}/);
});

test("clicking source evidence pins without scrolling the result pane", () => {
  const sourcePinHandler = workspaceSource.match(
    /function pinSourceEvidence\(next: string\) \{[\s\S]*?\n  \}/,
  )?.[0];

  assert.ok(sourcePinHandler);
  assert.match(sourcePinHandler, /pinEvidence\(next\)/);
  assert.doesNotMatch(sourcePinHandler, /scrollIntoView|pinFromSource/);
  assert.doesNotMatch(workspaceSource, /block:\s*"center"/);
});
