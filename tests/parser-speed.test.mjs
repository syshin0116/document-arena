import assert from "node:assert/strict";
import { test } from "bun:test";

import { aggregateSpeed, selectSpeedSamples } from "../app/parser-speed.ts";

const sample = (parser, durationMs, pageCount, documentId = "d1") => ({
  parser,
  documentId,
  runId: `${parser}-${durationMs}-${documentId}`,
  durationMs,
  pageCount,
});

test("rates are per page and ranked fastest first", () => {
  const speeds = aggregateSpeed([
    sample("opendataloader", 900, 9), // 100 ms/page
    sample("mineru", 900, 3), // 300 ms/page
  ]);

  assert.deepEqual(
    speeds.map((s) => s.parserId),
    ["opendataloader", "mineru"],
  );
  assert.equal(speeds[0].medianMsPerPage, 100);
  assert.equal(speeds[1].medianMsPerPage, 300);
});

test("the median ignores a single cold start", () => {
  // A container cold start on one run must not drag the reported figure.
  const speeds = aggregateSpeed([
    sample("opendataloader", 1000, 10, "a"), // 100
    sample("opendataloader", 1100, 10, "b"), // 110
    sample("opendataloader", 9000, 10, "c"), // 900, an outlier
  ]);

  assert.equal(speeds[0].medianMsPerPage, 110);
  assert.equal(speeds[0].slowestMsPerPage, 900, "the outlier is still reported");
});

test("an even sample averages the two middle rates", () => {
  const speeds = aggregateSpeed([
    sample("mineru", 100, 1, "a"),
    sample("mineru", 200, 1, "b"),
    sample("mineru", 300, 1, "c"),
    sample("mineru", 400, 1, "d"),
  ]);
  assert.equal(speeds[0].medianMsPerPage, 250);
});

test("runs and documents are counted separately", () => {
  // Three runs over two documents: the caller can see the sample is thin even
  // though the run count looks healthier.
  const speeds = aggregateSpeed([
    sample("azuredi", 100, 1, "a"),
    sample("azuredi", 120, 1, "a"),
    sample("azuredi", 140, 1, "b"),
  ]);
  assert.equal(speeds[0].runs, 3);
  assert.equal(speeds[0].documents, 2);
});

test("runs that cannot produce a rate are dropped", () => {
  const speeds = aggregateSpeed([
    sample("opendataloader", 500, 5),
    sample("opendataloader", 500, 0), // no pages
    sample("opendataloader", 0, 5), // no duration
    sample("ocropus", 500, 5), // not a known parser
  ]);

  assert.equal(speeds.length, 1);
  assert.equal(speeds[0].runs, 1);
  assert.equal(speeds[0].medianMsPerPage, 100);
});

test("no samples means no rows, not a zero row", () => {
  assert.deepEqual(aggregateSpeed([]), []);
});

const record = (parser, documentId, durationMs, pageCount, runId = "r") => ({
  parser,
  documentId,
  runId,
  durationMs,
  pageCount,
});

test("a receipt supersedes the legacy row for the same document and parser", () => {
  // The legacy store keeps only the newest result per pair, so without this the
  // last run is counted twice and drags the median toward itself.
  const samples = selectSpeedSamples(
    [record("mineru", "doc-a", 1000, 2, "job-1")],
    [record("mineru", "doc-a", 1000, 2, "doc-a:mineru")],
  );

  assert.equal(samples.length, 1);
  assert.equal(samples[0].runId, "job-1");
});

test("a legacy row survives when the pair has no receipt", () => {
  const samples = selectSpeedSamples(
    [record("mineru", "doc-a", 1000, 2, "job-1")],
    [
      record("mineru", "doc-b", 800, 2, "doc-b:mineru"), // same parser, other doc
      record("azuredi", "doc-a", 900, 2, "doc-a:azuredi"), // same doc, other parser
    ],
  );

  assert.equal(samples.length, 3);
  assert.deepEqual(
    samples.map((s) => s.runId).sort(),
    ["doc-a:azuredi", "doc-b:mineru", "job-1"],
  );
});

test("a receipt with no timing still suppresses its legacy row", () => {
  // The legacy row is a different run, not a stand-in for the receipt's missing
  // duration; counting it would attribute one run's time to another.
  const samples = selectSpeedSamples(
    [record("mineru", "doc-a", undefined, 2, "job-1")],
    [record("mineru", "doc-a", 5000, 2, "doc-a:mineru")],
  );
  assert.deepEqual(samples, []);
});

test("records without a usable duration or page count are dropped", () => {
  const samples = selectSpeedSamples(
    [],
    [
      record("mineru", "doc-a", 0, 2),
      record("mineru", "doc-b", 1000, 0),
      record("mineru", "doc-c", undefined, undefined),
      record("mineru", "doc-d", 1000, 2),
    ],
  );
  assert.equal(samples.length, 1);
  assert.equal(samples[0].documentId, "doc-d");
});

test("the merged samples feed the median unchanged", () => {
  const speeds = aggregateSpeed(
    selectSpeedSamples(
      [record("opendataloader", "doc-a", 1000, 10, "job-1")], // 100
      [
        record("opendataloader", "doc-a", 9000, 10, "doc-a:odl"), // superseded
        record("opendataloader", "doc-b", 3000, 10, "doc-b:odl"), // 300
      ],
    ),
  );

  assert.equal(speeds[0].runs, 2);
  assert.equal(speeds[0].medianMsPerPage, 200);
});
