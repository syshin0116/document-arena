"use client";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { VoteOutcome } from "../vote-store";
import type { ParserId } from "../workspace-state";

/**
 * The verdict bar under a blind comparison.
 *
 * Button order is the candidate order it is handed, which is the column order,
 * which is what the recorded vote claims - so this renders the array as given
 * rather than sorting it. Labels are the caller's: under a mask they read
 * "Candidate A", not the parser's name.
 */
export function VerdictBar({
  candidates,
  votedOutcome,
  disabledReason,
  onVote,
}: {
  candidates: readonly { parserId: ParserId; label: string }[];
  votedOutcome: VoteOutcome | null;
  disabledReason: string | null;
  onVote: (outcome: VoteOutcome) => void;
}) {
  const verdictLabel = (outcome: VoteOutcome) => {
    if (outcome === "tie") return "a tie";
    if (outcome === "all-poor") return "all poor";
    return candidates.find((c) => c.parserId === outcome)?.label ?? outcome;
  };

  if (votedOutcome) {
    return (
      <footer className="verdict-bar" aria-label="Recorded verdict">
        <span className="verdict-label">Recorded</span>
        <strong className="verdict-recorded">
          You called this {verdictLabel(votedOutcome)}.
        </strong>
      </footer>
    );
  }

  return (
    <footer className="verdict-bar" aria-label="Vote on this comparison">
      <span className="verdict-label">Which read it better?</span>
      {candidates.map((candidate) => (
        <button
          key={candidate.parserId}
          type="button"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          disabled={Boolean(disabledReason)}
          onClick={() => onVote(candidate.parserId)}
        >
          {candidate.label}
        </button>
      ))}
      <button
        type="button"
        className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
        disabled={Boolean(disabledReason)}
        onClick={() => onVote("tie")}
      >
        Tie
      </button>
      <button
        type="button"
        className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
        disabled={Boolean(disabledReason)}
        onClick={() => onVote("all-poor")}
      >
        All poor
      </button>
      {disabledReason && <span className="verdict-note">{disabledReason}</span>}
    </footer>
  );
}
