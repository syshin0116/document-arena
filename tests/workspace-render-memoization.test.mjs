import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "bun:test";

const workspaceSource = await readFile(
  new URL("../app/ui/Workspace.tsx", import.meta.url),
  "utf8",
);

function namedMemoBoundary(componentName) {
  return new RegExp(
    `const\\s+${componentName}\\s*=\\s*memo\\(function\\s+${componentName}\\s*\\(`,
  );
}

test("expensive result renderers keep named memo boundaries", () => {
  for (const componentName of [
    "MarkdownView",
    "BlockRawView",
    "InlineMarkdown",
  ]) {
    assert.match(
      workspaceSource,
      namedMemoBoundary(componentName),
      `${componentName} should skip work when its immutable inputs are unchanged`,
    );
  }
});

test("evidence-sensitive reading and recursive markdown parsing stay outside those boundaries", () => {
  assert.match(workspaceSource, /function\s+BlockReadingView\s*\(/);
  assert.doesNotMatch(workspaceSource, namedMemoBoundary("BlockReadingView"));
  assert.match(
    workspaceSource,
    /const\s+pattern\s*=\s*new\s+RegExp\(INLINE_MARKDOWN_PATTERN\.source,\s*"g"\)/,
  );
});
