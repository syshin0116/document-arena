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
