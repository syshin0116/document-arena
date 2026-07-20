# Runner deployment plan

Status: accepted; hosted compute/storage handoff updated 2026-07-20
Date: 2026-07-15

## Product rule

Users choose what they want to run, not where a container should run.

- The hosted service automatically uses its project-managed GCP runner.
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

OpenDataLoader runs on the first project-managed GCP CPU environment. M2 adds
one known GCP Linux environment for MinerU. The exact GCP compute product is a
deployment adapter choice; it does not leak into the common runner or UI
contract.

## Security baseline

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
