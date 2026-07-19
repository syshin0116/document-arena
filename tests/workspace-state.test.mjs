import assert from "node:assert/strict";
import test from "node:test";
import {
  canChooseParser,
  canCompare,
  createWorkspaceState,
  displayedEvidence,
  workspaceReducer,
} from "../app/workspace-state.ts";

test("parsers are chosen after upload and append independent runs", () => {
  let state = createWorkspaceState();
  assert.equal(canChooseParser(state), true);
  assert.deepEqual(state.runs, {
    opendataloader: "idle",
    mineru: "idle",
    azuredi: "idle",
  });
  assert.equal(canCompare(state), false);

  state = workspaceReducer(state, {
    type: "start-run",
    parser: "opendataloader",
  });
  assert.equal(state.runs.opendataloader, "running");

  state = workspaceReducer(state, {
    type: "complete-run",
    parser: "opendataloader",
  });
  const firstResult = state.runs.opendataloader;

  state = workspaceReducer(state, { type: "start-run", parser: "mineru" });
  assert.equal(state.runs.opendataloader, firstResult);
  assert.equal(state.runs.mineru, "running");

  state = workspaceReducer(state, { type: "complete-run", parser: "mineru" });
  assert.equal(state.runs.opendataloader, "complete");
  assert.equal(state.runs.mineru, "complete");
  assert.equal(canCompare(state), true);
});

test("evidence hover is transient while pin persists until toggle or Escape", () => {
  let state = createWorkspaceState(true);

  state = workspaceReducer(state, {
    type: "activate-evidence",
    evidence: "abstract",
  });
  assert.equal(displayedEvidence(state), "abstract");

  state = workspaceReducer(state, {
    type: "pin-evidence",
    evidence: "abstract",
  });
  state = workspaceReducer(state, {
    type: "activate-evidence",
    evidence: null,
  });
  assert.equal(displayedEvidence(state), "abstract");

  state = workspaceReducer(state, { type: "clear-evidence" });
  assert.equal(displayedEvidence(state), null);
});

test("shared page state is bounded for source and every result", () => {
  let state = createWorkspaceState(true);
  state = workspaceReducer(state, { type: "set-page", page: 7 });
  assert.equal(state.page, 7);
  state = workspaceReducer(state, { type: "set-page", page: 99 });
  assert.equal(state.page, 12);
  state = workspaceReducer(state, { type: "set-page", page: -4 });
  assert.equal(state.page, 1);
});

test("uploaded documents adopt the page count reported by the PDF renderer", () => {
  let state = createWorkspaceState();
  assert.equal(state.pageCount, null);

  state = workspaceReducer(state, { type: "set-page", page: 8 });
  assert.equal(state.page, 8);

  state = workspaceReducer(state, { type: "set-page-count", pageCount: 3 });
  assert.equal(state.pageCount, 3);
  assert.equal(state.page, 3);

  state = workspaceReducer(state, { type: "set-page", page: 99 });
  assert.equal(state.page, 3);

  state = workspaceReducer(state, { type: "set-page-count", pageCount: 0 });
  assert.equal(state.pageCount, 1);
  assert.equal(state.page, 1);
});

test("thumbnail navigation uses the shared page state and clears stale evidence", () => {
  let state = createWorkspaceState(true);
  state = workspaceReducer(state, {
    type: "activate-evidence",
    evidence: "title",
  });
  state = workspaceReducer(state, {
    type: "pin-evidence",
    evidence: "title",
  });

  state = workspaceReducer(state, { type: "set-page", page: 4 });
  assert.equal(state.page, 4);
  assert.equal(state.activeEvidence, null);
  assert.equal(state.pinnedEvidence, null);
});
