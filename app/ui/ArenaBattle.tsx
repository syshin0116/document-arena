"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type ArenaParserId,
  type BlindVoteOutcome,
  saveVote,
} from "../vote-store";
import { ModeToggle } from "@/components/mode-toggle";
import { AppHeader } from "./AppHeader";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const PdfSourceViewer = dynamic(() => import("./PdfSourceViewer"), {
  ssr: false,
  loading: () => (
    <div className="pdf-viewer-shell">
      <div className="pdf-viewer-message" role="status">
        <span className="spinner" aria-hidden="true" />
        <strong>Loading sample PDF</strong>
        <span>Starting the local PDF renderer</span>
      </div>
    </div>
  ),
});

const parserMeta: Record<
  ArenaParserId,
  { name: string; version: string; timing: string; artifactId: string }
> = {
  opendataloader: {
    name: "OpenDataLoader",
    version: "2.5.0",
    timing: "4.2s",
    artifactId: "demo-opendataloader-parsed-document",
  },
  mineru: {
    name: "MinerU",
    version: "2.6.1",
    timing: "11.8s",
    artifactId: "demo-mineru-parsed-document",
  },
};

type BattlePhase = "intro" | "running" | "blind" | "revealed";
type ArenaMobilePane = "source" | "candidate-a" | "candidate-b";

function shuffledPair(): [ArenaParserId, ArenaParserId] {
  return Math.random() < 0.5
    ? ["opendataloader", "mineru"]
    : ["mineru", "opendataloader"];
}

export function ArenaBattle() {
  const [phase, setPhase] = useState<BattlePhase>("intro");
  const [permutation, setPermutation] = useState<[ArenaParserId, ArenaParserId]>([
    "opendataloader",
    "mineru",
  ]);
  const [outcome, setOutcome] = useState<BlindVoteOutcome | null>(null);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [mobilePane, setMobilePane] =
    useState<ArenaMobilePane>("candidate-a");
  const timers = useRef<number[]>([]);

  useEffect(
    () => () => timers.current.forEach((timer) => window.clearTimeout(timer)),
    [],
  );

  const handlePageCountChange = useCallback((count: number) => {
    setPageCount(count);
  }, []);
  const handlePageChange = useCallback((next: number) => {
    setPage(Math.max(1, next));
  }, []);
  const noop = useCallback(() => {}, []);
  const noopActivate: (id: string | null) => void = noop;

  function startBattle() {
    setPermutation(shuffledPair());
    setOutcome(null);
    setPage(1);
    setMobilePane("candidate-a");
    setPhase("running");
    const timer = window.setTimeout(() => setPhase("blind"), 1600);
    timers.current.push(timer);
  }

  function castVote(vote: BlindVoteOutcome) {
    setOutcome(vote);
    setPhase("revealed");
    saveVote({
      id: `vote_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      documentId: "demo",
      documentType: "digital-text",
      page,
      permutation,
      candidateArtifactIds: permutation.map(
        (parser) => parserMeta[parser].artifactId,
      ),
      outcome: vote,
      blind: true,
    });
  }

  return (
    <main
      className="arena-shell"
      data-phase={phase}
      data-mobile-pane={mobilePane}
    >
      <AppHeader
        title="Arena"
        meta="Blind battle · sample document"
        actions={
          <>
          <ModeToggle />
          <Link className={buttonVariants({ variant: "outline", size: "sm" })} href="/leaderboard">
            Leaderboard
          </Link>
          </>
        }
      />

      {phase === "intro" && (
        <section className="arena-intro" aria-labelledby="arena-title">
          <p className="eyebrow">
            <span className="eyebrow-dot" aria-hidden="true" />
            Judge without brand bias
          </p>
          <h1 id="arena-title">Two parsers. No labels. Your call.</h1>
          <p className="landing-lede">
            Both parsers read the same sample document. Labels, versions, and
            timing stay hidden until you vote. Votes stay on this device.
          </p>
          <div className="empty-result-actions">
            <button className={buttonVariants({ size: "lg" })} type="button" onClick={startBattle}>
              Start a sample battle
            </button>
            <Link className={buttonVariants({ variant: "outline", size: "lg" })} href="/">
              Use my own document
            </Link>
          </div>
          <span className="empty-result-meta">
            Sample: attention-is-all-you-need.pdf · digital text
          </span>
        </section>
      )}

      {phase === "running" && (
        <section className="arena-intro" aria-live="polite">
          <div className="running-orbit" aria-hidden="true"><span /></div>
          <p className="eyebrow">Preparing battle</p>
          <h1>Two anonymous parsers are reading.</h1>
          <p className="landing-lede">
            Candidate order is randomized once and kept until your vote.
          </p>
        </section>
      )}

      {(phase === "blind" || phase === "revealed") && (
        <>
          <div
            className="arena-mobile-pane-switcher"
            role="group"
            aria-label="Arena view"
          >
            <button
              type="button"
              aria-pressed={mobilePane === "source"}
              aria-controls="arena-source-pane"
              onClick={() => setMobilePane("source")}
            >
              Source
            </button>
            <button
              type="button"
              aria-pressed={mobilePane === "candidate-a"}
              aria-controls="arena-candidate-a"
              onClick={() => setMobilePane("candidate-a")}
            >
              Candidate A
            </button>
            <button
              type="button"
              aria-pressed={mobilePane === "candidate-b"}
              aria-controls="arena-candidate-b"
              onClick={() => setMobilePane("candidate-b")}
            >
              Candidate B
            </button>
          </div>

          <div
            className="workspace-canvas arena-canvas"
            data-mobile-pane={mobilePane}
          >
            <section
              id="arena-source-pane"
              className="source-pane"
              aria-label="Source PDF"
            >
              <div className="pane-toolbar">
                <div>
                  <strong>Source</strong>
                  <span className="native-pill">Sample PDF</span>
                </div>
                <div className="source-controls" aria-label="Page controls">
                  <button
                    type="button"
                    aria-label="Previous page"
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                    disabled={page <= 1}
                  >
                    ‹
                  </button>
                  <span>
                    <b>{page}</b> / {pageCount ?? "—"}
                  </span>
                  <button
                    type="button"
                    aria-label="Next page"
                    onClick={() =>
                      setPage((current) =>
                        pageCount ? Math.min(pageCount, current + 1) : current + 1,
                      )
                    }
                    disabled={!pageCount || page >= pageCount}
                  >
                    ›
                  </button>
                </div>
              </div>
              <div className="pdf-stage">
                <PdfSourceViewer
                  documentId="demo"
                  sample
                  pageNumber={page}
                  zoom={92}
                  thumbnailsOpen={false}
                  regions={[]}
                  regionParserId="opendataloader"
                  activeEvidence={null}
                  pinnedEvidence={null}
                  comparing
                  onPageCountChange={handlePageCountChange}
                  onPageChange={handlePageChange}
                  onFileNameChange={noop}
                  onActivateEvidence={noopActivate}
                  onPinEvidence={noop}
                />
              </div>
            </section>

            <section
              className="results-pane"
              aria-label={
                phase === "blind"
                  ? "Anonymous candidates"
                  : "Revealed parser results"
              }
            >
              <div className="result-ready-shell">
                <div className="pane-toolbar result-toolbar">
                  <div className="result-heading">
                    <strong>
                      {phase === "blind" ? "Blind comparison" : "Identities revealed"}
                    </strong>
                    <span className="mapping-status" data-unavailable={phase === "blind" || undefined}>
                      <span aria-hidden="true" />
                      {phase === "blind"
                        ? "Labels masked · order randomized"
                        : "Vote recorded on this device"}
                    </span>
                  </div>
                </div>
                <div className="results-scroll">
                  <div className="result-columns" data-columns={2}>
                    {permutation.map((parser, index) => (
                      <CandidateColumn
                        key={parser}
                        parser={parser}
                        letter={index === 0 ? "A" : "B"}
                        revealed={phase === "revealed"}
                        winner={outcome === parser}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </section>
          </div>

          <footer className="arena-vote-bar" aria-label="Vote">
            {phase === "blind" ? (
              <>
                <span className="arena-vote-question">
                  Which candidate parsed this page better?
                </span>
                <div className="arena-vote-actions">
                  <button
                    className={cn(buttonVariants({ size: "sm" }), "arena-candidate-vote")}
                    type="button"
                    onClick={() => castVote(permutation[0])}
                  >
                    Candidate A
                  </button>
                  <button
                    className={cn(buttonVariants({ size: "sm" }), "arena-candidate-vote")}
                    type="button"
                    onClick={() => castVote(permutation[1])}
                  >
                    Candidate B
                  </button>
                  <button
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                    type="button"
                    onClick={() => castVote("tie")}
                  >
                    Tie
                  </button>
                  <button
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                    type="button"
                    onClick={() => castVote("both-poor")}
                  >
                    Both poor
                  </button>
                </div>
              </>
            ) : (
              <>
                <span className="arena-vote-question">
                  {outcome === "tie"
                    ? "You called it a tie."
                    : outcome === "both-poor"
                      ? "You marked both results poor."
                      : `You picked ${outcome ? parserMeta[outcome].name : ""}.`}
                </span>
                <div className="arena-vote-actions">
                  <button className={buttonVariants({ size: "sm" })} type="button" onClick={startBattle}>
                    Battle again
                  </button>
                  <Link className={buttonVariants({ variant: "outline", size: "sm" })} href="/leaderboard">
                    View leaderboard
                  </Link>
                </div>
              </>
            )}
          </footer>
        </>
      )}
    </main>
  );
}

function CandidateColumn({
  parser,
  letter,
  revealed,
  winner,
}: {
  parser: ArenaParserId;
  letter: "A" | "B";
  revealed: boolean;
  winner: boolean;
}) {
  const meta = parserMeta[parser];
  const alternate = parser === "mineru";
  return (
    <article
      id={`arena-candidate-${letter.toLowerCase()}`}
      className="parser-result"
      data-arena-candidate={letter.toLowerCase()}
      data-accent={revealed ? (alternate ? "amber" : "indigo") : "neutral"}
      data-winner={winner || undefined}
    >
      <header className="parser-result-header">
        <div>
          <span className="parser-letter">{letter}</span>
          <div>
            <h2>{revealed ? meta.name : `Candidate ${letter}`}</h2>
            <p>{revealed ? `v${meta.version}` : "Identity masked"}</p>
          </div>
        </div>
        <span className="complete-badge">
          {revealed ? (
            <>
              <span className="status-dot" data-status="complete" aria-hidden="true" />{" "}
              {meta.timing}
            </>
          ) : (
            "···"
          )}
        </span>
      </header>
      <div className="parsed-document">
        <div className="parsed-block parsed-title" data-static>
          <span className="block-type">Title</span>
          <strong>Attention Is All You Need</strong>
          <small>{alternate ? "Heading · level 1" : "Title · confidence 0.99"}</small>
        </div>
        <div className="parsed-block" data-static>
          <span className="block-type">{alternate ? "Section" : "Paragraph"}</span>
          <strong>Abstract</strong>
          <p>
            {alternate
              ? "We compare structured document parsers through source-linked evidence, layout preservation and reading order quality."
              : "We compare structured document parsers using source-linked evidence, layout preservation, and reading-order quality."}
          </p>
          <small>{alternate ? "Text block · page 1" : "Paragraph · 31 words"}</small>
        </div>
        <div className="parsed-block parsed-table" data-static>
          <span className="block-type">Table</span>
          <strong>Parser output comparison</strong>
          <div className="mini-table" aria-hidden="true">
            <span>Parser</span><span>Text</span><span>Layout</span>
            <span>OpenDataLoader</span><span>0.96</span><span>0.91</span>
            <span>MinerU</span><span>0.94</span><span>0.95</span>
          </div>
          <small>{alternate ? "Table · 3 columns · 3 rows" : "Table · native cells"}</small>
        </div>
      </div>
    </article>
  );
}
