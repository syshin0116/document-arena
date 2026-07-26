import type { ParserSpeed } from "./parser-speed";
import type { ParserStanding } from "./vote-store";

export type LeaderboardRow = {
  parserId: string;
  /** Position in the blind-vote standings, or null if this parser has none. */
  rank: number | null;
  standing: ParserStanding | null;
  speed: ParserSpeed | null;
};

export type SortKey =
  /**
   * The order the table is built in: standings first, then the parsers with
   * only a speed, fastest first. It is not a column, so no header claims it -
   * and sorting by it must not reorder anything, or the unvoted parsers would
   * lose the speed order they arrive in.
   */
  | "default"
  | "parser"
  | "winRate"
  | "speed"
  | "battles"
  | "ties"
  | "allPoor";

export type Sort = { key: SortKey; direction: "asc" | "desc" };

/**
 * What a first click on each column should mean.
 *
 * "Best first" differs per column: a high win rate is good, a low ms/page is
 * good. Making every column open ascending would make half of them open at the
 * least interesting end.
 */
export const DEFAULT_DIRECTION: Record<SortKey, "asc" | "desc"> = {
  default: "asc",
  parser: "asc",
  winRate: "desc",
  speed: "asc",
  battles: "desc",
  ties: "desc",
  allPoor: "desc",
};

export const SORT_LABELS: Record<SortKey, string> = {
  default: "Standing",
  parser: "Parser",
  winRate: "Win rate",
  speed: "Speed",
  battles: "Battles",
  ties: "Ties",
  allPoor: "All poor",
};

function valueFor(row: LeaderboardRow, key: SortKey): number | string | null {
  switch (key) {
    case "default":
      return null;
    case "parser":
      return row.parserId;
    case "winRate":
      // A parser with battles but no decisive one has no rate, which is not the
      // same as a rate of zero.
      return row.standing?.winRate ?? null;
    case "speed":
      return row.speed?.medianMsPerPage ?? null;
    case "battles":
      return row.standing?.battles ?? null;
    case "ties":
      return row.standing?.ties ?? null;
    case "allPoor":
      return row.standing?.allPoor ?? null;
  }
}

/**
 * Sorts the table, keeping rows with nothing to say at the bottom.
 *
 * A parser with no timed runs is not the fastest, and one with no decisive
 * battle has not lost them all - so a missing value sinks in both directions
 * rather than flipping to the top when the sort is reversed.
 */
export function sortRows(
  rows: readonly LeaderboardRow[],
  sort: Sort,
): LeaderboardRow[] {
  if (sort.key === "default") return [...rows];

  const factor = sort.direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = valueFor(a, sort.key);
    const right = valueFor(b, sort.key);

    if (left === null && right === null) return compareByName(a, b);
    if (left === null) return 1;
    if (right === null) return -1;

    const order =
      typeof left === "string" && typeof right === "string"
        ? left.localeCompare(right)
        : Number(left) - Number(right);

    return order === 0 ? compareByName(a, b) : order * factor;
  });
}

/** A stable, meaningful tiebreak so equal rows do not shuffle between sorts. */
function compareByName(a: LeaderboardRow, b: LeaderboardRow): number {
  return a.parserId.localeCompare(b.parserId);
}
