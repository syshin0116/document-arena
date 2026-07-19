import { getDemoPdf } from "@/app/lib/demo-pdf";
import {
  respondWithDocumentContent,
  type DocumentContentSource,
} from "@/services/http/document-content";

export const dynamic = "force-dynamic";

function demoSource(): DocumentContentSource {
  const bytes = getDemoPdf();
  return {
    size: bytes.byteLength,
    etag: '"document-arena-demo-pdf-v1"',
    fileName: "attention-is-all-you-need.pdf",
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
  if (documentId !== "demo") {
    return new Response("Document not found", { status: 404 });
  }
  return respondWithDocumentContent(request, demoSource(), { head });
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
