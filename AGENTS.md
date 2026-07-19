# Document Arena working guide

Document Arena is an independent document pipeline evaluation product, currently
shipping a parser-first PDF workflow. Keep it separate from the `syshin0116.dev`
blog and its source material.

## Product contract

- The primary workflow is upload → run a recommended parser → inspect linked
  source/result evidence → optionally add one parser → compare.
- Never require users to choose every parser before the document workspace is
  created.
- Preserve every parser's raw output before normalization.
- Keep component-specific invocation and normalization inside
  `extensions/<id>/`.
- Never branch on a component id in the runner, control plane, evaluator,
  database, or UI. Derive behavior from roles, artifact types, capabilities,
  and schemas.
- Generate advanced component option forms from JSON Schema.
- A new compatible component must not require a core or UI change. Propose a
  contract version change when that is impossible.
- Prefer a profile on the shared VLM adapter when a model exposes a compatible
  vision-completion API and needs no executable custom post-processing.
- Every result must retain parser version, model/version identifier, options,
  timing, and execution status.
- Stage outputs are immutable. LLM-derived output never overwrites or silently
  improves the parser output used by the default comparison.
- Keep MVP recipes linear: preprocessors, exactly one parser, postprocessors,
  then optional chunk/embed/vector sink. Do not add a user-configurable recipe
  DAG without a demonstrated workflow that cannot fit this shape; the internal
  LangGraph lifecycle wrapper is not recipe topology.
- A failure in one parser must not cancel or hide successful parser results.
- Geometry and logical document structure are separate evaluation concerns.
- Display source geometry only when the parser emitted it. Reversible coordinate
  normalization is allowed; text alignment, OCR, or an LLM must not create a
  source box labeled as parser-native.
- Use PDF.js for the interactive source view. A pinned PDFium renderer may
  produce explicit thumbnail, Judge, raster-input, or evaluation artifacts; it
  is never an implicit geometry source or mandatory parser preprocessor.
- LLM Judge evaluations must anonymize and randomize parser identities.
- Wrap long-running ingest, pipeline, and evaluation jobs with the shared thin
  LangGraph workflow envelope. Keep recipes linear and keep LangGraph out of
  component, artifact, and runner contracts.
- Treat the domain database as authoritative for jobs, attempts, events, and
  artifacts. LangGraph checkpoints are rebuildable execution cursors, not a
  queue, event log, or product data store.

## Safety and repository hygiene

- Treat PDFs and parser processes as untrusted input.
- Do not commit uploaded documents, benchmark downloads, generated parser
  output, model weights, secrets, or build artifacts.
- Keep parser dependencies isolated from the web application and from one
  another in independently pinned OCI images.
- Record the exact container image digest and model artifact revisions for
  every parser run.
- LLM Judge submission is opt-in because documents may be confidential.
- Hosted and self-hosted runners use the same API and artifact contract. The
  deployment selects its single MVP runner; do not expose infrastructure choice
  in the common user flow.
- Access document bytes only through the BlobStore contract. The reference
  self-host profile uses SeaweedFS, hosted deployment uses R2, and provider
  names must not leak into core behavior.
- Record structural or hard-to-reverse choices in `DECISIONS.md`.

## Toolchains

- Use Bun for every JavaScript/TypeScript install, lockfile, script, and test.
  Commit `bun.lock`; never add `package-lock.json`, `pnpm-lock.yaml`, or
  `yarn.lock`, and never instruct contributors to run npm, pnpm, or Yarn.
- Keep runtime compatibility separate from package management. A component may
  retain Node when an upstream SDK requires it, but its dependencies are still
  resolved and installed with Bun.
- Every Python service or extension uses uv with a colocated `pyproject.toml`
  and committed `uv.lock`. Use `uv add`, `uv sync --locked`, and `uv run
  --locked`; do not add pip requirements, Poetry, Pipenv, or a shared root
  environment that couples independently deployed components.
- Keep `make dev` as the host HMR path and `make up` as the detached Compose
  path. Add a service to the default Compose stack only after it has a runnable
  application boundary; never mount the Docker socket into the web service.

## Planned boundaries

- `app/`: browser UI and lightweight control-plane routes.
- `services/orchestrator/`: shared durable job envelope, dispatch, and task
  adapters for ingest, pipeline runs, and evaluation.
- `services/runner/`: recipe validation, generic execution, resource limits, and
  artifact validation.
- `packages/contracts/`: versioned artifact, component, recipe, run, and result
  schemas.
- `extensions/`: component manifests, adapters/profiles, normalization, and
  small fixtures.
- `infra/`: reference PostgreSQL/SeaweedFS Compose and deployment configuration;
  catalog hardening is later.
- `docs/`: product and engineering decisions.
