import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createLocalParseRunReceipt } from "../app/local-document-store";

function resultFor({ runId, version, options }) {
  return {
    status: "completed",
    runId,
    stageRunId: `stage-${runId}`,
    startedAt: "2026-07-20T01:00:00.000Z",
    completedAt: "2026-07-20T01:00:01.000Z",
    component: {
      id: "opendataloader-pdf",
      version,
      image: `document-arena/opendataloader-pdf:${version}`,
    },
    source: {
      artifactId: "sha256:source",
      sha256: "a".repeat(64),
      sizeBytes: 42,
    },
    options,
    durationMs: 1_000,
    blockCount: 1,
    nativeRegionCount: 1,
    rawArtifacts: [
      {
        path: "raw/result.json",
        mediaType: "application/json",
        sizeBytes: 12,
        sha256: "b".repeat(64),
        bytesLocation: "local-runner",
      },
    ],
    outputDirectory: `/tmp/${runId}`,
    parsedDocument: {
      apiVersion: "document-arena.dev/parsed-document/v1alpha1",
      parser: { id: "opendataloader-pdf" },
      pages: [],
    },
  };
}

test("reruns retain distinct immutable receipts with their version and options", () => {
  const first = createLocalParseRunReceipt(
    "local_document",
    "opendataloader",
    resultFor({ runId: "job-one", version: "1.0.0", options: { mode: "fast" } }),
    "2026-07-20T01:01:00.000Z",
  );
  const second = createLocalParseRunReceipt(
    "local_document",
    "opendataloader",
    resultFor({ runId: "job-two", version: "2.0.0", options: { mode: "accurate" } }),
    "2026-07-20T01:02:00.000Z",
  );

  assert.notEqual(first.recordId, second.recordId);
  assert.equal(first.component.version, "1.0.0");
  assert.deepEqual(first.options, { mode: "fast" });
  assert.equal(second.component.version, "2.0.0");
  assert.deepEqual(second.options, { mode: "accurate" });
});

test("browser receipts describe runner raw artifacts without claiming their bytes", () => {
  const receipt = createLocalParseRunReceipt(
    "local_document",
    "opendataloader",
    resultFor({ runId: "job-raw", version: "1.0.0", options: {} }),
  );

  assert.equal(receipt.rawArtifactBytes, "not-imported");
  assert.equal(receipt.rawArtifacts[0].bytesLocation, "local-runner");
  assert.equal(receipt.rawArtifacts[0].sha256, "b".repeat(64));
});

test("the IndexedDB path appends runs and the workspace surfaces save failures", async () => {
  const storeSource = await readFile(
    new URL("../app/local-document-store.ts", import.meta.url),
    "utf8",
  );
  const workspaceSource = await readFile(
    new URL("../app/ui/Workspace.tsx", import.meta.url),
    "utf8",
  );
  const runnerSource = await readFile(
    new URL("../services/runner/serve.mjs", import.meta.url),
    "utf8",
  );

  assert.match(storeSource, /const DATABASE_VERSION = 4/);
  assert.match(storeSource, /request\.onblocked/);
  assert.match(storeSource, /store\.add\(receipt\)/);
  assert.doesNotMatch(storeSource, /store\.put\(receipt\)/);
  assert.match(workspaceSource, /await saveLocalParseResult/);
  assert.match(
    workspaceSource,
    /Run finished, but browser history was not saved\./,
  );
  assert.match(runnerSource, /runId: result\.runnerManifest\.jobId/);
  assert.match(runnerSource, /bytesLocation: "local-runner"/);
});
