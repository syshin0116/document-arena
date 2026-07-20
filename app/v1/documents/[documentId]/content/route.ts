import {
  getSamplePdfFor,
  sampleDocumentFor,
} from "@/app/lib/sample-document";
import type { SampleDocumentMeta } from "@/app/lib/sample-documents-meta";
import {
  respondWithDocumentContent,
  type DocumentContentSource,
} from "@/services/http/document-content";

export const dynamic = "force-dynamic";

function sampleSource(sample: SampleDocumentMeta): DocumentContentSource {
  const bytes = getSamplePdfFor(sample);
  return {
    size: bytes.byteLength,
    /* Keyed by sample id so three immutable responses cannot share one tag. */
    etag: `"document-arena-sample-${sample.id}-v1"`,
    fileName: sample.pdfFileName,
    mediaType: "application/pdf",
    cacheControl: "public, max-age=3600, immutable, no-transform",
    async read({ offset, length }) {
      return bytes.slice(offset, offset + length).buffer;
    },
  };
}

async function contentResponse(
  request: Request,
  context: { params: Promise<{ documentId: string }> },
  head = false,
) {
  const { documentId } = await context.params;
  const sample = sampleDocumentFor(documentId);
  if (!sample) {
    return new Response("Document not found", { status: 404 });
  }
  return respondWithDocumentContent(request, sampleSource(sample), { head });
}

export function GET(
  request: Request,
  context: { params: Promise<{ documentId: string }> },
) {
  return contentResponse(request, context);
}

export function HEAD(
  request: Request,
  context: { params: Promise<{ documentId: string }> },
) {
  return contentResponse(request, context, true);
}
