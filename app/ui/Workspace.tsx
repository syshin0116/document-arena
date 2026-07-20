"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import {
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import { ModeToggle } from "@/components/mode-toggle";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { toast } from "sonner";
import {
  createWorkspaceState,
  displayedEvidence,
  type ParserId,
  workspaceReducer,
} from "../workspace-state";
import {
  isNormalizedBbox,
  type SourceEvidenceRegion,
} from "../evidence-regions";
import {
  blockLabel,
  buildReadingNodes,
  checkLocalRunner,
  type LocalRunnerProbe,
  deviceExecutionPlan,
  evidenceIdForBlock,
  parseWithLocalRunner,
  requiresDocumentTransferConsent,
  runnerComponent,
  runnerConnectionType,
  toEvidenceRegions,
  type ExecutionPlan,
  type LocalParseResult,
  type LocalRunnerComponent,
  type LocalRunnerInfo,
} from "../local-runner";
import {
  loadLocalDocument,
  loadLocalParseResults,
  saveLocalParseResult,
  type LocalDocument,
} from "../local-document-store";
import { preferredScrollBehavior } from "../motion-preference";
import {
  cleanRunOptionValues,
  defaultRunOptionValues,
  localComponentRunAvailability,
  runOptionsInvalidReason,
  type RunAvailability,
} from "../run-options";
import { AppHeader } from "./AppHeader";
import { buttonVariants } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { RunOptionFields, RunOptionsDialog } from "./RunOptionsDialog";

// pdfjs must never load during SSR; the crop renderer is client-only.
const SourceRegionImage = dynamic(
  () => import("./SourceRegionImage").then((mod) => mod.SourceRegionImage),
  { ssr: false },
);

const IMAGE_KINDS = new Set(["image", "figure", "picture", "graphic", "chart"]);

type LocalRunnerState =
  | { status: "checking" }
  | LocalRunnerProbe;

type StageProgress = { stage: string; current: number; total: number };

type LocalParserRun =
  | {
      status: "running";
      phase?: string;
      detail?: string;
      stages?: StageProgress[];
      options?: Record<string, unknown>;
    }
  | { status: "complete"; result: LocalParseResult }
  | { status: "failed"; error: string };

type PendingRemoteRun = {
  parser: ParserId;
  options?: Record<string, unknown>;
  component: LocalRunnerComponent;
  executionPlan: ExecutionPlan;
  document: LocalDocument;
  openedFromPicker: boolean;
};

type PendingRunOptions = {
  parser: ParserId;
  componentName: string;
  schema: NonNullable<LocalRunnerComponent["optionsSchema"]> | null;
  availability: RunAvailability;
};

type ResultContentView = "blocks" | "markdown";
type ResultRenderMode = "rendered" | "raw";

export function ResultViewToolbar({
  mappingAvailable,
  localView,
  viewMode,
  onLocalViewChange,
  onViewModeChange,
  controlsId,
}: {
  mappingAvailable: boolean;
  localView: ResultContentView;
  viewMode: ResultRenderMode;
  onLocalViewChange: (view: ResultContentView) => void;
  onViewModeChange: (mode: ResultRenderMode) => void;
  controlsId: string;
}) {
  return (
    <div className="pane-toolbar result-toolbar result-view-toolbar">
      <div className="result-toolbar-status">
        {!mappingAvailable && (
          <span className="mapping-status" data-unavailable>
            <span aria-hidden="true" />
            No source mapping on this page
          </span>
        )}
      </div>
      <div className="result-view-cluster">
        <div className="result-view-group">
          <span className="result-view-label" aria-hidden="true">
            Content
          </span>
          <ToggleGroup
            className="result-toggle-group"
            variant="outline"
            size="sm"
            spacing={0}
            role="group"
            aria-label="Content view"
          >
            <ToggleGroupItem
              pressed={localView === "blocks"}
              aria-pressed={localView === "blocks"}
              aria-controls={controlsId}
              onPressedChange={() => onLocalViewChange("blocks")}
            >
              Blocks
            </ToggleGroupItem>
            <ToggleGroupItem
              pressed={localView === "markdown"}
              aria-pressed={localView === "markdown"}
              aria-controls={controlsId}
              onPressedChange={() => onLocalViewChange("markdown")}
            >
              Markdown
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        <span className="result-view-divider" aria-hidden="true" />
        <div className="result-view-group">
          <span className="result-view-label" aria-hidden="true">
            Mode
          </span>
          <ToggleGroup className="result-toggle-group" variant="outline" size="sm" spacing={0} role="group" aria-label="Render mode">
            <ToggleGroupItem
              pressed={viewMode === "rendered"}
              aria-pressed={viewMode === "rendered"}
              aria-controls={controlsId}
              title={
                localView === "blocks"
                  ? "Rendered blocks"
                  : "Rendered Markdown"
              }
              onPressedChange={() => onViewModeChange("rendered")}
            >
              Rendered
            </ToggleGroupItem>
            <ToggleGroupItem
              pressed={viewMode === "raw"}
              aria-pressed={viewMode === "raw"}
              aria-controls={controlsId}
              title={
                localView === "blocks"
                  ? "Raw block JSON"
                  : "Raw Markdown output"
              }
              onPressedChange={() => onViewModeChange("raw")}
            >
              Raw
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>
    </div>
  );
}

const LOCAL_COMPONENT_IDS: Record<ParserId, string> = {
  opendataloader: "opendataloader-pdf",
  mineru: "mineru-pipeline",
  azuredi: "azure-di",
};

const LOCAL_PARSER_ORDER: readonly ParserId[] = [
  "opendataloader",
  "mineru",
  "azuredi",
];

const PARSER_ACCENT: Record<ParserId, "indigo" | "amber" | "teal"> = {
  opendataloader: "indigo",
  mineru: "amber",
  azuredi: "teal",
};

const PARSER_LETTER: Record<ParserId, string> = {
  opendataloader: "A",
  mineru: "B",
  azuredi: "C",
};

const PARSER_DISPLAY: Record<ParserId, string> = {
  opendataloader: "OpenDataLoader",
  mineru: "MinerU",
  azuredi: "Azure DI",
};

type EvidenceId = "title" | "abstract" | "introduction";

const evidenceLabels: Record<EvidenceId, string> = {
  title: "Document title",
  abstract: "Abstract paragraph",
  introduction: "Introduction paragraph",
};

/**
 * Page-1 regions from a real OpenDataLoader run over the sample PDF, copied out
 * of fixtures/sample/llama-opendataloader-parsed-document.json.
 *
 * These were previously three round numbers typed in by hand and labelled
 * `provenance: "native"`, which claimed parser-reported geometry for a
 * synthetic page nothing had parsed. The bboxes below are the parser's own
 * output, and the block ids and pointers resolve in that fixture. Regenerating
 * the fixture can shift page-1 block indices; see fixtures/sample/README.md.
 */
const demoEvidenceRegions: readonly SourceEvidenceRegion[] = [
  {
    // odl-p1-id-33, page 1 block 1, kind "heading"
    id: "title",
    parserId: "opendataloader",
    label: evidenceLabels.title,
    pageNumber: 1,
    bbox: [0.197004, 0.085313, 0.803001, 0.107482],
    provenance: "native",
    artifactId: "sample-opendataloader-parsed-document",
    jsonPointer: "/pages/0/blocks/1/sourceRegions/0",
  },
  {
    // odl-p1-id-37, page 1 block 5, kind "paragraph"
    id: "abstract",
    parserId: "opendataloader",
    label: evidenceLabels.abstract,
    pageNumber: 1,
    bbox: [0.147066, 0.280092, 0.459914, 0.450554],
    provenance: "native",
    artifactId: "sample-opendataloader-parsed-document",
    jsonPointer: "/pages/0/blocks/5/sourceRegions/0",
  },
  {
    // odl-p1-id-39, page 1 block 7, kind "paragraph"
    id: "introduction",
    parserId: "opendataloader",
    label: evidenceLabels.introduction,
    pageNumber: 1,
    bbox: [0.118479, 0.487849, 0.488926, 0.712681],
    provenance: "native",
    artifactId: "sample-opendataloader-parsed-document",
    jsonPointer: "/pages/0/blocks/7/sourceRegions/0",
  },
];

const PdfSourceViewer = dynamic(() => import("./PdfSourceViewer"), {
  ssr: false,
  loading: () => (
    <div className="pdf-viewer-shell">
      <div className="pdf-viewer-message" role="status">
        <span className="spinner" aria-hidden="true" />
        <strong>Loading source PDF</strong>
        <span>Starting the local PDF renderer</span>
      </div>
    </div>
  ),
});

const parserCards = [
  {
    id: "opendataloader" as const,
    name: "OpenDataLoader",
    purpose: "Fast CPU baseline",
    runtime: "Runs locally",
    tag: "Recommended",
  },
  {
    id: "mineru" as const,
    name: "MinerU",
    purpose: "Layout + OCR",
    runtime: "Needs GPU",
    tag: "Available",
  },
];

function StatusDot({ status }: { status: string }) {
  return <span className="status-dot" data-status={status} aria-hidden="true" />;
}

export function Workspace({
  documentId,
  demo = false,
  sample = false,
  fileName = "uploaded-document.pdf",
}: {
  documentId: string;
  demo?: boolean;
  /* Served by the app rather than stored in this browser. Every demo is a
     sample; not every sample is the demo. */
  sample?: boolean;
  fileName?: string;
}) {
  const [state, dispatch] = useReducer(
    workspaceReducer,
    demo,
    createWorkspaceState,
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [zoom, setZoom] = useState(92);
  const [thumbnailsOpen, setThumbnailsOpen] = useState(true);
  const [displayFileName, setDisplayFileName] = useState(fileName);
  const [localRunner, setLocalRunner] = useState<LocalRunnerState>({
    status: "checking",
  });
  const [localRuns, setLocalRuns] = useState<
    Partial<Record<ParserId, LocalParserRun>>
  >({});
  const [pendingRemoteRun, setPendingRemoteRun] =
    useState<PendingRemoteRun | null>(null);
  const [remoteConsentConfirming, setRemoteConsentConfirming] = useState(false);
  const [pendingRunOptions, setPendingRunOptions] =
    useState<PendingRunOptions | null>(null);
  const [runOptionsSubmitting, setRunOptionsSubmitting] = useState(false);
  const [localView, setLocalView] = useState<ResultContentView>("blocks");
  // Rendered/Raw applies to both the Blocks and Markdown views.
  const [mergeRegions, setMergeRegions] = useState(false);
  const [viewMode, setViewMode] = useState<ResultRenderMode>("rendered");
  const [runTab, setRunTab] = useState<ParserId | "compare" | null>(null);
  const [customSplit, setCustomSplit] = useState<number | null>(null);
  const [splitDragging, setSplitDragging] = useState(false);
  const [sourceCollapsed, setSourceCollapsed] = useState(false);
  const resultViewId = useId();
  const canvasRef = useRef<HTMLDivElement>(null);
  const timers = useRef<number[]>([]);
  const remoteConsentSubmitting = useRef(false);
  const remoteConsentReturnFocus = useRef<HTMLElement | null>(null);
  const runOptionsSubmittingRef = useRef(false);
  const runOptionsReturnFocus = useRef<HTMLElement | null>(null);
  const pickerReturnFocus = useRef<HTMLElement | null>(null);
  // Bidirectional page sync between the results scroll and the source PDF.
  const resultsScrollRef = useRef<HTMLDivElement | null>(null);
  const pageSyncSource = useRef<"scroll" | "page" | null>(null);
  const pageSyncRaf = useRef<number | null>(null);
  // Set when a pin originates from clicking a box on the source PDF, so the
  // results scroll to that block (but not when the pin came from the results).
  const pinFromSource = useRef(false);
  const evidence = displayedEvidence(state);

  const resultFor = useCallback(
    (parser: ParserId): LocalParseResult | null => {
      if (demo) return null;
      const run = localRuns[parser];
      return run?.status === "complete" ? run.result : null;
    },
    [demo, localRuns],
  );

  // Parsers that have a completed result, in catalog order.
  const completedParsers = demo
    ? []
    : LOCAL_PARSER_ORDER.filter((parser) => resultFor(parser));

  const effectiveTab: ParserId | "compare" | null = demo
    ? null
    : (() => {
        if (runTab === "compare") {
          if (completedParsers.length >= 2) return "compare";
        } else if (runTab && localRuns[runTab]) {
          return runTab;
        }
        if (completedParsers.length >= 2) return "compare";
        if (completedParsers.length === 1) return completedParsers[0];
        // Nothing complete yet: surface a running/failed parser if any.
        const active = LOCAL_PARSER_ORDER.find(
          (p) =>
            localRuns[p]?.status === "running" ||
            localRuns[p]?.status === "failed",
        );
        return active ?? null;
      })();

  // Which parsers are shown in the current tab (compare = all completed).
  const shownParsers: ParserId[] = demo
    ? []
    : effectiveTab === "compare"
      ? completedParsers
      : effectiveTab
        ? [effectiveTab]
        : [];

  // The demo never compares. It used to render a second "MinerU" column whose
  // text, version, and 11.8s timing were all written by hand, next to a real
  // OpenDataLoader run: a fabricated result presented beside a genuine one.
  // Only OpenDataLoader has actually been run over the sample PDF, so the demo
  // shows that one result and comparison stays on the real path, where the user
  // runs the second parser themselves.
  const comparing = demo
    ? false
    : effectiveTab === "compare" && completedParsers.length >= 2;

  const localRegions = useMemo(() => {
    const regions: SourceEvidenceRegion[] = [];
    const opts = { merge: mergeRegions };
    for (const parser of shownParsers) {
      const result = resultFor(parser);
      if (result) {
        regions.push(
          ...toEvidenceRegions(result.parsedDocument, parser, opts),
        );
      }
    }
    return regions;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localRuns, effectiveTab, mergeRegions, demo]);
  const demoHasNativeMapping =
    demo && state.page === 1 && state.runs.opendataloader === "complete";
  const sourceRegions = demo
    ? demoHasNativeMapping
      ? demoEvidenceRegions
      : []
    : localRegions;
  const hasNativeMapping = demo
    ? demoHasNativeMapping
    : localRegions.some((region) => region.pageNumber === state.page);
  const evidenceLabel = evidence
    ? demo
      ? evidenceLabels[evidence as EvidenceId]
      : localRegions.find((region) => region.id === evidence)?.label ?? evidence
    : null;

  const handlePageCountChange = useCallback((pageCount: number) => {
    dispatch({ type: "set-page-count", pageCount });
  }, []);
  const handlePageChange = useCallback((page: number) => {
    dispatch({ type: "set-page", page, source: "navigation" });
  }, []);
  const handleFileNameChange = useCallback((name: string) => {
    setDisplayFileName(name);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (pendingRemoteRun || pendingRunOptions) return;
        dispatch({ type: "clear-evidence" });
        setPickerOpen(false);
        setDetailsOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pendingRemoteRun, pendingRunOptions]);

  useEffect(
    () => () => timers.current.forEach((timer) => window.clearTimeout(timer)),
    [],
  );

  // Keep the source/result split stable: entering compare mode used to shrink
  // the source pane (0.46 → 0.38), which re-rendered the PDF page smaller.
  const splitRatio = customSplit ?? 0.46;

  const applySplitFromPointer = useCallback((clientX: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    setCustomSplit(
      Math.min(0.72, Math.max(0.24, (clientX - rect.left) / rect.width)),
    );
  }, []);

  useEffect(() => {
    if (demo) return;
    let cancelled = false;
    checkLocalRunner().then((probe) => {
      if (cancelled) return;
      setLocalRunner(probe);
    });
    return () => {
      cancelled = true;
    };
  }, [demo]);

  useEffect(() => {
    if (demo) return;
    let cancelled = false;
    loadLocalParseResults(documentId, Object.keys(LOCAL_COMPONENT_IDS))
      .catch((error) => {
        if (!cancelled) {
          toast.error("Saved run history could not be loaded.", {
            description:
              error instanceof Error
                ? error.message
                : "The browser store returned an unknown error.",
          });
        }
        return {} as Record<string, LocalParseResult>;
      })
      .then((stored) => {
        if (cancelled) return;
        for (const parser of Object.keys(
          LOCAL_COMPONENT_IDS,
        ) as ParserId[]) {
          const result = stored[parser] as LocalParseResult | undefined;
          if (!result?.parsedDocument) continue;
          setLocalRuns((current) =>
            current[parser]
              ? current
              : { ...current, [parser]: { status: "complete", result } },
          );
          dispatch({ type: "start-run", parser });
          dispatch({ type: "complete-run", parser });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [demo, documentId]);

  const recheckLocalRunner = useCallback(() => {
    setLocalRunner({ status: "checking" });
    checkLocalRunner().then(setLocalRunner);
  }, []);

  const runLocalParse = useCallback(
    async (
      parser: ParserId,
      options?: Record<string, unknown>,
      preparedDocument?: LocalDocument,
    ) => {
      if (demo) return;
      setLocalRuns((current) =>
        current[parser]?.status === "running"
          ? current
          : { ...current, [parser]: { status: "running", options } },
      );
      dispatch({ type: "start-run", parser });
      try {
        const document =
          preparedDocument ?? (await loadLocalDocument(documentId));
        if (!document) {
          throw new Error(
            "This local PDF is no longer available in the browser store.",
          );
        }
        const result = await parseWithLocalRunner(
          document.file,
          LOCAL_COMPONENT_IDS[parser],
          (progress) => {
            setLocalRuns((current) => {
              const run = current[parser];
              if (run?.status !== "running") return current;
              let stages = run.stages;
              if (
                progress.stage &&
                typeof progress.current === "number" &&
                typeof progress.total === "number"
              ) {
                const next = [...(stages ?? [])];
                const index = next.findIndex(
                  (entry) => entry.stage === progress.stage,
                );
                const entry = {
                  stage: progress.stage,
                  current: progress.current,
                  total: progress.total,
                };
                if (index === -1) next.push(entry);
                else next[index] = entry;
                stages = next;
              }
              return {
                ...current,
                [parser]: {
                  ...run,
                  phase: progress.phase,
                  detail:
                    progress.detail ??
                    (progress.phase !== run.phase ? undefined : run.detail),
                  stages,
                },
              };
            });
          },
          options,
        );
        setLocalRuns((current) => ({
          ...current,
          [parser]: { status: "complete", result },
        }));
        try {
          await saveLocalParseResult(documentId, parser, result);
        } catch (error) {
          toast.error("Run finished, but browser history was not saved.", {
            description:
              error instanceof Error
                ? error.message
                : "The browser store returned an unknown error.",
          });
        }
        dispatch({ type: "complete-run", parser });
        dispatch({ type: "set-mobile-pane", pane: "results" });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Unknown local runner error.";
        setLocalRuns((current) => ({
          ...current,
          [parser]: { status: "failed", error: message },
        }));
        dispatch({ type: "fail-run", parser });
      }
    },
    [demo, documentId],
  );

  const failRunRequest = useCallback((parser: ParserId, message: string) => {
    dispatch({ type: "start-run", parser });
    setLocalRuns((current) => ({
      ...current,
      [parser]: { status: "failed", error: message },
    }));
    dispatch({ type: "fail-run", parser });
    setRunTab(parser);
  }, []);

  /**
   * The single boundary for every real run request. Local components pass
   * through immediately. A manifest-declared remote component pauses before
   * any run state or network submission changes, loads the exact local file
   * metadata, and waits for explicit consent once per component version and
   * document in this workspace session.
   */
  const requestLocalParse = useCallback(
    async (parser: ParserId, options?: Record<string, unknown>) => {
      if (demo) return;

      const componentId = LOCAL_COMPONENT_IDS[parser];
      const component =
        localRunner.status === "ready"
          ? runnerComponent(localRunner.info, componentId)
          : null;
      if (!component) {
        failRunRequest(
          parser,
          "The local runner did not advertise this component. Check the runner and try again.",
        );
        return;
      }

      const executionPlan = deviceExecutionPlan(component);
      if (!requiresDocumentTransferConsent(executionPlan)) {
        if (pickerOpen) setPickerOpen(false);
        await runLocalParse(parser, options);
        return;
      }

      remoteConsentReturnFocus.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      try {
        const localDocument = await loadLocalDocument(documentId);
        if (!localDocument) {
          throw new Error(
            "This local PDF is no longer available in the browser store.",
          );
        }
        remoteConsentSubmitting.current = false;
        setRemoteConsentConfirming(false);
        setPendingRemoteRun({
          parser,
          options,
          component,
          executionPlan,
          document: localDocument,
          openedFromPicker: pickerOpen,
        });
      } catch (error) {
        failRunRequest(
          parser,
          error instanceof Error
            ? error.message
            : "The browser could not read this local PDF.",
        );
      }
    },
    [
      demo,
      documentId,
      failRunRequest,
      localRunner,
      pickerOpen,
      runLocalParse,
    ],
  );

  const restoreConsentFocus = useCallback((target: HTMLElement | null) => {
    window.requestAnimationFrame(() => {
      if (target?.isConnected) {
        target.focus();
        return;
      }
      document
        .querySelector<HTMLElement>(".runner-strip button:not([disabled])")
        ?.focus();
    });
  }, []);

  const cancelRemoteRun = useCallback(() => {
    if (remoteConsentSubmitting.current) return;
    const target = remoteConsentReturnFocus.current;
    remoteConsentReturnFocus.current = null;
    setPendingRemoteRun(null);
    restoreConsentFocus(target);
  }, [restoreConsentFocus]);

  const confirmRemoteRun = useCallback(() => {
    if (!pendingRemoteRun || remoteConsentSubmitting.current) return;
    remoteConsentSubmitting.current = true;
    setRemoteConsentConfirming(true);
    const request = pendingRemoteRun;
    const target = request.openedFromPicker
      ? pickerReturnFocus.current
      : remoteConsentReturnFocus.current;
    remoteConsentReturnFocus.current = null;
    setPendingRemoteRun(null);
    if (request.openedFromPicker) setPickerOpen(false);
    restoreConsentFocus(target);
    void runLocalParse(request.parser, request.options, request.document);
  }, [pendingRemoteRun, restoreConsentFocus, runLocalParse]);

  const requestRunFromStrip = useCallback(
    (
      parser: ParserId,
      component: LocalRunnerComponent | null,
      fallbackName: string,
      trigger: HTMLElement,
    ) => {
      const availability = localComponentRunAvailability(component);
      const properties = component?.optionsSchema?.properties ?? {};
      if (availability.available && Object.keys(properties).length === 0) {
        void requestLocalParse(parser);
        return;
      }
      runOptionsReturnFocus.current = trigger;
      runOptionsSubmittingRef.current = false;
      setRunOptionsSubmitting(false);
      setPendingRunOptions({
        parser,
        componentName: component?.displayName?.trim() || fallbackName,
        schema: component?.optionsSchema ?? null,
        availability,
      });
    },
    [requestLocalParse],
  );

  const cancelRunOptions = useCallback(() => {
    if (runOptionsSubmittingRef.current) return;
    const target = runOptionsReturnFocus.current;
    runOptionsReturnFocus.current = null;
    setPendingRunOptions(null);
    restoreConsentFocus(target);
  }, [restoreConsentFocus]);

  const confirmRunOptions = useCallback(
    (options: Record<string, unknown>) => {
      if (!pendingRunOptions || runOptionsSubmittingRef.current) return;
      runOptionsSubmittingRef.current = true;
      setRunOptionsSubmitting(true);
      const request = pendingRunOptions;
      const target = runOptionsReturnFocus.current;
      runOptionsReturnFocus.current = null;
      if (target?.isConnected) target.focus();
      setPendingRunOptions(null);
      void requestLocalParse(request.parser, options);
    },
    [pendingRunOptions, requestLocalParse],
  );

  function retrySelectedParser() {
    if (effectiveTab === null || effectiveTab === "compare") return;
    void requestLocalParse(effectiveTab);
  }

  function runMineruFallback() {
    void requestLocalParse("mineru");
  }

  const liveMessage = useMemo(() => {
    if (state.runs.mineru === "running") return "MinerU is parsing the document.";
    if (state.runs.opendataloader === "running") {
      return "OpenDataLoader is parsing the document.";
    }
    if (comparing) return "Two parser results are ready to compare.";
    if (state.runs.opendataloader === "complete") {
      return "OpenDataLoader result is ready.";
    }
    return "Document is ready to parse.";
  }, [comparing, state.runs]);

  function runParser(parser: ParserId) {
    dispatch({ type: "start-run", parser });
    setPickerOpen(false);
    const timer = window.setTimeout(() => {
      dispatch({ type: "complete-run", parser });
      dispatch({ type: "set-mobile-pane", pane: "results" });
    }, parser === "mineru" ? 1900 : 1500);
    timers.current.push(timer);
  }

  function activateEvidence(next: string | null) {
    dispatch({ type: "activate-evidence", evidence: next });
  }

  function pinEvidence(next: string) {
    dispatch({ type: "pin-evidence", evidence: next });
  }

  function isKnownEvidence(id: string) {
    return demo
      ? id in evidenceLabels
      : localRegions.some((region) => region.id === id);
  }

  function activateSourceEvidence(next: string | null) {
    activateEvidence(next && isKnownEvidence(next) ? next : null);
  }

  function pinSourceEvidence(next: string) {
    if (isKnownEvidence(next)) {
      pinFromSource.current = true;
      pinEvidence(next);
    }
  }

  // A pin from the source PDF scrolls the results to the matching block.
  useEffect(() => {
    if (demo || !pinFromSource.current) return;
    pinFromSource.current = false;
    const pinned = state.pinnedEvidence;
    if (!pinned) return;
    const container = resultsScrollRef.current;
    const target = container?.querySelector<HTMLElement>(
      `[data-evidence-id="${CSS.escape(pinned)}"]`,
    );
    target?.scrollIntoView({
      block: "center",
      behavior: preferredScrollBehavior(),
    });
  }, [state.pinnedEvidence, demo]);

  // Scrolling the results moves the source PDF to whichever page section sits
  // nearest the top of the scroll area (throttled to one read per frame).
  function handleResultsScroll() {
    if (demo || pageSyncSource.current === "page") return;
    if (pageSyncRaf.current !== null) return;
    pageSyncRaf.current = window.requestAnimationFrame(() => {
      pageSyncRaf.current = null;
      const container = resultsScrollRef.current;
      if (!container) return;
      const containerTop = container.getBoundingClientRect().top;
      let nearest: number | null = null;
      let nearestDist = Infinity;
      container
        .querySelectorAll<HTMLElement>(".md-page[data-page]")
        .forEach((section) => {
          const dist = Math.abs(
            section.getBoundingClientRect().top - containerTop,
          );
          if (dist < nearestDist) {
            nearestDist = dist;
            nearest = Number(section.dataset.page);
          }
        });
      if (nearest && nearest !== state.page) {
        pageSyncSource.current = "scroll";
        dispatch({
          type: "set-page",
          page: nearest,
          source: "synchronization",
        });
      }
    });
  }

  // When the page changes from elsewhere (PDF scroll, thumbnails, a pinned
  // block), bring the matching results section to the top — unless the change
  // originated from the results scroll itself, to avoid a feedback loop.
  useEffect(() => {
    if (demo) return;
    if (pageSyncSource.current === "scroll") {
      pageSyncSource.current = null;
      return;
    }
    const container = resultsScrollRef.current;
    if (!container) return;
    const target = container.querySelector<HTMLElement>(
      `.md-page[data-page="${state.page}"]`,
    );
    if (!target) return;
    pageSyncSource.current = "page";
    target.scrollIntoView({
      block: "start",
      behavior: preferredScrollBehavior(),
    });
    const timer = window.setTimeout(() => {
      pageSyncSource.current = null;
    }, 500);
    return () => window.clearTimeout(timer);
  }, [state.page, demo]);

  // The result body for one parser, honoring the Blocks/Markdown and
  // Rendered/Raw toggles. Shared by the single-parser view and each column of
  // the compare view so both stay in sync.
  function renderResultBody(parser: ParserId, result: LocalParseResult) {
    const parserName = PARSER_DISPLAY[parser];
    const letter = PARSER_LETTER[parser];
    const accent = PARSER_ACCENT[parser];
    if (localView === "blocks") {
      return viewMode === "raw" ? (
        <BlockRawView
          result={result}
          parserName={parserName}
          letter={letter}
          accent={accent}
        />
      ) : (
        <BlockReadingView
          documentId={documentId}
          result={result}
          parserName={parserName}
          letter={letter}
          accent={accent}
          page={state.page}
          merge={mergeRegions}
          evidence={evidence}
          pinned={state.pinnedEvidence}
          onActivate={activateEvidence}
          onPin={pinEvidence}
          onNavigatePage={(nextPage) =>
            dispatch({
              type: "set-page",
              page: nextPage,
              source: "synchronization",
            })
          }
        />
      );
    }
    return (
      <MarkdownView
        mode={viewMode}
        result={result}
        parserName={parserName}
        letter={letter}
        accent={accent}
      />
    );
  }

  return (
    <main
      className="workspace-shell"
      data-mobile-pane={state.mobilePane}
      data-comparing={comparing || undefined}
      data-no-dock={!demo || undefined}
    >
      <AppHeader
        title={<span title={displayFileName}>{displayFileName}</span>}
        meta={`${state.pageCount ? `${state.pageCount} pages` : "Reading pages"} · PDF`}
        actions={
          <>
          <ModeToggle />
          {demo && state.runs.opendataloader === "complete" && (
            <button
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "add-parser-button")}
              type="button"
              onClick={() => setPickerOpen(true)}
              disabled={state.runs.mineru !== "idle"}
            >
              <span aria-hidden="true">＋</span>
              Run another parser
            </button>
          )}
          <Link className={buttonVariants({ variant: "secondary", size: "sm" })} href="/arena">
            Arena
          </Link>
          <button
            className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
            type="button"
            aria-label="Open run details"
            onClick={() => setDetailsOpen(true)}
          >
            •••
          </button>
          </>
        }
      />

      <div className="mobile-pane-switcher" role="tablist" aria-label="Workspace pane">
        <button
          role="tab"
          aria-selected={state.mobilePane === "source"}
          onClick={() => dispatch({ type: "set-mobile-pane", pane: "source" })}
        >
          Source
        </button>
        <button
          role="tab"
          aria-selected={state.mobilePane === "results"}
          onClick={() => dispatch({ type: "set-mobile-pane", pane: "results" })}
        >
          Results
          {state.runs.opendataloader === "complete" && <span className="tab-dot" />}
        </button>
      </div>

      <div
        ref={canvasRef}
        className="workspace-canvas"
        data-resizable
        data-dragging={splitDragging || undefined}
        data-source-collapsed={sourceCollapsed || undefined}
        style={{
          gridTemplateColumns: sourceCollapsed
            ? "40px 1px minmax(360px, 1fr)"
            : `minmax(300px, ${splitRatio}fr) 1px minmax(360px, ${1 - splitRatio}fr)`,
        }}
      >
        {sourceCollapsed ? (
          <section className="source-pane source-rail" aria-label="Source PDF (collapsed)">
            <button
              type="button"
              className="source-rail-toggle"
              aria-label="Expand the source panel"
              title="Expand the source panel"
              onClick={() => setSourceCollapsed(false)}
            >
              ›
            </button>
            <span className="source-rail-label">Original file</span>
          </section>
        ) : (
        <section className="source-pane" aria-label="Source PDF">
          <div className="pane-toolbar">
            <div className="source-title">
              <button
                type="button"
                className="source-collapse-toggle"
                aria-label="Collapse the source panel"
                title="Collapse the source panel to widen the results"
                onClick={() => setSourceCollapsed(true)}
              >
                ‹
              </button>
              <strong>Original file</strong>
              {!demo && hasNativeMapping && (
                <div
                  className="view-toggle region-toggle"
                  role="tablist"
                  aria-label="Evidence region mode"
                >
                  <button
                    role="tab"
                    type="button"
                    aria-selected={!mergeRegions}
                    title="Show each parser-native region exactly as reported"
                    onClick={() => setMergeRegions(false)}
                  >
                    Native
                  </button>
                  <button
                    role="tab"
                    type="button"
                    aria-selected={mergeRegions}
                    title="Union a table's native regions into one highlight"
                    onClick={() => setMergeRegions(true)}
                  >
                    Merged
                  </button>
                </div>
              )}
            </div>
            <div className="source-controls" aria-label="Page controls">
              <button
                className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }), "thumbnail-toggle")}
                type="button"
                aria-label={thumbnailsOpen ? "Hide page thumbnails" : "Show page thumbnails"}
                aria-expanded={thumbnailsOpen}
                aria-controls="pdf-thumbnail-rail"
                title={thumbnailsOpen ? "Hide page thumbnails" : "Show page thumbnails"}
                onClick={() => setThumbnailsOpen((open) => !open)}
              >
                ▤
              </button>
              <Separator orientation="vertical" className="control-separator" />
              <button
                type="button"
                className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
                aria-label="Previous page"
                onClick={() =>
                  dispatch({
                    type: "set-page",
                    page: state.page - 1,
                    source: "navigation",
                  })
                }
                disabled={state.page <= 1}
              >
                ‹
              </button>
              <span>
                <b>{state.page}</b> / {state.pageCount ?? "—"}
              </span>
              <button
                type="button"
                className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
                aria-label="Next page"
                onClick={() =>
                  dispatch({
                    type: "set-page",
                    page: state.page + 1,
                    source: "navigation",
                  })
                }
                disabled={!state.pageCount || state.page >= state.pageCount}
              >
                ›
              </button>
              <Separator orientation="vertical" className="control-separator" />
              <button
                type="button"
                className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
                aria-label="Zoom out"
                disabled={zoom <= 50}
                onClick={() => setZoom((value) => Math.max(50, value - 10))}
              >−</button>
              <span>{zoom}%</span>
              <button
                type="button"
                className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
                aria-label="Zoom in"
                disabled={zoom >= 200}
                onClick={() => setZoom((value) => Math.min(200, value + 10))}
              >＋</button>
            </div>
          </div>

          <div className="pdf-stage">
            {evidence && evidenceLabel && (
              <div
                className="evidence-pill"
                data-pinned={state.pinnedEvidence || undefined}
                role="status"
              >
                <span>
                  {state.pinnedEvidence ? "Pinned · " : ""}
                  {evidenceLabel}
                </span>
                {state.pinnedEvidence && (
                  <button
                    type="button"
                    aria-label="Clear pinned evidence"
                    onClick={() => dispatch({ type: "clear-evidence" })}
                  >
                    ×
                  </button>
                )}
              </div>
            )}
            <PdfSourceViewer
              key={documentId}
              documentId={documentId}
              sample={sample || demo}
              pageNumber={state.page}
              zoom={zoom}
              thumbnailsOpen={thumbnailsOpen}
              regions={sourceRegions}
              regionParserId="*"
              activeEvidence={evidence}
              pinnedEvidence={state.pinnedEvidence}
              comparing={comparing}
              onPageCountChange={handlePageCountChange}
              onPageChange={handlePageChange}
              onFileNameChange={handleFileNameChange}
              onActivateEvidence={activateSourceEvidence}
              onPinEvidence={pinSourceEvidence}
            />
          </div>
        </section>
        )}

        <div
          className="pane-divider"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the source and result panes"
          tabIndex={0}
          data-active={splitDragging || undefined}
          data-inert={sourceCollapsed || undefined}
          onPointerDown={(event) => {
            if (sourceCollapsed) return;
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            setSplitDragging(true);
          }}
          onPointerMove={(event) => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
            applySplitFromPointer(event.clientX);
          }}
          onPointerUp={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
            setSplitDragging(false);
          }}
          onPointerCancel={() => setSplitDragging(false)}
          onDoubleClick={() => setCustomSplit(null)}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault();
              const delta = event.key === "ArrowLeft" ? -0.03 : 0.03;
              setCustomSplit(
                Math.min(0.72, Math.max(0.24, splitRatio + delta)),
              );
            }
          }}
        />

        <section className="results-pane" aria-label="Parser results">
          {!demo && (
            <RunnerStrip
              runner={localRunner}
              runs={state.runs}
              localRuns={localRuns}
              activeTab={effectiveTab}
              canCompareRuns={completedParsers.length >= 2}
              onSelect={setRunTab}
              onRequestRun={requestRunFromStrip}
              onOptions={() => {
                pickerReturnFocus.current =
                  document.activeElement instanceof HTMLElement
                    ? document.activeElement
                    : null;
                setPickerOpen(true);
              }}
              onRecheck={recheckLocalRunner}
            />
          )}

          {demo && state.runs.opendataloader === "idle" && (
            <EmptyResult
              onRun={() => runParser("opendataloader")}
              onChoose={() => setPickerOpen(true)}
            />
          )}
          {demo && state.runs.opendataloader === "running" && (
            <RunningResult
              parser="OpenDataLoader"
              detail="Reading page structure locally"
            />
          )}
          {demo && state.runs.opendataloader === "complete" && (
            <div className="result-ready-shell">
              {(!hasNativeMapping || comparing) && (
                <div className="pane-toolbar result-toolbar">
                  <div className="result-heading">
                    {!hasNativeMapping ? (
                      <span className="mapping-status" data-unavailable>
                        <span aria-hidden="true" />
                        No source mapping on this page
                      </span>
                    ) : comparing ? (
                      <span className="mapping-status" data-partial>
                        <span aria-hidden="true" />
                        B has no source mapping
                      </span>
                    ) : null}
                  </div>
                </div>
              )}
              <div className="results-scroll">
                {state.runs.mineru === "running" && (
                  <div className="inline-run-status" role="status">
                    <span className="spinner" aria-hidden="true" />
                    <div>
                      <strong>MinerU is parsing</strong>
                      <span>Layout analysis · the first result stays available</span>
                    </div>
                  </div>
                )}
                <div className="result-columns" data-columns={comparing ? 2 : 1}>
                  <ParserResult
                    parser="OpenDataLoader"
                    version="2.5.0"
                    timing="4.2s"
                    accent="indigo"
                    evidence={evidence as EvidenceId | null}
                    pinned={state.pinnedEvidence}
                    onActivate={activateEvidence}
                    onPin={pinEvidence}
                    mappingAvailable={hasNativeMapping}
                  />
                </div>
              </div>
            </div>
          )}

          {!demo && effectiveTab === null && (
            <LocalIdleHint runner={localRunner} onRecheck={recheckLocalRunner} />
          )}

          {!demo && effectiveTab === "compare" && comparing && (
            <div className="result-ready-shell">
              <ResultViewToolbar
                mappingAvailable={hasNativeMapping}
                localView={localView}
                viewMode={viewMode}
                onLocalViewChange={setLocalView}
                onViewModeChange={setViewMode}
                controlsId={resultViewId}
              />
              <div
                id={resultViewId}
                className="results-scroll"
                ref={resultsScrollRef}
                onScroll={handleResultsScroll}
              >
                <div
                  className="result-columns"
                  data-columns={completedParsers.length}
                >
                  {completedParsers.map((parser) => {
                    const result = resultFor(parser);
                    if (!result) return null;
                    return (
                      <div key={parser} className="result-compare-column">
                        {renderResultBody(parser, result)}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {!demo &&
            effectiveTab !== null &&
            effectiveTab !== "compare" &&
            (() => {
              const parser = effectiveTab as ParserId;
              const run = localRuns[parser];
              const parserName = PARSER_DISPLAY[parser];
              if (run?.status === "running") {
                return (
                  <LocalRunningResult
                    fileName={displayFileName}
                    parser={parserName}
                    run={run}
                  />
                );
              }
              if (run?.status === "failed") {
                return (
                  <LocalFailedResult
                    error={run.error}
                    onRetry={retrySelectedParser}
                    mineruAvailable={
                      parser === "opendataloader" &&
                      localRunner.status === "ready" &&
                      runnerComponent(localRunner.info, "mineru-pipeline")
                        ?.imageAvailable === true &&
                      state.runs.mineru === "idle"
                    }
                    onRunMineru={runMineruFallback}
                  />
                );
              }
              if (run?.status !== "complete") return null;
              const result = run.result;
              return (
                <div className="result-ready-shell">
                  <ResultViewToolbar
                    mappingAvailable={hasNativeMapping}
                    localView={localView}
                    viewMode={viewMode}
                    onLocalViewChange={setLocalView}
                    onViewModeChange={setViewMode}
                    controlsId={resultViewId}
                  />
                  <div
                    id={resultViewId}
                    className="results-scroll"
                    ref={resultsScrollRef}
                    onScroll={handleResultsScroll}
                  >
                    <div className="result-columns" data-columns={1}>
                      {renderResultBody(parser, result)}
                    </div>
                  </div>
                </div>
              );
            })()}
        </section>
      </div>

      {demo && (
      <footer className="run-dock" aria-label="Parser runs">
        <div className="run-list">
          <button
            className="run-chip"
            type="button"
            data-selected="true"
            title="Open run details"
            onClick={() => setDetailsOpen(true)}
          >
            <StatusDot status={state.runs.opendataloader} />
            <span>OpenDataLoader</span>
            <small>{formatStatus(state.runs.opendataloader, "4.2s")}</small>
          </button>
          {state.runs.mineru !== "idle" && (
            <button
              className="run-chip"
              type="button"
              data-selected={comparing || undefined}
              title="Open run details"
              onClick={() => setDetailsOpen(true)}
            >
              <StatusDot status={state.runs.mineru} />
              <span>MinerU</span>
              <small>{formatStatus(state.runs.mineru, "11.8s")}</small>
            </button>
          )}
        </div>
        <button className="details-button" type="button" onClick={() => setDetailsOpen(true)}>
          Details &amp; artifacts
          <span aria-hidden="true">›</span>
        </button>
      </footer>
      )}

      <p className="visually-hidden" aria-live="polite">{liveMessage}</p>

      {pickerOpen &&
        (demo ? (
          <ParserSheet
            runs={state.runs}
            onClose={() => setPickerOpen(false)}
            onRun={runParser}
          />
        ) : (
          localRunner.status === "ready" && (
            <LocalParserSheet
              info={localRunner.info}
              runs={state.runs}
              onClose={() => setPickerOpen(false)}
              onRun={(parser, options) => {
                void requestLocalParse(parser, options);
              }}
            />
          )
        ))}
      {detailsOpen && (
        <DetailsSheet
          demo={demo}
          entries={completedParsers
            .map((parser) => {
              const result = resultFor(parser);
              return result
                ? { title: PARSER_DISPLAY[parser], result }
                : null;
            })
            .filter(Boolean) as { title: string; result: LocalParseResult }[]}
          onClose={() => setDetailsOpen(false)}
        />
      )}
      {pendingRunOptions && (
        <RunOptionsDialog
          componentName={pendingRunOptions.componentName}
          schema={pendingRunOptions.schema}
          availability={pendingRunOptions.availability}
          submitting={runOptionsSubmitting}
          onCancel={cancelRunOptions}
          onConfirm={confirmRunOptions}
        />
      )}
      {pendingRemoteRun && (
        <RemoteRunConsentDialog
          component={pendingRemoteRun.component}
          executionPlan={pendingRemoteRun.executionPlan}
          fileName={pendingRemoteRun.document.file.name}
          fileSize={pendingRemoteRun.document.file.size}
          confirming={remoteConsentConfirming}
          onCancel={cancelRemoteRun}
          onConfirm={confirmRemoteRun}
        />
      )}
    </main>
  );
}

export function RemoteRunConsentDialog({
  component,
  executionPlan,
  fileName,
  fileSize,
  confirming,
  onCancel,
  onConfirm,
}: {
  component: LocalRunnerComponent;
  executionPlan: ExecutionPlan;
  fileName: string;
  fileSize: number;
  confirming: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const displayName = component.displayName?.trim() || component.id;
  const connectionType = runnerConnectionType(component);
  const retention = executionPlan.retentionSeconds
    ? `${Math.ceil(executionPlan.retentionSeconds / 3600)} hours maximum`
    : null;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => cancelRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  return (
    <div
      className="remote-consent-backdrop"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        className="remote-consent-dialog"
        role="dialog"
        aria-modal="true"
        aria-busy={confirming}
        aria-labelledby="remote-consent-title"
        aria-describedby="remote-consent-description remote-consent-warning"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
            return;
          }
          if (event.key !== "Tab") return;
          const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          );
          if (!focusable || focusable.length === 0) return;
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <p className="eyebrow">Document transfer review</p>
        <h2 id="remote-consent-title">
          Send this PDF to {executionPlan.destinationName}?
        </h2>
        <p id="remote-consent-description">
          The complete PDF will leave this device before {displayName} starts.
          This approval applies only to this run.
        </p>
        <dl className="remote-consent-details">
          <div>
            <dt>Document</dt>
            <dd>{fileName}</dd>
          </div>
          <div>
            <dt>Exact size</dt>
            <dd>{fileSize.toLocaleString("en-US")} bytes</dd>
          </div>
          <div>
            <dt>Component</dt>
            <dd>{displayName}</dd>
          </div>
          <div>
            <dt>Execution</dt>
            <dd>
              {executionPlan.location === "hosted" ? "Hosted" : "On this device"}
            </dd>
          </div>
          {executionPlan.region && (
            <div>
              <dt>Region</dt>
              <dd>{executionPlan.region}</dd>
            </div>
          )}
          {retention && (
            <div>
              <dt>Temporary retention</dt>
              <dd>{retention}</dd>
            </div>
          )}
          {connectionType && (
            <div>
              <dt>Connection type</dt>
              <dd>{connectionType}</dd>
            </div>
          )}
        </dl>
        <p id="remote-consent-warning" className="remote-consent-warning">
          Provider billing may apply. Document Arena cannot verify the external
          provider&apos;s logging or retention, so review your provider agreement
          before continuing. No connection secrets are displayed or added to
          the run record.
        </p>
        <p className="remote-consent-session-note">
          Retrying or starting another run asks again before the PDF is sent.
        </p>
        <div className="remote-consent-actions">
          <button
            ref={cancelRef}
            className={buttonVariants({ variant: "outline" })}
            type="button"
            disabled={confirming}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className={buttonVariants()}
            type="button"
            disabled={confirming}
            onClick={onConfirm}
          >
            {confirming ? "Starting…" : "Send and run"}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatStatus(status: string, timing: string) {
  if (status === "complete") return `Complete · ${timing}`;
  if (status === "running") return "Parsing…";
  if (status === "failed") return "Failed";
  return "Not run";
}

// MinerU 3.x reports page-level progress ("Processing pages n/N"); any other
// stages it prints (OCR passes on scanned docs) are appended as observed.
const MINERU_STAGE_LABELS: readonly (readonly [string, string])[] = [
  ["Processing pages", "Processing pages"],
];

function mineruStagePlan(options?: Record<string, unknown>) {
  return MINERU_STAGE_LABELS.filter(([key]) => {
    if (options?.formula === false && key.startsWith("MF")) return false;
    if (options?.table === false && key === "Table Predict") return false;
    return true;
  });
}

function stageSummary(run: LocalParserRun | undefined): string | null {
  if (run?.status !== "running") return null;
  const stages = run.stages ?? [];
  const active = [...stages].reverse().find((entry) => entry.current < entry.total)
    ?? stages[stages.length - 1];
  if (!active) return run.detail ?? (run.phase ? `Phase: ${run.phase}` : null);
  const plan = mineruStagePlan(run.options);
  const planIndex = plan.findIndex(([key]) => key === active.stage);
  const label =
    plan.find(([key]) => key === active.stage)?.[1] ?? active.stage;
  const position =
    planIndex === -1 ? "" : ` · step ${planIndex + 1}/${plan.length}`;
  return `${label} ${active.current}/${active.total}${position}`;
}

function StageChecklist({ run }: { run: LocalParserRun }) {
  if (run.status !== "running") return null;
  const stages = run.stages ?? [];
  const plan = mineruStagePlan(run.options);
  const known = new Set(plan.map(([key]) => key));
  const extras = stages.filter((entry) => !known.has(entry.stage));
  const rows = [
    ...plan.map(([key, label]) => ({ key, label })),
    ...extras.map((entry) => ({ key: entry.stage, label: entry.stage })),
  ];
  const activeKey = [...stages]
    .reverse()
    .find((entry) => entry.current < entry.total)?.stage
    ?? stages[stages.length - 1]?.stage;

  return (
    <div className="stage-checklist" aria-label="Parser stages">
      {rows.map(({ key, label }) => {
        const observed = stages.find((entry) => entry.stage === key);
        const done = observed ? observed.current >= observed.total : false;
        const active = key === activeKey && !done;
        return (
          <div
            key={key}
            className="stage-row"
            data-done={done || undefined}
            data-active={active || undefined}
          >
            <span className="stage-mark" aria-hidden="true">
              {done ? "✓" : active ? "●" : "○"}
            </span>
            <span className="stage-label">{label}</span>
            <span className="stage-count">
              {observed ? `${observed.current}/${observed.total}` : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function RunnerStrip({
  runner,
  runs,
  localRuns,
  activeTab,
  canCompareRuns,
  onSelect,
  onRequestRun,
  onOptions,
  onRecheck,
}: {
  runner: LocalRunnerState;
  runs: Record<ParserId, string>;
  localRuns: Partial<Record<ParserId, LocalParserRun>>;
  activeTab: ParserId | "compare" | null;
  canCompareRuns: boolean;
  onSelect: (tab: ParserId | "compare") => void;
  onRequestRun: (
    parser: ParserId,
    component: LocalRunnerComponent | null,
    fallbackName: string,
    trigger: HTMLElement,
  ) => void;
  onOptions: () => void;
  onRecheck: () => void;
}) {
  if (runner.status === "checking") {
    return (
      <div className="runner-strip" role="status">
        <span className="strip-note">
          <span className="spinner" aria-hidden="true" /> Looking for the local
          runner…
        </span>
      </div>
    );
  }
  if (runner.status === "unreachable" || runner.status === "failing") {
    return (
      <div className="runner-strip">
        <span className="strip-note">
          {runner.status === "failing" ? (
            <>Local runner {runner.detail} · running but not usable</>
          ) : (
            <>
              No answer from the local runner · start it, or restart one already
              holding the port, with <code>make runner-serve</code>
            </>
          )}
        </span>
        <button className={cn(buttonVariants({ variant: "outline", size: "sm" }), "strip-action")} type="button" onClick={onRecheck}>
          Check again
        </button>
      </div>
    );
  }

  const entries = (Object.keys(LOCAL_COMPONENT_IDS) as ParserId[]).map(
    (parser) => ({
      parser,
      component: runnerComponent(runner.info, LOCAL_COMPONENT_IDS[parser]),
      meta: LOCAL_PARSER_META[parser],
      status: runs[parser],
      run: localRuns[parser],
    }),
  );

  return (
    <div className="runner-strip" aria-label="Parser runs">
      {entries.map((entry) => {
        const letter = entry.parser === "mineru" ? "B" : "A";
        const result =
          entry.run?.status === "complete" ? entry.run.result : null;
        if (entry.status === "complete" && result) {
          const coverage =
            result.blockCount > 0
              ? Math.round(
                  (result.nativeRegionCount / result.blockCount) * 100,
                )
              : 0;
          return (
            <button
              key={entry.parser}
              className="strip-chip"
              type="button"
              data-parser={entry.parser}
              data-state="complete"
              data-selected={activeTab === entry.parser || undefined}
              title={`Show the ${entry.component?.displayName ?? entry.parser} result`}
              onClick={() => onSelect(entry.parser)}
            >
              <span className="strip-letter">{letter}</span>
              <span className="strip-name">
                {entry.component?.displayName ?? entry.parser}
              </span>
              <small>
                {(result.durationMs / 1000).toFixed(1)}s · {coverage}% bbox
              </small>
            </button>
          );
        }
        if (entry.status === "running") {
          return (
            <button
              key={entry.parser}
              className="strip-chip"
              type="button"
              data-parser={entry.parser}
              data-state="running"
              data-selected={activeTab === entry.parser || undefined}
              title="Show stage progress"
              onClick={() => onSelect(entry.parser)}
            >
              <span className="spinner" aria-hidden="true" />
              <span className="strip-name">
                {entry.component?.displayName ?? entry.parser}
              </span>
              <small>
                {stageSummary(entry.run) ??
                  (entry.run?.status === "running" && entry.run.phase
                    ? `Phase: ${entry.run.phase}`
                    : "Starting…")}
              </small>
            </button>
          );
        }
        if (entry.status === "failed") {
          const error =
            entry.run?.status === "failed" ? entry.run.error : undefined;
          return (
            <button
              key={entry.parser}
              className="strip-chip"
              type="button"
              data-parser={entry.parser}
              data-state="failed"
              data-selected={activeTab === entry.parser || undefined}
              title={error ?? "Show failure details"}
              onClick={() => onSelect(entry.parser)}
            >
              <span className="strip-name">
                {entry.component?.displayName ?? entry.parser}
              </span>
              <small>Failed · Retry</small>
            </button>
          );
        }
        const properties = entry.component?.optionsSchema?.properties ?? {};
        const hasOptions = Object.keys(properties).length > 0;
        const availability = localComponentRunAvailability(entry.component);
        const opensDialog = hasOptions || !availability.available;
        return (
          <span
            key={entry.parser}
            className="strip-chip"
            data-parser={entry.parser}
            data-state="idle"
            data-unavailable={!availability.available || undefined}
          >
            <span className="strip-name">
              {entry.component?.displayName ?? entry.parser}
            </span>
            <small>
              {availability.available ? entry.meta.runtime : "Unavailable"}
            </small>
            <button
              className={cn(buttonVariants({ size: "xs" }), "strip-run")}
              type="button"
              aria-haspopup={opensDialog ? "dialog" : undefined}
              title={availability.disabledReason ?? "Run this parser"}
              onClick={(event) =>
                onRequestRun(
                  entry.parser,
                  entry.component,
                  entry.component?.displayName ?? entry.parser,
                  event.currentTarget,
                )
              }
            >
              Run
            </button>
          </span>
        );
      })}
      {canCompareRuns && (
        <button
          className="strip-chip"
          type="button"
          data-state="compare"
          data-selected={activeTab === "compare" || undefined}
          title="Show both results side by side"
          onClick={() => onSelect("compare")}
        >
          <span className="strip-name">⇄ Compare</span>
        </button>
      )}
      <button
        className={cn(buttonVariants({ variant: "outline", size: "sm" }), "strip-action")}
        type="button"
        onClick={onOptions}
        title="Browse every parser and its run details"
      >
        All parsers…
      </button>
    </div>
  );
}

function LocalIdleHint({
  runner,
  onRecheck,
}: {
  runner: LocalRunnerState;
  onRecheck: () => void;
}) {
  if (runner.status === "unreachable" || runner.status === "failing") {
    const failing = runner.status === "failing";
    return (
      <div className="empty-result local-source-ready">
        <div className="empty-result-visual" aria-hidden="true">
          <span className="empty-result-page" />
          <span className="empty-result-block one" />
          <span className="empty-result-block two" />
          <span className="empty-result-block three" />
        </div>
        <p className="eyebrow">Local source ready</p>
        <h2>
          {failing
            ? "The local runner is answering, but not with a result."
            : "The PDF is open. Parsing needs the local runner."}
        </h2>
        {/* "Offline" sent people who had already started a runner looking in
            the wrong place. A crashed runner's error page carries no CORS
            headers, so the browser blocks it and this probe cannot tell it
            apart from nothing listening — so the copy names both cases instead
            of asserting the one it cannot verify. */}
        <p>
          {failing ? (
            <>
              It {runner.detail}. Restart it, then check again:
            </>
          ) : (
            <>
              Your document stays on this device. Nothing usable answered on the
              runner port — either it is not started, or a process from an older
              checkout is still holding it. Start or restart it, then check
              again:
            </>
          )}
        </p>
        <pre className="local-runner-command">make runner-serve</pre>
        <div className="empty-result-actions">
          <button className={buttonVariants()} type="button" onClick={onRecheck}>
            Check again
          </button>
        </div>
        <span className="empty-result-meta">
          Device-local · no parser result invented
        </span>
      </div>
    );
  }
  return (
    <div className="empty-result idle-hint">
      <div className="empty-result-visual" aria-hidden="true">
        <span className="empty-result-page" />
        <span className="empty-result-block one" />
        <span className="empty-result-block two" />
        <span className="empty-result-block three" />
      </div>
      <p className="eyebrow">Ready to parse</p>
      <h2>Pick a parser above.</h2>
      <p>
        Each run executes in an isolated local container and appends its own
        result; the source is never modified.
      </p>
      <span className="empty-result-meta">
        Local Docker · network disabled · runs are append-only
      </span>
    </div>
  );
}

const RUN_PHASES = ["inspecting", "parsing", "normalizing"] as const;

function PhaseList({ phase }: { phase?: string }) {
  const activeIndex = phase ? RUN_PHASES.indexOf(phase as never) : -1;
  return (
    <div className="phase-list">
      {RUN_PHASES.map((name, index) => (
        <span
          key={name}
          data-done={(activeIndex > index || undefined) as true | undefined}
          data-active={(activeIndex === index || undefined) as true | undefined}
        >
          <b>{index + 1}</b> {name.charAt(0).toUpperCase() + name.slice(1)}
        </span>
      ))}
    </div>
  );
}

function LocalRunningResult({
  fileName,
  parser,
  run,
}: {
  fileName: string;
  parser: string;
  run?: LocalParserRun;
}) {
  const phase = run?.status === "running" ? run.phase : undefined;
  const detail = run?.status === "running" ? run.detail : undefined;
  return (
    <div className="running-result" role="status">
      <div className="running-orbit" aria-hidden="true"><span /></div>
      <p className="eyebrow">Parsing on this device</p>
      <h2>{parser} is reading the source.</h2>
      <p>
        {fileName} is being parsed in an isolated local container. Long or
        scanned documents can take a while; this page stays usable.
      </p>
      {parser === "MinerU" && run?.status === "running" ? (
        <StageChecklist run={run} />
      ) : (
        <PhaseList phase={phase} />
      )}
      {parser !== "MinerU" && detail && (
        <span className="run-progress-detail">{detail}</span>
      )}
      <span className="empty-result-meta">
        These are the parser&apos;s own progress events · nothing is estimated
      </span>
    </div>
  );
}

function LocalFailedResult({
  error,
  onRetry,
  mineruAvailable = false,
  onRunMineru,
}: {
  error: string;
  onRetry: () => void;
  mineruAvailable?: boolean;
  onRunMineru?: () => void;
}) {
  const emptyOutput = /empty/i.test(error);
  return (
    <div className="empty-result" role="alert">
      <p className="eyebrow">Run failed</p>
      <h2>
        {emptyOutput
          ? "The parser found no extractable text."
          : "The local parse did not complete."}
      </h2>
      <p className="local-run-error">{error}</p>
      {emptyOutput && (
        <p>
          This profile runs OpenDataLoader without OCR, so scanned or
          image-only PDFs yield no text. MinerU runs with OCR and can read
          them.
        </p>
      )}
      <div className="empty-result-actions">
        {mineruAvailable && onRunMineru && (
          <button className={buttonVariants()} type="button" onClick={onRunMineru}>
            Run MinerU (OCR)
          </button>
        )}
        <button
          className={buttonVariants({ variant: mineruAvailable ? "outline" : "default" })}
          type="button"
          onClick={onRetry}
        >
          Retry OpenDataLoader
        </button>
      </div>
      <span className="empty-result-meta">
        The source PDF is unchanged; retrying starts a fresh run.
      </span>
    </div>
  );
}

// Markdown rendering plugins. remark-gfm handles pipe tables and strikethrough;
// rehype-raw parses the HTML <table> blocks Azure DI and MinerU emit; then
// rehype-sanitize strips anything unsafe (the Markdown comes from an arbitrary
// uploaded document, so it must not be trusted as HTML).
const MARKDOWN_REMARK_PLUGINS = [remarkGfm];
const MARKDOWN_REHYPE_PLUGINS = [rehypeRaw, rehypeSanitize];
// Azure DI marks page boundaries in its Markdown; MinerU/OpenDataLoader do not.
const PAGE_BREAK_RE = /<!--\s*PageBreak\s*-->/i;

// The Markdown view: the parser's own Markdown string. Rendered runs it through
// react-markdown (real headings/tables, split on Azure DI page breaks); Raw
// shows the string verbatim. This is not geometry-linked — hover lives in the
// Blocks view — so it stays a faithful rendering of exactly what the parser
// wrote, escapes and all (e.g. Azure DI's "2022\. 11\." renders as "2022. 11.").
const MarkdownView = memo(function MarkdownView({
  mode,
  result,
  parserName = "OpenDataLoader",
  letter = "A",
  accent = "indigo",
}: {
  mode: "rendered" | "raw";
  result: LocalParseResult;
  parserName?: string;
  letter?: string;
  accent?: "indigo" | "amber" | "teal";
}) {
  const markdown = (result.parsedDocument.markdown ?? "").trim();
  const pageChunks = useMemo(
    () => markdown.split(PAGE_BREAK_RE).map((part) => part.trim()),
    [markdown],
  );

  return (
    <article className="parser-result" data-accent={accent}>
      <header className="parser-result-header">
        <div>
          <span className="parser-letter">{letter}</span>
          <div>
            <h2>{parserName}</h2>
            <p>
              {mode === "raw"
                ? "Markdown · raw parser output"
                : "Markdown · rendered from the parser's own Markdown"}
            </p>
          </div>
        </div>
        <span className="complete-badge">
          <StatusDot status="complete" /> {(result.durationMs / 1000).toFixed(1)}s
        </span>
      </header>
      {!markdown ? (
        <p className="local-empty-page">The parser emitted no Markdown output.</p>
      ) : mode === "raw" ? (
        <pre className="markdown-raw">{markdown}</pre>
      ) : (
        <div className="markdown-view typeset-result">
          {pageChunks.map((chunk, index) =>
            !chunk ? null : (
              <section key={index} className="md-page" data-page={index + 1}>
                {pageChunks.length > 1 && (
                  <div className="md-page-divider" aria-hidden="true">
                    <span>Page {index + 1}</span>
                  </div>
                )}
                <ReactMarkdown
                  remarkPlugins={MARKDOWN_REMARK_PLUGINS}
                  rehypePlugins={MARKDOWN_REHYPE_PLUGINS}
                >
                  {chunk}
                </ReactMarkdown>
              </section>
            ),
          )}
        </div>
      )}
    </article>
  );
});

// The Blocks · Raw view: the canonical blocks exactly as the adapter emitted
// them, as pretty-printed JSON. This is the honest structured form behind the
// Blocks · Rendered reading view.
const BlockRawView = memo(function BlockRawView({
  result,
  parserName = "OpenDataLoader",
  letter = "A",
  accent = "indigo",
}: {
  result: LocalParseResult;
  parserName?: string;
  letter?: string;
  accent?: "indigo" | "amber" | "teal";
}) {
  const json = useMemo(
    () => JSON.stringify(result.parsedDocument.pages, null, 2),
    [result],
  );
  return (
    <article className="parser-result" data-accent={accent}>
      <header className="parser-result-header">
        <div>
          <span className="parser-letter">{letter}</span>
          <div>
            <h2>{parserName}</h2>
            <p>Blocks · raw · canonical JSON ({result.blockCount} blocks)</p>
          </div>
        </div>
        <span className="complete-badge">
          <StatusDot status="complete" /> {(result.durationMs / 1000).toFixed(1)}s
        </span>
      </header>
      <pre className="markdown-raw">{json}</pre>
    </article>
  );
});

// Inline-only Markdown for one block's text: **bold**, *italic*, `code`,
// ~~strike~~, [text](url). We render each block's text inline (never as a
// block-level document) because the rendered reading view is reconstructed
// from canonical blocks, and per-block source hover requires a wrapper element
// per block. A block-level Markdown parser would misread common document text
// that begins with "N. " (e.g. "1. 과업내용", "2022. 11.") as an ordered list
// and drop or mangle it; inline rendering keeps such text verbatim. Structure
// (headings, tables) comes from the canonical block kind, not from the text.
const INLINE_MARKDOWN_PATTERN =
  /(`[^`]+`)|(\*\*[^*]+\*\*|__[^_]+__)|(\*[^*\s][^*]*\*|_[^_\s][^_]*_)|(~~[^~]+~~)|(\[[^\]]+\]\([^)\s]+\))/g;

function renderInlineMarkdown(text: string, keyPrefix = "i"): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = new RegExp(INLINE_MARKDOWN_PATTERN.source, "g");
  let last = 0;
  let index = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${index++}`;
    if (match[1]) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (match[2]) {
      nodes.push(
        <strong key={key}>{renderInlineMarkdown(token.slice(2, -2), key)}</strong>,
      );
    } else if (match[3]) {
      nodes.push(<em key={key}>{renderInlineMarkdown(token.slice(1, -1), key)}</em>);
    } else if (match[4]) {
      nodes.push(<del key={key}>{renderInlineMarkdown(token.slice(2, -2), key)}</del>);
    } else if (match[5]) {
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token);
      if (link) {
        nodes.push(
          <a key={key} href={link[2]} target="_blank" rel="noreferrer">
            {link[1]}
          </a>,
        );
      } else {
        nodes.push(token);
      }
    }
    last = pattern.lastIndex;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

const InlineMarkdown = memo(function InlineMarkdown({
  text,
}: {
  text: string;
}) {
  return <>{renderInlineMarkdown(text)}</>;
});

// The Blocks · Rendered view: the parser's canonical blocks reconstructed into
// a document (real headings and tables), spanning every page, with per-block
// source-region hover. This is a *block* render — the geometry-linked reading
// of the structured output — as opposed to the Markdown view, which renders the
// parser's own Markdown string.
function BlockReadingView({
  documentId,
  result,
  parserName = "OpenDataLoader",
  letter = "A",
  accent = "indigo",
  page,
  merge,
  evidence,
  pinned,
  onActivate,
  onPin,
  onNavigatePage,
}: {
  documentId: string;
  result: LocalParseResult;
  parserName?: string;
  letter?: string;
  accent?: "indigo" | "amber" | "teal";
  page: number;
  merge: boolean;
  evidence: string | null;
  pinned: string | null;
  onActivate: (id: string | null) => void;
  onPin: (id: string) => void;
  onNavigatePage?: (page: number) => void;
}) {
  const pages = result.parsedDocument.pages;
  // The reading view spans the whole document, grouped by page.
  const nodesByPage = useMemo(
    () =>
      pages.map((candidate) => ({
        pageNumber: candidate.pageNumber,
        nodes: buildReadingNodes(candidate.blocks ?? [], { merge }),
      })),
    [pages, merge],
  );
  const mappedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const candidate of pages) {
      for (const block of candidate.blocks ?? []) {
        if (block.sourceRegions?.length) {
          ids.add(evidenceIdForBlock(block, merge));
        }
      }
    }
    return ids;
  }, [pages, merge]);

  // Hover highlights the source region (visible when the source viewer is on
  // the same page); pinning a block jumps the source to that block's page so
  // the highlight is always reachable without disorienting hover-navigation.
  const evidenceProps = (id: string | null, pageNumber: number) =>
    id && mappedIds.has(id)
      ? {
          "data-evidence": true,
          "data-evidence-id": id,
          "data-active": evidence === id || undefined,
          "data-pinned": pinned === id || undefined,
          onMouseEnter: () => onActivate(id),
          onMouseLeave: () => onActivate(null),
          onClick: () => {
            if (pageNumber !== page) onNavigatePage?.(pageNumber);
            onPin(id);
          },
        }
      : {};

  const renderNode = (
    node: ReturnType<typeof buildReadingNodes>[number],
    pageNumber: number,
    // A parser can emit duplicate block ids; the index keeps React keys unique.
    key: string,
  ) => {
    if (node.type === "table") {
      return (
        <table
          key={key}
          data-active={evidence === evidenceIdForBlock(node.block, merge) || undefined}
        >
          <tbody>
            {node.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, columnIndex) => {
                  if (!cell) return null;
                  const Cell = rowIndex === 0 ? "th" : "td";
                  return (
                    <Cell
                      key={columnIndex}
                      rowSpan={cell.rowSpan > 1 ? cell.rowSpan : undefined}
                      colSpan={cell.columnSpan > 1 ? cell.columnSpan : undefined}
                      {...evidenceProps(cell.evidenceBlockId, pageNumber)}
                    >
                      {cell.text ? <InlineMarkdown text={cell.text} /> : null}
                    </Cell>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      );
    }
    const block = node.block;
    const text = (block.text ?? "").trim();
    if (block.kind === "heading") {
      const level = Math.min(Math.max(block.headingLevel ?? 2, 1), 4);
      const Heading = `h${level}` as "h1" | "h2" | "h3" | "h4";
      return (
        <Heading
          key={key}
          {...evidenceProps(evidenceIdForBlock(block, merge), pageNumber)}
        >
          {text ? <InlineMarkdown text={text} /> : blockLabel(block)}
        </Heading>
      );
    }
    if (
      IMAGE_KINDS.has(block.kind) &&
      block.sourceRegions?.[0] &&
      isNormalizedBbox(block.sourceRegions[0].bbox)
    ) {
      return (
        <figure
          key={key}
          {...evidenceProps(evidenceIdForBlock(block, merge), pageNumber)}
        >
          <SourceRegionImage
            documentId={documentId}
            pageNumber={block.sourceRegions[0].pageNumber}
            bbox={block.sourceRegions[0].bbox}
          />
        </figure>
      );
    }
    return (
      <p
        key={key}
        data-placeholder={!text || undefined}
        {...evidenceProps(evidenceIdForBlock(block, merge), pageNumber)}
      >
        {text ? <InlineMarkdown text={text} /> : `[${block.kind}]`}
      </p>
    );
  };

  const hasAnyNodes = nodesByPage.some((entry) => entry.nodes.length > 0);

  return (
    <article className="parser-result" data-accent={accent}>
      <header className="parser-result-header">
        <div>
          <span className="parser-letter">{letter}</span>
          <div>
            <h2>{parserName}</h2>
            <p>
              Blocks · rendered · hover links to the source, click to jump the page
            </p>
          </div>
        </div>
        <span className="complete-badge">
          <StatusDot status="complete" /> {(result.durationMs / 1000).toFixed(1)}s
        </span>
      </header>
      <div className="markdown-view typeset-result">
        {!hasAnyNodes && (
          <p className="local-empty-page">
            The parser emitted no blocks for this document.
          </p>
        )}
        {nodesByPage.map(({ pageNumber, nodes }) =>
          nodes.length === 0 ? null : (
            <section
              key={pageNumber}
              className="md-page"
              data-page={pageNumber}
              data-current={pageNumber === page || undefined}
            >
              {pages.length > 1 && (
                <div className="md-page-divider" aria-hidden="true">
                  <span>Page {pageNumber}</span>
                </div>
              )}
              {nodes.map((node, index) =>
                renderNode(node, pageNumber, `${pageNumber}-${index}`),
              )}
            </section>
          ),
        )}
      </div>
    </article>
  );
}

function EmptyResult({ onRun, onChoose }: { onRun: () => void; onChoose: () => void }) {
  return (
    <div className="empty-result">
      <div className="empty-result-visual" aria-hidden="true">
        <span className="empty-result-page" />
        <span className="empty-result-block one" />
        <span className="empty-result-block two" />
        <span className="empty-result-block three" />
      </div>
      <p className="eyebrow">Document ready</p>
      <h2>Choose what reads it.</h2>
      <p>
        Start with the fast local baseline. Nothing runs until you choose a
        parser.
      </p>
      <div className="empty-result-actions">
        <button className={buttonVariants()} type="button" onClick={onRun}>
          Run OpenDataLoader
        </button>
        <button className={buttonVariants({ variant: "outline" })} type="button" onClick={onChoose}>
          Choose parser
        </button>
      </div>
      <span className="empty-result-meta">Recommended · Fast CPU · Local</span>
    </div>
  );
}

function RunningResult({ parser, detail }: { parser: string; detail: string }) {
  return (
    <div className="running-result" role="status">
      <div className="running-orbit" aria-hidden="true"><span /></div>
      <p className="eyebrow">Parsing document</p>
      <h2>{parser} is reading the source.</h2>
      <p>{detail}</p>
      <div className="phase-list">
        <span data-done="true"><b>1</b> Preparing source</span>
        <span data-active="true"><b>2</b> Parsing content</span>
        <span><b>3</b> Normalizing result</span>
      </div>
    </div>
  );
}

function ParserResult({
  parser,
  version,
  timing,
  accent,
  evidence,
  pinned,
  onActivate,
  onPin,
  mappingAvailable,
}: {
  parser: string;
  version: string;
  timing: string;
  accent: "indigo" | "amber";
  evidence: EvidenceId | null;
  pinned: string | null;
  onActivate: (id: EvidenceId | null) => void;
  onPin: (id: EvidenceId) => void;
  mappingAvailable: boolean;
}) {
  const blockProps = (id: EvidenceId, label: string) =>
    mappingAvailable
      ? {
          type: "button" as const,
          "data-active": evidence === id || undefined,
          "data-pinned": pinned === id || undefined,
          "aria-pressed": pinned === id,
          onMouseEnter: () => onActivate(id),
          onMouseLeave: () => onActivate(null),
          onFocus: () => onActivate(id),
          onBlur: () => onActivate(null),
          onClick: () => onPin(id),
        }
      : {
          type: "button" as const,
          disabled: true,
          "data-mapping-unavailable": true,
          title: `${parser} has no parser-native source region for ${label}.`,
        };

  return (
    <article className="parser-result" data-accent={accent}>
      <header className="parser-result-header">
        <div>
          <span className="parser-letter">{accent === "indigo" ? "A" : "B"}</span>
          <div><h2>{parser}</h2><p>v{version}</p></div>
        </div>
        <span className="complete-badge"><StatusDot status="complete" /> {timing}</span>
      </header>
      <div className="parsed-document">
        {/* Text, kinds, and word counts below are what OpenDataLoader actually
            returned for page 1 of the sample PDF. The "ﬁ" in "Efﬁcient" is the
            ligature the parser emitted; it is left as-is because normalising it
            here would hide a real characteristic of the output. */}
        {/* The kind used to be stated twice per block: a `.block-type` label
            above the text and a `<small>` below it that repeated the kind and
            appended one statistic. That is 34px of restatement in a 158px
            block. One meta line carries both. */}
        <button
          className="parsed-block parsed-title"
          {...blockProps("title", "the title")}
        >
          <span className="block-type">Heading · level 2</span>
          <strong>LLaMA: Open and Efﬁcient Foundation Language Models</strong>
        </button>
        <button
          className="parsed-block"
          {...blockProps("abstract", "the abstract")}
        >
          <span className="block-type">Paragraph · 74 words</span>
          <strong>Abstract</strong>
          <p>
            We introduce LLaMA, a collection of foundation language models
            ranging from 7B to 65B parameters. We train our models on trillions
            of tokens, and show that it is possible to train state-of-the-art
            models using publicly available datasets exclusively.
          </p>
        </button>
        <button
          className="parsed-block"
          {...blockProps("introduction", "the introduction")}
        >
          <span className="block-type">Paragraph · 115 words</span>
          <strong>1 Introduction</strong>
          <p>
            Large Languages Models (LLMs) trained on massive corpora of texts
            have shown their ability to perform new tasks from textual
            instructions or from a few examples (Brown et al., 2020).
          </p>
        </button>
      </div>
    </article>
  );
}

function ParserSheet({
  runs,
  onClose,
  onRun,
}: {
  runs: Record<ParserId, string>;
  onClose: () => void;
  onRun: (parser: ParserId) => void;
}) {
  const available = runs.opendataloader === "idle" ? "opendataloader" : "mineru";
  return (
    <aside className="side-sheet parser-sheet" role="dialog" aria-modal="false" aria-labelledby="parser-sheet-title">
      <header className="sheet-header">
        <div><span className="eyebrow">New independent run</span><h2 id="parser-sheet-title">Choose a parser</h2></div>
        <button className="sheet-close" type="button" onClick={onClose} aria-label="Close parser picker">×</button>
      </header>
      <p className="sheet-intro">The source stays unchanged. Each parser keeps its own raw and normalized output.</p>
      <div className="parser-options">
        {parserCards.map((parser) => {
          const disabled = parser.id !== available;
          return (
            <button
              key={parser.id}
              className="parser-option"
              type="button"
              data-selected={!disabled || undefined}
              disabled={disabled}
              onClick={() => onRun(parser.id)}
            >
              <span className="option-radio" aria-hidden="true" />
              <span className="option-copy"><strong>{parser.name}</strong><small>{parser.purpose}</small></span>
              <span className="option-meta"><b>{disabled ? formatStatus(runs[parser.id], "") : parser.tag}</b><small>{parser.runtime}</small></span>
            </button>
          );
        })}
      </div>
      <details className="advanced-disclosure">
        <summary>Advanced settings</summary>
        <div><span>Version</span><strong>Reviewed default</strong></div>
        <div><span>Execution</span><strong>Automatic</strong></div>
        <div><span>Output</span><strong>Raw + canonical</strong></div>
      </details>
      <footer className="sheet-footer">
        <span>Parser-specific options remain optional.</span>
        <button className={buttonVariants()} type="button" onClick={() => onRun(available)}>Run {available === "mineru" ? "MinerU" : "OpenDataLoader"}</button>
      </footer>
    </aside>
  );
}

const LOCAL_PARSER_META: Record<
  ParserId,
  {
    purpose: string;
    runtime: string;
    tag: string;
    engine: string;
    hardware: string;
    license: string;
    url: string;
  }
> = {
  opendataloader: {
    purpose: "Deterministic digital-PDF baseline · native geometry",
    runtime: "CPU · fast",
    tag: "Recommended",
    engine:
      "Rule-based Java engine (Temurin JRE 17 in this image, invoked via the official npm wrapper) · no ML models · deterministic",
    hardware: "CPU only · no GPU needed · single thread pinned for determinism",
    license: "Apache-2.0 (verified upstream)",
    url: "https://github.com/opendataloader-project/opendataloader-pdf",
  },
  mineru: {
    purpose: "Layout models + OCR · reads scanned pages",
    runtime: "CPU · slower",
    tag: "OCR",
    engine:
      "Model pipeline (onnxruntime inference) · layout, formula, OCR (PaddleOCR-family), and table models",
    hardware:
      "This build runs on CPU (models baked in, network disabled) · upstream also supports CUDA/MPS GPU",
    license:
      "MinerU Open Source License (Apache-2.0 based · attribution + scale thresholds) at pinned 3.4.4",
    url: "https://github.com/opendatalab/MinerU",
  },
  azuredi: {
    purpose: "Cloud OCR · strong on Korean · word-level geometry",
    runtime: "Remote API · per-page cost",
    tag: "Cloud",
    engine:
      "Azure prebuilt-layout (MARKDOWN + OCR_HIGH_RESOLUTION) · near-per-character Korean words folded into line segments; each word box is kept for the Native view",
    hardware:
      "Remote Azure service (no local model) · needs outbound network and a connection key; runs read-only otherwise",
    license:
      "Paid Microsoft cloud service (customer's Azure agreement, per-page billing) · SDK is MIT",
    url: "https://learn.microsoft.com/azure/ai-services/document-intelligence/",
  },
};

function LocalParserSheet({
  info,
  runs,
  onClose,
  onRun,
}: {
  info: LocalRunnerInfo;
  runs: Record<ParserId, string>;
  onClose: () => void;
  onRun: (parser: ParserId, options: Record<string, unknown>) => void;
}) {
  const entries = (Object.keys(LOCAL_COMPONENT_IDS) as ParserId[]).map(
    (parser) => ({
      parser,
      component: runnerComponent(info, LOCAL_COMPONENT_IDS[parser]),
      meta: LOCAL_PARSER_META[parser],
      status: runs[parser],
    }),
  );
  const inspectable = (entry: (typeof entries)[number]) =>
    Boolean(entry.component);
  const executable = (entry: (typeof entries)[number]) =>
    inspectable(entry) &&
    localComponentRunAvailability(entry.component).available &&
    entry.status !== "complete" &&
    entry.status !== "running";

  const [selected, setSelected] = useState<ParserId>(
    () => entries.find(inspectable)?.parser ?? "opendataloader",
  );
  const selectedEntry = entries.find((entry) => entry.parser === selected);
  const [options, setOptions] = useState<Record<string, unknown>>(() =>
    defaultRunOptionValues(
      selectedEntry?.component?.optionsSchema?.properties ?? {},
    ),
  );

  const choose = (entry: (typeof entries)[number]) => {
    if (!inspectable(entry)) return;
    setSelected(entry.parser);
    setOptions(
      defaultRunOptionValues(entry.component?.optionsSchema?.properties ?? {}),
    );
  };

  const properties = selectedEntry?.component?.optionsSchema?.properties ?? {};
  const required = selectedEntry?.component?.optionsSchema?.required ?? [];
  const invalidReason = runOptionsInvalidReason(properties, options, required);
  const selectedAvailability = localComponentRunAvailability(
    selectedEntry?.component,
  );
  const runnable = selectedEntry
    ? executable(selectedEntry) && invalidReason === null
    : false;

  const submit = () => {
    if (!runnable) return;
    onRun(selected, cleanRunOptionValues(properties, options));
  };

  return (
    <aside
      className="side-sheet parser-sheet"
      role="dialog"
      aria-modal="false"
      aria-labelledby="local-parser-sheet-title"
    >
      <header className="sheet-header">
        <div>
          <span className="eyebrow">New independent run</span>
          <h2 id="local-parser-sheet-title">Choose a parser</h2>
        </div>
        <button
          className="sheet-close"
          type="button"
          onClick={onClose}
          aria-label="Close parser picker"
        >
          ×
        </button>
      </header>
      <p className="sheet-intro">
        The source stays unchanged. Each parser keeps its own raw and
        normalized output, so runs are always comparable.
      </p>
      <div className="parser-options">
        {entries.map((entry) => {
          const disabled = !inspectable(entry);
          const availability = localComponentRunAvailability(entry.component);
          const statusLabel =
            entry.status === "complete"
              ? "Complete"
              : entry.status === "running"
                ? "Running…"
                : !availability.available
                  ? "Unavailable"
                  : entry.status === "failed"
                    ? "Retry"
                    : entry.meta.tag;
          return (
            <button
              key={entry.parser}
              className="parser-option"
              type="button"
              data-selected={selected === entry.parser || undefined}
              data-unavailable={!availability.available || undefined}
              disabled={disabled}
              title={availability.disabledReason}
              onClick={() => choose(entry)}
            >
              <span className="option-radio" aria-hidden="true" />
              <span className="option-copy">
                <strong>
                  {entry.component?.displayName ?? entry.parser}
                  {entry.component?.upstreamVersion
                    ? ` ${entry.component.upstreamVersion}`
                    : ""}
                </strong>
                <small>{entry.meta.purpose}</small>
                {!availability.available && (
                  <small className="parser-option-reason">
                    {availability.disabledReason}
                  </small>
                )}
              </span>
              <span className="option-meta">
                <b>{statusLabel}</b>
                <small>{entry.meta.runtime}</small>
              </span>
            </button>
          );
        })}
      </div>

      {selectedEntry?.component && (
        <div className="parser-about" aria-label="About this parser">
          <span className="eyebrow">About</span>
          <dl>
            <div>
              <dt>Engine</dt>
              <dd>{selectedEntry.meta.engine}</dd>
            </div>
            <div>
              <dt>Version</dt>
              <dd>
                {selectedEntry.component.displayName}{" "}
                {selectedEntry.component.upstreamVersion} · adapter{" "}
                {selectedEntry.component.version}
              </dd>
            </div>
            <div>
              <dt>Runs on</dt>
              <dd>{selectedEntry.meta.hardware}</dd>
            </div>
            <div>
              <dt>Capabilities</dt>
              <dd className="about-caps">
                {Object.entries(selectedEntry.component.capabilities ?? {})
                  .filter(([, value]) => typeof value !== "object")
                  .map(([key, value]) => (
                    <span
                      key={key}
                      className="cap-chip"
                      data-off={value === false || value === "none" || undefined}
                    >
                      {key}
                      {typeof value === "string" ? `: ${value}` : ""}
                    </span>
                  ))}
              </dd>
            </div>
            <div>
              <dt>Image</dt>
              <dd className="about-mono">{selectedEntry.component.image}</dd>
            </div>
            <div>
              <dt>License</dt>
              <dd>
                {selectedEntry.meta.license} ·{" "}
                <a
                  href={selectedEntry.meta.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  upstream project ↗
                </a>
              </dd>
            </div>
          </dl>
        </div>
      )}

      {selectedEntry?.component && Object.keys(properties).length > 0 && (
        <div className="option-form" aria-label="Parser options">
          <span className="eyebrow">Options</span>
          {!selectedAvailability.available && (
            <div className="parser-selection-availability" role="status">
              <strong>Unavailable in this environment</strong>
              <span>{selectedAvailability.disabledReason}</span>
            </div>
          )}
          <RunOptionFields
            properties={properties}
            required={required}
            values={options}
            componentDisabled={!selectedAvailability.available}
            onChange={(key, value) =>
              setOptions((current) => {
                const next = { ...current };
                if (value === undefined) delete next[key];
                else next[key] = value;
                return next;
              })
            }
          />
          {invalidReason && (
            <small className="option-note" data-invalid>
              {invalidReason}
            </small>
          )}
          <small className="option-note">
            Resolved values are recorded with the run and shown in Details.
          </small>
        </div>
      )}

      <footer className="sheet-footer">
        <span>Runs are append-only; nothing is overwritten.</span>
        <button
          className={buttonVariants()}
          type="button"
          disabled={!runnable}
          onClick={submit}
        >
          Run {selectedEntry?.component?.displayName ?? selected}
        </button>
      </footer>
    </aside>
  );
}

function DetailsSheet({
  demo,
  entries,
  onClose,
}: {
  demo: boolean;
  entries: { title: string; result: LocalParseResult }[];
  onClose: () => void;
}) {
  return (
    <aside className="side-sheet" role="dialog" aria-modal="false" aria-labelledby="details-title">
      <header className="sheet-header"><div><span className="eyebrow">Reproducibility</span><h2 id="details-title">Run details</h2></div><button className="sheet-close" type="button" onClick={onClose} aria-label="Close details">×</button></header>
      {demo || entries.length === 0 ? (
        <div className="detail-list">
          <section><span>Source</span><strong>SHA-256 verified</strong><small>Immutable original PDF</small></section>
          <section><span>Parser image</span><strong>OpenDataLoader 2.5.0</strong><small>OCI digest recorded</small></section>
          <section><span>Resolved options</span><strong>Digital PDF · XYCut</strong><small>Reviewed defaults</small></section>
          <section><span>Artifacts</span><strong>Canonical preview + raw descriptors</strong><small>Demo metadata; raw bytes are not browser-imported</small></section>
        </div>
      ) : (
        <div className="detail-list">
          {entries.map(({ title, result }) => (
            <div key={title} className="detail-run">
              <h3>{title}</h3>
              <section>
                <span>Parser image</span>
                <strong>{result.component.image}</strong>
                {result.component.imageId && (
                  <small className="mono">{result.component.imageId.slice(0, 26)}…</small>
                )}
              </section>
              <section>
                <span>Source</span>
                <strong>SHA-256 verified</strong>
                {result.source?.sha256 && (
                  <small className="mono">{result.source.sha256.slice(0, 26)}…</small>
                )}
              </section>
              <section>
                <span>Resolved options</span>
                {Object.keys(result.options ?? {}).length === 0 ? (
                  <strong>Reviewed defaults</strong>
                ) : (
                  <dl className="option-grid">
                    {Object.entries(result.options ?? {}).map(([key, value]) => (
                      <div key={key}>
                        <dt>{key}</dt>
                        <dd className="mono">{JSON.stringify(value)}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </section>
              <section>
                <span>Run</span>
                <strong>
                  {(result.durationMs / 1000).toFixed(1)}s · {result.blockCount}{" "}
                  blocks · {result.nativeRegionCount} native regions
                </strong>
                {result.runId && (
                  <small className="mono">Run {result.runId}</small>
                )}
                <small className="mono">{result.outputDirectory}</small>
              </section>
              <section>
                <span>Raw artifacts</span>
                <strong>
                  {result.rawArtifacts?.length ?? 0} verified descriptor
                  {(result.rawArtifacts?.length ?? 0) === 1 ? "" : "s"}
                </strong>
                <small>
                  Metadata is saved in browser history; bytes remain in the
                  local runner output until explicitly imported.
                </small>
              </section>
            </div>
          ))}
        </div>
      )}
      <footer className="sheet-footer"><span>The canonical result is saved in this browser. Raw bytes are runner-local.</span></footer>
    </aside>
  );
}

// The AI compare (LLM Judge) sheet is deferred until human blind voting in
// the Arena exists; see DECISIONS.md 2026-07-17.
