"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ModeToggle } from "@/components/mode-toggle";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AppHeader } from "./AppHeader";
import { VerdictBar } from "./VerdictBar";
import { BlockReadingView } from "./Workspace";
import {
  LOCAL_COMPONENT_IDS,
  LOCAL_PARSER_ORDER,
  POSITION_ACCENTS,
  POSITION_LETTERS,
  PARSER_DISPLAY,
} from "../parsers";
import {
  listLocalDocuments,
  loadLocalDocument,
  loadLocalParseResults,
  saveLocalParseResult,
  type LocalDocument,
  type LocalDocumentSummary,
} from "../local-document-store";
import {
  checkLocalRunner,
  parseWithLocalRunner,
  runnerComponent,
  type LocalParseResult,
  type LocalRunnerProbe,
} from "../local-runner";
import { localComponentRunAvailability } from "../run-options";
import { SAMPLE_DOCUMENTS } from "../lib/sample-documents-meta";
import { buildVote } from "../vote-builder";
import { saveVote, type VoteOutcome } from "../vote-store";
import type { ParserId } from "../workspace-state";

const PdfSourceViewer = dynamic(() => import("./PdfSourceViewer"), {
  ssr: false,
  loading: () => (
    <div className="pdf-viewer-shell">
      <div className="pdf-viewer-message" role="status">
        <span className="spinner" aria-hidden="true" />
        <strong>Loading PDF</strong>
        <span>Starting the local PDF renderer</span>
      </div>
    </div>
  ),
});

type BattlePhase = "pick" | "running" | "blind" | "revealed";

/** One candidate in a battle: a real run, and the receipt a vote points at. */
type Candidate = {
  parserId: ParserId;
  result: LocalParseResult;
  recordId: string;
};

type BattleDocument = {
  id: string;
  name: string;
  /** Samples are served by the app; uploads live in this browser. */
  sample: boolean;
};

/**
 * Deterministic-per-battle shuffle.
 *
 * `Math.random` is called once when a battle starts, never during render, so a
 * re-render cannot reorder the columns out from under a reader mid-vote.
 */
function shuffle<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function ArenaBattle() {
  const [phase, setPhase] = useState<BattlePhase>("pick");
  const [runner, setRunner] = useState<LocalRunnerProbe | null>(null);
  const [uploads, setUploads] = useState<LocalDocumentSummary[]>([]);
  const [battleDocument, setBattleDocument] = useState<BattleDocument | null>(
    null,
  );
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [outcome, setOutcome] = useState<VoteOutcome | null>(null);
  const [progress, setProgress] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState<number | null>(null);
  /** "source", or the index of the candidate column a narrow screen shows. */
  const [mobilePane, setMobilePane] = useState<"source" | number>(0);
  /**
   * Set before the first await so a second click cannot start a second battle.
   *
   * The picker unmounts once the phase changes, but every click in a
   * double-click lands before React re-renders, and each one would run the
   * missing parsers again - twice the wait, and twice the bill for a remote
   * component.
   */
  const battleInFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;
    checkLocalRunner().then((probe) => {
      if (!cancelled) setRunner(probe);
    });
    listLocalDocuments(6)
      .then((documents) => {
        if (!cancelled) setUploads(documents);
      })
      .catch(() => {
        if (!cancelled) setUploads([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handlePageCountChange = useCallback((count: number) => {
    setPageCount(count);
  }, []);
  const handlePageChange = useCallback((next: number) => {
    setPage(Math.max(1, next));
  }, []);
  const noop = useCallback(() => {}, []);
  const noopActivate: (id: string | null) => void = noop;

  /**
   * Parsers this runner can actually execute right now.
   *
   * Presence is not enough: a component whose container image was never built
   * is still advertised, and asking it to run fails with "not runnable on this
   * runner" after the battle has already started.
   */
  const runnableParsers = useMemo(() => {
    if (runner?.status !== "ready") return [];
    return LOCAL_PARSER_ORDER.filter(
      (parser) =>
        localComponentRunAvailability(
          runnerComponent(runner.info, LOCAL_COMPONENT_IDS[parser]),
        ).available,
    );
  }, [runner]);

  async function startBattle(document: BattleDocument) {
    if (battleInFlight.current) return;
    battleInFlight.current = true;
    setBattleDocument(document);
    setCandidates([]);
    setOutcome(null);
    setError(null);
    setPage(1);
    setMobilePane(0);
    setPhase("running");

    try {
      // Saved receipts first: a battle should not pay to re-run what this
      // browser already has, and a receipt is exactly what a vote points at.
      setProgress("Reading saved runs");
      const restored = await loadLocalParseResults(
        document.id,
        LOCAL_PARSER_ORDER,
      );

      const found: Candidate[] = [];
      const missing: ParserId[] = [];
      for (const parser of LOCAL_PARSER_ORDER) {
        const run = restored[parser];
        // A run without a receipt cannot be cited, so it is treated as absent
        // and re-run rather than silently disqualifying the whole battle.
        if (run?.recordId) {
          found.push({
            parserId: parser,
            result: run.result,
            recordId: run.recordId,
          });
        } else if (runnableParsers.includes(parser)) {
          missing.push(parser);
        }
      }

      if (found.length + missing.length < 2) {
        throw new Error(
          "A battle needs two parsers. This runner offers " +
            `${found.length + missing.length}. Start the local runner, or pick a document with saved runs.`,
        );
      }

      let file: LocalDocument | null = null;
      if (missing.length > 0) {
        file = await loadBattleDocument(document);
      }

      const failures: string[] = [];
      for (const parser of missing) {
        setProgress(
          `Parsing with candidate ${found.length + 1} of ${found.length + missing.length}`,
        );
        try {
          const result = await parseWithLocalRunner(
            file!.file,
            LOCAL_COMPONENT_IDS[parser],
            () => {},
          );
          const receipt = await saveLocalParseResult(
            document.id,
            parser,
            result,
          );
          found.push({ parserId: parser, result, recordId: receipt.recordId });
        } catch (caught) {
          // One parser refusing to run is not a reason to throw away the others.
          // Naming it here would leak an identity, so the count is all that is
          // reported until the reveal.
          failures.push(
            caught instanceof Error ? caught.message : "unknown runner error",
          );
        }
      }

      if (found.length < 2) {
        throw new Error(
          `Only ${found.length} parser finished, so there is nothing to compare. ${failures.join(" ")}`.trim(),
        );
      }

      setCandidates(shuffle(found));
      setProgress("");
      setPhase("blind");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "The battle could not start.",
      );
      setPhase("pick");
    } finally {
      battleInFlight.current = false;
    }
  }

  function castVote(vote: VoteOutcome) {
    if (!battleDocument) return;
    try {
      const built = buildVote({
        documentId: battleDocument.id,
        page,
        candidates: candidates.map((candidate) => ({
          parserId: candidate.parserId,
          runId: candidate.result.runId,
          recordId: candidate.recordId,
        })),
        outcome: vote,
        // Names, versions, and timings were masked the whole way here, so this
        // one counts.
        blind: true,
        sourceArtifactId: candidates[0]?.result.source?.artifactId,
        id: crypto.randomUUID(),
        now: new Date(),
      });
      if (!saveVote(built)) {
        toast.error("That verdict could not be saved.", {
          description:
            "This browser refused to store it. Check that site data is allowed and that storage is not full.",
        });
        return;
      }
      setOutcome(vote);
      setPhase("revealed");
    } catch (caught) {
      toast.error("That verdict was not recorded.", {
        description:
          caught instanceof Error
            ? caught.message
            : "The vote could not be built.",
      });
    }
  }

  const revealed = phase === "revealed";

  return (
    <main className="arena-shell" data-phase={phase}>
      <AppHeader
        title="Arena"
        meta="Blind battle · votes count here"
        actions={
          <>
            <ModeToggle />
            <Link
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
              href="/leaderboard"
            >
              Leaderboard
            </Link>
          </>
        }
      />

      {phase === "pick" && (
        <section className="arena-intro" aria-labelledby="arena-title">
          <p className="eyebrow">
            <span className="eyebrow-dot" aria-hidden="true" />
            Judge without brand bias
          </p>
          <h1 id="arena-title">No labels. Your call.</h1>
          <p className="landing-lede">
            Every parser reads the same document. Names, versions, and timings
            stay hidden until you vote, and only votes cast here are ranked.
          </p>

          {error && (
            <p className="arena-error" role="alert">
              {error}
            </p>
          )}

          {runner !== null && runner.status !== "ready" && (
            <p className="empty-result-meta" role="status">
              The local runner is not answering, so only documents with saved
              runs can battle.
            </p>
          )}

          <div className="arena-pick-group">
            <h2>Samples</h2>
            <div className="arena-pick-row">
              {SAMPLE_DOCUMENTS.map((sample) => (
                <button
                  key={sample.id}
                  type="button"
                  className={cn(buttonVariants({ variant: "outline" }))}
                  onClick={() =>
                    startBattle({
                      id: sample.id,
                      name: sample.shortTitle,
                      sample: true,
                    })
                  }
                >
                  {sample.shortTitle}
                  <small>{sample.pageCount} pages</small>
                </button>
              ))}
            </div>
          </div>

          {uploads.length > 0 && (
            <div className="arena-pick-group">
              <h2>Your documents</h2>
              <div className="arena-pick-row">
                {uploads.map((upload) => (
                  <button
                    key={upload.id}
                    type="button"
                    className={cn(buttonVariants({ variant: "outline" }))}
                    onClick={() =>
                      startBattle({
                        id: upload.id,
                        name: upload.name,
                        sample: false,
                      })
                    }
                  >
                    {upload.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <Link
            className={buttonVariants({ variant: "ghost", size: "sm" })}
            href="/"
          >
            Upload another PDF
          </Link>
        </section>
      )}

      {phase === "running" && (
        <section className="arena-intro" aria-live="polite">
          <div className="running-orbit" aria-hidden="true">
            <span />
          </div>
          <p className="eyebrow">Preparing battle</p>
          <h1>Anonymous parsers are reading.</h1>
          <p className="landing-lede">{progress}</p>
        </section>
      )}

      {(phase === "blind" || revealed) && battleDocument && (
        <>
          {/* Narrow screens cannot hold the source and every candidate at
              once. One button per candidate, so this follows a two- or
              three-way battle rather than assuming two. */}
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
            {candidates.map((candidate, index) => (
              <button
                key={index}
                type="button"
                aria-pressed={mobilePane === index}
                aria-controls={`arena-candidate-${index}`}
                onClick={() => setMobilePane(index)}
              >
                {revealed
                  ? PARSER_DISPLAY[candidate.parserId]
                  : `Candidate ${POSITION_LETTERS[index]}`}
              </button>
            ))}
          </div>

          <div
            className="workspace-canvas arena-canvas"
            data-mobile-pane={
              typeof mobilePane === "number" ? `c${mobilePane}` : "source"
            }
          >
            <section
              id="arena-source-pane"
              className="source-pane"
              aria-label="Source PDF"
            >
              <div className="pane-toolbar">
                <div>
                  <strong>Source</strong>
                  <span className="native-pill">{battleDocument.name}</span>
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
                  documentId={battleDocument.id}
                  sample={battleDocument.sample}
                  pageNumber={page}
                  zoom={92}
                  thumbnailsOpen={false}
                  /* No source boxes while masked: the workspace tints each
                     parser's regions by parser, which would name the columns. */
                  regions={[]}
                  regionParserId="*"
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
                revealed ? "Revealed parser results" : "Anonymous candidates"
              }
            >
              <div className="result-ready-shell">
                <div className="pane-toolbar result-toolbar">
                  <div className="result-heading">
                    <strong>
                      {revealed ? "Identities revealed" : "Blind comparison"}
                    </strong>
                    <span
                      className="mapping-status"
                      data-unavailable={!revealed || undefined}
                    >
                      <span aria-hidden="true" />
                      {revealed
                        ? "Vote recorded on this device"
                        : "Labels masked · order randomized"}
                    </span>
                  </div>
                </div>
                <div className="results-scroll">
                  <div
                    className="result-columns"
                    data-columns={candidates.length}
                  >
                    {candidates.map((candidate, index) => (
                      <div
                        key={index}
                        id={`arena-candidate-${index}`}
                        className="arena-candidate"
                        data-candidate={index}
                      >
                      <BlockReadingView
                        documentId={battleDocument.id}
                        result={candidate.result}
                        parserName={
                          revealed
                            ? PARSER_DISPLAY[candidate.parserId]
                            : `Candidate ${POSITION_LETTERS[index]}`
                        }
                        letter={POSITION_LETTERS[index]}
                        accent={POSITION_ACCENTS[index]}
                        masked={!revealed}
                        page={page}
                        merge={false}
                        evidence={null}
                        pinned={null}
                        onActivate={noopActivate}
                        onPin={noop}
                      />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          </div>

          {revealed ? (
            <footer className="verdict-bar" aria-label="Recorded verdict">
              <span className="verdict-label">Recorded</span>
              <strong className="verdict-recorded">
                {outcome === "tie"
                  ? "You called it a tie."
                  : outcome === "all-poor"
                    ? "You marked them all poor."
                    : `You picked ${outcome ? PARSER_DISPLAY[outcome as ParserId] : ""}.`}
              </strong>
              <button
                className={buttonVariants({ size: "sm" })}
                type="button"
                onClick={() => setPhase("pick")}
              >
                Battle again
              </button>
              <Link
                className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                href="/leaderboard"
              >
                View leaderboard
              </Link>
            </footer>
          ) : (
            <VerdictBar
              candidates={candidates.map((candidate, index) => ({
                parserId: candidate.parserId,
                label: `Candidate ${POSITION_LETTERS[index]}`,
              }))}
              votedOutcome={null}
              disabledReason={null}
              onVote={castVote}
            />
          )}
        </>
      )}
    </main>
  );
}

async function loadBattleDocument(
  document: BattleDocument,
): Promise<LocalDocument> {
  if (document.sample) {
    const response = await fetch(
      `/v1/documents/${encodeURIComponent(document.id)}/content`,
    );
    if (!response.ok) {
      throw new Error(
        `The sample PDF could not be loaded (HTTP ${response.status}).`,
      );
    }
    const blob = await response.blob();
    return {
      id: document.id,
      file: new File([blob], `${document.id}.pdf`, { type: "application/pdf" }),
    };
  }

  const stored = await loadLocalDocument(document.id);
  if (!stored) {
    throw new Error("This PDF is no longer available in the browser store.");
  }
  return stored;
}
