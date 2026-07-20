# Pipeline components

Status: accepted MVP contract  
Date: 2026-07-15

## Goal

Document Arena should be easy to use as a parser comparison tool while allowing
different preprocessing, LLM post-processing, embedding, vector-store, and
evaluation choices later. The component recipe does not need a general DAG or
visual workflow builder. A thin LangGraph job envelope sits outside this
contract for restartable execution; see [workflow orchestration](WORKFLOWS.md).

The product UI remains parser-first:

```text
upload document -> add parser -> inspect result -> add another parser -> compare
```

Internally, each comparison candidate is a versioned `PipelineRun`. A parser's
default recipe hides the optional stages until a user opens advanced settings.

## Fixed linear recipe

MVP recipes have fixed slots and one forward-moving primary artifact:

```text
immutable source
  -> preprocess[]
  -> parser
  -> postprocess[]
  -> final parsed document
  -> chunk? -> embed? -> vector store?
```

- `preprocess` contains zero or more sequential document transforms.
- `parser` contains exactly one parser component.
- `postprocess` contains zero or more sequential parsed-document transforms,
  including optional LLM processing.
- `index` is optional and, when present, has fixed chunk, embed, and vector-store
  slots.
- Evaluation is not a transformation stage. It is a separate read-only job over
  one or more selected artifacts.

There are no arbitrary edges, loops, conditions, or stage-level fan-out. The
control plane compares multiple recipes by creating independent `PipelineRun`s.
A component that needs a complex internal workflow keeps that workflow inside
its adapter boundary.

The orchestrator may checkpoint which ordered stage is active, but neither a
component manifest nor a recipe imports LangGraph concepts. The generic runner
must remain directly conformance-testable without LangGraph.

Every stage receives the immutable original source plus the previous stage's
primary output. This lets an LLM postprocessor inspect both the PDF evidence and
the parsed document without introducing general graph dependencies.

## Small stable contracts

### `ComponentManifest`

A component manifest describes what can be executed without teaching the core
about a specific parser, model, or provider.

```yaml
apiVersion: document-arena.dev/component/v1alpha1
kind: Component
metadata:
  id: mineru-pipeline
  version: 1.0.0
  displayName: MinerU Pipeline
spec:
  role: parser
  accepts: [document-arena/source-document@v1]
  produces: document-arena/parsed-document@v1
  executor:
    protocol: oci-batch/v1
    image: ghcr.io/document-arena/mineru@sha256:...
  optionsSchema: ./options.schema.json
  requirements:
    gpu: optional
  policy:
    network: none
```

The common manifest contains only:

- stable id and adapter version;
- semantic role;
- accepted and produced artifact types;
- immutable executor reference;
- options schema;
- required resources, connections, and network policy;
- role-specific capabilities such as `geometry: native | none` or table support.
  The capability is descriptive; it never triggers parser-id routing.

Supported roles are `preprocessor`, `parser`, `postprocessor`, `chunker`,
`embedder`, `vector-store`, and `evaluator`. A parser manifest is a specialized
component manifest, not a separate execution system.

### Complete option surfaces and availability

Option forms render directly from each component's JSON Schema. Standard
keywords define types, defaults, choices, and constraints. Document Arena adds
only presentation metadata under `x-document-arena`:

```json
{
  "x-document-arena": {
    "sourceUrl": "https://github.com/vendor/project/blob/pinned-tag/options.ts",
    "availability": {
      "state": "fixed",
      "reason": "Pinned by this reviewed component profile.",
      "reasonCode": "profile-value"
    }
  }
}
```

`availability.state` is either `fixed` or `unavailable`. Both properties and
individual `oneOf` choices remain visible and disabled, with a non-secret
reason. `sourceUrl` points to the pinned upstream repository or official
documentation used to verify the option. `disabledReason` is accepted as the
short form for an unavailable individual choice.

Disabled values are omitted from the stage request. The component adapter must
inject and record every fixed effective value, reject unavailable selections,
and validate input again at its trust boundary. The UI must not branch on a
component id to render these states.

### `ArtifactRef`

Artifacts are immutable and addressed independently of local paths or expiring
cloud URLs.

```json
{
  "id": "artifact_...",
  "sha256": "...",
  "mediaType": "application/vnd.document-arena.parsed-document+json",
  "schemaVersion": "v1",
  "sizeBytes": 12345,
  "createdByStageRunId": "stage_...",
  "parentArtifactIds": ["artifact_..."]
}
```

For local execution, the browser resolves a retained artifact id through its
IndexedDB/OPFS index and gives the runner the bytes directly. For hosted
execution, the browser stages those bytes and the orchestrator resolves an
opaque temporary reference through the `BlobStore` adapter, then gives the GCP
runner a local mount or short-lived presigned object reference. Those delivery
details are not part of durable recipes, retained run records, or exports.

Initial typed artifacts are:

| Artifact type | Purpose |
|---|---|
| `SourceDocument` | uploaded or preprocessed PDF/document |
| `PdfMetadata` | inspected page count, dimensions, boxes, rotation, and source hash |
| `PageRenderSet` | optional pinned server-rendered pages and render manifest |
| `ParsedDocument` | canonical text, structure, geometry, and evidence links |
| `ChunkSet` | chunks with stable links to parsed elements |
| `EmbeddingSet` | vectors, model metadata, and referenced chunk ids |
| `IndexReceipt` | receipt for an external vector-store write |
| `MetricSet` / `JudgeSet` | deterministic or LLM evaluation output |

### `PipelineRun`

A `PipelineRun` is one immutable comparison candidate:

```text
PipelineRun
  recipe and recipe hash
  sourceArtifact
  StageRun[]
  parserOutputArtifact
  finalOutputArtifact
  optional IndexReceipt
```

`parserOutputArtifact` and `finalOutputArtifact` may be the same when no
postprocessor is configured. A comparison label must describe the complete
recipe, for example `MinerU raw` versus `MinerU + LLM cleanup`; it must not
attribute postprocessed quality to the parser alone.

### `StageRun`

A `StageRun` records one component invocation:

- component id, adapter version, resolved image/model/prompt revision;
- original source and primary input artifact refs;
- resolved options and connection names, never secret values;
- status, timestamps, resource observations, and structured error;
- primary output plus raw and diagnostic artifacts.

A technical retry creates a `StageAttempt` beneath the same logical
`StageRun`. Changing resolved options or a component, image, model, or prompt
revision creates a new `PipelineRun` instead.

Stage outputs never overwrite their inputs. Parser-native output, canonical
parser output, every postprocessor output, and index receipts remain separately
inspectable. A postprocessor that changes a `ParsedDocument` emits a new
`ParsedDocument` with lineage to its input.

Geometry inside a canonical parser result is present only when the parser
emitted the corresponding source region. The adapter may perform reversible
page-index, CropBox, rotation, and coordinate normalization while retaining a
pointer to the native value. Derived text alignment is not a geometry capability
in the MVP.

### `EvaluationRun`

An `EvaluationRun` is separate from `PipelineRun` because an evaluator may need
several candidates at once:

```text
EvaluationRun
  sourceArtifact
  candidateArtifactRefs[]
  evaluator components and options
  MetricSet[] / JudgeSet[]
```

Evaluators are read-only. Deterministic metrics, listwise LLM Judge, human
review, and later RAG evaluation can target parser outputs or final
postprocessed outputs explicitly. They cannot mutate a comparison candidate.
`PipelineRun` and `EvaluationRun` each have an independent durable lifecycle,
but their portable contracts contain no LangGraph thread or checkpoint data.

## Identity, fingerprints, and stage caching

One hash cannot serve candidate identity, stage reuse, and vote history at the
same time, so identity is split into three layers:

```text
candidateSpecFingerprint   the fully resolved recipe of one comparison
                           candidate; what comparisons, labels, and votes
                           reference
stageInvocationFingerprint per stage; what the cache keys on
artifact sha256            the concrete bytes a user actually saw
```

### Stage invocation fingerprint inputs

A stage's invocation fingerprint covers every behavior-affecting input:

- contract/fingerprint schema version (namespacing the key format);
- component id, adapter version, and options-schema digest;
- executor image digest (not tag) plus platform manifest digest;
- externally mounted model weights, language packs, and prompt revisions as
  their own digests, because an image digest alone does not cover them;
- resolved normalized options after canonical encoding;
- input artifact content hashes (never run ids or storage URLs);
- seed and sampling parameters where the component supports them;
- non-secret connection binding revision (provider type, endpoint class, model
  deployment revision): secret rotation alone does not change the fingerprint,
  but a silent model or endpoint switch does;
- an adapter-declared manual cache-version knob for adapter-code changes that
  are invisible to the other inputs.

Canonical encoding rules (sorted keys, Unicode normalization, explicit
defaults versus omitted values, number and array representation) must be
specified with conformance test vectors before the cache is implemented;
semantically identical options must never hash differently.

### Cache rules

- Cache entries are published only after output validation passes and blobs are
  durably stored; failed, cancelled, or partial attempts never become hits.
- Receipts and blobs are separate: the fingerprint maps to an execution receipt
  (producing stage, versions, resolved options, upstream hashes, validator
  revision, timestamps); byte-identical blobs dedupe across recipes while
  receipts stay per-invocation.
- Digests are re-verified on cache read.
- Concurrent identical requests use atomic get-or-reserve on the fingerprint.
- Changing any upstream stage invalidates that stage and all downstream stages
  of the linear recipe; there is no partial downstream reuse.
- Cache decisions are explainable: a hit names the matched fingerprint; a miss
  reports which fields differed.
- Original execution timing is stored and displayed separately from cache
  retrieval; a cache hit never presents a stale duration as current latency.
- Garbage collection is reachability-based: active workspaces, retained
  reproduction manifests, and pinned exports are roots.

### Nondeterministic stages

Component manifests declare a determinism capability
(`deterministic | seeded | nondeterministic`). Nondeterministic stages,
typically remote LLM/VLM calls without a seed, are never reused across runs
automatically: the UI offers an explicit "reuse prior output" versus "run
again" choice, and a reused sampled output is labeled a cached observation,
not a fresh execution. Reproducibility surfaces as a graded badge: image
pinned, then options resolved, then seed recorded, then raw-output hash
reproduced on replay.

## Recipe example

Recipes reference reviewed component ids and versions. The catalog resolves
them to immutable executor and model revisions and records those resolutions in
the run manifest.

```yaml
apiVersion: document-arena.dev/pipeline/v1alpha1
kind: PipelineRecipe
metadata:
  id: mineru-clean-rag
spec:
  preprocess:
    - uses: ocrmypdf-deskew@1
      options:
        deskew: true

  parser:
    uses: mineru-pipeline@1
    options:
      mode: auto

  postprocess:
    - uses: llm-document-cleanup@1
      options:
        model: compatible-provider/document-model
        promptRevision: cleanup-v2
      connectionRef: document-llm

  index:
    chunker:
      uses: recursive-chunker@1
      options:
        size: 800
        overlap: 120
    embedder:
      uses: multilingual-embedder@1
      connectionRef: embeddings
    vectorStore:
      uses: qdrant@1
      options:
        collection: document-arena
      connectionRef: team-qdrant
```

The default parser recipe usually contains only `parser`. Preprocessing,
post-processing, and indexing are opt-in additions rather than prerequisites
for the core comparison flow.

## LLM roles

`llm` is an implementation choice, not a pipeline role:

- a document VLM is a `parser`;
- cleanup, correction, extraction, or enrichment after parsing is a
  `postprocessor`;
- LLM as Judge is an `evaluator`.

This distinction keeps input/output semantics stable when a local model, hosted
model, or deterministic implementation replaces the LLM. Every LLM-backed run
records provider type, model revision, prompt revision, options, and the pages
or artifacts sent remotely.

## Vector stores are side-effect sinks

A vector store is not the BlobStore and must not become the source of truth for
parser results; retained authoritative records and bytes remain in browser
IndexedDB/OPFS. Its adapter consumes an `EmbeddingSet`, performs an idempotent
write, and returns an immutable `IndexReceipt` containing:

- provider and logical connection name;
- collection and run-scoped namespace;
- source, parsed-document, chunk, and embedding artifact ids;
- inserted/updated counts and embedding dimensions;
- an idempotency key;
- a provider-specific deletion reference.

Failures in indexing do not invalidate a completed parser result. Re-indexing
creates a new stage run or safely reuses the same idempotency key. Query and
retrieval contracts are deferred until a concrete RAG workflow needs them.

## Secrets and connections

Recipes refer to named connections such as `document-llm` or `team-qdrant`.
Connection records contain non-secret endpoint configuration and references to
secrets managed by the local runner or hosted secret store.

- Secret values never appear in manifests, recipes, events, logs, exports, or
  artifact metadata.
- A component declares the connection type and fields it needs.
- The runner injects only the selected connection for that stage.
- Network access is disabled unless a reviewed manifest opts into a remote
  connection. The current Docker bridge grant is not destination-scoped.
- Public hosting runs only reviewed components and connection types; self-hosted
  installations may register local ones.

The local runner discovers connection types from `extensions/*/component.json`.
Each remote component declares UI-safe field metadata, its container env mapping,
and server-side validation policy (including approved endpoint host suffixes).
The browser can inspect connection status with `GET /v1/connections`, configure
all fields atomically for the current runner process with
`PUT /v1/connections/<type>`, and clear that session override with `DELETE` on
the same resource. Credential mutations require an allowed browser Origin.
Responses are `Cache-Control: no-store` and contain descriptors plus
`configured`/`source` status only—never field values or container env names.
When no session override exists, the runner may fall back to its existing
environment connection; a session override never mixes with environment fields.
`configured` means those values passed local manifest validation; it is not a
provider authentication or connectivity check. Endpoint validation catches
accidental misconfiguration and enforces a known endpoint policy, but the MVP
has no egress proxy/firewall. A compromised remote extension with bridge
network access is therefore outside this sandbox guarantee.
The Origin check is a browser CSRF boundary, not local-process authentication;
the local MVP trusts same-user processes and must remain bound to loopback.
Connection values become the scoped environment of the running container and
are visible to principals that can inspect the local Docker daemon.

## Progressive UI disclosure

The pipeline model should not make the first-run experience feel like a
workflow tool.

1. Upload creates a document workspace.
2. **Add parser** shows available parser cards and a primary **Run** action.
3. The parser's reviewed default recipe runs without additional configuration.
4. **Advanced pipeline** optionally exposes preprocessing and post-processing.
5. **Index result** appears only after a parsed result exists and only when a
   vector connection is configured.
6. Comparison shows the parser output by default and clearly identifies any
   selected postprocessed snapshot.

MVP does not include a node canvas, arbitrary YAML editing in the browser,
conditional execution, or a plugin marketplace.

## Now and later

### Build now

- The common component manifest base and typed `ArtifactRef`.
- Linear `PipelineRecipe`, `PipelineRun`, and `StageRun` records.
- One parser-only default recipe through the existing batch executor.
- Immutable parser-native and canonical outputs with lineage.
- Upload, browser PDF.js viewing, result inspection, native evidence hover, and a
  second independently runnable comparison candidate.
- Optional `PageRenderSet` generation only when a thumbnail, Judge, explicit
  raster-input recipe, or visual evaluation requires it.
- A small fixture preprocessor or postprocessor proving that a stage can be
  added without parser-specific core or UI code.
- `EvaluationRun` storage shape, even if the first evaluation is manual or one
  simple deterministic metric.

### Add later

- Production LLM postprocessors and listwise LLM Judge.
- Chunker, embedder, vector-store adapters, and RAG evaluation.
- MinerU/LightOnOCR and a broader parser catalog after the first vertical slice.
- Long-lived HTTP model services, multiple cloud runners, signed catalogs, and
  automated conformance tooling.
- Conditional branches, retrieval/query adapters, or a general recipe DAG only
  after a demonstrated workflow cannot fit the linear recipe.

The extension contract succeeds when a new compatible component can be added
through its manifest, adapter, and tests without a component-id branch in the
runner, control plane, database, evaluator, or UI.
