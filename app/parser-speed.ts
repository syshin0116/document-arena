import { PARSER_IDS } from "./vote-store";
import type { ParserId } from "./workspace-state";

/** One completed run, reduced to what a speed table needs. */
export type ParserSpeedSample = {
  parser: string;
  documentId: string;
  runId: string;
  durationMs: number;
  pageCount: number;
};

export type ParserSpeed = {
  parserId: ParserId;
  /** Completed runs this figure is built from. */
  runs: number;
  /** Distinct documents those runs covered. */
  documents: number;
  medianMsPerPage: number;
  fastestMsPerPage: number;
  slowestMsPerPage: number;
};

/** The shape both stores agree on, before parser filtering. */
export type RawSpeedRecord = {
  parser: string;
  documentId: string;
  runId: string;
  durationMs: number | undefined;
  pageCount: number | undefined;
};

/**
 * Receipts plus the legacy per-document-and-parser results that predate them.
 *
 * The legacy store keeps only the newest result for a document and parser, so a
 * pair that already has receipts would otherwise have whichever run happened to
 * be last counted twice. Receipts win for that pair.
 */
export function selectSpeedSamples(
  receipts: readonly RawSpeedRecord[],
  legacy: readonly RawSpeedRecord[],
): ParserSpeedSample[] {
  const usable = (record: RawSpeedRecord): boolean =>
    (record.durationMs ?? 0) > 0 && (record.pageCount ?? 0) > 0;
  const pair = (record: RawSpeedRecord): string =>
    `${record.documentId}:${record.parser}`;

  // Every receipt for a pair suppresses the legacy row, including receipts that
  // carry no usable timing - the legacy row is not a stand-in for those.
  const superseded = new Set(receipts.map(pair));
  const samples: ParserSpeedSample[] = [];

  for (const record of [...receipts, ...legacy.filter((r) => !superseded.has(pair(r)))]) {
    if (!usable(record)) continue;
    samples.push({
      parser: record.parser,
      documentId: record.documentId,
      runId: record.runId,
      durationMs: record.durationMs as number,
      pageCount: record.pageCount as number,
    });
  }
  return samples;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

/**
 * Median milliseconds per page, per parser.
 *
 * Median rather than mean because a single cold start skews a small sample:
 * measured on this project's fixtures, container startup is roughly 200-300 ms,
 * which is about 70% of a two-page document's total time.
 *
 * The figure is NOT a controlled comparison. Measured on this project's
 * fixtures, repeating one document varied about 9% while the same parser across
 * different documents varied several-fold, so which document was read dominates
 * the number. Two parsers that happened to run different documents are not
 * really being compared, which is why `runs` and `documents` are part of the
 * result and the range is carried alongside the median: a reader can see how
 * thin, and how spread, the sample is.
 */
export function aggregateSpeed(
  samples: readonly ParserSpeedSample[],
): ParserSpeed[] {
  const byParser = new Map<ParserId, { rates: number[]; documents: Set<string> }>();

  for (const sample of samples) {
    if (!PARSER_IDS.includes(sample.parser as ParserId)) continue;
    if (sample.pageCount <= 0 || sample.durationMs <= 0) continue;
    const parserId = sample.parser as ParserId;
    let row = byParser.get(parserId);
    if (!row) {
      row = { rates: [], documents: new Set() };
      byParser.set(parserId, row);
    }
    row.rates.push(sample.durationMs / sample.pageCount);
    row.documents.add(sample.documentId);
  }

  return [...byParser.entries()]
    .map(([parserId, row]) => ({
      parserId,
      runs: row.rates.length,
      documents: row.documents.size,
      medianMsPerPage: median(row.rates),
      fastestMsPerPage: Math.min(...row.rates),
      slowestMsPerPage: Math.max(...row.rates),
    }))
    .sort((a, b) => a.medianMsPerPage - b.medianMsPerPage);
}
