export type ThumbnailRenderPagesInput = {
  pageCount: number;
  activePage: number;
  visiblePages: readonly number[];
  overscan?: number;
};

function boundedPage(page: number, pageCount: number) {
  if (!Number.isFinite(page)) return null;
  const normalized = Math.floor(page);
  if (normalized < 1 || normalized > pageCount) return null;
  return normalized;
}

export function thumbnailRenderPages({
  pageCount,
  activePage,
  visiblePages,
  overscan = 1,
}: ThumbnailRenderPagesInput) {
  const normalizedCount = Math.max(0, Math.floor(pageCount));
  const normalizedOverscan = Math.max(0, Math.floor(overscan));
  if (normalizedCount === 0) return [];

  const pages = new Set<number>();
  const addWindow = (candidate: number) => {
    const page = boundedPage(candidate, normalizedCount);
    if (page === null) return;
    for (let offset = -normalizedOverscan; offset <= normalizedOverscan; offset += 1) {
      const neighbor = page + offset;
      if (neighbor >= 1 && neighbor <= normalizedCount) pages.add(neighbor);
    }
  };

  addWindow(activePage);
  visiblePages.forEach(addWindow);
  return [...pages].sort((left, right) => left - right);
}
