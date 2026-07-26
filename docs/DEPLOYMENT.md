# Deployment

The first hosted surface is the Next.js application on Vercel with managed
Neon Auth and Neon PostgreSQL. GCP execution, Artifact Registry, hosted parser
images, and the temporary remote artifact exchange are intentionally deferred.

## Vercel

Connect the GitHub repository through Vercel's native Git integration:

- pull requests create Preview deployments;
- merges to `main` create Production deployments;
- the install command is `bun install --frozen-lockfile`;
- the build command is `bun run build`;
- the runtime remains Node.js 24.

Set these server-only Vercel environment variables for Production and Preview:

```text
DATABASE_URL
NEON_AUTH_BASE_URL
NEON_AUTH_COOKIE_SECRET
```

`DATABASE_URL` is the pooled application connection. The direct migration
connection does not belong in Vercel. Neon Auth preview branches can provide a
branch-specific `NEON_AUTH_BASE_URL` through the Neon/Vercel integration.

The application deliberately builds without these variables. In that mode,
local browser workspaces remain available while Auth API routes return a
fail-closed `503 auth_not_configured` response.

## GitHub Actions

The normal CI workflow needs no secrets. It installs the Bun lockfile and runs
lint, typecheck, and tests, with the single `check` job intended for branch
protection.

Production SQL migration is manual and protected:

1. Create the GitHub Environment named `production`.
2. Add required reviewers to that Environment.
3. Add the Environment secret `DIRECT_DATABASE_URL` using Neon's direct,
   unpooled TLS connection string.
4. Run **Production database migration** from the `main` branch and enter one
   checked-in migration filename.

The initial `0001_domain_documents.sql` migration was applied directly to the
production Neon branch on 2026-07-26. Do not dispatch it again there. Future
migrations are additive, ordered files and are applied one at a time after
review.

Never store `DATABASE_URL`, `DIRECT_DATABASE_URL`,
`NEON_AUTH_COOKIE_SECRET`, OAuth credentials, or presigned URLs in repository
variables, workflow files, logs, or committed `.env` files.
