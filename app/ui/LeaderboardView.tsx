"use client";

import Link from "next/link";
import { useMemo, useSyncExternalStore } from "react";
import {
  aggregateStandings,
  getBlindVotesSnapshot,
  getServerVotesSnapshot,
  subscribeToVotes,
} from "../vote-store";
import { Brand } from "./Brand";

const parserNames: Record<string, { name: string; profile: string }> = {
  opendataloader: {
    name: "OpenDataLoader",
    profile: "Deterministic · native geometry · CPU",
  },
  mineru: { name: "MinerU", profile: "Pipeline · layout + OCR · GPU optional" },
};

export function LeaderboardView() {
  const votes = useSyncExternalStore(
    subscribeToVotes,
    getBlindVotesSnapshot,
    getServerVotesSnapshot,
  );
  const voteCount = votes.length;
  const standings = useMemo(() => aggregateStandings(votes), [votes]);

  return (
    <main className="leaderboard-shell">
      <header className="workspace-header">
        <div className="workspace-identity">
          <Link className="back-button" href="/" aria-label="Back to upload">
            ←
          </Link>
          <Link className="workspace-brand" href="/" aria-label="Document Arena home">
            <Brand compact />
          </Link>
          <span className="header-separator" aria-hidden="true" />
          <div className="document-identity">
            <strong>Leaderboard</strong>
            <span>Blind votes only · this device</span>
          </div>
        </div>
        <div className="workspace-actions">
          <Link className="primary-button" href="/arena">
            Go to Arena
          </Link>
        </div>
      </header>

      <section className="leaderboard-main" aria-labelledby="leaderboard-title">
        <div className="landing-copy">
          <p className="eyebrow">
            <span className="eyebrow-dot" aria-hidden="true" />
            Digital text documents
          </p>
          <h1 id="leaderboard-title">Who wins blind votes?</h1>
          <p className="landing-lede">
            Rankings are grouped by document type and count only blind votes.
            Labeled preferences never count. Until hosted battles exist, this
            aggregates the votes cast on this device.
          </p>
        </div>

        {standings.length === 0 ? (
          <div className="leaderboard-empty">
            <h2>No blind votes yet.</h2>
            <p>Run a battle in the Arena to seed this device&apos;s rankings.</p>
            <Link className="primary-button" href="/arena">
              Start a sample battle
            </Link>
          </div>
        ) : (
          <div className="leaderboard-table" role="table" aria-label="Parser standings">
            <div className="leaderboard-row leaderboard-head" role="row">
              <span role="columnheader">Parser</span>
              <span role="columnheader">Win rate</span>
              <span role="columnheader">Battles</span>
              <span role="columnheader">Ties</span>
            </div>
            {standings.map((standing, index) => {
              const meta = parserNames[standing.parserId] ?? {
                name: standing.parserId,
                profile: "",
              };
              return (
                <div className="leaderboard-row" role="row" key={standing.parserId}>
                  <span role="cell" className="leaderboard-parser">
                    <b className="leaderboard-rank">{index + 1}</b>
                    <span>
                      <strong>{meta.name}</strong>
                      <small>{meta.profile}</small>
                    </span>
                  </span>
                  <span role="cell" className="leaderboard-rate">
                    {standing.winRate === null ? (
                      <small>No decisive battles</small>
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
                  <span role="cell">{standing.battles}</span>
                  <span role="cell">{standing.ties}</span>
                </div>
              );
            })}
          </div>
        )}

        <div className="leaderboard-method">
          <strong>Methodology</strong>
          <p>
            Every battle randomizes candidate order and masks labels, versions,
            timing, and runner details until the vote is cast. Each vote stores
            the exact artifacts shown and the displayed permutation.
            {voteCount > 0 && ` Based on ${voteCount} blind vote${voteCount === 1 ? "" : "s"}.`}
            {" "}
            Win rate is wins over decisive battles; ties are shown separately.
            One device is not a benchmark: treat this as your own verdict
            history, not a global truth.
          </p>
        </div>
      </section>
    </main>
  );
}
