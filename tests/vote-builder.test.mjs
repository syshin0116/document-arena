import assert from "node:assert/strict";
import { test } from "bun:test";

import { buildVote } from "../app/vote-builder.ts";

const NOW = new Date("2026-07-26T12:00:00.000Z");

function candidate(parserId) {
  return {
    parserId,
    runId: `job-${parserId}`,
    recordId: `local_doc:${parserId}:job-${parserId}`,
  };
}

function input(overrides = {}) {
  return {
    documentId: "local_doc",
    page: 3,
    candidates: [candidate("opendataloader"), candidate("mineru")],
    outcome: "mineru",
    blind: false,
    id: "vote_abc",
    now: NOW,
    ...overrides,
  };
}

test("a vote keeps the ids and the display order it was given", () => {
  const vote = buildVote(input());

  assert.equal(vote.id, "vote_abc");
  assert.equal(vote.createdAt, NOW.toISOString());
  assert.equal(vote.documentId, "local_doc");
  assert.equal(vote.page, 3);
  assert.equal(vote.outcome, "mineru");
  assert.equal(vote.blind, false);
  // Display order is the invariant the standings rest on.
  assert.deepEqual(
    vote.candidates.map((c) => c.parserId),
    ["opendataloader", "mineru"],
  );
  assert.equal(vote.candidates[1].runId, "job-mineru");
  assert.equal(vote.candidates[1].recordId, "local_doc:mineru:job-mineru");
  assert.equal("sourceArtifactId" in vote, false);
});

test("the source hash is carried when the runner reported one", () => {
  const vote = buildVote(input({ sourceArtifactId: "sha256:abc" }));
  assert.equal(vote.sourceArtifactId, "sha256:abc");
});

test("a three-way comparison is allowed", () => {
  const vote = buildVote(
    input({
      candidates: [
        candidate("opendataloader"),
        candidate("mineru"),
        candidate("azuredi"),
      ],
      outcome: "azuredi",
    }),
  );
  assert.equal(vote.candidates.length, 3);
});

test("tie and all-poor need no named winner", () => {
  assert.equal(buildVote(input({ outcome: "tie" })).outcome, "tie");
  assert.equal(buildVote(input({ outcome: "all-poor" })).outcome, "all-poor");
});

test("it refuses anything the standings could not trust", () => {
  assert.throws(
    () => buildVote(input({ candidates: [candidate("mineru")] })),
    /at least two candidates/,
  );
  assert.throws(
    () =>
      buildVote(
        input({ candidates: [candidate("mineru"), candidate("mineru")] }),
      ),
    /appears twice/,
  );
  assert.throws(
    () => buildVote(input({ outcome: "azuredi" })),
    /not among the candidates/,
  );
  assert.throws(
    () =>
      buildVote(
        input({
          candidates: [
            { parserId: "mineru", runId: "job-x", recordId: "" },
            candidate("azuredi"),
          ],
          outcome: "mineru",
        }),
      ),
    /run history/,
  );
  assert.throws(
    () =>
      buildVote(
        input({
          candidates: [
            { parserId: "mineru", runId: "", recordId: "r" },
            candidate("azuredi"),
          ],
          outcome: "mineru",
        }),
      ),
    /no run id/,
  );
  assert.throws(() => buildVote(input({ page: 0 })), /page number/);
  assert.throws(() => buildVote(input({ documentId: "" })), /document id/);
});

test("the stored candidates do not alias the caller's array", () => {
  const candidates = [candidate("opendataloader"), candidate("mineru")];
  const vote = buildVote(input({ candidates }));
  candidates[0].parserId = "azuredi";
  assert.equal(vote.candidates[0].parserId, "opendataloader");
});
