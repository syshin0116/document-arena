# Research references and idea backlog

Status: research input and prioritized backlog, not accepted scope  
Date: 2026-07-16

This document records external prior art and the idea backlog distilled from
research (web survey plus an external Codex review/research pass). Accepted
items graduate into [DECISIONS.md](../DECISIONS.md) and the planning documents;
everything else stays here so it is not re-researched.

## Positioning: what competitors already do

Side-by-side multi-parser viewing is no longer a differentiator by itself.

| Product | What it is | Takeaway |
|---|---|---|
| [OCR Arena](https://www.ocrarena.ai/) (Extend) | Battle / Playground / Leaderboard for hosted OCR/VLM APIs, anonymous voting, Elo | Closest arena reference; global rankings, no reproducibility or native-evidence contract |
| [LMArena Document Arena](https://arena.ai/blog/leaderboard-changelog/) | Rankings for PDF question/summarization, not parsing | Different layer; naming overlap risk only |
| [OpenOCR playground](https://open-ocr.com/playground) | Multi-engine OCR compare with text/confidence/latency | Commodity compare UX |
| [DocDigitizer ARENA](https://arena.docdigitizer.com/) | Field accuracy/latency/cost benchmark with a declarative benchmark language | Declarative benchmark definitions worth watching |
| [HF pdf-playground](https://huggingface.co/spaces/chunking-ai/pdf-playground) | Docling/Marker/MinerU in one visual playground | No provenance/evidence contract |
| [Roboflow Arena](https://docs.roboflow.com/changelog/explore-by-month/september-2025/roboflow-arena) | Blind pairwise voting for vision models with native boxes | Pair-queue blind UX pattern |
| [Chunkr](https://docs.chunkr.ai/pages/get-started/web-interface) | Parse/extract viewers with granular bboxes and citations | Result-viewer quality bar |
| [Design Arena methodology](https://notes.designarena.ai/methodology/) | Public Bradley-Terry methodology page | Publish methodology as a page |

Document Arena's defensible differentiators are: (1) the parser-native evidence
contract, (2) reproducible pinned-OCI execution with fingerprints and
reproduction manifests, and (3) per-document verdicts with integrity-preserving
vote records, instead of a global leaderboard.

## Evaluation prior art

- [OmniDocBench](https://github.com/opendatalab/OmniDocBench) (CVPR 2025):
  axis-per-axis metrics (text, tables, formulas, reading order); reference for
  deterministic metric implementations.
- olmOCR-Bench: machine-checkable per-page "facts" instead of edit distance;
  compatible with ground-truth-free per-document checks.
- [ParseBench](https://github.com/run-llama/ParseBench) (LlamaIndex): five
  downstream capability dimensions including visual grounding; no parser wins
  uniformly, which supports per-document verdicts over global rankings.
- [OmniAI benchmark](https://github.com/getomni-ai/benchmark): reports cost per
  1,000 pages and per-page latency beside accuracy; publishes raw data on
  Hugging Face for credibility.
- Human-preference research: listwise ranking of ~10 items matches pairwise
  label quality at an order-of-magnitude lower cost
  ([Permutative Preference Alignment](https://arxiv.org/html/2410.04346));
  position bias requires randomized display order and storing the shown
  permutation with each vote.
- Korean angle: [KolmOCR](https://github.com/posicube-services/KolmOCR),
  [KO-VLM-Benchmark](https://github.com/Marker-Inc-Korea/KO-VLM-Benchmark), and
  AI Hub public-document OCR data are candidate sources for a `fixtures/ko/`
  pack; Korean documents are underserved by English-first arenas.

## Eval-tooling UX patterns worth borrowing

- [Promptfoo matrix viewer](https://www.promptfoo.dev/docs/usage/web-ui/):
  providers × prompts × cases grid, aggressive row filters, shareable URL state.
- [Braintrust](https://www.braintrust.dev/docs/evaluate/compare-experiments):
  regression-first sorting against a baseline, summary/table/grid views, trial
  grouping for variance.
- [W&B Weave comparison](https://docs.wandb.ai/weave/guides/tools/comparison):
  reorderable candidate tokens, caps visible columns, "vs baseline" and
  "vs previous" pivots.
- [Inspect AI log viewer](https://inspect.aisi.org.uk/log-viewer.html): groups
  repeated epochs instead of collapsing nondeterministic runs into one.
- [MLflow GenAI evaluation](https://mlflow.github.io/mlflow-website/genai/evaluations/):
  re-evaluate existing traces without regenerating outputs.

## Idea backlog

### Adopt into MVP trajectory

- **Evidence coverage receipt**: per run, the share of blocks with native
  geometry, broken down by text/table/formula/image. Describes evidence
  availability, not accuracy; computable without ground truth; surfaces as a
  run badge.
- **Disagreement heat strip**: rank pages (thumbnail-rail markers) and blocks by
  inter-parser disagreement to prioritize review. Label as review priority,
  never as correctness.
- **N/A as a first-class value** with capability filters ("has native
  geometry", "has tables"); unsupported features are explicit N/A, never zero.
- **Reproducibility badge levels**: image pinned → options resolved → seed
  recorded → raw-output hash reproduced on replay.
- **Runner profile badge**: `local · M2 Max · warm` / `cloud · A10G · cold`;
  duration comparisons across hardware classes are flagged non-comparable
  (already mandated by [EVALUATION.md](EVALUATION.md), surfaced in UI).

### N-way comparison UX (when combinations grow)

- Two altitudes: triage matrix (rows = pages/review items, columns =
  candidates, compact cells) → click into the Source+2 close-reading workspace.
- Baseline pivot: pin one candidate, view others as deltas; column labels use
  compact delta chips ("OCR on", "+cleanup") while shared stages recede.
- Hierarchical grouping by shared stage-prefix fingerprint, collapsible.
- Blind pair queue for large candidate pools (one anonymous pair at a time);
  listwise for small pools.
- Optional quality/cost/latency scatter as navigation; dominated candidates
  deemphasized, not hidden.
- Persist candidate set, baseline, page, filters in shareable URL state.

### Post-MVP backlog

- **Fixture promotion**: promote a problematic page/region to a private
  regression fixture (source hash + permitted crop + expected structure +
  license status) without publishing the PDF; feeds regression CI.
- **Downstream utility probes**: table QA, citation retrieval, key-value lookup
  against immutable outputs (ParseBench motivation).
- **Adaptive parser recommendation** from detected document properties
  ([AdaParse](https://proceedings.mlsys.org/paper_files/paper/2025/file/678773d96b5822e93348aeb5c80d4dc5-Paper-Conference.pdf));
  rationale shown, manual override kept.
- **Judge evidence highlighting**: Judge cites the region behind its verdict,
  rendered through the native-evidence overlay.
- **Separately versioned correction layer**: reviewer corrections/annotations
  never overwrite parser artifacts (Google Document AI Workbench pattern).
- **Repeated-trial siblings** for stochastic stages: agreement and output-hash
  stability shown instead of presenting one sample as canonical.
- **Reviewer issue tags** (missing text, hallucination, reading order, table
  structure, formula, geometry) kept distinct from Judge scores.
- **Shareable comparison links** for opt-in public documents; viral surface.
- **Region/block-level blind votes** in addition to page-level.

### Monetization and growth notes (not scheduled)

- Open engine + managed execution (Langfuse-style split: self-host stays fully
  functional; hosted runners, artifact retention, org workspaces are paid).
- Golden-doc regression CI: private document suites re-run on adapter/parser
  upgrades, gating on evidence coverage and quality thresholds.
- Document challenges instead of a global leaderboard: one licensed sample PDF,
  reproducible adapter submissions, blind votes, archived manifests.
- Publish anonymized vote datasets (document type, candidate pair, human vs
  Judge choice) on Hugging Face for credibility and research reuse.
- Adapter conformance suite as a GitHub Action template to lower contribution
  barriers; verified-adapter program must never sell ranking placement.

## Caching and fingerprint lessons (input to PIPELINE_COMPONENTS.md)

- [Bazel](https://bazel.build/remote/caching): two levels — action-key →
  execution receipt, separate from content-addressed blobs; identical bytes
  dedupe across recipes while receipts stay per-invocation.
- Nix: downstream keys use upstream **output content hashes**, not run ids;
  content equivalence is distinct from provenance equivalence; GC works from
  reachability roots (retained workspaces, pinned manifests).
- [Docker/OCI](https://docs.docker.com/dhi/core-concepts/digests/): pin by
  digest, include platform manifest digest; image digests do not cover
  externally mounted model weights or language packs — those need their own
  revisions.
- Nextflow's lenient cache modes show why filename/size/timestamp caching is
  unsafe; Flyte shows hash-the-bytes (never the URL), atomic get-or-reserve to
  prevent stampedes, and a manual `cache_version` knob for adapter-code changes.
- [DVC](https://www.dvc.org/blog/dvc-2-0-release/): explain hits and misses
  field-by-field ("image digest changed", "option default resolved
  differently").
- Publish cache entries only after validation and durable blob storage; verify
  digests again on read; failed/cancelled/partial attempts never become hits;
  original execution timing stays separate from cache-retrieval timing.
