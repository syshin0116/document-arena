const CHILD_ARRAY_KEYS = ["kids", "rows", "cells", "list items"];

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function escapePointerSegment(value) {
  return String(value).replaceAll("~", "~0").replaceAll("/", "~1");
}

function jsonPointer(path) {
  if (path.length === 0) return "";
  return `/${path.map(escapePointerSegment).join("/")}`;
}

function normalizeKind(value) {
  const kind = String(value ?? "unknown").trim().toLowerCase();
  const aliases = {
    "table cell": "table-cell",
    "table row": "table-row",
    "list item": "list-item",
    picture: "image",
  };
  return aliases[kind] ?? kind.replaceAll(/\s+/g, "-");
}

function finiteNumberArray(value, length) {
  return (
    Array.isArray(value) &&
    value.length === length &&
    value.every((item) => typeof item === "number" && Number.isFinite(item))
  );
}

function transformPoint(transform, x, y) {
  const [a, b, c, d, e, f] = transform;
  return [a * x + c * y + e, b * x + d * y + f];
}

function clampUnit(value) {
  return Math.min(1, Math.max(0, value));
}

export function normalizeNativeBbox(nativeBbox, page) {
  if (
    !finiteNumberArray(nativeBbox, 4) ||
    !finiteNumberArray(page.transform, 6) ||
    !Number.isFinite(page.width) ||
    !Number.isFinite(page.height) ||
    page.width <= 0 ||
    page.height <= 0
  ) {
    return null;
  }

  const [left, bottom, right, top] = nativeBbox;
  if (right < left || top < bottom) return null;

  const points = [
    transformPoint(page.transform, left, bottom),
    transformPoint(page.transform, left, top),
    transformPoint(page.transform, right, bottom),
    transformPoint(page.transform, right, top),
  ];
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const normalized = [
    clampUnit(Math.min(...xs) / page.width),
    clampUnit(Math.min(...ys) / page.height),
    clampUnit(Math.max(...xs) / page.width),
    clampUnit(Math.max(...ys) / page.height),
  ];

  if (normalized[2] < normalized[0] || normalized[3] < normalized[1]) {
    return null;
  }
  return normalized;
}

function blockId(node, pageNumber, pointer) {
  if (typeof node.id === "number" || typeof node.id === "string") {
    return `odl-p${pageNumber}-id-${node.id}`;
  }
  const stablePath = pointer
    .replaceAll(/[^a-zA-Z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "");
  return `odl-p${pageNumber}-path-${stablePath || "root"}`;
}

function childArrays(node) {
  return CHILD_ARRAY_KEYS.flatMap((key) => {
    const value = node[key];
    return Array.isArray(value) ? [{ key, value }] : [];
  });
}

export function normalizeOdlDocument({
  raw,
  markdown,
  pages,
  rawArtifactId,
  sourceArtifactId,
}) {
  if (!isRecord(raw) || !Array.isArray(raw.kids)) {
    throw new Error("OpenDataLoader JSON root must contain a kids array.");
  }
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new Error("At least one source page descriptor is required.");
  }

  const pageByNumber = new Map();
  const canonicalPages = pages.map((page) => {
    if (
      !Number.isInteger(page.pageNumber) ||
      page.pageNumber < 1 ||
      !Number.isFinite(page.width) ||
      !Number.isFinite(page.height)
    ) {
      throw new Error("Invalid source page descriptor.");
    }
    const canonicalPage = {
      pageNumber: page.pageNumber,
      width: page.width,
      height: page.height,
      rotation: page.rotation ?? 0,
      cropBox: page.view,
      blocks: [],
    };
    pageByNumber.set(page.pageNumber, {
      source: page,
      canonical: canonicalPage,
      readingOrder: 0,
    });
    return canonicalPage;
  });

  function walk(value, path, inheritedPageNumber, parentId) {
    if (Array.isArray(value)) {
      value.forEach((item, index) =>
        walk(item, [...path, index], inheritedPageNumber, parentId),
      );
      return;
    }
    if (!isRecord(value)) return;

    const pageNumber = Number.isInteger(value["page number"])
      ? value["page number"]
      : inheritedPageNumber;
    const pointer = jsonPointer(path);
    const pageEntry = pageByNumber.get(pageNumber);
    let nextParentId = parentId;

    if (pageEntry && typeof value.type === "string") {
      const id = blockId(value, pageNumber, pointer);
      const block = {
        id,
        kind: normalizeKind(value.type),
        readingOrder: pageEntry.readingOrder,
        rawArtifactRef: rawArtifactId,
        rawJsonPointer: pointer,
      };
      pageEntry.readingOrder += 1;

      if (parentId) block.parentId = parentId;
      if (typeof value.content === "string" && value.content.length > 0) {
        block.text = value.content;
      }
      if (Number.isInteger(value["heading level"])) {
        block.headingLevel = value["heading level"];
      }
      if (Number.isInteger(value["row number"])) {
        block.rowNumber = value["row number"];
      }
      if (Number.isInteger(value["column number"])) {
        block.columnNumber = value["column number"];
      }
      if (Number.isInteger(value["row span"])) {
        block.rowSpan = value["row span"];
      }
      if (Number.isInteger(value["column span"])) {
        block.columnSpan = value["column span"];
      }

      const nativeBbox = value["bounding box"];
      const normalizedBbox = normalizeNativeBbox(nativeBbox, pageEntry.source);
      if (normalizedBbox) {
        block.sourceRegions = [
          {
            pageNumber,
            bbox: normalizedBbox,
            provenance: "native",
            native: {
              bbox: [...nativeBbox],
              coordinateSystem: "pdf-bottom-left-points",
              artifactId: rawArtifactId,
              jsonPointer: pointer,
            },
          },
        ];
      }

      pageEntry.canonical.blocks.push(block);
      nextParentId = id;
    }

    childArrays(value).forEach(({ key, value: children }) => {
      walk(children, [...path, key], pageNumber, nextParentId);
    });
  }

  walk(raw.kids, ["kids"], undefined, undefined);

  return {
    apiVersion: "document-arena.dev/parsed-document/v1alpha1",
    sourceArtifactRef: sourceArtifactId,
    parser: {
      id: "opendataloader-pdf",
      upstreamVersion: "2.5.0",
    },
    metadata: {
      fileName: raw["file name"] ?? null,
      numberOfPages: raw["number of pages"] ?? canonicalPages.length,
      title: raw.title ?? null,
      author: raw.author ?? null,
    },
    markdown,
    pages: canonicalPages,
    rawArtifactRefs: [rawArtifactId],
  };
}
