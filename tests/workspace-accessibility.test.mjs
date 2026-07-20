import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "bun:test";
import { preferredScrollBehavior } from "../app/motion-preference";

const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const workspaceSource = await readFile(
  new URL("../app/ui/Workspace.tsx", import.meta.url),
  "utf8",
);

// Tokens are oklch or aliases now, and the hues come from Radix Colors, so
// resolving a variable means following var() indirection across files and
// converting oklch to linear sRGB. The guarantee this test makes is unchanged:
// faint informational text clears AA on every surface it is drawn on.
const radixCss = (
  await Promise.all(
    [...css.matchAll(/@import "(@radix-ui\/colors\/[^"]+)"/g)].map(([, spec]) =>
      readFile(new URL(`../node_modules/${spec}`, import.meta.url), "utf8"),
    ),
  )
).join("\n");

// Light-theme declarations only: Radix scopes its dark values to `.dark`, and
// this test is about the light surfaces.
const lightCss = css.slice(0, css.indexOf(".dark {")) + radixCss.replace(/\.dark[^{]*\{[^}]*\}/gs, "");

function rawValue(name) {
  const value = new RegExp(`--${name}:\\s*([^;]+);`, "i").exec(lightCss)?.[1];
  assert.ok(value, `Expected --${name} to be declared`);
  return value.trim();
}

function resolve(name, depth = 0) {
  assert.ok(depth < 10, `--${name} alias chain is too deep`);
  const value = rawValue(name);
  const alias = /^var\(--([a-z0-9-]+)\)$/i.exec(value);
  return alias ? resolve(alias[1], depth + 1) : value;
}

function srgbToLinear(channel) {
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}

function linearRgb(value) {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) {
    return [0, 2, 4].map((offset) =>
      srgbToLinear(Number.parseInt(hex[1].slice(offset, offset + 2), 16) / 255),
    );
  }

  const oklch = /^oklch\(\s*([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s*\)$/i.exec(value);
  assert.ok(oklch, `Cannot read a colour out of "${value}"`);
  const [, lightness, chroma, hue] = oklch.map(Number);
  const radians = (hue * Math.PI) / 180;
  const a = chroma * Math.cos(radians);
  const b = chroma * Math.sin(radians);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((channel) => Math.min(1, Math.max(0, channel)));
}

function relativeLuminance(value) {
  const [r, g, b] = linearRgb(value);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(first, second) {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second));
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

test("faint informational text meets AA contrast on app surfaces", () => {
  const faint = resolve("ink-faint");

  for (const surface of [
    "surface",
    "surface-subtle",
    "canvas",
    "canvas-deep",
    "indigo-soft",
    "amber-soft",
  ]) {
    const ratio = contrastRatio(faint, resolve(surface));
    assert.ok(
      ratio >= 4.5,
      `--ink-faint is ${ratio.toFixed(2)}:1 on --${surface}, below AA`,
    );
  }
});

test("secondary and primary ink clear AA wherever faint ink does", () => {
  for (const ink of ["ink-soft", "ink"]) {
    for (const surface of ["surface", "surface-subtle", "canvas"]) {
      const ratio = contrastRatio(resolve(ink), resolve(surface));
      assert.ok(
        ratio >= 4.5,
        `--${ink} is ${ratio.toFixed(2)}:1 on --${surface}, below AA`,
      );
    }
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
