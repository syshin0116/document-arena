# GCP deployment

This directory prepares the accepted Seoul deployment boundary without
pretending that the GCP Batch runner adapter already exists.

## Prerequisites

- A selected GCP project with billing and the Cloud Build, Artifact Registry,
  and Cloud Run APIs enabled.
- An existing Docker Artifact Registry repository in `asia-northeast3`.
- Separate least-privilege service accounts for the web and orchestrator.
- `gcloud auth login` and the selected project permissions on the operator
  machine. Do not create or download service-account JSON keys.

## Build

```sh
GCP_PROJECT_ID=your-project make cloud-build
```

## Deploy the safe shell

```sh
GCP_PROJECT_ID=your-project \
GCP_WEB_SERVICE_ACCOUNT=document-arena-web@your-project.iam.gserviceaccount.com \
GCP_ORCHESTRATOR_SERVICE_ACCOUNT=document-arena-orchestrator@your-project.iam.gserviceaccount.com \
make cloud-deploy
```

Both services deploy with `DOCUMENT_ARENA_HOSTED_EXECUTION_ENABLED=false`,
scale to zero when idle, and cap at one instance. Raise `GCP_MAX_INSTANCES`
only with a cost ceiling in mind; the Cloud Run default is 100.
The web health endpoint is `/healthz`; the orchestrator exposes `/healthz`,
`/readyz`, and `/v1/status`. `/readyz` intentionally returns 503 until the
hosted settings are complete and execution is explicitly enabled.

Do not enable hosted execution until the authenticated execution-job API, GCP
Batch submit/poll/cancel adapter, quota gate, R2 policy verification, and
terminal cleanup flow have passed end-to-end tests.
