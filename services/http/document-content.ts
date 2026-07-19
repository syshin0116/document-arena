export type ContentReadRange = {
  offset: number;
  length: number;
};

export type DocumentContentSource = {
  size: number;
  etag: string;
  fileName: string;
  mediaType: "application/pdf";
  cacheControl?: string;
  read(range: ContentReadRange): Promise<BodyInit>;
};

export type ParsedByteRange =
  | { kind: "none" }
  | { kind: "invalid" }
  | { kind: "range"; start: number; end: number };

export function parseSingleByteRange(
  value: string | null,
  size: number,
): ParsedByteRange {
  if (!value) return { kind: "none" };
  if (!value.startsWith("bytes=") || value.includes(",") || size <= 0) {
    return { kind: "invalid" };
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) return { kind: "invalid" };

  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return { kind: "invalid" };
    }
    return {
      kind: "range",
      start: Math.max(0, size - suffixLength),
      end: size - 1,
    };
  }

  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    start >= size ||
    requestedEnd < start
  ) {
    return { kind: "invalid" };
  }

  return {
    kind: "range",
    start,
    end: Math.min(requestedEnd, size - 1),
  };
}

function contentDisposition(fileName: string) {
  const encodedFileName = encodeURIComponent(fileName).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `inline; filename*=UTF-8''${encodedFileName}`;
}

function baseHeaders(source: DocumentContentSource) {
  return new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": source.cacheControl ?? "private, no-transform",
    "Content-Disposition": contentDisposition(source.fileName),
    "Content-Type": source.mediaType,
    "Cross-Origin-Resource-Policy": "same-origin",
    ETag: source.etag,
    "X-Content-Type-Options": "nosniff",
  });
}

export async function respondWithDocumentContent(
  request: Request,
  source: DocumentContentSource,
  options: { head?: boolean } = {},
) {
  const headers = baseHeaders(source);
  if (options.head) {
    headers.set("Content-Length", String(source.size));
    return new Response(null, { status: 200, headers });
  }

  const ifRange = request.headers.get("if-range");
  const range =
    ifRange && ifRange !== source.etag
      ? { kind: "none" as const }
      : parseSingleByteRange(request.headers.get("range"), source.size);

  if (range.kind === "invalid") {
    headers.set("Content-Length", "0");
    headers.set("Content-Range", `bytes */${source.size}`);
    return new Response(null, { status: 416, headers });
  }

  if (range.kind === "range") {
    const length = range.end - range.start + 1;
    headers.set("Content-Length", String(length));
    headers.set(
      "Content-Range",
      `bytes ${range.start}-${range.end}/${source.size}`,
    );
    return new Response(
      await source.read({ offset: range.start, length }),
      { status: 206, headers },
    );
  }

  headers.set("Content-Length", String(source.size));
  return new Response(
    await source.read({ offset: 0, length: source.size }),
    { status: 200, headers },
  );
}
