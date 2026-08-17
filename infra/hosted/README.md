# Strict-$0 hosted preview

Status: manual provisioning profile; no external account or resource is assumed
to exist. `DOCUMENT_ARENA_HOSTED_EXECUTION_ENABLED` stays `false` until every
required check below has passed in the target environment.

This profile is for a personal, non-commercial preview only. It is designed to
produce a `$0` provider invoice, but that outcome is conditional: Cloudflare R2
is metered beyond its monthly free allowances and does not provide the product
with a hard `$0` spending cap. Application quotas and verified deletion are
therefore release blockers, not optional monitoring.

## Allowed profile

| Layer | Required selection | `$0` boundary |
| --- | --- | --- |
| Web and orchestrator | Two Cloud Run services, `min-instances=0`, `max-instances=1` | Cloud Run's monthly free tier covers a preview's request volume; anything beyond it draws on the same Free Trial credit as compute. An always-warm instance would spend credit while nobody is using the preview. |
| Origin | Generated `*.run.app` URL | No purchased or mapped custom domain. |
| Database | Neon Free | One Free project holding the domain tables and the Neon-owned `neon_auth` schema. Do not upgrade to Launch. |
| Authentication | Managed Neon Auth with GitHub sign-in | Included with the Neon Free project. No separate auth subscription and no email-delivery service. |
| Transfer storage | Private R2 Standard bucket | Stay below 10 GB-month storage, 1 million Class A operations, and 10 million Class B operations per month. R2 egress is free, but over-allowance storage and operations are billed. |
| Compute | Unactivated Google Cloud Free Trial, GCP Batch, CPU only | The trial provides $300 credit for 90 days and does not bill while it remains a Free Trial account. Batch has no scheduler fee, but its VM, disk, logging, registry, and network resources consume the credit. |

Because the control plane and the parser jobs now live in the same GCP billing
account, the trial deadline governs the whole preview rather than compute alone.
The day-85 shutdown takes the web app down with the runs; there is no separately
hosted front end that survives it.

GCP's Seoul resources are not treated as Always Free. Result uploads from GCP
to R2 can consume paid-rate Google network transfer covered by the trial credit.
A Free Trial account cannot add GPUs; the preview additionally rejects every GPU
catalog shape. Never click **Activate** or otherwise convert the billing account
to Paid under this profile.

Artifact Registry gives 0.5 GB of free storage. The OpenDataLoader image fits;
a model-bearing MinerU image does not, and its stored bytes draw on the trial
credit. Push a second parser image only after deciding that cost is acceptable.

Google Cloud budgets only send alerts; they do not cap usage or spending. They
are useful warning signals, not the `$0` enforcement mechanism. The actual
enforcement is the unactivated trial account, CPU/job limits, and the timed
shutdown below.

## Required server-only configuration

Store runtime secrets as Cloud Run service environment values or Secret Manager
references. None may use a `NEXT_PUBLIC_*` name, enter a browser bundle, appear
in a run manifest, or be passed to a GCP job.

- Neon: `DATABASE_URL` for the pooled runtime connection and
  `DIRECT_DATABASE_URL` for migrations only. Neon Auth owns its `neon_auth`
  schema in the same database; domain tables reference the subject string
  without an auth-schema foreign key.
- Neon Auth: `NEON_AUTH_BASE_URL` and `NEON_AUTH_COOKIE_SECRET`. Generate the
  cookie secret with at least 32 high-entropy characters.
- R2 runtime: `DOCUMENT_ARENA_BLOBSTORE_ENDPOINT`,
  `DOCUMENT_ARENA_BLOBSTORE_REGION`, `DOCUMENT_ARENA_BLOBSTORE_BUCKET`,
  `DOCUMENT_ARENA_BLOBSTORE_ACCESS_KEY_ID`, and
  `DOCUMENT_ARENA_BLOBSTORE_SECRET_ACCESS_KEY`.
- R2 provisioning only: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`,
  `DOCUMENT_ARENA_R2_ALLOWED_ORIGINS`, and
  `DOCUMENT_ARENA_R2_JURISDICTION`. Do not copy the provisioning token into the
  web runtime.
- GCP non-secret identifiers: `DOCUMENT_ARENA_GCP_PROJECT`,
  `DOCUMENT_ARENA_GCP_REGION`, and
  `DOCUMENT_ARENA_GCP_BATCH_SERVICE_ACCOUNT`. Each Cloud Run service reaches
  Google APIs through its own attached least-privilege service account, so the
  deployment needs neither a federated identity provider nor a JSON key.

Register GitHub sign-in through the Neon Auth console against the production
`*.run.app` origin, and use a separate development configuration for localhost
rather than sharing the production one. Do not enable email/password
authentication; the preview intentionally has no email-delivery service.

## Manual provisioning checklist

No checked box below should be inferred from this repository. Record evidence
outside Git after performing each action.

- [ ] Confirm the deployment is personal/non-commercial and create one dedicated
  GCP project on the Free Trial billing account.
- [ ] Create a Neon Free project. Create the domain schema, run the reviewed
  migrations, enable Neon Auth with GitHub sign-in, and place only the pooled
  server connection string in the Cloud Run service environment. Confirm the
  Neon dashboard still says **Free**.
- [ ] Deploy the web and orchestrator services with
  [`infra/gcp/README.md`](../gcp/README.md). Keep the generated `*.run.app`
  origin, `min-instances=0`, and `max-instances=1`, and leave the orchestrator
  service private (`--no-allow-unauthenticated`).
- [ ] Complete R2 subscription onboarding, create a dedicated private Standard
  bucket, and issue a bucket-scoped runtime access key. R2 onboarding can require
  a payment method; that does not turn its free allowances into a hard cap.
- [ ] Apply and verify the one-day object and incomplete-multipart lifecycle,
  exact-origin CORS, and absence of conflicting bucket locks using
  [`infra/r2/README.md`](../r2/README.md).
- [ ] Wire the checked-in
  [`free-preview-policy.ts`](../../services/hosting/free-preview-policy.ts) into
  the hosted run-creation transaction before enabling the route. The policy
  already denies missing authentication, grants, quota/capacity snapshots, R2
  counters, lifecycle verification, current unupgraded-Free-Trial evidence,
  GPU requests, and unsafe time windows. The hosted API and atomic database
  reservation do not exist yet, so the presence of this file alone is not a
  readiness signal.
- [ ] Record the exact Free Trial start timestamp and verify the billing account
  still says **Free Trial**, not Paid. Do not press **Activate**.
- [ ] Create separate least-privilege service accounts for the web service, the
  orchestrator, and Batch jobs, plus the regional Artifact Registry repository.
  Do not generate a JSON key.
- [ ] Allow only one reviewed CPU job shape, one concurrent job, and a bounded
  timeout. Disable every GPU capability and clean stale Batch jobs, disks,
  images, and logs.
- [ ] Create GCP budget alerts and credit-balance alerts, while acknowledging
  that budgets do not cap spending. Test that low remaining credit, missing
  billing status, missing quota state, or a service account without the required
  Batch roles denies new runs.
- [ ] Schedule two independent calendar/operations controls from the recorded
  trial start: day 80 warns operators and starts export/cleanup; day 85 disables
  new hosted runs, drains or cancels jobs, imports available results, deletes R2
  job prefixes, and removes GCP compute resources. Day 90 is not a run day.
- [ ] Run the R2 policy verification, authentication/session validation, quota
  checks, CPU-only catalog check, Free Trial status check, and a Batch
  submit/cancel smoke test under the attached service account. Only then may the
  deployment set hosted execution to `true`.

Any commercial use, custom domain mapping, Neon or R2 paid upgrade, GCP Paid
activation, GPU requirement, or operation beyond day 85 exits this profile and
requires a new cost decision before deployment.

## Official references

- [Cloud Run pricing](https://cloud.google.com/run/pricing) and [instance autoscaling](https://cloud.google.com/run/docs/configuring/max-instances)
- [Neon pricing](https://neon.com/pricing) and [network transfer limits](https://neon.com/docs/introduction/network-transfer)
- [Neon Auth](https://neon.com/docs/neon-auth/overview)
- [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/) and [R2 onboarding](https://developers.cloudflare.com/r2/get-started/)
- [Google Cloud Free Trial](https://cloud.google.com/free/docs/free-cloud-features), [Cloud Billing budgets](https://cloud.google.com/billing/docs/how-to/budgets), and [Batch pricing](https://cloud.google.com/batch/pricing)
- [Artifact Registry pricing](https://cloud.google.com/artifact-registry/pricing)
- [Cloud Run service identity](https://cloud.google.com/run/docs/securing/service-identity)
