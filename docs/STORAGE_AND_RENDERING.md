# Storage, rendering, and native geometry

Status: accepted architecture boundary  
Date: 2026-07-15

## Storage decision

Parser Arena's production and reference deployments do not depend on the AWS S3
service. They depend on a small S3-compatible BlobStore contract. This is the
accepted target boundary; the current uploaded-document UI slice still uses the
device-local handoff described below.

| Deployment | Blob implementation |
|---|---|
| Minimal unit development | Local filesystem |
| Reference open-source Docker deployment | SeaweedFS |
| Hosted public service | Cloudflare R2 |
| Optional tested compatibility profiles | Garage, AWS S3, or another verified endpoint |
| Experimental compatibility profile | RustFS |

SeaweedFS is the default self-hosted service because it is Apache-2.0, actively
maintained, supports the required S3 subset, and can grow beyond a single-node
deployment. Garage's AGPL license does not make deployment automatically
forbidden, but a modified network service needs a deliberate source-offer and
compliance plan, so it is optional rather than the default. RustFS remains
experimental until its distributed and lifecycle behavior is stable enough for
the compatibility suite. This is a product dependency policy, not legal advice.

## BlobStore contract

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

Listing objects is not the artifact index. The domain database records every
logical artifact, object key, checksum, ETag, size, media type, lineage, and
retention deadline.

ETag is retained for HTTP caching and range requests but is never assumed to be
the content SHA-256. The application calculates or verifies SHA-256 separately.

No core branch may check whether the provider is SeaweedFS or R2. Provider
configuration supplies endpoint, region, addressing style, bucket, and
credentials.

## Object layout

Use a small number of private buckets and prefixes, never one bucket per
document.

~~~text
documents/{documentId}/source/original.pdf
documents/{documentId}/source/manifest.json

renders/{documentId}/{renderProfileHash}/manifest.json
renders/{documentId}/{renderProfileHash}/page-0001.png
renders/{documentId}/{renderProfileHash}/thumb-0001.webp

runs/{runId}/stages/{stageRunId}/raw/...
runs/{runId}/stages/{stageRunId}/primary/...
runs/{runId}/result.json

evaluations/{evaluationRunId}/...
~~~

Keys are immutable. SHA-256 remains metadata and a cache input; it is not
exposed as a cross-tenant public lookup key.

## Current device-local MVP handoff

The implemented upload page does not yet write to BlobStore. It stores the PDF
Blob in browser IndexedDB under an opaque `local_...` workspace id, navigates to
that workspace, reconstructs a `File`, and passes it directly to the client PDF
viewer.

This handoff makes the first rendering slice usable without pretending that the
service upload boundary exists. It has explicit limits:

- the PDF remains scoped to the current browser, origin, and device;
- browser storage eviction or site-data deletion can remove the workspace;
- another device, a server parser runner, and a remote Judge cannot read it;
- it does not implement server verification, retention, sharing, deletion
  receipts, or authoritative document records;
- local document ids are not production document ids or BlobStore references.

No production path may treat IndexedDB as the document system of record. The
handoff is replaced, rather than migrated into a storage adapter, when the
upload/finalize flow below lands.

## Production upload path (planned)

~~~text
create Document
  -> issue short-lived signed PUT
  -> browser uploads source
  -> client calls upload-complete
  -> server verifies HEAD, size, type, and checksum
  -> domain transaction queues ingest + outbox
  -> dispatcher starts ingest workflow
  -> mark workspace ready
~~~

Buckets are private. Signed URLs are short lived and treated as bearer tokens.
The application validates ownership before issuing any URL.

## Retention and deletion

The domain expiresAt value is authoritative. Deletion first tombstones the
document and cancels active jobs. An outbox-driven idempotent cleanup job then
removes the source, renders, raw outputs, canonical results, evaluation
artifacts, events, and workflow checkpoints. A retryable deletion receipt
records each provider operation before the domain tombstone is finally purged.

Bucket lifecycle rules are only a safety net for missed cleanup. Object
versioning is disabled by default so a privacy deletion does not leave hidden
versions.

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
endpoint and are passed to `react-pdf` as `File` objects. The production version
will keep the same HTTP behavior while resolving an authorized immutable source
artifact and forwarding its range from BlobStore.

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
- persistence across container restart;
- full document-prefix deletion;
- concurrent immutable writes for independent parser runs.

The application uses only this verified subset even if a provider implements
more of the S3 API.
