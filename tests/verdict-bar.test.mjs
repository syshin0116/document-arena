import assert from "node:assert/strict";
import { test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { VerdictBar } from "../app/ui/VerdictBar";

function render(overrides = {}) {
  return renderToStaticMarkup(
    createElement(VerdictBar, {
      candidates: [
        { parserId: "opendataloader", label: "OpenDataLoader" },
        { parserId: "mineru", label: "MinerU" },
      ],
      votedOutcome: null,
      disabledReason: null,
      onVote() {},
      ...overrides,
    }),
  );
}

function buttonOrder(html) {
  return [...html.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map((m) =>
    m[1].replace(/<[^>]*>/g, "").trim(),
  );
}

test("a two-way comparison offers each candidate, then tie and all-poor", () => {
  const html = render();
  assert.deepEqual(buttonOrder(html), [
    "OpenDataLoader",
    "MinerU",
    "Tie",
    "All poor",
  ]);
  assert.match(html, /aria-label="Vote on this comparison"/);
});

test("a three-way comparison offers all three", () => {
  const html = render({
    candidates: [
      { parserId: "opendataloader", label: "OpenDataLoader" },
      { parserId: "mineru", label: "MinerU" },
      { parserId: "azuredi", label: "Azure DI" },
    ],
  });
  assert.deepEqual(buttonOrder(html), [
    "OpenDataLoader",
    "MinerU",
    "Azure DI",
    "Tie",
    "All poor",
  ]);
});

test("button order follows the columns, not the catalog", () => {
  // The recorded vote claims its candidates are in display order, so the bar
  // must render the array as handed to it rather than sorting it.
  const html = render({
    candidates: [
      { parserId: "azuredi", label: "Azure DI" },
      { parserId: "opendataloader", label: "OpenDataLoader" },
    ],
  });
  assert.deepEqual(buttonOrder(html), [
    "Azure DI",
    "OpenDataLoader",
    "Tie",
    "All poor",
  ]);
});

test("an unsaved run disables every vote and says why", () => {
  const html = render({ disabledReason: "One of these runs was not saved." });
  const buttons = [...html.matchAll(/<button[^>]*>/g)].map((m) => m[0]);
  assert.equal(buttons.length, 4);
  for (const button of buttons) assert.match(button, /disabled/);
  assert.match(html, /One of these runs was not saved\./);
});

test("a recorded verdict replaces the buttons", () => {
  const html = render({ votedOutcome: "tie" });
  assert.equal(buttonOrder(html).length, 0);
  assert.match(html, /You called this a tie\./);
  assert.match(html, /aria-label="Recorded verdict"/);
});

test("no button carries the parser id it stands for", () => {
  // Under a mask the label reads "Candidate A"; an id left in an attribute
  // would hand the answer to anyone who opened the inspector.
  const html = render({
    candidates: [
      { parserId: "opendataloader", label: "Candidate A" },
      { parserId: "mineru", label: "Candidate B" },
    ],
  });
  assert.doesNotMatch(html, /opendataloader/);
  assert.doesNotMatch(html, /mineru/);
});

test("a recorded winner is named by its display label", () => {
  const html = render({ votedOutcome: "mineru" });
  assert.match(html, /You called this MinerU\./);
});
