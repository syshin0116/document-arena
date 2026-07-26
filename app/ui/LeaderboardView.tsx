"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { listParserSpeedSamples } from "../local-document-store";
import { aggregateSpeed, type ParserSpeed } from "../parser-speed";
import {
  DEFAULT_DIRECTION,
  SORT_LABELS,
  sortRows,
  type LeaderboardRow,
  type Sort,
  type SortKey,
} from "../leaderboard-sort";
import {
  aggregateStandings,
  getBlindVotesSnapshot,
  getLabeledVoteCount,
  getServerLabeledVoteCount,
  getServerVotesSnapshot,
  subscribeToVotes,
} from "../vote-store";
import { ModeToggle } from "@/components/mode-toggle";
import { AppHeader } from "./AppHeader";
import { buttonVariants } from "@/components/ui/button";

const parserNames: Record<string, { name: string; profile: string }> = {
  opendataloader: {
    name: "OpenDataLoader",
    profile: "Deterministic · native geometry · CPU",
  },
  mineru: { name: "MinerU", profile: "Pipeline · layout + OCR · GPU optional" },
  azuredi: {
    name: "Azure DI",
    profile: "Hosted · layout + OCR · external service",
  },
};

/** Header order, which is also the grid column order. */
const COLUMNS: readonly SortKey[] = [
  "parser",
  "winRate",
  "speed",
  "battles",
  "ties",
  "allPoor",
];

export function LeaderboardView() {
  const votes = useSyncExternalStore(
    subscribeToVotes,
    getBlindVotesSnapshot,
    getServerVotesSnapshot,
  );
  const voteCount = votes.length;
  // Blind votes rank; labeled ones are recorded and must still be visible, or a
  // vote you just cast leaves no trace anywhere in the product. Read through the
  // store like the votes themselves: calling into localStorage during render
  // gave the server 0 and the client 1, which is a hydration mismatch.
  const labeledCount = useSyncExternalStore(
    subscribeToVotes,
    getLabeledVoteCount,
    getServerLabeledVoteCount,
  );
  const standings = useMemo(() => aggregateStandings(votes), [votes]);

  // Speed comes from run receipts in IndexedDB, not from votes, so it is
  // available before anyone has voted and is read asynchronously.
  const [speeds, setSpeeds] = useState<ParserSpeed[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    listParserSpeedSamples()
      .then((samples) => {
        if (!cancelled) setSpeeds(aggregateSpeed(samples));
      })
      .catch(() => {
        if (!cancelled) setSpeeds([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // One row per parser that has either a verdict record or a timed run. The two
  // metrics have different denominators, so every cell carries its own sample
  // rather than borrowing the row's.
  //
  // `rank` is fixed to the standings, not to the row's position on screen: it
  // means "where this parser stands", so sorting the table by speed or by ties
  // must not renumber it.
  const rows = useMemo(() => {
    const speedFor = new Map((speeds ?? []).map((s) => [s.parserId, s]));
    const merged: LeaderboardRow[] = standings.map((standing, index) => ({
      parserId: standing.parserId,
      rank: index + 1,
      standing,
      speed: speedFor.get(standing.parserId) ?? null,
    }));
    const alreadyListed = new Set(standings.map((s) => s.parserId));
    for (const speed of speeds ?? []) {
      if (alreadyListed.has(speed.parserId)) continue;
      merged.push({
        parserId: speed.parserId,
        rank: null,
        standing: null,
        speed,
      });
    }
    return merged;
  }, [standings, speeds]);

  const [sort, setSort] = useState<Sort>({ key: "default", direction: "asc" });

  const sortedRows = useMemo(() => sortRows(rows, sort), [rows, sort]);

  const toggleSort = (key: SortKey) => {
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key, direction: DEFAULT_DIRECTION[key] },
    );
  };

  // Rank numbers claim an ordering. Only blind votes produce one, so when there
  // are none the table renders as a plain speed table instead of a podium.
  const ranked = standings.length > 0;

  return (
    <main className="leaderboard-shell">
      <AppHeader
        title="Leaderboard"
        meta="This device · votes and run history"
        actions={
          <>
          <ModeToggle />
          <Link className={buttonVariants({ size: "sm" })} href="/arena">
            Go to Arena
          </Link>
          </>
        }
      />

      {/* Framing on the left, standings on the right. Stacking them put a
          two-row table in a 450px column on a 1440px screen with the caveats
          below the fold, so the numbers looked incidental and the reason they
          cannot be trusted as a global ranking was the easiest thing to miss. */}
      <section className="leaderboard-main" aria-labelledby="leaderboard-title">
        <aside className="leaderboard-aside">
          <div className="landing-copy">
            <h1 id="leaderboard-title">Who wins blind votes?</h1>
            <p className="landing-lede">
              Only blind votes count. Labeled preferences are recorded but
              never ranked. Until hosted battles exist, this aggregates the
              votes cast on this device.
            </p>
          </div>

          <div className="leaderboard-method">
            <strong>Methodology</strong>
            <p>
              Each vote stores the runs it actually compared - the runner&apos;s job
              id and the browser run-history key for every candidate - in the
              order they were displayed.
              {voteCount > 0 && ` Based on ${voteCount} blind vote${voteCount === 1 ? "" : "s"}.`}
              {" "}
              Win rate is wins over decisive battles; ties and all-poor
              verdicts are excluded from that denominator and shown separately.
              It mixes two- and three-way comparisons, so it is not comparable
              across field sizes. One device is not a benchmark: treat this as
              your own verdict history, not a global truth.
            </p>
          </div>

          <div className="leaderboard-method">
            <strong>Speed</strong>
            <p>
              Median milliseconds per page across every completed run in this
              browser&apos;s history. Median, not mean, because container startup
              is a fixed cost that a mean would smear across a small sample.
              {" "}
              It needs no vote, so it appears before anything has been ranked.
              Read it as a rough order of magnitude, not a benchmark: two parsers
              here have not necessarily read the same documents, and which
              document was read moves the figure more than a rerun does. The
              range and the run and document counts beside each number say how
              thin the sample is.
            </p>
          </div>
        </aside>

        {rows.length === 0 ? (
          <div className="leaderboard-empty">
            {speeds === null ? (
              <h2>Reading run history…</h2>
            ) : (
              <>
                <h2>Nothing measured yet.</h2>
                {labeledCount > 0 ? (
                  <p>
                    {labeledCount} labeled comparison
                    {labeledCount === 1 ? "" : "s"} recorded on this device.
                    Those are kept but never ranked, because the parser names
                    were visible when you chose.
                  </p>
                ) : (
                  <p>
                    Run a parser on a document to record its speed, then pick a
                    winner in the verdict bar under the columns.
                  </p>
                )}
                <Link className={buttonVariants({ size: "lg" })} href="/">
                  Open a document
                </Link>
              </>
            )}
          </div>
        ) : (
          <div className="leaderboard-table" role="table" aria-label="Parser standings">
            <div className="leaderboard-row leaderboard-head" role="row">
              {COLUMNS.map((key) => (
                <span
                  key={key}
                  role="columnheader"
                  aria-sort={
                    sort.key === key
                      ? sort.direction === "asc"
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                >
                  <button
                    type="button"
                    className="leaderboard-sort"
                    data-active={sort.key === key || undefined}
                    onClick={() => toggleSort(key)}
                  >
                    {SORT_LABELS[key]}
                    <span aria-hidden="true">
                      {sort.key === key
                        ? sort.direction === "asc"
                          ? "\u2191"
                          : "\u2193"
                        : "\u2195"}
                    </span>
                  </button>
                </span>
              ))}
            </div>
            {sortedRows.map(({ parserId, rank, standing, speed }) => {
              const meta = parserNames[parserId] ?? { name: parserId, profile: "" };
              return (
                <div className="leaderboard-row" role="row" key={parserId}>
                  <span role="cell" className="leaderboard-parser">
                    {ranked && (
                      <b
                        className="leaderboard-rank"
                        data-unranked={rank === null ? "" : undefined}
                      >
                        {rank ?? "–"}
                      </b>
                    )}
                    <span>
                      <strong>{meta.name}</strong>
                      <small>{meta.profile}</small>
                    </span>
                  </span>
                  <span role="cell" className="leaderboard-rate">
                    {!standing || standing.winRate === null ? (
                      <small>{standing ? "No decisive battles" : "Not voted on"}</small>
                    ) : (
                      <>
                        <span
                          className="leaderboard-bar"
                          style={{ ["--rate" as string]: `${Math.round(standing.winRate * 100)}%` }}
                          aria-hidden="true"
                        />
                        <b>{Math.round(standing.winRate * 100)}%</b>
                      </>
                    )}
                  </span>
                  <span role="cell" className="leaderboard-speed">
                    {speed ? (
                      <>
                        <b>
                          {Math.round(speed.medianMsPerPage)}
                          <span className="leaderboard-unit"> ms/page</span>
                        </b>
                        {/* The sample belongs next to the number: a median over
                            three runs of one document is not the same claim as
                            one over thirty. The range is dropped when it would
                            just restate the median. */}
                        <small>
                          {Math.round(speed.fastestMsPerPage) !==
                            Math.round(speed.slowestMsPerPage) && (
                            <>
                              {Math.round(speed.fastestMsPerPage)}–
                              {Math.round(speed.slowestMsPerPage)}
                              {" · "}
                            </>
                          )}
                          {speed.runs} run
                          {speed.runs === 1 ? "" : "s"} · {speed.documents} doc
                          {speed.documents === 1 ? "" : "s"}
                        </small>
                      </>
                    ) : (
                      <small>No timed runs</small>
                    )}
                  </span>
                  <span role="cell">{standing?.battles ?? 0}</span>
                  <span role="cell">{standing?.ties ?? 0}</span>
                  <span role="cell">{standing?.allPoor ?? 0}</span>
                </div>
              );
            })}
            {!ranked && (
              <p className="leaderboard-labeled-note">
                No blind votes yet, so no parser is ranked. These rows are
                ordered by speed, which is measured from run history.
              </p>
            )}
            {labeledCount > 0 && (
              <p className="leaderboard-labeled-note">
                Plus {labeledCount} labeled comparison
                {labeledCount === 1 ? "" : "s"}, kept but not ranked.
              </p>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
