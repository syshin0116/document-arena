# Parser Arena evaluation design

Status: accepted post-MVP research plan  
Date: 2026-07-15

The product MVP implements only human side-by-side review and an optional
one-pass anonymized listwise Judge.

## Principle

Reduce sample volume, not evaluation dimensions. Parse each document once and
reuse the artifacts for deterministic metrics, relative LLM judging, human
inspection, downstream RAG tests, and operational measurements.

Do not collapse everything into one score until the full quality profile has
been shown.

Every metric or Judge execution is an independent `EvaluationRun` over immutable
artifact references. Its durable workflow may resume independently, while its
authoritative status and outputs are registered in the domain database and
BlobStore rather than read from a checkpoint.

## Reproducible execution contract

Every compared run uses the same immutable source bytes but remains an
independent, append-only parser run. Record and expose:

- parser adapter, package, model, and OCI image digest;
- normalized options and random seeds where supported;
- host architecture, CPU/GPU, driver, RAM, and container runtime;
- CPU/GPU/memory limits and concurrency;
- cold-model-cache versus warm-model-cache mode;
- network policy and remote endpoints used;
- runner id, execution location, region, and remote retention policy;
- all raw output before normalization.

Quality results may be compared across compatible hardware, but performance
results must not be aggregated across different hardware classes or cold/warm
cache conditions. Containerization improves environmental reproducibility; it
does not guarantee bit-identical GPU inference, so repeatability checks remain
part of high-stakes studies.

Local and cloud quality results can share one study when image/model digests and
options match, but operational comparisons remain grouped by runner and hardware
class. Network transfer and queue delay are reported separately from parser wall
time.

## Evaluation dimensions

| Dimension | Deterministic evidence | LLM/Human evidence |
|---|---|---|
| Text | normalized edit similarity, CER/WER | omissions, semantic substitutions, hallucinations |
| Geometry | IoU, mAP/mAR, element F1 | visually important missed or fragmented regions |
| Logical layout | element coverage and type F1 | grouping and usable document structure |
| Reading order | Kendall tau, pairwise order accuracy | natural reading flow across columns and notes |
| Tables | TEDS/GriTS, cell-value F1 | header/value association and practical usability |
| Formulas | normalized LaTeX/CDM | semantic equivalence despite syntax differences |
| Hierarchy | heading-level F1, tree edit similarity | section and list nesting quality |
| Associations | caption/figure and footnote links | whether related content remains understandable |
| Robustness | success and critical-error rates | degradation severity on difficult pages |
| Operations | latency, throughput, memory, cost | not judged by an LLM |
| RAG | evidence Recall@K, MRR, citation accuracy | answer usefulness on finalists only |

## Layout is an independent axis

Geometry and logical layout are not interchangeable.

- Geometry-capable parsers are evaluated on bounding boxes, labels, overlap,
  duplication, fragmentation, and missed regions.
- Markdown-only parsers are evaluated on element coverage, reading flow,
  grouping, hierarchy, associations, and contamination.
- A multi-column PDF does not need to remain visually multi-column in Markdown;
  it must be linearized in the correct semantic order.
- Geometry capability may be reported as an additional score, but a missing
  capability must not automatically make a Markdown-only parser lose the common
  logical-layout comparison.
- Geometry metrics use parser-native regions only. If either native geometry or
  compatible geometry ground truth is absent, report N/A with coverage rather
  than infer a box or assign zero.

## Relative LLM Judge

### Input unit

For one page, region, or short multi-page item, provide:

1. original page image or relevant crop from a pinned `PageRenderSet`;
2. ground truth when available;
3. every parser's raw or normalized output required for that dimension;
4. consistently rendered output when visual structure matters;
5. geometry overlay only when the parser provides native source regions.

The `PageRenderSet` manifest travels with the Judge input record and includes
source hash, renderer/binding revision, OCI digest, platform/font pack,
CropBox/rotation policy, DPI or scale, and per-page checksums. Browser
screenshots are not evaluation evidence.

Parser identities are replaced with randomized labels. Candidate order changes
between passes.

### Judge output

For every applicable dimension, the Judge returns:

- a 0–4 absolute score per candidate;
- a relative ranking with ties;
- critical errors per candidate;
- concise evidence anchored to the source and output;
- confidence and an `insufficient_evidence` option.

The Judge must not infer missing source content, score runtime, or reward a
candidate merely for being longer or more visually decorated.

### Two-pass consistency

```text
Pass 1: A, B, C, D
Pass 2: C, A, D, B
```

- Accept stable rankings.
- Treat small inconsistent gaps as ties.
- Use pairwise tie-breaks only for material disagreements.
- Route contradictory critical-error judgments to human review.

For more than five parsers, avoid placing every full document output in one
context. Compare page/region-level outputs or use a seeded tournament followed
by a listwise final among the strongest and most uncertain candidates.

### Relative aggregation

Store rankings, not only a transformed scalar. For summary views, use normalized
Borda points or a Bradley–Terry preference model and bootstrap confidence
intervals across items. Report win/tie/loss counts by document type and
dimension.

## Evaluation corpus

Use complementary datasets rather than forcing one benchmark to cover every
capability.

| Role | Recommended source | Why |
|---|---|---|
| End-to-end document parsing | [OmniDocBench](https://github.com/opendatalab/OmniDocBench) | rich text, element, polygon, order, table, and formula ground truth |
| Multilingual and photographed documents | [MDPBench](https://github.com/Yuliang-Liu/MultimodalOCR/tree/main/MDPBench) | Korean among 17 reported languages, digital and camera-captured inputs |
| Targeted robustness | [olmOCR-bench](https://huggingface.co/datasets/allenai/olmOCR-bench) | unit-style checks for scans, tiny text, columns, tables, math, and order |
| Layout detection | [DocLayNet](https://github.com/DS4SD/DocLayNet) | human-annotated multi-domain boxes and polygons |
| Table structure | [PubTables-1M](https://github.com/microsoft/table-transformer) + [FinTabNet](https://dax-cdn.cdn.appdomain.cloud/dax-fintabnet/1.0.0/data_preview/index.html) | cell geometry including empty cells, plus difficult financial tables |
| Forms and key-value extraction | [CORD v2](https://github.com/clovaai/cord) | redistributable receipt boxes and structured fields |
| Real target distribution | private holdout | Korean and product-specific documents not represented by public sets |

OCRBench is visual question answering rather than block/layout parser ground
truth, so it belongs in an optional VLM-understanding panel rather than the main
parser leaderboard.

### Dataset publication policy

Evaluation code and underlying page/image rights are separate. OmniDocBench,
FUNSD, and OCRBench v2 contain research-only or non-commercial restrictions;
TableBank also carries conflicting redistribution language. Do not copy their
pages into the public gallery. Run allowed suites offline and publish aggregate
scores plus official links only after reviewing their current terms.

The public item gallery uses 30–50 clean-room or clearly redistributable PDFs.
Each item records source, author, license, modifications, and checksum. Dataset
files remain outside the repository.

## Execution tiers

Reduce volume by tier while retaining every quality axis:

| Tier | Volume | When | Policy |
|---|---:|---|---|
| PR smoke | 48–60 stratified pages | every adapter change | digital, scan, photo, columns, tables, formulas, forms, KO/EN/ZH/JP, rotation/noise |
| Weekly standard | 250–400 pages | scheduled | every core parser on the same paired sample; bootstrap 95% intervals |
| Release/full | official suites plus module subsets | versioned release | broad CPU runs; costly VLMs may use a fixed stratified subset, with rankings only on the common intersection |

Parse every selected page once and reuse its artifacts. LLM Judge does not need
to run on all pages: start with roughly 90–100 stratified or disagreement-heavy
items and human-audit 10–20%.

## UI presentation

The comparison workspace should expose three complementary views.

### Per-item evidence

- original page/crop;
- aligned outputs selected from the document's accumulated parser runs;
- metric differences;
- Judge scores, ranks, ties, evidence, and critical errors;
- manual reviewer choice.

### Parser profile

- text, layout, order, table, formula, hierarchy, robustness, RAG, and
  operations as separate axes;
- document-type and difficulty breakdowns;
- win/tie/loss matrix against every other parser;
- recurring critical-error categories;
- version and execution manifest.

### Study summary

- filters by dataset, document type, language, difficulty, and capability;
- confidence intervals and item count next to every aggregate;
- no overall winner when coverage or confidence is insufficient;
- export of raw evidence and calculation configuration.

## Suggested decision policy

Use quality gates before cost optimization.

```text
1. Reject parsers below success, critical-error, or required-capability limits.
2. Compare the surviving parsers across deterministic and relative profiles.
3. Run RAG tests only on the top two or three.
4. Among candidates meeting quality requirements, choose on latency, resources,
   privacy, licensing, and operating cost.
```

If a single weighted summary is required, keep its components visible. A
reasonable starting point is deterministic quality 40%, LLM absolute judgment
10%, LLM relative preference 15%, downstream RAG 20%, and operations 15%.
Weights must be configurable per study rather than embedded in parser code.
