"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Page } from "react-pdf";
import { thumbnailRenderPages } from "../pdf-thumbnail-pages";

const THUMBNAIL_WIDTH = 76;

export function PdfThumbnailRail({
  open,
  pageCount,
  pageNumber,
  onPageChange,
}: {
  open: boolean;
  pageCount: number;
  pageNumber: number;
  onPageChange: (page: number) => void;
}) {
  const railRef = useRef<HTMLElement>(null);
  const [visiblePages, setVisiblePages] = useState<readonly number[]>(() =>
    Array.from({ length: Math.min(pageCount, 3) }, (_, index) => index + 1),
  );
  const pages = useMemo(
    () => Array.from({ length: pageCount }, (_, index) => index + 1),
    [pageCount],
  );
  const renderedPages = useMemo(
    () =>
      new Set(
        thumbnailRenderPages({
          pageCount,
          activePage: pageNumber,
          visiblePages,
          overscan: 1,
        }),
      ),
    [pageCount, pageNumber, visiblePages],
  );

  useEffect(() => {
    const rail = railRef.current;
    if (!open || !rail || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        setVisiblePages((current) => {
          const next = new Set(current);
          for (const entry of entries) {
            const page = Number(
              (entry.target as HTMLElement).dataset.thumbnailPage,
            );
            if (!Number.isInteger(page)) continue;
            if (entry.isIntersecting) next.add(page);
            else next.delete(page);
          }
          const normalized = [...next].sort((left, right) => left - right);
          if (
            normalized.length === current.length &&
            normalized.every((page, index) => page === current[index])
          ) {
            return current;
          }
          return normalized;
        });
      },
      { root: rail, rootMargin: "180px" },
    );

    rail
      .querySelectorAll<HTMLElement>("[data-thumbnail-page]")
      .forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, [open, pageCount]);

  useEffect(() => {
    if (!open) return;
    railRef.current
      ?.querySelector<HTMLElement>(`[data-thumbnail-page="${pageNumber}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [open, pageNumber]);

  function moveFromKeyboard(event: React.KeyboardEvent, page: number) {
    const nextPage =
      event.key === "ArrowDown" || event.key === "ArrowRight"
        ? Math.min(pageCount, page + 1)
        : event.key === "ArrowUp" || event.key === "ArrowLeft"
          ? Math.max(1, page - 1)
          : event.key === "Home"
            ? 1
            : event.key === "End"
              ? pageCount
              : null;
    if (nextPage === null) return;

    event.preventDefault();
    onPageChange(nextPage);
    requestAnimationFrame(() => {
      railRef.current
        ?.querySelector<HTMLButtonElement>(`[data-thumbnail-button="${nextPage}"]`)
        ?.focus();
    });
  }

  return (
    <nav
      id="pdf-thumbnail-rail"
      ref={railRef}
      className="pdf-thumbnail-rail"
      aria-label="Page thumbnails"
      hidden={!open}
    >
      <ol className="pdf-thumbnail-list">
        {pages.map((page) => {
          const active = page === pageNumber;
          const shouldRender = open && renderedPages.has(page);
          return (
            <li
              key={page}
              className="pdf-thumbnail-item"
              data-active={active || undefined}
              data-thumbnail-page={page}
            >
              <div className="pdf-thumbnail-preview" aria-hidden="true">
                {shouldRender ? (
                  <Page
                    pageNumber={page}
                    width={THUMBNAIL_WIDTH}
                    devicePixelRatio={1}
                    renderAnnotationLayer={false}
                    renderForms={false}
                    renderTextLayer={false}
                    loading={<span className="pdf-thumbnail-placeholder" />}
                    error={<span className="pdf-thumbnail-error">!</span>}
                  />
                ) : (
                  <span className="pdf-thumbnail-placeholder" />
                )}
              </div>
              <button
                className="pdf-thumbnail-button"
                type="button"
                data-thumbnail-button={page}
                aria-current={active ? "page" : undefined}
                aria-label={`Go to page ${page} of ${pageCount}`}
                tabIndex={active ? 0 : -1}
                onClick={() => onPageChange(page)}
                onKeyDown={(event) => moveFromKeyboard(event, page)}
              />
              <span className="pdf-thumbnail-label" aria-hidden="true">
                {page}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
