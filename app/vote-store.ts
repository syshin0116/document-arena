export type ArenaParserId = "opendataloader" | "mineru";

export type BlindVoteOutcome = ArenaParserId | "tie" | "both-poor";

export type BlindVote = {
  id: string;
  createdAt: string;
  documentId: string;
  documentType: "digital-text";
  page: number;
  /** Parser ids in the order they were displayed (left to right). */
  permutation: readonly ArenaParserId[];
  /** Artifact ids the voter actually saw, aligned with permutation. */
  candidateArtifactIds: readonly string[];
  outcome: BlindVoteOutcome;
  /** True only when labels stayed masked from battle start to vote. */
  blind: boolean;
};

// Persistent browser data keeps its original stable key across the product rename.
const STORAGE_KEY = "parser-arena/blind-votes/v1";

export function loadVotes(): BlindVote[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as BlindVote[]) : [];
  } catch {
    return [];
  }
}

export function saveVote(vote: BlindVote): void {
  if (typeof window === "undefined") return;
  try {
    const votes = loadVotes();
    votes.push(vote);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(votes));
    blindVotesCache = null;
  } catch {
    // Votes are device-local convenience data in the prototype; a full
    // storage quota should not break the battle flow.
  }
}

const EMPTY_VOTES: readonly BlindVote[] = [];
let blindVotesCache: readonly BlindVote[] | null = null;

export function subscribeToVotes(onChange: () => void): () => void {
  const handle = () => {
    blindVotesCache = null;
    onChange();
  };
  window.addEventListener("storage", handle);
  return () => window.removeEventListener("storage", handle);
}

export function getBlindVotesSnapshot(): readonly BlindVote[] {
  if (blindVotesCache === null) {
    blindVotesCache = loadVotes().filter((vote) => vote.blind);
  }
  return blindVotesCache;
}

export function getServerVotesSnapshot(): readonly BlindVote[] {
  return EMPTY_VOTES;
}

export type ParserStanding = {
  parserId: ArenaParserId;
  battles: number;
  wins: number;
  ties: number;
  /** Wins over decisive battles (ties and both-poor excluded); null with no decisive battles. */
  winRate: number | null;
};

export function aggregateStandings(votes: readonly BlindVote[]): ParserStanding[] {
  const table = new Map<ArenaParserId, { battles: number; wins: number; ties: number }>();
  const ensure = (parser: ArenaParserId) => {
    let row = table.get(parser);
    if (!row) {
      row = { battles: 0, wins: 0, ties: 0 };
      table.set(parser, row);
    }
    return row;
  };

  for (const vote of votes) {
    if (!vote.blind) continue;
    for (const parser of vote.permutation) {
      const row = ensure(parser);
      row.battles += 1;
      if (vote.outcome === parser) row.wins += 1;
      if (vote.outcome === "tie") row.ties += 1;
    }
  }

  return [...table.entries()]
    .map(([parserId, row]) => {
      const decisive = row.battles - row.ties;
      return {
        parserId,
        battles: row.battles,
        wins: row.wins,
        ties: row.ties,
        winRate: decisive > 0 ? row.wins / decisive : null,
      };
    })
    .sort((a, b) => (b.winRate ?? -1) - (a.winRate ?? -1) || b.battles - a.battles);
}
