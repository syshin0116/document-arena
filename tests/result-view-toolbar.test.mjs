import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ResultViewToolbar } from "../app/ui/Workspace";

const workspaceSource = await readFile(
  new URL("../app/ui/Workspace.tsx", import.meta.url),
  "utf8",
);
const css = await readFile(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);

function renderToolbar(overrides = {}) {
  return renderToStaticMarkup(
    createElement(ResultViewToolbar, {
      mappingAvailable: true,
      localView: "blocks",
      viewMode: "rendered",
      controlsId: "result-output",
      onLocalViewChange() {},
      onViewModeChange() {},
      ...overrides,
    }),
  );
}

test("result view controls expose two labelled pressed-button groups", () => {
  const html = renderToolbar();

  assert.match(html, /role="group"[^>]*aria-label="Content view"/);
  assert.match(html, /role="group"[^>]*aria-label="Render mode"/);
  assert.match(html, />Content</);
  assert.match(html, />Mode</);
  assert.equal((html.match(/<button/g) ?? []).length, 4);
  assert.equal((html.match(/aria-controls="result-output"/g) ?? []).length, 4);
  assert.match(html, /aria-pressed="true"[^>]*>Blocks<\/button>/);
  assert.match(html, /aria-pressed="false"[^>]*>Markdown<\/button>/);
  assert.match(html, /aria-pressed="true"[^>]*>Rendered<\/button>/);
  assert.match(html, /aria-pressed="false"[^>]*>Raw<\/button>/);
  assert.doesNotMatch(html, /role="tab(?:list)?"|aria-selected=/);
});

test("result view controls preserve mapping status and mode-specific help", () => {
  const unavailable = renderToolbar({ mappingAvailable: false });
  const rawMarkdown = renderToolbar({
    localView: "markdown",
    viewMode: "raw",
  });

  assert.match(unavailable, /No source mapping on this page/);
  assert.doesNotMatch(renderToolbar(), /No source mapping on this page/);
  assert.match(rawMarkdown, /title="Rendered Markdown"/);
  assert.match(rawMarkdown, /title="Raw Markdown output"/);
  assert.match(rawMarkdown, /aria-pressed="true"[^>]*title="Raw Markdown output"/);
});

test("single and compare results share the same toolbar state and output target", () => {
  assert.equal(
    (workspaceSource.match(/<ResultViewToolbar\b/g) ?? []).length,
    2,
  );
  assert.equal(
    (workspaceSource.match(/controlsId=\{resultViewId\}/g) ?? []).length,
    2,
  );
  assert.equal(
    (workspaceSource.match(/id=\{resultViewId\}/g) ?? []).length,
    2,
  );
  assert.equal(
    (workspaceSource.match(/onLocalViewChange=\{setLocalView\}/g) ?? []).length,
    2,
  );
  assert.equal(
    (workspaceSource.match(/onViewModeChange=\{setViewMode\}/g) ?? []).length,
    2,
  );
});

test("toolbar keeps pressed styling, stable status space, and mobile targets", () => {
  // Pressed styling used to be a bespoke .view-toggle rule in globals.css. It
  // now comes from the shadcn toggle variant's aria-pressed:bg-muted utility,
  // so the guard checks the rendered control carries that hook rather than
  // grepping a rule that no longer exists.
  assert.match(renderToolbar(), /aria-pressed:bg-muted/);
  assert.match(
    css,
    /\.result-toolbar-status\s*\{[^}]*min-height:\s*16px/s,
  );

  const mobileStart = css.indexOf(
    "@media (max-width: 760px)",
    css.indexOf(".result-view-toolbar"),
  );
  const mobileEnd = css.indexOf("@media", mobileStart + 1);
  const mobileCss = css.slice(mobileStart, mobileEnd);

  assert.ok(mobileStart >= 0, "Expected a mobile result toolbar rule");
  assert.match(
    mobileCss,
    /\.result-view-toolbar > \.result-view-cluster\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s,
  );
  assert.match(
    mobileCss,
    /\.result-view-group \.result-toggle-group \[data-slot="toggle-group-item"\]\s*\{[^}]*min-height:\s*40px/s,
  );
  assert.doesNotMatch(mobileCss, /flex-wrap|overflow-x/);
});
