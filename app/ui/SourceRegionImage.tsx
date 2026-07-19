"use client";

import { useEffect, useRef, useState } from "react";
import { pdfjs } from "react-pdf";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { loadLocalDocument } from "../local-document-store";
import type { NormalizedBbox } from "../evidence-regions";
import { PDF_OPTIONS } from "../pdf-options";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

// One shared document per workspace: every image crop reuses the same loaded
// PDF instead of re-decoding the file per block.
const documentCache = new Map<string, Promise<PDFDocumentProxy>>();

function getCachedDocument(documentId: string): Promise<PDFDocumentProxy> {
  let cached = documentCache.get(documentId);
  if (!cached) {
    cached = loadLocalDocument(documentId).then(async (document) => {
      if (!document) {
        throw new Error("This local PDF is no longer available.");
      }
      const data = await document.file.arrayBuffer();
      return pdfjs.getDocument({ ...PDF_OPTIONS, data }).promise;
    });
    documentCache.set(documentId, cached);
    cached.catch(() => documentCache.delete(documentId));
  }
  return cached;
}

/**
 * Renders the source-page crop at a parser-reported native region. The pixels
 * come from the original PDF; only the geometry comes from the parser, and
 * the caption says so.
 */
export function SourceRegionImage({
  documentId,
  pageNumber,
  bbox,
}: {
  documentId: string;
  pageNumber: number;
  bbox: NormalizedBbox;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const pdf = await getCachedDocument(documentId);
      const page = await pdf.getPage(pageNumber);
      const canvas = canvasRef.current;
      if (cancelled || !canvas) return;

      const [xMin, yMin, xMax, yMax] = bbox;
      const baseViewport = page.getViewport({ scale: 1 });
      const targetCssWidth = 420;
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const scale =
        (targetCssWidth / ((xMax - xMin) * baseViewport.width)) * pixelRatio;
      const viewport = page.getViewport({ scale });

      const width = Math.max(1, Math.round((xMax - xMin) * viewport.width));
      const height = Math.max(1, Math.round((yMax - yMin) * viewport.height));
      canvas.width = width;
      canvas.height = height;
      canvas.style.aspectRatio = `${width} / ${height}`;

      const context = canvas.getContext("2d");
      if (!context) return;
      context.translate(
        -Math.round(xMin * viewport.width),
        -Math.round(yMin * viewport.height),
      );
      await page.render({ canvas, canvasContext: context, viewport }).promise;
    })().catch(() => {
      if (!cancelled) setFailed(true);
    });

    return () => {
      cancelled = true;
    };
  }, [documentId, pageNumber, bbox]);

  if (failed) return null;

  return (
    <span className="region-image">
      <canvas ref={canvasRef} aria-label="Source crop at the parser-reported image region" />
      <small>source crop · parser-reported region</small>
    </span>
  );
}
