# Domain database

Neon PostgreSQL is authoritative only for hosted execution metadata. Browser
IndexedDB/OPFS remains authoritative for locally retained documents,
workspaces, source bytes, and imported results.

## Schemas

- `domain`: documents submitted for hosted execution, immutable artifact
  descriptors, jobs, attempts, events, and the temporary remote-artifact
  ledger.
- `checkpoint`: rebuildable LangGraph execution cursors, added with the
  orchestrator service.
- `auth`: Better Auth-owned tables, added with the first authenticated hosted
  endpoint.

`domain.documents` deliberately has no foreign key into `auth`. Its
`owner_subject` is the stable authenticated subject supplied by the control
plane, which keeps domain migrations independent of the authentication
adapter.

## Document retention contract

- A browser-only document creates no server row.
- A hosted execution creates one `domain.documents` metadata row.
- PDF and result bytes never enter PostgreSQL.
- `domain.artifacts` descriptors are immutable after insertion.
- `domain.remote_artifact_ledger` stores only the `BlobRef` bucket/key pair and
  cleanup state. It must never store or log a presigned URL.
- Successful browser import moves temporary output toward deletion; explicit
  cleanup is primary and the one-day bucket lifecycle is the orphan backstop.
- Re-submitting identical bytes is allowed. The `(owner_subject, sha256)` index
  accelerates lookup but is intentionally not unique.

## Apply

Run migrations through the deployment's PostgreSQL migration job with a direct,
TLS-protected Neon connection. Do not run DDL from a Cloud Run request handler.

The initial migration is:

```text
migrations/0001_domain_documents.sql
```

Later migrations must be additive and ordered. Do not edit a migration after it
has reached a shared environment.
