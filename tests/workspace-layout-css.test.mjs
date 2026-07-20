import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "bun:test";

const css = await readFile(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);

function declarationBlock(selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`).exec(css);
  assert.ok(match, `Expected a CSS rule for ${selector}`);
  return match[1];
}

test("completed results fill their pane with or without a toolbar", () => {
  const shell = declarationBlock(".result-ready-shell");
  assert.match(shell, /display:\s*flex\s*;/);
  assert.match(shell, /min-height:\s*0\s*;/);
  assert.match(shell, /flex-direction:\s*column\s*;/);
  assert.doesNotMatch(shell, /grid-template-rows/);

  const results = declarationBlock(
    ".result-ready-shell > .results-scroll",
  );
  assert.match(results, /flex:\s*1\s+1\s+auto\s*;/);
});

test("mobile workspaces without a run dock reserve the pane switcher row", () => {
  const desktopRule =
    /\.workspace-shell\[data-no-dock\]\s*\{\s*grid-template-rows:\s*64px\s+minmax\(0,\s*1fr\)\s*;\s*\}/.exec(
      css,
    );
  assert.ok(desktopRule, "Expected the desktop no-dock workspace rows");

  const mobileRule =
    /@media\s*\(max-width:\s*760px\)\s*\{\s*\.workspace-shell\[data-no-dock\]\s*\{\s*grid-template-rows:\s*58px\s+42px\s+minmax\(0,\s*1fr\)\s*;\s*\}\s*\}/.exec(
      css,
    );
  assert.ok(
    mobileRule,
    "Expected mobile no-dock rows for header, pane switcher, and canvas",
  );
  assert.ok(
    mobileRule.index > desktopRule.index,
    "The mobile override must follow the desktop no-dock rule in the cascade",
  );
});
