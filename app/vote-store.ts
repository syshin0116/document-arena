import type { ParserId } from "./workspace-state";

export const PARSER_IDS: readonly ParserId[] = [
  "opendataloader",
  "mineru",
  "azuredi",
];

export type VoteOutcome = ParserId | "tie" | "all-poor";

/**
 * One candidate exactly as it was displayed, with ids that resolve to a run
 * that actually happened.
 *
 * The previous schema stored two parallel arrays (`permutation` and
 * `candidateArtifactIds`) that nothing kept aligned, and the ids it stored were
 * literals like "demo-opendataloader-parsed-document" that resolved to nothing.
 * One aligned array cannot desynchronise, and both ids here come from a real
 * `LocalParseResult`.
 */
export type VoteCandidate = {
  parserId: ParserId;
  /** LocalParseResult.runId - the runner's immutable job id for that run. */
  runId: string;
  /** IndexedDB run-receipt key, `${documentId}:${parser}:${runId}`. */
  recordId: string;
};

export type BlindVote = {
  id: string;
  createdAt: string;
  documentId: string;
  /** sha256 of the source PDF, when the runner reported one. */
  sourceArtifactId?: string;
  page: number;
  /** Candidates in the order they were displayed, left to right. */
  candidates: readonly VoteCandidate[];
  outcome: VoteOutcome;
  /** True only when labels stayed masked from open to vote. */
  blind: boolean;
};

/**
 * v2. The v1 records described hardcoded markup and carried artifact ids that
 * resolve to nothing, so they are dropped rather than migrated - there is no
 * run behind them to point at. Future schema changes must migrate instead,
 * because from v2 on a vote refers to work the user actually did.
 */
const STORAGE_KEY = "document-arena/votes/v2";
const LEGACY_STORAGE_KEY = "parser-arena/blind-votes/v1";

function isParserId(value: unknown): value is ParserId {
  return typeof value === "string" && PARSER_IDS.includes(value as ParserId);
}

function isCandidate(value: unknown): value is VoteCandidate {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isParserId(candidate.parserId) &&
    typeof candidate.runId === "string" &&
    candidate.runId.length > 0 &&
    typeof candidate.recordId === "string" &&
    candidate.recordId.length > 0
  );
}

/**
 * Persisted records are untrusted input: they survive code changes, they can be
 * hand-edited, and a malformed one silently skews the standings. The previous
 * loader cast the parsed JSON straight to BlindVote[].
 */
export function isVote(value: unknown): value is BlindVote {
  if (typeof value !== "object" || value === null) return false;
  const vote = value as Record<string, unknown>;
  if (typeof vote.id !== "string" || vote.id.length === 0) return false;
  if (typeof vote.createdAt !== "string" || vote.createdAt.length === 0) {
    return false;
  }
  if (typeof vote.documentId !== "string" || vote.documentId.length === 0) {
    return false;
  }
  if (!Number.isInteger(vote.page) || (vote.page as number) < 1) return false;
  if (typeof vote.blind !== "boolean") return false;
  if (
    vote.sourceArtifactId !== undefined &&
    typeof vote.sourceArtifactId !== "string"
  ) {
    return false;
  }
  if (!Array.isArray(vote.candidates) || vote.candidates.length < 2) {
    return false;
  }
  if (!vote.candidates.every(isCandidate)) return false;
  // A repeated parser would be counted twice by aggregateStandings.
  const parsers = vote.candidates.map((c) => (c as VoteCandidate).parserId);
  if (new Set(parsers).size !== parsers.length) return false;
  const outcome = vote.outcome;
  if (outcome === "tie" || outcome === "all-poor") return true;
  return isParserId(outcome) && parsers.includes(outcome);
}

export function loadVotes(): BlindVote[] {
  if (typeof window === "undefined") return [];
  try {
    // Drop the v1 key on first read rather than in a component effect, since
    // getBlindVotesSnapshot runs during render.
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isVote) : [];
  } catch {
    return [];
  }
}

const listeners = new Set<() => void>();

/**
 * True while no subscriber is listening, so another tab could have written
 * without this one hearing the storage event.
 */
let unobservedWrites = true;

/**
 * Returns whether the vote was actually persisted.
 *
 * It used to swallow the failure and return void, so a blocked or full
 * localStorage (Safari private browsing, quota exhausted) left the caller
 * showing "recorded" for a vote that was never written - the exact silent
 * failure this store exists to avoid.
 */
export function saveVote(vote: BlindVote): boolean {
  if (typeof window === "undefined") return false;
  try {
    const votes = loadVotes();
    votes.push(vote);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(votes));
    voteCache = null;
    labeledCountCache = null;
  } catch {
    return false;
  }
  // Notifying is separate from persisting: a subscriber that throws must not
  // make a stored vote look unsaved, or the caller re-arms the buttons and the
  // user records the same battle twice.
  // The storage event never fires in the tab that wrote, so a same-page
  // standings readout would otherwise stay stale until reload.
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // A broken subscriber is its own problem, not this write's.
    }
  }
  return true;
}

const EMPTY_VOTES: readonly BlindVote[] = [];
let voteCache: readonly BlindVote[] | null = null;

export function subscribeToVotes(onChange: () => void): () => void {
  const handle = () => {
    voteCache = null;
    labeledCountCache = null;
    onChange();
  };
  // The storage listener exists only while something is subscribed, so a vote
  // written by another tab in an unobserved gap would never be seen: the stale
  // snapshot survives the unmount and is served again on remount.
  //
  // Invalidate only when re-entering an observed state, not on every subscribe.
  // LeaderboardView subscribes twice for one mount, and invalidating on each
  // would hand useSyncExternalStore a fresh array the second time and force an
  // extra render. Tracked with an explicit flag rather than `listeners.size`,
  // which a leaked subscription would pin above zero forever.
  if (unobservedWrites) {
    voteCache = null;
    labeledCountCache = null;
    unobservedWrites = false;
  }
  listeners.add(onChange);
  if (typeof window !== "undefined") {
    window.addEventListener("storage", handle);
  }
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0) unobservedWrites = true;
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", handle);
    }
  };
}

export function getBlindVotesSnapshot(): readonly BlindVote[] {
  if (voteCache === null) {
    voteCache = loadVotes().filter((vote) => vote.blind);
  }
  return voteCache;
}

export function getServerVotesSnapshot(): readonly BlindVote[] {
  return EMPTY_VOTES;
}

/**
 * Blind votes rank; labeled ones are recorded but never counted.
 *
 * Returns a number, not an object: useSyncExternalStore compares snapshots by
 * identity, and a fresh `{blind, labeled}` each call would loop forever. The
 * count is cached alongside the vote cache and invalidated with it.
 */
let labeledCountCache: number | null = null;

export function getLabeledVoteCount(): number {
  if (labeledCountCache === null) {
    labeledCountCache = loadVotes().filter((vote) => !vote.blind).length;
  }
  return labeledCountCache;
}

/** The server has no localStorage, so it renders the same zero every time. */
export function getServerLabeledVoteCount(): number {
  return 0;
}

/**
 * Verdicts already cast for a document, keyed by candidate set, so a reload
 * does not re-arm a comparison that was already judged. `castVotes` is
 * component state and does not survive a refresh on its own.
 */
export function loadCastVerdicts(
  documentId: string,
): Record<string, VoteOutcome> {
  const verdicts: Record<string, VoteOutcome> = {};
  for (const vote of loadVotes()) {
    if (vote.documentId !== documentId) continue;
    const key = vote.candidates
      .map((candidate) => candidate.parserId)
      .join(",");
    verdicts[`${documentId}:${key}`] = vote.outcome;
  }
  return verdicts;
}

/** The module-level cache leaks across tests otherwise. */
export function resetVoteCacheForTests(): void {
  voteCache = null;
  labeledCountCache = null;
  listeners.clear();
  unobservedWrites = true;
}

export type ParserStanding = {
  parserId: ParserId;
  battles: number;
  wins: number;
  ties: number;
  allPoor: number;
  /** Wins over decisive battles; null when there were none. */
  winRate: number | null;
};

export function aggregateStandings(
  votes: readonly BlindVote[],
): ParserStanding[] {
  const table = new Map<
    ParserId,
    { battles: number; wins: number; ties: number; allPoor: number }
  >();
  const ensure = (parser: ParserId) => {
    let row = table.get(parser);
    if (!row) {
      row = { battles: 0, wins: 0, ties: 0, allPoor: 0 };
      table.set(parser, row);
    }
    return row;
  };

  for (const vote of votes) {
    if (!vote.blind) continue;
    for (const candidate of vote.candidates) {
      const row = ensure(candidate.parserId);
      row.battles += 1;
      if (vote.outcome === candidate.parserId) row.wins += 1;
      if (vote.outcome === "tie") row.ties += 1;
      if (vote.outcome === "all-poor") row.allPoor += 1;
    }
  }

  return [...table.entries()]
    .map(([parserId, row]) => {
      // "Decisive" excludes both ties and all-poor, matching what this rate
      // claims to mean. Subtracting only ties scored an all-poor verdict as a
      // loss for every candidate.
      const decisive = row.battles - row.ties - row.allPoor;
      return {
        parserId,
        battles: row.battles,
        wins: row.wins,
        ties: row.ties,
        allPoor: row.allPoor,
        winRate: decisive > 0 ? row.wins / decisive : null,
      };
    })
    .sort((a, b) => (b.winRate ?? -1) - (a.winRate ?? -1) || b.battles - a.battles);
}
