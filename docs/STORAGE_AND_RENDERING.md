# Storage, rendering, and native geometry

Status: accepted architecture boundary, local-first retention updated 2026-07-20
Date: 2026-07-15

## Storage decision

Retained document state is local-first. IndexedDB owns workspace metadata and
small records; OPFS owns source PDFs and large retained result artifacts (with
IndexedDB as the current implementation and fallback while the OPFS adapter is
introduced). Together they are authoritative for what the user keeps.

The S3-compatible `BlobStore` is a separate, temporary execution-exchange
boundary. It is not a durable document system of record.

| Role | Implementation |
|---|---|
| Authoritative browser metadata | IndexedDB |
| Authoritative browser document/result bytes | OPFS (current MVP still uses IndexedDB blobs) |
| Minimal-development execution exchange | Local filesystem |
| Reference self-hosted execution exchange | SeaweedFS |
| Hosted execution exchange | Private Cloudflare R2 bucket, one-day lifecycle |
| Optional tested compatibility profiles | Garage, AWS S3, or another verified endpoint |
| Experimental compatibility profile | RustFS |

SeaweedFS is the default self-hosted service because it is Apache-2.0, actively
maintained, supports the required S3 subset, and can grow beyond a single-node
deployment. Garage's AGPL license does not make deployment automatically
forbidden, but a modified network service needs a deliberate source-offer and
compliance plan, so it is optional rather than the default. RustFS remains
experimental until its distributed and lifecycle behavior is stable enough for
the compatibility suite. This is a product dependency policy, not legal advice.

Cloudflare R2 is selected for hosted transfer, while hosted parser compute runs
on GCP. R2 objects exist only long enough to move a job's inputs and outputs.
The control plane explicitly deletes them after successful browser import,
failure, or cancellation; a bucket-wide one-day expiration rule is the orphan
cleanup backstop.

## Temporary BlobStore contract

Core code uses capabilities rather than provider names:

~~~text
put
head
open with optional byte range
signPut
signGet
completeMultipart
abortMultipart
delete
deleteMany
~~~

Listing objects is not an artifact index. IndexedDB records every retained
logical artifact, local byte reference, checksum, size, media type, and lineage.
The server may keep a short-lived transfer ledger containing an opaque job id,
temporary object key, checksum, size, media type, and expiration deadline; that
ledger is operational state, not the user's retained workspace.

ETag is retained for HTTP caching and range requests but is never assumed to be
the content SHA-256. The application calculates or verifies SHA-256 separately.

No core branch may check whether the provider is SeaweedFS or R2. A server-side
adapter supplies endpoint, region, addressing style, bucket, and credentials
behind `BlobStore`. Long-lived storage credentials never enter browser bundles,
`NEXT_PUBLIC_*` configuration, job payloads, logs, or GCP containers.

## Object layout

Use a private execution bucket and one prefix per opaque job, never one bucket
per document or a user-derived object key.

~~~text
jobs/{jobId}/input/source.pdf
jobs/{jobId}/input/manifest.json
jobs/{jobId}/output/stages/{stageRunId}/raw/...
jobs/{jobId}/output/stages/{stageRunId}/primary/...
jobs/{jobId}/output/result.json
jobs/{jobId}/output/receipt.json
~~~

Keys are immutable for the life of the job. SHA-256 remains verification
metadata and a cache input; it is not exposed as a public lookup key. Temporary
keys must never be copied into a retained workspace as if they were durable.

## Browser authority

The implemented upload page stores the PDF Blob in browser IndexedDB under an
opaque `local_...` workspace id, navigates to that workspace, reconstructs a
`File`, and passes it directly to the client PDF viewer. This is the first
implementation of the accepted local-first boundary, not a placeholder for a
durable server upload.

The boundary has explicit limits:

- the PDF remains scoped to the current browser, origin, and device;
- browser storage eviction or site-data deletion can remove the workspace;
- another device cannot read it without a future explicit export/sync feature;
- remote execution reads only the bytes the browser stages for that job;
- clearing site data removes the local authority and cannot be undone by R2;
- local document ids are not `BlobStore` object references.

As artifacts grow, OPFS becomes the byte store while IndexedDB keeps metadata,
indexes, and transactional workspace state. A successful hosted result is not
complete from the user's perspective until the browser verifies and imports it
locally.

## Hosted execution handoff (planned)

~~~text
create local workspace
  -> request an authorized execution ticket
  -> control plane issues a short-lived presigned PUT
  -> browser uploads the job source directly to temporary BlobStore
  -> control plane verifies HEAD, size, type, and checksum
  -> GCP worker receives job-scoped presigned GET/PUT URLs
  -> worker reads source, runs the component, and uploads the result bundle
  -> browser downloads, verifies, and imports the result into IndexedDB/OPFS
  -> control plane explicitly deletes the job prefix
~~~

Buckets are private. Presigned URLs are short lived, limited to the exact key
and HTTP method, and treated as bearer capabilities. The application validates
job ownership before issuing each URL and never persists a signed URL. The
browser and GCP worker receive presigned URLs, never the R2 access key or secret.

## Retention and deletion

Browser deletion removes the local workspace metadata and corresponding OPFS or
IndexedDB bytes. For active cloud work it also requests cancellation and
temporary-prefix cleanup.

Every terminal hosted job schedules idempotent deletion of its source and
outputs after the browser imports the result, or immediately after failure or
cancellation. The private R2 bucket also applies an unfiltered one-day object
expiration rule so abandoned transfers become eligible for deletion after 24
hours. Cloudflare lifecycle deletion is asynchronous, so explicit cleanup is
the primary path rather than a promise that physical removal occurs at exactly
the 24-hour mark. Object versioning and bucket-lock rules are disabled because
they could retain execution bytes beyond this policy. See Cloudflare's
[object lifecycle documentation](https://developers.cloudflare.com/r2/buckets/object-lifecycles/).

## Interactive rendering

The implemented source viewer is client-only: `react-pdf` 10.4.1 wraps the
pinned `pdfjs-dist` 5.4.296 display API, and its matching worker is bundled
locally from that package. The component is dynamically imported with server
rendering disabled. It renders the canvas and text layer while annotation
rendering, forms, XFA, and PDF.js eval support are disabled in this first slice.
The exact-version CMaps, standard fonts, JPEG 2000 and color-management WASM,
and ICC profile are served from `public/pdfjs/5.4.296/`; the viewer has no CDN
dependency and keeps these support assets version-aligned with its worker and
display API.

The generated demo PDF is available from `GET` and `HEAD`
`/v1/documents/demo/content`. That route supports one HTTP byte range per
request, including suffix and open-ended ranges, plus ETag and If-Range
handling and 416 responses. It preserves:

~~~text
206 Partial Content
Accept-Ranges: bytes
Content-Range
Content-Length
ETag
~~~

PDF responses are not dynamically gzip encoded. PDF.js renders visible pages,
keeps its text layer for selection and search, and receives a separate SVG
evidence overlay.

The page-thumbnail rail is a second view over the same browser PDF.js document,
not a server `PageRenderSet` artifact. It mounts thumbnail canvases only for the
active and near-visible pages, disables text and annotation layers, and routes
selection through the workspace's shared page state. Server PDFium thumbnails
remain explicit immutable artifacts for external consumers and evaluation.

The demo endpoint is a contract spike, not a BlobStore adapter: it generates the
demo bytes in application code, accepts only the `demo` document id, and does
not exercise ownership or domain lookup. Device-local uploaded PDFs bypass the
endpoint and are passed to `react-pdf` as `File` objects. Retained hosted
workspaces keep that browser-local read path; temporary R2 references exist only
during remote execution and never become the viewer's durable source URL.

The renderer owns page display, zoom, selection, and page-count discovery. It
does not own source evidence. A sibling overlay receives only normalized
regions whose provenance is `native`; it does not derive boxes from the PDF.js
text layer, OCR, or visual alignment. The overlay is withheld until the current
page finishes rendering. In comparison mode, a parser without native geometry
is marked unavailable; another parser's regions are never copied into its lane.

## Canonical server rendering (planned)

PDFium through a pinned pypdfium2 container will create deterministic page
images only when needed:

- first-page or page-strip thumbnails;
- source evidence supplied to LLM Judge;
- a parser whose explicit recipe accepts raster pages;
- visual regression or layout evaluation fixtures.

It is not an invisible mandatory preprocessor. PDF-native parsers receive the
original PDF unless their declared recipe says otherwise.

The renderer will emit an immutable `PageRenderSet` artifact and manifest. The
render profile will record source hash, renderer and binding revisions, OCI
digest, platform, font pack, scale or DPI, CropBox, rotation, background,
annotation policy, output dimensions, per-page object refs, and page checksums.
Basic PDF inspection will separately emit a small `PdfMetadata` artifact.

Judge and visual metrics will use this pinned server render, never a browser
screenshot.

## Native geometry only

The MVP displays only geometry returned by the parser itself.

Allowed processing:

- convert page indexes to the canonical convention;
- transform parser coordinates through the source page CropBox and rotation;
- normalize a rectangle to top-left page coordinates in the range zero to one;
- retain several native source regions for one result element.

Not allowed in the MVP:

- text alignment that invents a box;
- OCR or LLM geometry recovery;
- unioning unrelated regions into a new semantic box;
- labeling a derived mapping as native;
- assigning a zero layout score to a parser that does not expose geometry.

Canonical evidence keeps both representations:

~~~json
{
  "sourceRegions": [
    {
      "pageNumber": 1,
      "bbox": [0.12, 0.18, 0.83, 0.26],
      "provenance": "native",
      "native": {
        "bbox": [72, 700, 540, 730],
        "coordinateSystem": "pdf-bottom-left-points",
        "artifactId": "artifact_raw",
        "jsonPointer": "/kids/42"
      }
    }
  ]
}
~~~

The UI highlights every linked native source region. When no native mapping
exists it displays No source-region mapping. Derived alignment may become a
separate, visibly labeled artifact later.

Initial capability declarations are:

| Component | Native geometry exposed in the MVP |
|---|---|
| OpenDataLoader PDF | semantic block, table cell, list item, image |
| MinerU Pipeline | semantic block from content_list.json |
| LightOnOCR-2 default | none |
| LightOnOCR-2 bbox variant | embedded image only |

MinerU line and span geometry may be added as a later detail mode after version
fixtures prove the mapping. It is not required for the first hover experience.

## Storage compatibility suite

Every non-filesystem provider must pass the same tests:

- PUT, HEAD, complete GET, DELETE, and repeated delete;
- single byte-range GET returning 206 and Content-Range;
- ETag and If-Range behavior used by the PDF endpoint;
- signed PUT and GET expiration;
- browser CORS headers if direct URLs are enabled;
- multipart completion and abort;
- full job-prefix deletion and repeated cleanup;
- the provisioned hosted bucket has an unfiltered one-day expiration rule;
- concurrent immutable writes for independent parser runs.

The application uses only this verified subset even if a provider implements
more of the S3 API.
