# Runner deployment plan

Status: accepted; hosted compute/storage handoff updated 2026-07-20
Date: 2026-07-15

## Product rule

Users choose what they want to run, not where a container should run.

- The hosted service automatically uses its project-managed GCP Batch adapter.
- A self-hosted Docker installation automatically uses its local runner.
- The common parser picker does not expose Local/Cloud CPU/Cloud GPU choices.
- The run details still record execution location and coarse hardware for
  reproducibility and privacy.

This keeps the UI simple while preserving one location-independent runner API.

## MVP runner contract

One configured runner provides:

```text
health
available component manifests
submit run
poll status
cancel run
return output-bundle receipt
delete working data
```

The workflow service calls submit and poll as idempotent tasks, validates the
returned bundle in the temporary `BlobStore` exchange, and makes it available
for verified browser import. MVP uses one runner-local queue/process
implementation. The domain job worker separately owns durable leases,
heartbeats, cancellation requests, and public events; PostgresSaver owns none of
those. No fleet broker, registry, scheduler, regions, mTLS, or automatic GPU
placement are required.

OpenDataLoader runs first as a GCP Batch CPU job in `asia-northeast3`. M2 adds a
reviewed Seoul GPU machine shape for MinerU through the same adapter. Each Batch
job runs the manifest-selected, digest-pinned component image directly; it does
not start Docker inside a generic container. The provider choice stays in the
deployment adapter and does not leak into the common runner or UI contract.

Reviewed external images are mirrored by digest into Artifact Registry in the
same region. The Cloud Run runner gateway calls Batch with its attached
least-privilege service account; neither the repository nor a container stores
a service-account JSON key.

Keep every Google API call in the orchestrator service. The web service talks
only to the database and the orchestrator, which is what lets it be redeployed
outside this GCP project without reintroducing a federated-identity setup. A web
route that reaches for ambient Google credentials silently spends that option.

## Security baseline

- Keep hosted execution disabled unless R2 policy verification, Better Auth
  session validation, a per-user quota/grant, and Cloud Run service-account IAM
  readiness all pass.
- Authenticate hosted runner calls.
- Verify source and artifact hashes.
- Isolate each run and apply time, memory, process, disk, and output limits.
- Give component containers no ambient credentials or Docker socket.
- Disable network unless a component declares a reviewed connection.
- Never place document contents or secret values in logs.
- Delete temporary working files when a run completes or is cancelled.
- Give the GCP job only exact-key, method-scoped, short-lived presigned URLs.
  Keep long-lived R2 signing credentials in the trusted server-side `BlobStore`
  adapter; never put them in the browser bundle, `NEXT_PUBLIC_*` values, job
  options, or component containers.
- Show explicit consent before a future stage sends document content to an
  external LLM or vector service.

## Hosted GCP handoff

The authoritative workspace remains in browser IndexedDB/OPFS. Hosted execution
uses the same logical runner contract with R2 as a short-lived byte exchange:

```text
browser -- presigned PUT --> temporary R2 source
control plane -- job + presigned GET/PUT --> GCP worker
GCP worker -- typed output bundle --> temporary R2 result
browser <-- presigned GET -- temporary R2 result
browser -- verify + import --> IndexedDB/OPFS
control plane -- explicit prefix delete --> R2
```

Presigned URLs are bearer capabilities: keep their lifetime short, scope them to
one key and method, do not persist or log them, and issue a fresh URL after
authorization when a retry needs one. A one-day R2 lifecycle rule is the orphan
backstop, not the normal cleanup mechanism.

### Staging around a network-denied parser

Every parser manifest declares `requirements.network: "none"`, so the component
container must reach neither R2 nor anything else. A Batch job therefore runs
three sequential runnables and gives only the first and last an R2 destination:

```text
stage-in   presigned GET  --> shared job volume
parser     no network, no credentials, reads and writes the volume
stage-out  shared job volume --> presigned PUT
```

This is the shape the local runner already has. There, the host has network and
the parser container runs under `--network none` with a bind-mounted directory;
on Batch, the VM has network and the parser container has none. Staging is the
runner's transport, not a pipeline stage, so it stays outside the component
contract and needs no manifest or schema change.

Batch controls networking per VM rather than per runnable, which is the one real
difference from the local path: an escape from the parser container reaches a VM
that holds this job's presigned URLs, whereas locally it would reach the user's
own machine. The exact-key, method-scoped, short-lived URL rule above is what
bounds that blast radius, so it is a requirement of this design rather than
general hygiene. Do not hand the parser runnable the URLs "for convenience"; that
single shortcut removes the whole boundary.

## Network-cost caveat

Cloudflare R2 does not charge egress, but that policy applies only to the R2
side. When GCP compute uploads parser output to R2, those bytes leave Google's
network and can incur GCP internet data-transfer-out charges. Input pulled from
R2 into GCP does not create an R2 egress charge, while any applicable GCP
service/network processing charges remain separate. Track result-bundle size
and use the current [Google Cloud network pricing](https://cloud.google.com/vpc/network-pricing)
for the selected region, service, and network tier; do not bake a per-GiB number
into the product contract.

Add fleet-level capabilities only after one GCP runner no longer suffices:

- runner registration and hardware capability discovery;
- signed object references and remote deletion receipts;
- a fleet broker, runner heartbeats, quotas, and placement retries;
- GPU scheduling, regions, cost telemetry, and autoscaling.

Kubernetes and provider-specific orchestration are explicitly deferred until
measured queue depth or utilization requires them.

Official deployment references:

- [GCP Batch container jobs](https://cloud.google.com/batch/docs/create-run-basic-job)
- [GCP Batch pricing](https://cloud.google.com/batch/pricing)
- [Cloud Run service identity](https://cloud.google.com/run/docs/securing/service-identity)
- [Better Auth for Next.js](https://better-auth.com/docs/integrations/next)
- [Better Auth PostgreSQL adapter](https://better-auth.com/docs/adapters/postgresql)
