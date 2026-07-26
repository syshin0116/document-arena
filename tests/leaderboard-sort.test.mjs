import assert from "node:assert/strict";
import { test } from "bun:test";

import { DEFAULT_DIRECTION, sortRows } from "../app/leaderboard-sort.ts";

function row(parserId, { rank = null, standing = null, speed = null } = {}) {
  return { parserId, rank, standing, speed };
}

function standing({ battles = 1, wins = 1, ties = 0, allPoor = 0, winRate = 1 }) {
  return { parserId: "x", battles, wins, ties, allPoor, winRate };
}

function speed(medianMsPerPage) {
  return {
    parserId: "x",
    runs: 1,
    documents: 1,
    medianMsPerPage,
    fastestMsPerPage: medianMsPerPage,
    slowestMsPerPage: medianMsPerPage,
  };
}

const order = (rows) => rows.map((r) => r.parserId);

test("speed sorts fastest first by default", () => {
  const rows = [
    row("mineru", { speed: speed(13215) }),
    row("opendataloader", { speed: speed(264) }),
    row("azuredi", { speed: speed(7383) }),
  ];
  assert.equal(DEFAULT_DIRECTION.speed, "asc");
  assert.deepEqual(
    order(sortRows(rows, { key: "speed", direction: "asc" })),
    ["opendataloader", "azuredi", "mineru"],
  );
  assert.deepEqual(
    order(sortRows(rows, { key: "speed", direction: "desc" })),
    ["mineru", "azuredi", "opendataloader"],
  );
});

test("win rate sorts best first by default", () => {
  assert.equal(DEFAULT_DIRECTION.winRate, "desc");
  const rows = [
    row("a", { standing: standing({ winRate: 0.25 }) }),
    row("b", { standing: standing({ winRate: 0.75 }) }),
  ];
  assert.deepEqual(
    order(sortRows(rows, { key: "winRate", direction: "desc" })),
    ["b", "a"],
  );
});

test("a row with no value sinks in both directions", () => {
  // "No timed runs" is not a speed of zero, and reversing the sort must not
  // promote it to the top as though it were the slowest.
  const rows = [
    row("unmeasured"),
    row("fast", { speed: speed(100) }),
    row("slow", { speed: speed(900) }),
  ];

  assert.deepEqual(
    order(sortRows(rows, { key: "speed", direction: "asc" })),
    ["fast", "slow", "unmeasured"],
  );
  assert.deepEqual(
    order(sortRows(rows, { key: "speed", direction: "desc" })),
    ["slow", "fast", "unmeasured"],
  );
});

test("a parser with battles but no decisive one is not treated as a zero rate", () => {
  const rows = [
    row("allTies", { standing: standing({ battles: 3, ties: 3, winRate: null }) }),
    row("loser", { standing: standing({ battles: 1, wins: 0, winRate: 0 }) }),
  ];
  // The 0% row is a real measurement and outranks the one with no rate at all.
  assert.deepEqual(
    order(sortRows(rows, { key: "winRate", direction: "desc" })),
    ["loser", "allTies"],
  );
  assert.deepEqual(
    order(sortRows(rows, { key: "winRate", direction: "asc" })),
    ["loser", "allTies"],
  );
});

test("equal values fall back to the parser id, so re-sorting is stable", () => {
  const rows = [
    row("mineru", { standing: standing({ ties: 2 }) }),
    row("azuredi", { standing: standing({ ties: 2 }) }),
    row("opendataloader", { standing: standing({ ties: 2 }) }),
  ];
  const ascending = order(sortRows(rows, { key: "ties", direction: "asc" }));
  const descending = order(sortRows(rows, { key: "ties", direction: "desc" }));
  assert.deepEqual(ascending, ["azuredi", "mineru", "opendataloader"]);
  assert.deepEqual(descending, ascending);
});

test("the parser column sorts by name, not by id order", () => {
  const rows = [row("opendataloader"), row("azuredi"), row("mineru")];
  assert.deepEqual(
    order(sortRows(rows, { key: "parser", direction: "asc" })),
    ["azuredi", "mineru", "opendataloader"],
  );
});

test("the default order is the order the table was built in", () => {
  // Unvoted parsers arrive fastest-first from the speed aggregate. Treating
  // "default" as a sortable column would tie them all on a null rank and drop
  // them into alphabetical order, silently losing that.
  const rows = [
    row("second", { rank: 2 }),
    row("first", { rank: 1 }),
    row("fast", { speed: speed(1) }),
    row("slow", { speed: speed(900) }),
  ];
  assert.deepEqual(
    order(sortRows(rows, { key: "default", direction: "asc" })),
    ["second", "first", "fast", "slow"],
  );
  assert.deepEqual(
    order(sortRows(rows, { key: "default", direction: "desc" })),
    ["second", "first", "fast", "slow"],
  );
});

test("sorting does not mutate the array it was given", () => {
  const rows = [row("b", { speed: speed(2) }), row("a", { speed: speed(1) })];
  const before = order(rows);
  sortRows(rows, { key: "speed", direction: "asc" });
  assert.deepEqual(order(rows), before);
});
