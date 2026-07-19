"use client";

import {
  isNormalizedBbox,
  type NormalizedBbox,
  type SourceEvidenceRegion,
} from "./evidence-regions";

// The local runner service (services/runner/serve.mjs) listens on this port on
// the same machine. The document goes browser → local runner directly; it never
// passes through the web control plane.
const LOCAL_RUNNER_ORIGIN = "http://localhost:8799";

export type OptionsSchemaProperty = {
  type?: string;
  enum?: readonly string[];
  default?: unknown;
  description?: string;
};

export type LocalRunnerComponent = {
  id: string;
  version: string;
  upstreamVersion?: string;
  displayName?: string;
  image: string;
  imageAvailable?: boolean;
  capabilities?: Record<string, unknown>;
  requirements?: Record<string, unknown>;
  optionsSchema?: {
    title?: string;
    properties?: Record<string, OptionsSchemaProperty>;
  } | null;
};

export type LocalRunnerInfo = {
  component: LocalRunnerComponent;
  components?: LocalRunnerComponent[];
};

export function runnerComponent(
  info: LocalRunnerInfo | null,
  componentId: string,
): LocalRunnerComponent | null {
  if (!info) return null;
  const list = info.components ?? [info.component];
  return list.find((component) => component.id === componentId) ?? null;
}

export type CanonicalSourceRegion = {
  pageNumber: number;
  bbox: readonly [number, number, number, number];
  provenance: "native";
  native: {
    bbox: readonly number[];
    coordinateSystem: string;
    artifactId: string;
    jsonPointer: string;
    // Word-level boxes (Azure DI): the individual normalized word rectangles
    // whose union is this region. Present only when a parser reports below the
    // segment level. Native mode shows these; merged mode shows the union.
    words?: readonly (readonly number[])[];
  };
};

export type CanonicalBlock = {
  id: string;
  kind: string;
  readingOrder?: number;
  text?: string;
  headingLevel?: number;
  rawJsonPointer?: string;
  sourceRegions?: readonly CanonicalSourceRegion[];
};

export type CanonicalPage = {
  pageNumber: number;
  width: number;
  height: number;
  blocks: readonly CanonicalBlock[];
};

export type CanonicalParsedDocument = {
  apiVersion: string;
  parser: { id: string; upstreamVersion?: string };
  metadata?: { fileName?: string; numberOfPages?: number };
  markdown?: string;
  pages: readonly CanonicalPage[];
};

export type LocalParseResult = {
  component: { id: string; version: string; image: string; imageId?: string };
  source?: { artifactId?: string; sha256?: string; sizeBytes?: number };
  options?: Record<string, unknown>;
  durationMs: number;
  blockCount: number;
  nativeRegionCount: number;
  outputDirectory: string;
  parsedDocument: CanonicalParsedDocument;
};

export async function checkLocalRunner(): Promise<LocalRunnerInfo | null> {
  try {
    const response = await fetch(`${LOCAL_RUNNER_ORIGIN}/v1/health`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { ok?: boolean } & LocalRunnerInfo;
    return body.ok && body.component ? body : null;
  } catch {
    return null;
  }
}

export type ParseProgress = {
  phase: string;
  detail?: string;
  stage?: string;
  current?: number;
  total?: number;
};

export async function parseWithLocalRunner(
  file: File,
  componentId = "opendataloader-pdf",
  onProgress?: (progress: ParseProgress) => void,
  options?: Record<string, unknown>,
): Promise<LocalParseResult> {
  const optionsQuery =
    options && Object.keys(options).length > 0
      ? `&options=${encodeURIComponent(JSON.stringify(options))}`
      : "";
  const response = await fetch(
    `${LOCAL_RUNNER_ORIGIN}/v1/parse?component=${encodeURIComponent(componentId)}${optionsQuery}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/pdf",
        "x-parser-arena-filename": encodeURIComponent(file.name),
      },
      body: file,
    },
  );

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/x-ndjson")) {
    const body = (await response.json().catch(() => null)) as
      | (LocalParseResult & { ok?: boolean; error?: string })
      | null;
    if (!response.ok || !body?.ok) {
      throw new Error(
        body?.error ?? `Local runner returned ${response.status}.`,
      );
    }
    return body;
  }

  if (!response.body) throw new Error("Local runner returned no body.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  let result: LocalParseResult | null = null;
  let failure: string | null = null;

  const consume = (line: string) => {
    if (!line.trim()) return;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    if (event.type === "stage.phase" && typeof event.phase === "string") {
      onProgress?.({ phase: event.phase });
    } else if (event.type === "stage.progress") {
      onProgress?.({
        phase: typeof event.phase === "string" ? event.phase : "parsing",
        detail: typeof event.detail === "string" ? event.detail : undefined,
        stage: typeof event.stage === "string" ? event.stage : undefined,
        current: typeof event.current === "number" ? event.current : undefined,
        total: typeof event.total === "number" ? event.total : undefined,
      });
    } else if (event.type === "result" && event.ok) {
      result = event as unknown as LocalParseResult;
    } else if (event.type === "error" && typeof event.error === "string") {
      failure = event.error;
    } else if (
      event.type === "stage.failed" &&
      typeof event.message === "string"
    ) {
      failure = event.message;
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffered += decoder.decode(value, { stream: true });
    let newline = buffered.indexOf("\n");
    while (newline !== -1) {
      consume(buffered.slice(0, newline));
      buffered = buffered.slice(newline + 1);
      newline = buffered.indexOf("\n");
    }
  }
  consume(buffered);

  if (result) return result;
  throw new Error(failure ?? "The local runner stream ended without a result.");
}

export function blockLabel(block: CanonicalBlock): string {
  const kind = block.kind.charAt(0).toUpperCase() + block.kind.slice(1);
  const text = (block.text ?? "").trim();
  if (!text) return kind;
  return `${kind} · ${text.length > 42 ? `${text.slice(0, 42)}…` : text}`;
}

/**
 * Structural container rows/cells carry no text of their own; their content
 * arrives as separate child blocks. Rendering the empty containers only adds
 * noise, so both the block list and the evidence overlay skip them.
 */
export function isRenderableBlock(block: CanonicalBlock): boolean {
  if ((block.text ?? "").trim().length > 0) return true;
  return block.kind !== "table-row" && block.kind !== "table-cell";
}

export type ReadingCell = {
  text: string;
  evidenceBlockId: string | null;
};

export type ReadingNode =
  | { type: "block"; block: CanonicalBlock }
  | { type: "table"; block: CanonicalBlock; rows: ReadingCell[][] };

/**
 * Rebuilds a document-like reading structure from the flattened canonical
 * blocks. Table grids are reconstructed from each block's rawJsonPointer
 * (`.../rows/<r>/cells/<c>/...`), and every rendered element keeps the id of
 * the canonical block that carries its native evidence region.
 */
export function buildReadingNodes(
  blocks: readonly CanonicalBlock[],
  options?: { merge?: boolean },
): ReadingNode[] {
  const merge = options?.merge ?? false;
  const nodes: ReadingNode[] = [];
  const consumed = new Set<string>();

  for (const block of blocks) {
    if (consumed.has(block.id)) continue;

    if (block.kind === "table" && block.rawJsonPointer) {
      const tablePointer = block.rawJsonPointer;
      const children = blocks.filter(
        (candidate) =>
          candidate.id !== block.id &&
          candidate.rawJsonPointer?.startsWith(`${tablePointer}/rows/`),
      );
      for (const child of children) consumed.add(child.id);

      const cellMap = new Map<string, { text: string[]; blockId: string | null }>();
      let maxRow = -1;
      let maxColumn = -1;
      for (const child of children) {
        const match = child.rawJsonPointer
          ?.slice(tablePointer.length)
          .match(/^\/rows\/(\d+)\/cells\/(\d+)/);
        if (!match) continue;
        const row = Number(match[1]);
        const column = Number(match[2]);
        maxRow = Math.max(maxRow, row);
        maxColumn = Math.max(maxColumn, column);
        const key = `${row}:${column}`;
        const cell = cellMap.get(key) ?? { text: [], blockId: null };
        const text = (child.text ?? "").trim();
        if (text) {
          cell.text.push(text);
          // Merged mode: every cell of this table hovers to one table id.
          cell.blockId ??= merge ? `table:${tablePointer}` : child.id;
        }
        cellMap.set(key, cell);
      }

      if (maxRow >= 0) {
        const rows: ReadingCell[][] = [];
        for (let row = 0; row <= maxRow; row += 1) {
          const cells: ReadingCell[] = [];
          for (let column = 0; column <= maxColumn; column += 1) {
            const cell = cellMap.get(`${row}:${column}`);
            cells.push({
              text: cell?.text.join(" ") ?? "",
              evidenceBlockId: cell?.blockId ?? null,
            });
          }
          rows.push(cells);
        }
        nodes.push({ type: "table", block, rows });
        continue;
      }
    }

    if (!isRenderableBlock(block)) continue;
    nodes.push({ type: "block", block });
  }

  return nodes;
}

/**
 * Groups blocks that belong to the same table. A parser like OpenDataLoader
 * flattens a table into `table` + `table-row` + `table-cell` + cell-text
 * blocks whose rawJsonPointer encodes the hierarchy
 * (`/kids/3/rows/0/cells/0/...`); all of them share the root `/kids/3`.
 * Returns null for blocks that are not part of a table.
 */
function tableGroupRoot(block: CanonicalBlock): string | null {
  const ptr = block.rawJsonPointer;
  if (!ptr) return null;
  const rowsIndex = ptr.indexOf("/rows/");
  if (rowsIndex !== -1) return ptr.slice(0, rowsIndex);
  if (block.kind === "table") return ptr;
  return null;
}

/**
 * The evidence id a block hovers to. In native mode this is the block itself.
 * In merged mode, every block of one table collapses to a single
 * `table:<root>` id so hovering any cell lights the whole table.
 */
export function evidenceIdForBlock(
  block: CanonicalBlock,
  merge: boolean,
): string {
  if (!merge) return block.id;
  const root = tableGroupRoot(block);
  return root ? `table:${root}` : block.id;
}

function unionBbox(a: NormalizedBbox, b: NormalizedBbox): NormalizedBbox {
  return [
    Math.min(a[0], b[0]),
    Math.min(a[1], b[1]),
    Math.max(a[2], b[2]),
    Math.max(a[3], b[3]),
  ];
}

/**
 * Maps canonical blocks to viewer evidence regions. Only parser-native
 * regions with valid normalized geometry are emitted; blocks without native
 * geometry simply produce nothing, they are never inferred.
 *
 * In native mode (default) every block keeps its own parser-reported box —
 * nothing is joined. In merged mode the native boxes of one table are unioned
 * into a single region; this is a pure geometric union of parser-native boxes,
 * never a text-to-coordinate inference.
 */
export function toEvidenceRegions(
  parsed: CanonicalParsedDocument,
  parserId: string,
  options?: { merge?: boolean },
): SourceEvidenceRegion[] {
  const merge = options?.merge ?? false;
  const regions: SourceEvidenceRegion[] = [];

  for (const page of parsed.pages) {
    if (!merge) {
      for (const block of page.blocks) {
        if (!isRenderableBlock(block)) continue;
        const region = block.sourceRegions?.[0];
        if (!region || region.provenance !== "native") continue;
        if (!isNormalizedBbox(region.bbox)) continue;
        const words = region.native.words;
        if (words && words.length > 0) {
          // Native mode below the segment level: draw each parser word box,
          // all sharing the segment's evidence id so the whole line hovers.
          let index = 0;
          for (const word of words) {
            if (!isNormalizedBbox(word)) continue;
            regions.push({
              id: block.id,
              parserId,
              label: blockLabel(block),
              pageNumber: region.pageNumber,
              bbox: word,
              provenance: "native",
              artifactId: region.native.artifactId,
              jsonPointer: `${region.native.jsonPointer}#w${index}`,
            });
            index += 1;
          }
          continue;
        }
        regions.push({
          id: block.id,
          parserId,
          label: blockLabel(block),
          pageNumber: region.pageNumber,
          bbox: region.bbox,
          provenance: "native",
          artifactId: region.native.artifactId,
          jsonPointer: region.native.jsonPointer,
        });
      }
      continue;
    }

    // Merged: union every native box that shares an evidence id. Structural
    // rows/cells contribute their geometry even though they are not rendered.
    const byId = new Map<string, SourceEvidenceRegion>();
    for (const block of page.blocks) {
      const region = block.sourceRegions?.[0];
      if (!region || region.provenance !== "native") continue;
      if (!isNormalizedBbox(region.bbox)) continue;
      const id = evidenceIdForBlock(block, true);
      const existing = byId.get(id);
      if (existing) {
        existing.bbox = unionBbox(existing.bbox, region.bbox);
      } else {
        byId.set(id, {
          id,
          parserId,
          label: id.startsWith("table:") ? "Table" : blockLabel(block),
          pageNumber: region.pageNumber,
          bbox: region.bbox,
          provenance: "native",
          artifactId: region.native.artifactId,
          jsonPointer: region.native.jsonPointer,
        });
      }
    }
    regions.push(...byId.values());
  }

  return regions;
}
