# Document Arena page definitions

Status: accepted MVP information architecture  
Date: 2026-07-15

## Page-design rule

Keep the user with the document. Upload is one page; every document-specific
task happens inside one workspace page.

The product has four routes across its staged rollout:

```text
/                              Home and upload            (M1)
/documents/[documentId]        Document workspace         (M1–M2)
/arena                         Blind battle               (M3)
/leaderboard                   Blind-vote rankings        (M4)
```

Within the workspace, parser selection, run details, comparison, downloads,
and failures remain states or overlays, not separate pages. The deferred LLM
Judge, when it returns, is also a workspace overlay.

## User scenarios

| Priority | User situation | Short journey | Success condition |
|---|---|---|---|
| P0 | First-time user wants one result quickly | Home upload → workspace → run recommended parser | A readable result appears without required settings |
| P0 | User wants to verify where output came from | Focus view → hover/tap a native-mapped source or result → pin | Native mappings link honestly; unsupported mapping is clearly N/A |
| P0 | First result looks questionable | Run parser sheet → run MinerU → compare | Both results are visible against the same source page |
| P0 | One parser fails | Inline failure → retry or open details | Successful runs remain usable and only the failed run retries |
| P1 | User wants to judge without brand bias | Arena → upload or sample document → anonymous A/B → vote → reveal | Vote is recorded with permutation and blind state before identities show |
| P1 | User returns, exports, or deletes | Reopen unlisted URL → details/menu | Runs restore; artifacts can be downloaded or fully deleted |
| P2 | User wants to know which parser tends to win | Leaderboard → filter by document type | Rankings show blind-vote win rates per document type, never one global score |
| Later | User wants a relative AI opinion | Compare → AI compare → consent if remote | A/B/Tie/insufficient result appears without changing artifacts |
| Later | User wants LLM cleanup or indexing | Result → Add next step → choose compatible action | A new derived artifact or index receipt is created without rerunning the parser |

## Page 1 — Home and upload

Route: `/`

### User goal

Start evaluating a document with minimal explanation and no infrastructure
decisions.

### Primary content

- one sentence explaining the product;
- one large PDF drop zone and file-picker action;
- concise file-size/page limits;
- a short retention/privacy statement and delete promise;
- one or two optional redistributable sample documents;
- optional device-local **Recent workspaces** below the main action.

### Behavior

- Upload validates type and limits inline.
- Upload creates the workspace before any parser runs, then finalizes and
  inspects the source before enabling parser actions.
- Success immediately navigates to `/documents/[documentId]`.
- No parser, model, Docker, GPU, pipeline, or Vector DB choice appears here.
- Recent workspace metadata stays on the device until account functionality
  exists; it is not a global document dashboard.

### Main states

```text
ready → validating → uploading → finalizing → workspace ingesting → ready
  ↘ actionable validation/upload/finalize error
```

## Page 2 — Document workspace

Route: `/documents/[documentId]`

### User goal

Run, inspect, and compare parsers without losing the source document or moving
between result pages.

### Stable frame

```text
+-------------------------------------------------------------------+
| Back · filename · page                              Arena · More   |
+------------------------------+------------------------------------+
| Source PDF                   | Runner strip: one chip per catalog  |
| page canvas + evidence layer | parser (Run / running progress /    |
|                              | result stats) · Options…            |
|                              +------------------------------------+
|                              | Empty hint / progress / result /    |
|                              | compare                             |
+------------------------------+------------------------------------+
```

The runner strip is the single home for parser actions and run state: idle
parsers show a Run action, running parsers show the parser's own stage
progress inline, completed parsers show duration and evidence coverage and
open run details. There is no separate bottom dock.

The source stays visible on desktop and is rendered by PDF.js from the immutable
original. A separate SVG evidence layer shows only parser-native geometry. The
right side changes with workspace state. On small screens, Source and Results
become tabs; hover behavior becomes tap-to-pin.

### Workspace states

#### Ingesting

- Keep the filename and upload status visible while the source is verified.
- Do not enable parser Run actions until the domain document state is ready.
- An ingest failure offers retry-finalize or delete; it is not a parser failure.

#### Empty

- Render the ready uploaded source immediately.
- Show one primary **Run recommended parser** action.
- Keep **Choose parser** as a secondary action.

#### Running

- Keep the source usable.
- Show one plain-language status and progress only when available.
- Allow another independent run only after the basic flow is stable.

#### Focus

- Show Source and one readable parser result.
- The run chip carries compact badges: evidence coverage (share of blocks with
  native geometry, by kind), reproducibility grade (image pinned → options
  resolved → seed recorded → replay-verified), execution locality with runner
  profile (for example `local · arm64 · warm` or `cloud · A10G · cold`), and
  duration.
- Native bounding boxes support hover/tap, click-to-pin, `Escape`, and keyboard
  selection.
- Geometry not supplied by the parser is labeled unavailable.
- Show **Run another parser** after the first result completes.

#### Compare

- Show Source plus two selected result columns.
- Synchronize page changes and pinned native evidence.
- Label missing or unsupported mappings instead of leaving ambiguous blanks.
- More completed runs may replace A or B, but only two are visible together.
- Candidates whose slots differ only in options or one stage show that
  difference compactly (for example `same parser, OCR on/off`) instead of two
  identical-looking labels.
- When the two runs executed on different hardware classes or cache states,
  durations are labeled non-comparable instead of being shown as a plain pair.
- Later: the thumbnail rail gains a disagreement heat strip that marks pages
  where compared candidates diverge most. It is labeled review priority, never
  correctness, and links to a source region only where native geometry exists.

#### Blind compare — later

- A **Blind** toggle on the compare state masks candidate labels, hides run
  details, and shuffles column order.
- The user submits one listwise vote for the current page (ties allowed) using
  the same anonymized schema as the LLM Judge; voting reveals the labels and
  returns to normal compare.
- Every human vote records whether it was blind; only blind votes may feed any
  future community ranking.
- Blind is a display mode over existing runs, not a separate page or a new
  execution path.

#### Failed

- Keep every successful result available.
- Show a short error and **Retry** in the failed run slot.
- Put stack traces, logs, and resolved options in Details.
- Do not navigate to a separate error page.

#### Derived result — later

- Show an LLM/postprocessor result as a new derived output, never as a replacement
  for the parser result.
- Label the complete path, for example `MinerU → LLM cleanup`.
- A vector write appears as an index receipt such as `Indexed to Qdrant`, not a
  new parser result.

### URL state

The page route remains stable. Useful review state may live in query parameters:

```text
?page=3&run=run_a
?page=3&compare=run_a,run_b
```

Page number and selected comparison candidates should survive refresh and be
shareable. Hover state and open drawers do not need shareable URLs in the MVP.

## Page 3 — Arena (M3)

Route: `/arena`

### User goal

Judge parser output without brand bias, with the least possible setup.

### Primary content

- one upload zone plus a **Use a sample document** action so a battle can start
  with zero preparation;
- two anonymous result columns (`Candidate A` / `Candidate B`) beside the
  source page;
- one listwise vote control for the current page: A, B, tie, or both poor;
- after the vote: identities, versions, and run details are revealed and the
  battle can continue on another page or document.

### Behavior

- Candidate order is randomized once per battle and persisted until the vote.
- While blind, everything that could identify a candidate is masked: labels,
  duration, runner profile, logs, and details.
- Every vote records the exact candidate artifacts, the displayed permutation,
  and blind-exposure state.
- Arena runs use the same immutable runs and evidence rules as the workspace;
  blind is a display state, not a separate execution path.
- Until hosted parsing exists, votes stay on the device; nothing is submitted
  to a shared ranking without explicit opt-in.

## Page 4 — Leaderboard (M4)

Route: `/leaderboard`

### User goal

See which parsers tend to win blind votes for documents like mine.

### Primary content

- rankings grouped by document type (for example digital text, scanned, table
  heavy, Korean), never one global score;
- win rate, battle count, and tie share per parser profile;
- a methodology link explaining blind-vote-only aggregation, anonymization,
  and known limits.

### Behavior

- Only blind votes are aggregated; labeled preferences never count.
- Until community submission exists, the page aggregates this device's votes
  and clearly says so.
- A parser row links to its catalog entry with version, license, and
  capability information.

## Overlays, not pages

### Run parser sheet

- Opened from the empty state or **Run another parser**. The action adds a run
  of a curated catalog parser to this document; users never register new
  parsers here.
- Composes one run candidate from per-stage slots: a required Parser/OCR slot
  and, later, optional postprocessor slots (for example an LLM cleanup slot)
  that default to none, so the default sheet looks like a single parser choice.
- Each slot is one dropdown of curated named profiles (for example
  `OpenDataLoader deterministic`, `MinerU Pipeline`); the recommended
  compatible profile is preselected.
- Default view shows per-slot name, purpose, relative speed, availability, and
  a local/remote execution badge.
- **Advanced** discloses, per slot, the options form generated from the
  manifest-declared option schema, versions, license, and runtime data.
  Resolved normalized options join the candidate fingerprint; they are never
  free-form text.
- A profile that calls a remote provider selects a named connection from
  `/settings/connections` by reference; secrets never appear in slot options,
  fingerprints, or exports, and the first remote submission of document bytes
  goes through the confirm modal.
- Duplicating an existing candidate and changing one slot is the primary way to
  create a controlled comparison; unchanged stage results are reused rather
  than rerun.
- Future preprocessors belong in this pre-run slot list, not a new surface.

### Details drawer

- Parser/model/image versions and resolved options.
- Raw output, canonical JSON, Markdown, logs, duration, and errors.
- Reproduction manifest and download actions.
- Stage lineage when a run later contains more than one component.

### AI compare drawer — later (deferred with the LLM Judge)

- Appears only when two results exist.
- Defaults to the current page; optional page range can be selected.
- Requests explicit consent before remote document submission.
- Returns A, B, Tie, or insufficient evidence with one short reason.
- Shows its own queued/running/failed state and retry action without changing
  parser runs.

### Confirm modal

Reserved for irreversible or external actions: remote data submission, document
deletion, and a future external index write. It is not used for normal parser
selection.

### Add next step sheet — later

- Appears only for completed artifacts and installed compatible components.
- Offers actions such as LLM cleanup or an indexing preset.
- Creates a new immutable derived artifact and compact lineage breadcrumb.
- Does not expose a node canvas or arbitrary YAML editor.

## Page 5 — Connections, later only

Route: `/settings/connections`

This page is added only when a real external LLM, embedding provider, or vector
database integration ships. Connections are reusable across documents, so they
do not belong inside one workspace drawer.

It contains:

- friendly connection name and provider type;
- endpoint, region, and secret entry/update;
- test connection and connection status;
- data-transfer and retention disclosure;
- delete/disconnect action.

Secret values are never shown again or stored in recipe/export artifacts. Vector
collection browsing, retrieval, chat, and database administration remain out of
scope.

## Supporting static page

Before a public upload beta, add `/privacy` with retention, deletion, remote
provider, logging, and contact details. This is a compliance/support page, not a
product workflow.

## Intentionally not pages

MVP does not create dedicated routes for:

- dashboard or global document library;
- parser catalog;
- parser run detail;
- result detail or compare;
- Judge or evaluation history;
- pipeline builder;
- Vector DB administration.

These remain inline, sheets, drawers, or explicitly later until a real user
scenario requires separate navigation.

## First wireframes to make

Create only these five workspace frames before implementation:

1. Home/upload;
2. empty workspace with recommended-run action;
3. running plus failed variants;
4. one-result focus view with evidence hover/pin;
5. two-result compare view.

Reserve a button and drawer boundary for Judge, but do not design the advanced
pipeline or Connections UI before those integrations are scheduled.
