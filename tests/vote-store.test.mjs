import assert from "node:assert/strict";
import { test } from "bun:test";

import {
  aggregateStandings,
  isVote,
} from "../app/vote-store.ts";

function candidate(parserId, n = 1) {
  return {
    parserId,
    runId: `job-${parserId}-${n}`,
    recordId: `local_doc:${parserId}:job-${parserId}-${n}`,
  };
}

function vote(overrides = {}) {
  return {
    id: "vote_1",
    createdAt: "2026-07-26T00:00:00.000Z",
    documentId: "local_doc",
    page: 1,
    candidates: [candidate("opendataloader"), candidate("mineru")],
    outcome: "opendataloader",
    blind: true,
    ...overrides,
  };
}

test("a three-way comparison records a battle for every candidate", () => {
  const standings = aggregateStandings([
    vote({
      candidates: [
        candidate("opendataloader"),
        candidate("mineru"),
        candidate("azuredi"),
      ],
      outcome: "azuredi",
    }),
  ]);

  assert.equal(standings.length, 3);
  for (const standing of standings) assert.equal(standing.battles, 1);
  const winner = standings.find((s) => s.parserId === "azuredi");
  assert.equal(winner.wins, 1);
  assert.equal(winner.winRate, 1);
});

test("an all-poor verdict is not a loss for anyone", () => {
  // The rate claims to be "wins over decisive battles". Counting all-poor as a
  // decisive loss dragged the winner of a separate battle from 1.0 to 0.5.
  const standings = aggregateStandings([
    vote({ id: "v1", outcome: "opendataloader" }),
    vote({ id: "v2", outcome: "all-poor" }),
  ]);

  const odl = standings.find((s) => s.parserId === "opendataloader");
  assert.equal(odl.battles, 2);
  assert.equal(odl.wins, 1);
  assert.equal(odl.allPoor, 1);
  assert.equal(odl.winRate, 1);
});

test("a tie is a battle for each parser and leaves the rate undefined", () => {
  const standings = aggregateStandings([vote({ outcome: "tie" })]);

  for (const standing of standings) {
    assert.equal(standing.battles, 1);
    assert.equal(standing.ties, 1);
    assert.equal(standing.winRate, null);
  }
});

test("labeled votes never reach the standings", () => {
  assert.deepEqual(aggregateStandings([vote({ blind: false })]), []);
});

test("standings sort by win rate, then by battles", () => {
  const standings = aggregateStandings([
    vote({ id: "v1", outcome: "mineru" }),
    vote({ id: "v2", outcome: "mineru" }),
    vote({
      id: "v3",
      candidates: [candidate("opendataloader"), candidate("azuredi")],
      outcome: "opendataloader",
    }),
  ]);

  assert.equal(standings[0].parserId, "mineru");
  assert.equal(standings[0].winRate, 1);
});

test("malformed persisted records are rejected", () => {
  assert.ok(isVote(vote()));

  // v1 records: parallel arrays, no candidates, ids that resolve to nothing.
  assert.equal(
    isVote({
      id: "v",
      createdAt: "2026-01-01T00:00:00.000Z",
      documentId: "demo",
      documentType: "digital-text",
      page: 1,
      permutation: ["opendataloader", "mineru"],
      candidateArtifactIds: ["demo-opendataloader-parsed-document"],
      outcome: "opendataloader",
      blind: true,
    }),
    false,
  );

  assert.equal(isVote(vote({ candidates: [candidate("mineru")] })), false);
  assert.equal(
    isVote(vote({ candidates: [candidate("mineru"), candidate("mineru", 2)] })),
    false,
  );
  assert.equal(
    isVote(vote({ candidates: [{ parserId: "ocropus", runId: "j", recordId: "r" }, candidate("mineru")] })),
    false,
  );
  assert.equal(isVote(vote({ outcome: "azuredi" })), false);
  assert.equal(
    isVote(vote({ candidates: [{ parserId: "mineru", runId: "j", recordId: "" }, candidate("azuredi")] })),
    false,
  );
  assert.equal(isVote(vote({ page: 0 })), false);
  assert.equal(isVote(vote({ blind: "yes" })), false);
});
