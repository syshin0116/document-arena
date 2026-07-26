# Domain database

Neon PostgreSQL is authoritative only for hosted execution metadata. Browser
IndexedDB/OPFS remains authoritative for locally retained documents,
workspaces, source bytes, and imported results.

The `domain` schema contains hosted document metadata, immutable artifact
descriptors, and the temporary remote-artifact cleanup ledger. The
`neon_auth` schema is owned by managed Neon Auth. Domain rows store the stable
authenticated subject in `owner_subject` without a cross-schema foreign key.

PDF and result bytes never enter PostgreSQL. The remote ledger stores only a
provider-neutral BlobStore bucket/key pair and must never persist a presigned
URL.

Apply migrations through a deployment job using a direct TLS Neon connection.
Do not run DDL from a Vercel request handler:

```bash
psql "$DIRECT_DATABASE_URL" \
  -X -v ON_ERROR_STOP=1 \
  -f services/orchestrator/db/migrations/0001_domain_documents.sql
```

Later migrations must be additive and ordered. Never edit a migration after it
has reached a shared environment.
