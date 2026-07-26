import type { BlindVote, VoteCandidate, VoteOutcome } from "./vote-store";

/**
 * Builds a vote, or throws.
 *
 * Every invariant the standings depend on lives here rather than in the click
 * handler, because a miswired handler that writes a plausible-but-wrong record
 * is invisible: `saveVote` swallows errors and the leaderboard shows blind
 * votes only. A throw surfaces as a toast; a silent bad write does not.
 *
 * `id` and `now` are injected so this stays a pure function. The vote it
 * replaces minted both inline with `Date.now()` and `Math.random()`, which is
 * part of why it was never testable.
 */
export function buildVote(input: {
  documentId: string;
  page: number;
  candidates: readonly VoteCandidate[];
  outcome: VoteOutcome;
  blind: boolean;
  sourceArtifactId?: string;
  id: string;
  now: Date;
}): BlindVote {
  const { documentId, page, candidates, outcome, blind, id, now } = input;

  if (!documentId) throw new Error("A vote needs a document id.");
  if (!id) throw new Error("A vote needs an id.");
  if (!Number.isInteger(page) || page < 1) {
    throw new Error(`A vote needs a real page number, got ${page}.`);
  }
  if (candidates.length < 2) {
    throw new Error(
      `A comparison needs at least two candidates, got ${candidates.length}.`,
    );
  }

  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate.runId) {
      throw new Error(`Candidate ${candidate.parserId} has no run id.`);
    }
    if (!candidate.recordId) {
      // Without this the vote cannot be traced back to a stored run, which is
      // the whole difference between this and the votes it replaces.
      throw new Error(
        `Candidate ${candidate.parserId} was not saved to run history, so its vote could not be reopened.`,
      );
    }
    if (seen.has(candidate.parserId)) {
      throw new Error(`Candidate ${candidate.parserId} appears twice.`);
    }
    seen.add(candidate.parserId);
  }

  if (outcome !== "tie" && outcome !== "all-poor" && !seen.has(outcome)) {
    throw new Error(
      `Outcome "${outcome}" names a parser that is not among the candidates.`,
    );
  }

  return {
    id,
    createdAt: now.toISOString(),
    documentId,
    ...(input.sourceArtifactId
      ? { sourceArtifactId: input.sourceArtifactId }
      : {}),
    page,
    // Frozen copy: the caller's array is derived from React state.
    candidates: candidates.map((candidate) => ({ ...candidate })),
    outcome,
    blind,
  };
}
