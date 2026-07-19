# Runner deployment plan

Status: accepted; MVP uses one deployment-selected runner  
Date: 2026-07-15

## Product rule

Users choose what they want to run, not where a container should run.

- The hosted service automatically uses its project-managed runner.
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
returned bundle, and publishes it to BlobStore. MVP uses one runner-local queue/process
implementation. The domain job worker separately owns durable leases,
heartbeats, cancellation requests, and public events; PostgresSaver owns none of
those. No fleet broker, registry, scheduler, regions, cost estimates, mTLS, or
automatic GPU placement are required.

OpenDataLoader runs on the first project-managed CPU environment. M2 adds one
known Linux environment for MinerU. Whether that environment is on the same
machine or a VM is a deployment detail, not a user decision.

## Security baseline

- Authenticate hosted runner calls.
- Verify source and artifact hashes.
- Isolate each run and apply time, memory, process, disk, and output limits.
- Give component containers no ambient credentials or Docker socket.
- Disable network unless a component declares a reviewed connection.
- Never place document contents or secret values in logs.
- Delete temporary working files when a run completes or is cancelled.
- Show explicit consent before a future stage sends document content to an
  external LLM or vector service.

## Later remote-runner handoff

BlobStore is already part of the base architecture. When one local runner no
longer suffices, the same logical contract can hand short-lived object
references to a remote worker:

```text
control plane → short-lived source reference → worker
worker → typed output bundle → artifact store
```

Only then add fleet-level capabilities:

- runner registration and hardware capability discovery;
- signed object references and remote deletion receipts;
- a fleet broker, runner heartbeats, quotas, and placement retries;
- GPU scheduling, regions, cost telemetry, and autoscaling.

Kubernetes and provider-specific orchestration are explicitly deferred until
measured queue depth or utilization requires them.
