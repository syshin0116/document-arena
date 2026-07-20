# Hosted R2 execution exchange

This directory defines the minimum bucket policy for Document Arena's planned
hosted execution exchange. It does not prove that any Cloudflare account has
been configured. The hosted path remains unavailable until the target
environment passes the read-only verification command below.

Use a dedicated, private R2 bucket. The apply command replaces that bucket's
entire lifecycle and CORS policies, so do not point it at a bucket shared with
durable data or another application.

## Required policy

- All objects and incomplete multipart uploads become eligible for deletion
  after one day. Runtime cleanup remains the primary deletion path.
- No enabled bucket-lock rule may override lifecycle deletion. The script does
  not remove locks automatically; verification fails until an operator reviews
  and removes them.
- Browser CORS allows only exact configured origins, presigned `PUT` and `GET`,
  and the headers used by the transfer adapter. The bucket stays private.
- CORS exposes `ETag`, `Content-Range`, and `x-amz-expiration` to browser code.

Cloudflare performs lifecycle deletion asynchronously. Its documentation says
objects are typically removed within 24 hours of the computed expiration, so
"one day" is an orphan-cleanup threshold, not a guarantee of physical deletion
at exactly 24 hours.

## Apply and verify

Create a Cloudflare API token with `Workers R2 Storage Write` for provisioning.
Keep it out of the web runtime; this script is a deployment/operations tool.

```sh
export CLOUDFLARE_ACCOUNT_ID=<32-character-account-id>
export CLOUDFLARE_API_TOKEN=<provisioning-token>
export DOCUMENT_ARENA_BLOBSTORE_BUCKET=document-arena-execution
export DOCUMENT_ARENA_R2_ALLOWED_ORIGINS=https://document-arena.example
export DOCUMENT_ARENA_R2_JURISDICTION=default

bun infra/r2/configure.mjs --apply
bun infra/r2/configure.mjs --verify
```

`--apply` sends the checked-in lifecycle policy and generated exact-origin CORS
policy to Cloudflare's bucket lifecycle and CORS API endpoints, then reads both
back and checks bucket-lock state. `--verify` only reads and compares external
state, exits nonzero on drift, and is the required hosted deployment gate. Do
not treat the presence of R2 runtime credentials as readiness.

The equivalent current Wrangler lifecycle command is:

```sh
bunx wrangler r2 bucket lifecycle add \
  "$DOCUMENT_ARENA_BLOBSTORE_BUCKET" \
  expire-all-temporary-objects-after-one-day \
  --expire-days 1 \
  --abort-multipart-days 1

bunx wrangler r2 bucket lifecycle list \
  "$DOCUMENT_ARENA_BLOBSTORE_BUCKET"
```

For CORS, Cloudflare's Wrangler form is
`wrangler r2 bucket cors set <BUCKET> --file <JSON>` followed by
`wrangler r2 bucket cors list <BUCKET>`. Prefer the checked-in script because it
builds the CORS JSON from `DOCUMENT_ARENA_R2_ALLOWED_ORIGINS` and validates the
read-back response instead of relying on visual inspection.

Official references:

- [Object lifecycles](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)
- [Configure CORS](https://developers.cloudflare.com/r2/buckets/cors/)
- [R2 lifecycle API](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/lifecycle/)
- [R2 CORS API](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/cors/)
- [R2 bucket locks](https://developers.cloudflare.com/r2/buckets/bucket-locks/)
