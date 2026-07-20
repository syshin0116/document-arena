# Container reproducibility plan

Status: first OCI parser spike runnable; service integration planned  
Date: 2026-07-15

## Goal

Parser and future pipeline dependencies stay outside the web application. A
supported Docker host should reproduce a stage from its component revision,
image digest, input artifact hashes, and resolved non-secret options.

Docker is the execution boundary, not a feature users must understand. Hosted
users click **Run**; self-hosted contributors use one documented Compose setup.

## MVP images

| Milestone | Component | Image strategy |
|---|---|---|
| M1, runnable spike | OpenDataLoader PDF 2.5.0 deterministic | Bun-installed Node/Java adapter CPU image built from the pinned official package |
| M2 | MinerU Pipeline | pinned adapter around one supported upstream runtime |
| M3/on demand | PDFium page renderer | pinned pypdfium2 CPU image for explicit `PageRenderSet` artifacts |
| Later | LightOnOCR and other VLMs | shared or model-specific GPU image only when needed |

OpenDataLoader hybrid is not the M1 baseline because it delegates to another
parser. MinerU Pipeline, VLM, and hybrid modes remain distinct component
profiles so results are attributable.

The runnable OpenDataLoader profile targets digital PDFs and does not perform
OCR. It disables hybrid parsing, image output, and network access; uses one
parser thread and the `xycut` reading-order default; and emits both upstream
JSON and Markdown. Canonical geometry is created only where the upstream JSON
contains a native bounding box. The original PDF bottom-left point coordinates
and JSON pointer are retained beside normalized top-left coordinates.

References:

- [OpenDataLoader PDF](https://github.com/opendataloader-project/opendataloader-pdf)
- [MinerU](https://github.com/opendatalab/MinerU)
- [LightOnOCR-2-1B](https://huggingface.co/lightonai/LightOnOCR-2-1B)

## Extension package shape

```text
extensions/<component-id>/
  component.yaml
  options.schema.json
  package.json + bun.lock  JavaScript/TypeScript component
  pyproject.toml + uv.lock Python component
  Dockerfile              optional when reusing a reviewed image
  adapter/ or profile/
  tests/
  LICENSES.md
```

`component.yaml` declares role, accepted and produced artifact types, image,
command, capabilities, resource hints, network policy, connections, and
license metadata. The common contract is defined in
[Pipeline components](PIPELINE_COMPONENTS.md).

Each independently deployed Python component is its own uv project and uses
`uv sync --locked` during image builds. A shared root virtual environment is
not used because parser and model dependency ranges can conflict.

## Runnable batch executor

The first spike implements `oci-batch/v1` only. Each stage receives:

```text
/arena/request.json       read-only request and artifact references
/arena/input/             read-only materialized inputs
/arena/output/            fresh writable output bundle
```

The component writes its typed primary artifact, untouched native output,
diagnostics, and a small run manifest. Long-lived HTTP services are added only
if measured model startup makes batch execution impractical.

The current generic local runner materializes the request, starts the component
container, streams structured phase events, verifies every output size and
SHA-256, validates native geometry provenance, and writes a runner manifest.
It has no parser-specific branch. The future orchestrator will call this runner
boundary through idempotent submit and await tasks; that service integration is
not part of the spike.

Run the implemented path with:

```bash
bun run parser:fixture
bun run parser:build:opendataloader
bun run parser:run:opendataloader -- --input work/fixtures/document-arena-smoke.pdf
```

OpenDataLoader exposes batch conversion rather than a structured page-complete
callback. The adapter therefore reports `inspecting`, `parsing`, and
`normalizing` phases followed by completion, and declares
`partialResults: none`. Redis or another event transport may relay those events
later, but cannot turn them into truthful partial parse artifacts.

## Isolation

Each run has:

- read-only input artifacts and a new output directory;
- no Docker socket, host filesystem, or ambient credentials;
- no network unless a reviewed connection requires it;
- CPU, memory, process, tmpfs, and post-run output-size limits.

The local spike does not yet enforce a wall-clock run timeout or a total event
rate/count limit. A stalled provider call or event-flooding reviewed extension
must currently be stopped with its runner/container; durable hosted execution
needs those limits before it is treated as hardened multi-user infrastructure.

For reviewed remote extensions, `network=remote` currently grants Docker bridge
egress. Manifest endpoint validation reduces accidental connection mistakes but
is not an egress firewall and does not prevent compromised extension code from
contacting another destination. Run credentialed remote images only after
review; destination-scoped proxy/firewall enforcement is future hardening.

One stage failure does not alter its inputs or another parser result.

## Minimal reproduction record

```json
{
  "sourceSha256": "...",
  "component": "opendataloader-pdf",
  "componentVersion": "...",
  "image": "...@sha256:...",
  "modelRevision": null,
  "options": {},
  "inputArtifacts": ["artifact_..."],
  "durationMs": 0,
  "status": "completed"
}
```

Secret values are never stored. Development may resolve a floating image tag,
but persisted runs record the resulting digest.

## Compose scope

The implemented root `compose.yaml` is the lightweight developer stack. It
starts only the Bun-managed web development service, binds it to localhost,
uses named volumes for dependencies and cache, and exposes a healthcheck used by
`make up`. It never mounts the Docker socket. `make dev` keeps the faster host
HMR path, while `make up`, `make logs`, and `make down` exercise Compose. The
Compose process uses the invoking user's UID and GID so Next.js-generated files
do not become root-owned on Linux hosts.

The eventual reference self-hosted stack will add services only when their
application boundaries exist. Its planned shape is:

- web/control plane;
- the thin workflow service;
- one PostgreSQL cluster with separately migrated domain and checkpoint schemas;
- SeaweedFS with its S3 endpoint as the temporary execution exchange;
- one generic local runner.

OpenDataLoader is launched by the runner as an on-demand component container,
not kept alive as another service. MinerU gets an additional M2 profile, and
the pinned PDFium image is pulled only for an explicit render job. Redis, Kafka,
a parser fleet, Garage, and RustFS are not in the reference stack.

A lightweight developer profile may use SQLite/SqliteSaver and a mounted local
temporary-exchange directory. Retained workspace artifacts remain in browser
IndexedDB/OPFS in every profile.

The reference data/workflow services, web upload flow, LangGraph envelope,
Redis-backed live updates, and hosted runner are still plans rather than part of
the developer Compose stack. The repository source is MIT licensed; built
component images and hosted profiles must also preserve every upstream license,
notice, attribution, model-weight, privacy, and service-specific obligation
recorded by their extension.
