"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import { loadLocalDocument } from "../local-document-store";
import type { SourceEvidenceRegion } from "../evidence-regions";
import { SourceEvidenceOverlay } from "./SourceEvidenceOverlay";
import { PdfThumbnailRail } from "./PdfThumbnailRail";
import { PDF_OPTIONS } from "../pdf-options";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

const DEMO_PDF_URL = "/v1/documents/demo/content";

function ViewerMessage({
  tone = "loading",
  title,
  detail,
}: {
  tone?: "loading" | "error";
  title: string;
  detail: string;
}) {
  return (
    <div className="pdf-viewer-message" data-tone={tone} role={tone === "error" ? "alert" : "status"}>
      {tone === "loading" && <span className="spinner" aria-hidden="true" />}
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}

export default function PdfSourceViewer({
  documentId,
  demo,
  pageNumber,
  zoom,
  thumbnailsOpen,
  regions,
  regionParserId,
  activeEvidence,
  pinnedEvidence,
  comparing,
  onPageCountChange,
  onPageChange,
  onFileNameChange,
  onActivateEvidence,
  onPinEvidence,
}: {
  documentId: string;
  demo: boolean;
  pageNumber: number;
  zoom: number;
  thumbnailsOpen: boolean;
  regions: readonly SourceEvidenceRegion[];
  regionParserId: string;
  activeEvidence: string | null;
  pinnedEvidence: string | null;
  comparing: boolean;
  onPageCountChange: (count: number) => void;
  onPageChange: (page: number) => void;
  onFileNameChange: (name: string) => void;
  onActivateEvidence: (id: string | null) => void;
  onPinEvidence: (id: string) => void;
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const [localFile, setLocalFile] = useState<File | null>(null);
  const [availableWidth, setAvailableWidth] = useState(560);
  const [availableHeight, setAvailableHeight] = useState(720);
  // page height / width, so we can size the page to fit both dimensions.
  const [pageAspect, setPageAspect] = useState<number | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [renderedPageKey, setRenderedPageKey] = useState<string | null>(null);
  const [loadedPageCount, setLoadedPageCount] = useState<number | null>(null);
  const wheelCooldown = useRef(false);

  // Scrolling past the top/bottom of the current page turns the page, so the
  // source reads like a continuous document even though one page renders at a
  // time. A short cooldown stops a single wheel gesture from skipping pages.
  const handleViewportWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    const node = viewportRef.current;
    if (!node || wheelCooldown.current) return;
    const atBottom =
      node.scrollTop + node.clientHeight >= node.scrollHeight - 2;
    const atTop = node.scrollTop <= 2;
    const turn = (next: number) => {
      wheelCooldown.current = true;
      onPageChange(next);
      window.setTimeout(() => {
        wheelCooldown.current = false;
      }, 300);
    };
    if (event.deltaY > 6 && atBottom && loadedPageCount && pageNumber < loadedPageCount) {
      node.scrollTop = 0;
      turn(pageNumber + 1);
    } else if (event.deltaY < -6 && atTop && pageNumber > 1) {
      turn(pageNumber - 1);
    }
  };

  useEffect(() => {
    if (demo) return;

    let cancelled = false;

    loadLocalDocument(documentId)
      .then((document) => {
        if (cancelled) return;
        if (!document) {
          setSourceError("This local PDF is no longer available. Upload it again on this device.");
          return;
        }
        onFileNameChange(document.file.name);
        setLocalFile(document.file);
      })
      .catch(() => {
        if (!cancelled) {
          setSourceError("The browser could not open this local PDF workspace.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [demo, documentId, onFileNameChange]);

  // Hand react-pdf a stable object URL rather than the File itself. pdfjs
  // transfers the document's ArrayBuffer to its worker, which detaches the
  // underlying buffer; passing the File directly then crashes on the next
  // render ("Cannot perform Construct on a detached ArrayBuffer"). An object
  // URL lets pdfjs fetch its own copy, so our stored blob is never detached.
  const localUrl = useMemo(
    () => (localFile ? URL.createObjectURL(localFile) : null),
    [localFile],
  );
  useEffect(() => {
    if (!localUrl) return;
    return () => URL.revokeObjectURL(localUrl);
  }, [localUrl]);

  // Attach the width observer via a callback ref so it tracks the viewport no
  // matter when it mounts (the node is rendered conditionally on `file`). We
  // measure synchronously on attach and ignore a zero width (which happens when
  // the pane is momentarily detached), so a re-render never collapses the page
  // to the fallback width and renders it small.
  const attachViewport = useCallback((node: HTMLDivElement | null) => {
    resizeObserverRef.current?.disconnect();
    viewportRef.current = node;
    if (!node) return;
    const measure = () => {
      const width = node.clientWidth;
      const height = node.clientHeight;
      if (width <= 0) return;
      setAvailableWidth((current) =>
        Math.abs(width - current) < 4 ? current : width,
      );
      if (height > 0) {
        setAvailableHeight((current) =>
          Math.abs(height - current) < 4 ? current : height,
        );
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    resizeObserverRef.current = observer;
  }, []);

  const file = useMemo(
    () => (demo ? DEMO_PDF_URL : localUrl),
    [demo, localUrl],
  );
  // Fit the page to the viewport in BOTH dimensions at 100% zoom, so a normal
  // page fills the pane without producing a vertical scrollbar. Zooming past
  // 100% is what deliberately overflows and scrolls.
  const widthFit = Math.min(1200, Math.max(220, availableWidth - 56));
  // The viewport has ~96px of vertical padding; subtract it so the fitted page
  // does not overflow and produce a scrollbar.
  const heightFit = pageAspect
    ? Math.max(220, (availableHeight - 104) / pageAspect)
    : widthFit;
  const fitWidth = Math.min(widthFit, heightFit);
  const pageWidth = Math.round(fitWidth * (zoom / 100));
  const pageRenderKey = `${pageNumber}:${pageWidth}`;

  return (
    <div className="pdf-viewer-shell">
      {sourceError ? (
        <ViewerMessage
          tone="error"
          title="Could not open the PDF"
          detail={sourceError}
        />
      ) : file ? (
        <Document
          file={file}
          options={PDF_OPTIONS}
          loading={
            <ViewerMessage
              title="Loading source PDF"
              detail="Preparing the first visible page"
            />
          }
          error={
            <ViewerMessage
              tone="error"
              title="Could not render this PDF"
              detail="The file may be damaged or use an unsupported PDF feature."
            />
          }
          onLoadSuccess={(pdf) => {
            setLoadedPageCount(pdf.numPages);
            onPageCountChange(pdf.numPages);
          }}
          onLoadError={() => setSourceError("The PDF could not be decoded safely.")}
          onPassword={() =>
            setSourceError("Password-protected PDFs are not supported in this first viewer slice.")
          }
        >
          <div
            className="pdf-document-layout"
            data-rail-open={thumbnailsOpen || undefined}
          >
            {loadedPageCount && (
              <PdfThumbnailRail
                open={thumbnailsOpen}
                pageCount={loadedPageCount}
                pageNumber={pageNumber}
                onPageChange={onPageChange}
              />
            )}
            <div
              key="main-page"
              ref={attachViewport}
              className="pdf-main-viewport"
              onWheel={handleViewportWheel}
            >
              <div className="pdf-page-frame" style={{ width: pageWidth }}>
                <Page
                  key={pageRenderKey}
                  pageNumber={pageNumber}
                  width={pageWidth}
                  onLoadSuccess={(loadedPage) => {
                    if (loadedPage.width > 0) {
                      setPageAspect(loadedPage.height / loadedPage.width);
                    }
                  }}
                  renderAnnotationLayer={false}
                  renderForms={false}
                  renderTextLayer
                  onRenderSuccess={() => setRenderedPageKey(pageRenderKey)}
                  onRenderError={() => setRenderedPageKey(null)}
                  loading={
                    <div
                      className="pdf-page-placeholder"
                      aria-label={`Loading PDF page ${pageNumber}`}
                    />
                  }
                  error={
                    <div className="pdf-page-error" role="alert">
                      <strong>Could not render page {pageNumber}</strong>
                      <span>
                        Source evidence is hidden until the page renders successfully.
                      </span>
                    </div>
                  }
                />
                {renderedPageKey === pageRenderKey && (
                  <SourceEvidenceOverlay
                    regions={regions}
                    parserId={regionParserId}
                    pageNumber={pageNumber}
                    activeEvidence={activeEvidence}
                    pinnedEvidence={pinnedEvidence}
                    comparing={comparing}
                    onActivate={onActivateEvidence}
                    onPin={onPinEvidence}
                  />
                )}
              </div>
            </div>
          </div>
        </Document>
      ) : (
        <ViewerMessage
          title="Opening local PDF"
          detail="Reading the copy stored on this device"
        />
      )}
    </div>
  );
}
