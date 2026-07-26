import assert from "node:assert/strict";
import { test } from "bun:test";

/**
 * These cover the storage half of the vote loop, which is where the failures
 * are silent: a blocked write and a stale cross-tab cache both look exactly
 * like "you never voted".
 */

function installWindow(overrides = {}) {
  const store = new Map();
  const listeners = new Set();
  globalThis.window = {
    localStorage: {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => store.set(key, value),
      removeItem: (key) => store.delete(key),
      ...overrides.localStorage,
    },
    addEventListener: (type, fn) => listeners.add(`${type}:${fn.name || "fn"}`),
    removeEventListener: (type, fn) =>
      listeners.delete(`${type}:${fn.name || "fn"}`),
  };
  return { store, listeners };
}

const vote = (overrides = {}) => ({
  id: "v1",
  createdAt: "2026-07-26T00:00:00.000Z",
  documentId: "local_doc",
  page: 1,
  candidates: [
    { parserId: "opendataloader", runId: "j1", recordId: "local_doc:opendataloader:j1" },
    { parserId: "mineru", runId: "j2", recordId: "local_doc:mineru:j2" },
  ],
  outcome: "mineru",
  blind: false,
  ...overrides,
});

test("saveVote reports whether the write actually happened", async () => {
  const { store } = installWindow();
  const mod = await import("../app/vote-store.ts");
  mod.resetVoteCacheForTests();

  assert.equal(mod.saveVote(vote()), true, "a normal write succeeds");
  assert.equal(store.size, 1);

  // Safari private browsing / exhausted quota: setItem throws.
  window.localStorage.setItem = () => {
    throw new DOMException("quota", "QuotaExceededError");
  };
  assert.equal(
    mod.saveVote(vote({ id: "v2" })),
    false,
    "a blocked write must report failure, not silently succeed",
  );
});

test("a fresh subscribe re-reads storage written while unmounted", async () => {
  const { store } = installWindow();
  const mod = await import("../app/vote-store.ts");
  mod.resetVoteCacheForTests();

  // Mount, read (populating the cache), unmount.
  const unsubscribe = mod.subscribeToVotes(() => {});
  assert.equal(mod.getLabeledVoteCount(), 0);
  unsubscribe();

  // Another tab writes while nothing is subscribed, so no storage event lands.
  store.set(
    "document-arena/votes/v2",
    JSON.stringify([vote(), vote({ id: "v2" })]),
  );

  // Remounting must not serve the stale zero.
  mod.subscribeToVotes(() => {});
  assert.equal(
    mod.getLabeledVoteCount(),
    2,
    "a remount must see votes written while it was away",
  );
});

test("two subscribers (as the leaderboard has) do not fight over the cache", async () => {
  const { store } = installWindow();
  const mod = await import("../app/vote-store.ts");
  mod.resetVoteCacheForTests();
  store.set(
    "document-arena/votes/v2",
    JSON.stringify([vote({ blind: true })]),
  );

  // LeaderboardView calls useSyncExternalStore twice, so subscribeToVotes runs
  // twice on one mount. The second must not invalidate what the first read.
  const un1 = mod.subscribeToVotes(() => {});
  const first = mod.getBlindVotesSnapshot();
  const un2 = mod.subscribeToVotes(() => {});
  assert.equal(
    mod.getBlindVotesSnapshot(),
    first,
    "the second subscribe must not hand back a new array identity",
  );

  // But a full unsubscribe then remount must re-read, since no storage event
  // could have been observed in the gap.
  un1();
  un2();
  store.set(
    "document-arena/votes/v2",
    JSON.stringify([vote({ blind: true }), vote({ id: "v2", blind: true })]),
  );
  mod.subscribeToVotes(() => {});
  assert.equal(
    mod.getBlindVotesSnapshot().length,
    2,
    "a remount after full unsubscribe sees writes made while away",
  );
});

test("a throwing subscriber cannot make a stored vote look unsaved", async () => {
  installWindow();
  const mod = await import("../app/vote-store.ts");
  mod.resetVoteCacheForTests();
  mod.subscribeToVotes(() => {
    throw new Error("a broken subscriber");
  });

  const saved = mod.saveVote(vote());
  mod.resetVoteCacheForTests();
  assert.equal(mod.loadVotes().length, 1, "the write succeeded");
  assert.equal(
    saved,
    true,
    "so it must report success - reporting failure would re-arm the buttons and duplicate the vote",
  );
});

test("saving notifies same-tab subscribers", async () => {
  installWindow();
  const mod = await import("../app/vote-store.ts");
  mod.resetVoteCacheForTests();

  let notified = 0;
  mod.subscribeToVotes(() => {
    notified += 1;
  });
  mod.saveVote(vote());
  assert.equal(notified, 1, "the storage event never fires in the writing tab");
});

test("cast verdicts are recoverable per document and candidate set", async () => {
  const { store } = installWindow();
  store.set(
    "document-arena/votes/v2",
    JSON.stringify([
      vote({ id: "a", documentId: "doc1", outcome: "mineru" }),
      vote({
        id: "b",
        documentId: "doc1",
        outcome: "tie",
        candidates: [
          { parserId: "opendataloader", runId: "j1", recordId: "r1" },
          { parserId: "mineru", runId: "j2", recordId: "r2" },
          { parserId: "azuredi", runId: "j3", recordId: "r3" },
        ],
      }),
      vote({ id: "c", documentId: "doc2", outcome: "opendataloader" }),
    ]),
  );
  const mod = await import("../app/vote-store.ts");
  mod.resetVoteCacheForTests();

  const verdicts = mod.loadCastVerdicts("doc1");
  // The two-way and three-way comparisons are different battles, so a verdict
  // on one must not lock the other.
  assert.equal(verdicts["doc1:opendataloader,mineru"], "mineru");
  assert.equal(verdicts["doc1:opendataloader,mineru,azuredi"], "tie");
  assert.equal(Object.keys(verdicts).length, 2, "other documents are excluded");

  // SSR has no localStorage; the seed must be empty rather than throwing.
  const realWindow = globalThis.window;
  delete globalThis.window;
  assert.deepEqual(mod.loadCastVerdicts("doc1"), {});
  globalThis.window = realWindow;
});

test("legacy v1 votes are dropped, not counted", async () => {
  const { store } = installWindow();
  store.set(
    "parser-arena/blind-votes/v1",
    JSON.stringify([{ id: "old", permutation: ["opendataloader", "mineru"] }]),
  );
  const mod = await import("../app/vote-store.ts");
  mod.resetVoteCacheForTests();

  assert.equal(mod.loadVotes().length, 0);
  assert.equal(
    store.has("parser-arena/blind-votes/v1"),
    false,
    "the v1 key is removed on read",
  );
});
