# Parser Arena core features

Status: accepted MVP UX contract  
Date: 2026-07-15

## Product promise

Upload a PDF, run a parser with sensible defaults, and inspect its result beside
the source. When the parser supplies native geometry, immediately see which
source region produced which parsed result. Add one more parser only when a
comparison is useful.

The first release optimizes for this short path:

```text
Upload PDF -> Run recommended parser -> Inspect source/result -> Add parser -> Compare
```

Reproducibility and extensibility remain architectural requirements, but their
technical detail stays out of the default workflow.

## UX principles

- Do not ask the user to choose a parser before upload.
- Make the recommended parser runnable with one click and no required options.
- Show product language such as **Fast** or **Needs GPU** before implementation
  details such as image digests and runtime versions.
- Reveal actions only when they become useful. Compare and Judge do not appear
  before two results exist.
- Keep parser-produced artifacts distinct from anything later produced by an
  LLM, embedder, or storage stage.
- Preserve advanced controls without making them part of the happy path.

## 1. Upload

The home screen contains one primary PDF drop zone, a file picker, and an
optional sample document. Upload immediately creates a document workspace; it
does not start a parser automatically.

Before accepting a file, validate its media type, size, and page limit. Show an
actionable inline error rather than opening a separate configuration flow.

The browser uploads to a short-lived target, calls finalize, and then shows
uploading, finalizing, and inspecting states while the ingest job verifies the
source. Parser actions become available only after the document is ready.

Retention, privacy, and deletion information is available near the upload
control, but detailed storage policy belongs in a disclosure rather than the
main form.

## 2. Empty document workspace

After upload, show the rendered source document and one clear action:
**Run a parser**.

The parser sheet initially shows a small recommended set. Each card needs only:

- display name;
- a short purpose, such as **Fast CPU baseline** or **Layout + OCR**;
- expected relative speed and required hardware;
- availability.

The recommended compatible parser is preselected with its default options, so
the primary **Run** button starts it immediately. Target selection is hidden
when only one runner is available. Sending a document to a remote runner always
requires an explicit privacy confirmation.

Parser version, model revision, license, image digest, target, and generated
option form live in **Details and settings**. Adding an advanced option must not
make the default form more complex.

## 3. Running and failure states

A run appears in the workspace as soon as it starts. The default status is one
plain-language line: preparing, parsing, finishing, complete, failed, or
cancelled. Show page progress and elapsed time only when available.

A failed parser does not affect the source document or another run. The error
state offers **Retry** and places technical logs in the details drawer.
**Cancel** becomes **Stopping** while the runner terminates the active process.

## 4. Single-result focus view

The first completed parser opens a two-pane workspace:

```text
+---------------------------+---------------------------+
| Source PDF                | Parsed result             |
| page canvas + overlay     | readable rendered output  |
+---------------------------+---------------------------+
```

Both panes share page navigation. The source pane provides thumbnails, page
jump, zoom, and rotation. The result pane opens in one readable rendered view;
raw JSON, Markdown, elements, logs, and manifests are not primary tabs.

The source pane uses PDF.js against the immutable original PDF. Its evidence
layer is a separate SVG overlay. A pinned PDFium render is created only for a
thumbnail, Judge, explicit raster-input recipe, or evaluation artifact; it does
not generate hover geometry.

### Native evidence hover and pin

For parsers that return native page geometry:

1. hovering a source bounding box highlights its parsed element;
2. hovering a parsed element highlights its source box;
3. clicking either side pins the relationship;
4. `Escape` clears the pin;
5. the same selection is reachable by keyboard.

The MVP supports native geometry only. A parser without native geometry still
shows its result, with a clear **No source-region mapping** state. Inferred text
alignment, manual mapping, split/merge editing, and confidence visualization
are later enhancements and must not be represented as exact boxes.

## 5. Two-parser comparison

After one result completes, show **Add parser** beside it. The user can run a
second parser without uploading again or recreating the workspace.

When two results exist, enable compare mode:

```text
+----------------------+---------------------------------------+
| Source PDF           | Parser A result | Parser B result     |
| shared evidence      | comparison column 1 | column 2        |
+----------------------+---------------------------------------+
```

Page changes and pinned native evidence stay synchronized. Hovering a source
region highlights the corresponding native element in each result when it
exists; a missing or unsupported mapping is labeled rather than left blank.

Only two parser results are visible at once in the MVP. Additional completed
runs may be selected into either column, but the UI does not attempt a five-way
grid.

## 6. Details drawer

One **Details** drawer keeps operational and reproducibility information
available without crowding the comparison surface. It may contain:

- exact parser, adapter, model, and image versions;
- resolved options and execution target;
- duration, resource information, and status events;
- raw parser output and extracted artifacts;
- logs and structured errors;
- reproduction manifest and download actions.

Capability-dependent sections appear only when data exists. Core UI must derive
these sections from manifests and artifact types, never parser-name branches.

## 7. Optional simple Judge

After two parser results complete, an optional **AI compare** action may evaluate
the current page or selected pages. The first version returns:

- Parser A, Parser B, or Tie;
- a short reason;
- any critical extraction error it found.

Candidate order is anonymized and randomized. Sending source pages or parsed
text to a remote model requires explicit consent. Judge output is an opinion,
not ground truth, and it never overwrites parser artifacts.

AI compare creates an independent evaluation run with queued, running, failed,
retry, and completed states. Its failure never changes either parser run.

Multi-pass judging, pairwise tie-breaks, detailed rubrics, evidence anchoring,
and leaderboard aggregation are later work.

## 8. Advanced pipeline path

The default parser run is internally a small pipeline even though the basic UI
shows only the parser:

```text
Source -> Parser -> Canonical result
```

The extension model may later support optional typed stages:

```text
Source -> Preprocess -> Parser -> LLM enrich
       -> Chunk -> Embed -> Vector store
```

A completed result may expose **Add next step** for compatible downstream
components. The workspace represents the result as a compact breadcrumb, for
example:

```text
Source -> MinerU -> LLM cleanup -> Qdrant
```

Changing a downstream stage should reuse the immutable upstream artifact rather
than rerunning the parser. Vector database credentials and other provider
connections belong in a separate Connections screen, not in the document flow.

Every stage output remains separately addressable:

- **Parser raw** is the untouched native output.
- **Parser result** is the deterministic canonical representation used for the
  default parser comparison.
- **Derived result** is produced by an LLM or another downstream component and
  is always labeled with its producing stage.

Derived output never replaces or silently improves the parser result. A user
who chooses to compare derived outputs must be able to see the full pipeline
breadcrumb.

The MVP does not include a node canvas, arbitrary DAG editing, pipeline
marketplace, or branching visualization. The data contract may preserve stage
lineage now while the UI remains a simple ordered path.

## MVP acceptance criteria

- A first-time user can upload a PDF and start the recommended parser without
  opening settings.
- One parser result opens in a source/result two-pane view.
- Native bounding boxes support bidirectional hover, click-to-pin, and keyboard
  selection.
- A user can add a second parser without re-uploading and compare two result
  columns on the same page.
- Unsupported geometry is honest and does not produce inferred-looking native
  boxes.
- Raw artifacts, logs, versions, and manifests remain accessible through one
  details drawer.
- An optional Judge can prefer A, prefer B, or tie without modifying either
  parser result.
- Parser output and LLM-derived output are stored and labeled as different
  artifact snapshots.
- A new conforming parser or future pipeline component can populate the generic
  surfaces without parser-specific core UI code.

## Explicitly later

- More than two visible parser result columns.
- Searchable large parser catalog and component marketplace.
- Inferred or manual evidence mapping and annotation tools.
- Specialized table, formula, hierarchy, and cell-alignment workbenches.
- Broad metric dashboards, benchmark batches, and public leaderboards.
- Advanced Judge orchestration and ground-truth workflows.
- Visual graph/DAG pipeline builder and branching editor.
- Retrieval, chat, and vector database administration inside the comparison UI.
