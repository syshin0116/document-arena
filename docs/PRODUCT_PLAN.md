# Document Arena product plan

Status: accepted MVP plan  
Date: 2026-07-15

## Product goal

Document Arena should make it easy to see which PDF parser works best for one real
document. A user uploads a PDF, runs a recommended parser with sensible defaults,
and adds another parser only when comparison is useful.

The product should feel simple even though its internals are extensible. Parser
versions, container details, model revisions, and custom options remain available
under **Advanced**, but they must not block the default flow.

The route map, workspace states, and scenario-to-page mapping are defined in
[Page definitions](PAGES.md).

## MVP user flow

1. Upload one PDF. The document workspace opens before any parser is selected.
2. Run the recommended parser, OpenDataLoader PDF, with one click and default
   options.
3. Inspect the source and result side by side. When the parser provides native
   geometry, hovering either side highlights the linked source/result region;
   otherwise the result remains readable and mapping is labeled unavailable.
4. Add MinerU when a second opinion is useful, then compare both results on the
   same page without uploading the PDF again.
5. Optionally judge candidates blind in the Arena: labels masked, order
   randomized, one listwise vote per page (ties allowed), identity revealed
   after voting. Blind votes feed a later per-document-type Leaderboard.

The product has three user-facing surfaces, shipped in this order: the
document workspace (M1–M2), the blind Arena with sample-document battles
(M3), and the Leaderboard aggregating only blind votes (M4). The LLM Judge is
deferred until human blind voting exists, so it can be validated against human
agreement before it is trusted.

Raw output, normalized output, and basic run information can be downloaded at any
time, but export is not a required step in the main flow.

## Product principles

- **Defaults first:** the common path is upload, run, and inspect. Configuration
  is optional.
- **Evidence before scores:** the source page and parser output remain visible
  together, with exact geometry shown only when the parser supplies it.
- **Add runs, do not restart:** each parser run is independent and appended to the
  existing workspace.
- **Simple UI, extensible runtime:** users select a parser; internally that choice
  resolves to a typed linear pipeline recipe.
- **No parser-specific core code:** parser and component behavior is declared by
  manifests and capabilities rather than parser-id branches in the API or UI.
- **Local-first authority:** IndexedDB/OPFS retains the source, workspace, and
  results; hosted object storage is only a temporary execution exchange.

## MVP scope

### Included

- PDF upload with basic file, size, and page-count validation.
- A document workspace that survives refresh and retains independent parser runs.
- OpenDataLoader PDF deterministic mode as the recommended first parser.
- MinerU Pipeline as the second parser for a useful real-world comparison.
- One-click execution with defaults and an optional **Advanced** drawer.
- A minimal typed component registry and ordered linear recipe executor, following
  the [pipeline component contract](PIPELINE_COMPONENTS.md).
- Immutable source input, untouched raw parser output, and a small canonical page
  and block representation.
- Simple user-facing run states backed by queued, running,
  cancel-requested/cancelling, completed, failed, and cancelled domain states.
- Original-page and parser-result focus view.
- Original-page and two-parser comparison on the same page.
- Bidirectional hover for native parser geometry. Missing geometry is shown as
  unavailable rather than inferred in the MVP.
- A blind Arena mode with anonymized, randomized candidates, listwise human
  votes with ties, and post-vote reveal, including sample-document battles that
  need no upload.
- Download of Markdown, raw artifacts, canonical JSON, and a small reproduction
  manifest containing source hash, parser version, options, image/model reference,
  status, and duration.
- A Docker-based development and self-hosting path with one documented default
  command.
- Durable ingest, pipeline-run, and evaluation lifecycles behind a small
  `WorkflowGateway`, with authoritative operational job state and idempotent
  resume.
- IndexedDB/OPFS as the retained workspace authority, plus a provider-neutral
  temporary `BlobStore`: SeaweedFS in the reference Docker stack and private R2
  with a one-day lifecycle for hosted GCP execution.

### Explicitly deferred

- The LLM Judge (anonymized listwise AI compare). It returns after human blind
  voting exists, validated against human vote agreement.
- LightOnOCR-2-1B and a broader parser catalog.
- User-configurable preprocessors, LLM postprocessors, chunkers, embedders, and
  vector database integrations. The component boundary supports them, but the MVP
  does not ship a pipeline builder or provider catalog.
- User-configurable DAG recipes, branches, loops, conditional routing, and a
  visual workflow editor. Recipes are ordered linear stages first; the internal
  durable job wrapper is not exposed as a pipeline builder.
- User-visible Local, Cloud CPU, and Cloud GPU target selection, multi-runner
  scheduling, and provider-specific fleet orchestration beyond the single
  configured GCP runner.
- Inferred text-to-source alignment, manual mapping, and specialized split,
  merged, duplicate, table, formula, or hierarchy review tools.
- Broad deterministic metric suites, benchmark dataset ingestion, scheduled
  studies, and confidence-interval reporting. The Leaderboard itself ships in
  M4, per document type, fed only by blind votes.
- Multi-pass Judge consistency checks, pairwise tie-breaks, and ranking models.
- Portable HTML reports, comments, annotation tools, and manual preference studies.
- Public accounts, organizations, billing, quotas, and multi-tenant GPU fleets.
- Office formats other than PDF and parser training or fine-tuning.

## Extensible internal model

A parser run is represented internally as a `PipelineRun` containing ordered
`StageRun` records. The MVP exposes only predefined parser recipes:

```text
OpenDataLoader recipe: [OpenDataLoader parser]
MinerU recipe:         [MinerU parser]
```

The same contract can later describe:

```text
[PDF preprocessor]
  -> [parser]
  -> [LLM postprocessor]
  -> [chunker]
  -> [embedder]
  -> [vector database sink]
```

Stages exchange typed, immutable artifacts and record their inputs, outputs,
options, version, status, and provenance. A derived LLM result must point to the
parser result it used rather than overwrite it. A vector database stage is a sink
that returns an index receipt; it is not part of the canonical parser result.

Only ordered linear recipes are implemented for the MVP. A shared thin
LangGraph Functional API envelope resumes ingest, pipeline, and evaluation jobs,
but it does not model the component recipe or appear in the UI.

## MVP product surfaces

### Upload

- One clear drop zone with validation and progress.
- A short-lived upload target is finalized, verified, and ingested before the
  user is asked to run a parser.
- The resulting workspace has a stable, unlisted URL or local identifier.

### Parser picker

- The recommended OpenDataLoader card appears first with a short description and
  **Run** button.
- MinerU appears as the second comparison option when its runtime is available.
- The default card shows only useful capability and runtime hints.
- Exact versions, image/model references, license notes, and generated options
  forms live in **Advanced**.
- Unavailable parsers explain the missing requirement instead of presenting a
  broken action.

### Result workspace

- The source page remains visible beside the selected result.
- Page navigation and zoom stay synchronized where practical.
- The default result view shows readable Markdown or structured text.
- Native layout blocks form the hover overlay and link to result blocks.
- Raw artifacts and run details are available from **Advanced**.

### Compare

- The original page and up to two selected parser results are readable together.
- Changing the page updates all visible results.
- A parser failure does not hide or invalidate successful results.
- Unsupported geometry or structure is labeled N/A, not scored as zero.

### Optional Judge

- Judge is available only after at least two results complete.
- It creates an independent `EvaluationRun`; its failure or retry never changes
  either parser candidate.
- The selected item includes the source image and every selected parser output.
- Parser identities are hidden and candidate order is randomized.
- One pass returns a relative ordering, ties, short evidence, and an
  `insufficient_evidence` outcome.
- Remote document submission requires explicit consent.

## MVP acceptance criteria

- A user can upload a valid PDF without choosing a parser first.
- OpenDataLoader runs with one click and no required configuration.
- The completed result remains available after refresh.
- Hovering a native source block and its result block highlights the linked item
  in both directions without implying geometry that does not exist.
- MinerU can be appended to the same workspace without re-uploading the PDF.
- A user can view the original page and both completed results together.
- Parser runs succeed, fail, and retry independently.
- Raw and canonical outputs remain distinguishable and downloadable.
- One-pass Judge input is anonymous and randomized, and its result may contain a
  tie or insufficient-evidence response.
- Parser cards and result affordances are derived from manifests and capabilities;
  no core behavior branches on parser id.
- The runtime stores a pipeline run as typed stage inputs and outputs, even when
  the recipe contains only one parser stage.
- A small fixture preprocessor or postprocessor can be inserted around a fixture
  parser in tests without changing the runner execution path or document UI.
- Restarting the orchestrator during ingest or a run resumes without starting a
  duplicate container or publishing a duplicate artifact.
- The workspace can be reconstructed from browser IndexedDB/OPFS without
  reading server domain records or LangGraph checkpoints.

## Milestones

### M0 — Minimal foundation

- Finalize only the typed artifact, stage manifest, linear recipe, and run-status
  contracts needed by the first vertical slice.
- Define `WorkflowGateway`, operational domain repository, browser artifact
  store, and temporary `BlobStore` ports before binding LangGraph, PostgreSQL,
  or SeaweedFS adapters.
- Add the shared job envelope, domain job lease/event records, and idempotent
  fixture tasks without adding a broker or user-visible workflow surface.
- Create a minimal runner that executes one container stage and persists its
  output bundle.
- Create upload and result-workspace wireframes.

Exit: a fixture one-stage recipe runs and produces a schema-valid artifact. No
cloud runner, full SDK, benchmark harness, or advanced evaluator is required.

### M1 — OpenDataLoader vertical slice

- Ship ingest and pipeline workflow entrypoints plus the PostgreSQL/SeaweedFS
  reference Compose profile, with SeaweedFS limited to temporary execution
  exchange.
- Upload one PDF and view it interactively with PDF.js; generate a server render
  only when a declared auxiliary artifact requires it.
- Run OpenDataLoader with defaults through its container adapter.
- Persist the source, raw output, canonical pages and blocks, native boxes, and
  reproduction manifest in IndexedDB/OPFS; persist attempts/events and basic
  active-job status in the operational domain store.
- Implement source/result hover and a readable focus view.

Exit: upload -> one-click run -> inspect linked evidence works end to end.

### M2 — Useful comparison

- Add MinerU through the same component and recipe contracts.
- Append it to an existing workspace and compare two results with synchronized
  page navigation.
- Add the **Advanced** drawer for options, raw artifacts, versions, and run details.
- Verify independent failure and retry behavior.

Exit: a user can make a practical parser choice from two real outputs without
understanding the execution infrastructure.

### M3 — Lightweight Judge and extension proof

- Ship the independent evaluation workflow entrypoint.
- Add the optional anonymized, randomized, one-pass listwise Judge.
- Generate a pinned PDFium `PageRenderSet` for Judge source evidence.
- Add Markdown, raw JSON, canonical JSON, and reproduction-manifest downloads.
- Test a fixture linear recipe with a preprocessor or postprocessor around a
  parser to prove that the runtime is not parser-only.

Exit: the MVP supports human comparison, a lightweight relative opinion, and a
verified extension seam without exposing a workflow builder.

### Later

- Add LightOnOCR-2-1B and other reviewed parser adapters.
- Add real preprocessing, LLM transformation, chunking, embedding, and vector
  sink components as predefined recipes before considering a visual builder.
- Add hosted GPU runners and automatic scheduling without adding target selection
  to the common user flow.
- Add deterministic benchmarks, richer metrics, advanced Judge consistency,
  inferred evidence mapping, batch studies, and portable reports.

## Decisions needed before M1

1. **Retention value:** choose the default expiry shown beside upload. The
   mechanism is already `expiresAt` plus an idempotent cleanup job and bucket
   lifecycle safety net.
2. **MVP limits:** choose conservative PDF size and page limits based on the first
   OpenDataLoader measurements.
3. **MinerU runtime:** choose one project-managed Linux execution environment for
   M2. This remains an implementation detail rather than a user-facing target
   choice.
4. **Judge provider:** choose one multimodal provider for M3 behind a small adapter,
   with remote submission disabled until the user consents.
