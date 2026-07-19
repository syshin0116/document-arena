import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { preferredScrollBehavior } from "../app/motion-preference";

const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const workspaceSource = await readFile(
  new URL("../app/ui/Workspace.tsx", import.meta.url),
  "utf8",
);

function cssVariable(name) {
  const value = new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "i").exec(css)?.[1];
  assert.ok(value, `Expected --${name} to be a six-digit hex color`);
  return value;
}

function relativeLuminance(hex) {
  const channels = [1, 3, 5].map((offset) =>
    Number.parseInt(hex.slice(offset, offset + 2), 16) / 255,
  );
  const linear = channels.map((channel) =>
    channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(first, second) {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second));
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

test("faint informational text meets AA contrast on app surfaces", () => {
  const faint = cssVariable("ink-faint");

  for (const surface of [
    "surface",
    "surface-subtle",
    "canvas",
    "canvas-deep",
    "indigo-soft",
    "amber-soft",
  ]) {
    assert.ok(
      contrastRatio(faint, cssVariable(surface)) >= 4.5,
      `--ink-faint should meet AA contrast on --${surface}`,
    );
  }
});

test("programmatic evidence scrolling respects reduced motion", () => {
  assert.equal(preferredScrollBehavior(true), "auto");
  assert.equal(preferredScrollBehavior(false), "smooth");
  assert.equal(
    (workspaceSource.match(/behavior:\s*preferredScrollBehavior\(\)/g) ?? [])
      .length,
    2,
  );
  assert.doesNotMatch(workspaceSource, /scrollIntoView\([^)]*behavior:\s*"smooth"/s);
});
