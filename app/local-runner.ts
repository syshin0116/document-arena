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

export type OptionsSchemaPrimitive = string | number | boolean | null;

export type OptionsSchemaAvailability = {
  state: "fixed" | "unavailable";
  reason: string;
  reasonCode?: string;
};

export type OptionsSchemaAnnotation = {
  disabledReason?: string;
  sourceUrl?: string;
  availability?: OptionsSchemaAvailability;
};

export type OptionsSchemaChoice = {
  const?: OptionsSchemaPrimitive;
  enum?: readonly OptionsSchemaPrimitive[];
  title?: string;
  description?: string;
  "x-document-arena"?: OptionsSchemaAnnotation;
};

export type OptionsSchemaItems = {
  type?: "string" | "boolean" | "number" | "integer";
  enum?: readonly OptionsSchemaPrimitive[];
  oneOf?: readonly OptionsSchemaChoice[];
  minLength?: number;
  maxLength?: number;
};

export type OptionsSchemaProperty = {
  type?: "string" | "boolean" | "number" | "integer" | "array";
  title?: string;
  const?: OptionsSchemaPrimitive;
  enum?: readonly OptionsSchemaPrimitive[];
  oneOf?: readonly OptionsSchemaChoice[];
  not?: {
    const?: OptionsSchemaPrimitive;
  };
  items?: OptionsSchemaItems;
  default?: unknown;
  description?: string;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  "x-document-arena"?: OptionsSchemaAnnotation;
};

export type LocalRunnerRequirements = Record<string, unknown> & {
  network?: string;
  connection?:
    | (Record<string, unknown> & {
        type?: string;
      })
    | null;
};

export type LocalRunnerComponent = {
  id: string;
  version: string;
  upstreamVersion?: string;
  displayName?: string;
  image: string;
  imageAvailable?: boolean;
  availability?: {
    runnable: boolean;
    reasons?: readonly {
      code?: string;
      message: string;
    }[];
  };
  capabilities?: Record<string, unknown>;
  requirements?: LocalRunnerRequirements;
  optionsSchema?: {
    title?: string;
    description?: string;
    required?: readonly string[];
    properties?: Record<string, OptionsSchemaProperty>;
  } | null;
};

/**
 * Remote execution is a manifest capability, never a property of a known
 * component id. Keeping this predicate at the runner boundary lets every run
 * entry point apply the same consent policy as the catalog grows.
 */
export function requiresRemoteConsent(
  component: LocalRunnerComponent | null | undefined,
): boolean {
  return component?.requirements?.network === "remote";
}

export type ExecutionPlan = Readonly<{
  location: "device" | "hosted";
  leavesDevice: boolean;
  destinationName: string;
  region?: string;
  retentionPolicyVersion?: string;
  retentionSeconds?: number;
  externalProcessor?: Readonly<{
    name: string;
    retentionKnown: boolean;
  }>;
}>;

/**
 * Container network permission and document-transfer consent are different
 * concerns. A hosted runner can execute a network-isolated component while
 * the PDF still leaves the device; a device-local adapter can call an external
 * provider. Deployment composition resolves this plan before a run starts.
 */
export function requiresDocumentTransferConsent(plan: ExecutionPlan): boolean {
  return plan.leavesDevice;
}

export function deviceExecutionPlan(
  component: LocalRunnerComponent,
): ExecutionPlan {
  const external = requiresRemoteConsent(component);
  const displayName = component.displayName?.trim() || component.id;
  return {
    location: "device",
    leavesDevice: external,
    destinationName: external ? displayName : "This device",
    externalProcessor: external
      ? { name: displayName, retentionKnown: false }
      : undefined,
  };
}

export function documentTransferConsentKey(
  documentId: string,
  component: Pick<LocalRunnerComponent, "id" | "version">,
  plan: ExecutionPlan,
): string {
  return JSON.stringify([
    documentId,
    component.id,
    component.version,
    plan.location,
    plan.leavesDevice,
    plan.destinationName,
    plan.region ?? null,
    plan.retentionPolicyVersion ?? null,
    plan.retentionSeconds ?? null,
    plan.externalProcessor?.name ?? null,
    plan.externalProcessor?.retentionKnown ?? null,
  ]);
}

export function runnerConnectionType(
  component: LocalRunnerComponent | null | undefined,
): string | null {
  const connection = component?.requirements?.connection;
  if (
    !connection ||
    typeof connection !== "object" ||
    Array.isArray(connection)
  ) {
    return null;
  }
  const type = connection.type;
  return typeof type === "string" && type.trim().length > 0 ? type.trim() : null;
}

export type LocalRunnerInfo = {
  component: LocalRunnerComponent;
  components?: LocalRunnerComponent[];
};

export type RunnerConnectionField = {
  name: string;
  label?: string;
  description?: string;
  placeholder?: string;
  format?: "uri" | "text";
  secret?: boolean;
  minLength?: number;
  maxLength?: number;
};

export type RunnerConnection = {
  type: string;
  title?: string;
  description?: string;
  configured: boolean;
  source: "session" | "environment" | null;
  fields: RunnerConnectionField[];
};

type RunnerConnectionsResponse = {
  connections: RunnerConnection[];
};

async function runnerJsonError(
  response: Response,
  fallback: string,
): Promise<Error> {
  const body = (await response.json().catch(() => null)) as
    | { error?: unknown }
    | null;
  return new Error(
    typeof body?.error === "string" && body.error.trim()
      ? body.error
      : fallback,
  );
}

export async function listRunnerConnections(): Promise<RunnerConnection[]> {
  const response = await fetch(`${LOCAL_RUNNER_ORIGIN}/v1/connections`, {
    headers: { accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(2000),
  });
  if (!response.ok) {
    throw await runnerJsonError(
      response,
      `Local runner returned ${response.status}.`,
    );
  }
  const body = (await response.json()) as Partial<RunnerConnectionsResponse>;
  return Array.isArray(body.connections) ? body.connections : [];
}

export async function configureRunnerConnection(
  type: string,
  values: Record<string, string>,
): Promise<void> {
  const response = await fetch(
    `${LOCAL_RUNNER_ORIGIN}/v1/connections/${encodeURIComponent(type)}`,
    {
      method: "PUT",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({ values }),
    },
  );
  if (!response.ok) {
    throw await runnerJsonError(
      response,
      `Local runner returned ${response.status}.`,
    );
  }
}

export async function clearRunnerConnection(type: string): Promise<void> {
  const response = await fetch(
    `${LOCAL_RUNNER_ORIGIN}/v1/connections/${encodeURIComponent(type)}`,
    {
      method: "DELETE",
      headers: { accept: "application/json" },
    },
  );
  if (!response.ok) {
    throw await runnerJsonError(
      response,
      `Local runner returned ${response.status}.`,
    );
  }
}

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
  tableBlockId?: string;
  tableCell?: {
    rowIndex: number;
    columnIndex: number;
    rowSpan?: number;
    columnSpan?: number;
  };
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

export type LocalRawArtifactMetadata = {
  path: string;
  mediaType: string;
  sizeBytes: number;
  sha256: string;
  /**
   * The local runner validated these bytes, but the browser only received this
   * descriptor. A future explicit import flow can change the location without
   * pretending IndexedDB already contains the raw artifact.
   */
  bytesLocation: "local-runner";
};

export type LocalParseResult = {
  status: "completed";
  runId: string;
  stageRunId: string;
  startedAt: string;
  completedAt: string;
  component: { id: string; version: string; image: string; imageId?: string };
  source?: { artifactId?: string; sha256?: string; sizeBytes?: number };
  options?: Record<string, unknown>;
  durationMs: number;
  blockCount: number;
  nativeRegionCount: number;
  rawArtifacts: readonly LocalRawArtifactMetadata[];
  outputDirectory: string;
  parsedDocument: CanonicalParsedDocument;
};

/**
 * A runner that answers with an error is not the same as no runner at all, and
 * telling someone to start a runner they already started sends them looking in
 * the wrong place. This collapsed all three outcomes to `null`, so a runner
 * left over from before a directory rename - serving 500s because the absolute
 * extension paths it resolved at startup no longer exist - reported as
 * "offline" while `make runner-serve` reported the port already in use.
 */
export type LocalRunnerProbe =
  | { status: "ready"; info: LocalRunnerInfo }
  /**
   * No usable answer. This covers more than "not started": a crashed runner
   * replies with the runtime's own error page, which carries no CORS headers,
   * so the browser blocks it and `fetch` rejects without exposing the status.
   * A process holding the port but serving 500s is indistinguishable here from
   * nothing listening at all, which is why the copy names both.
   */
  | { status: "unreachable" }
  /** Answered with CORS but is not ready to accept runs. */
  | { status: "failing"; detail: string };

export async function checkLocalRunner(): Promise<LocalRunnerProbe> {
  let response: Response;
  try {
    response = await fetch(`${LOCAL_RUNNER_ORIGIN}/v1/health`, {
      signal: AbortSignal.timeout(1500),
    });
  } catch {
    return { status: "unreachable" };
  }

  if (!response.ok) {
    return {
      status: "failing",
      detail: `answered HTTP ${response.status} on /v1/health`,
    };
  }

  let body: ({ ok?: boolean } & LocalRunnerInfo) | undefined;
  try {
    body = (await response.json()) as { ok?: boolean } & LocalRunnerInfo;
  } catch {
    return { status: "failing", detail: "answered with a malformed response" };
  }

  if (!body.ok || !body.component) {
    return {
      status: "failing",
      detail: "reported that it is not ready to accept runs",
    };
  }
  return { status: "ready", info: body };
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
        "x-document-arena-filename": encodeURIComponent(file.name),
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
  rowSpan: number;
  columnSpan: number;
};

export type ReadingNode =
  | { type: "block"; block: CanonicalBlock }
  | {
      type: "table";
      block: CanonicalBlock;
      rows: (ReadingCell | null)[][];
    };

/**
 * Rebuilds a document-like reading structure from the flattened canonical
 * blocks. Table grids use explicit component-neutral table metadata when it
 * is present, with legacy hierarchical rawJsonPointer paths as a compatibility
 * fallback. Every rendered element keeps the id of the canonical block that
 * carries its native evidence region.
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

    if (block.kind === "table") {
      const tablePointer = block.rawJsonPointer;
      const children = blocks.filter(
        (candidate) =>
          candidate.id !== block.id &&
          (candidate.tableBlockId === block.id ||
            (tablePointer !== undefined &&
              candidate.rawJsonPointer?.startsWith(`${tablePointer}/rows/`))),
      );

      const cellMap = new Map<
        string,
        {
          text: string[];
          blockId: string | null;
          rowSpan: number;
          columnSpan: number;
        }
      >();
      let maxRow = -1;
      let maxColumn = -1;
      for (const child of children) {
        const pointerMatch = tablePointer
          ? child.rawJsonPointer
              ?.slice(tablePointer.length)
              .match(/^\/rows\/(\d+)\/cells\/(\d+)/)
          : null;
        const row = child.tableCell?.rowIndex ?? Number(pointerMatch?.[1]);
        const column = child.tableCell?.columnIndex ?? Number(pointerMatch?.[2]);
        if (
          !Number.isInteger(row) ||
          row < 0 ||
          !Number.isInteger(column) ||
          column < 0
        ) {
          continue;
        }

        const rawRowSpan = child.tableCell?.rowSpan;
        const rowSpan =
          typeof rawRowSpan === "number" &&
          Number.isInteger(rawRowSpan) &&
          rawRowSpan > 0
            ? rawRowSpan
            : 1;
        const rawColumnSpan = child.tableCell?.columnSpan;
        const columnSpan =
          typeof rawColumnSpan === "number" &&
          Number.isInteger(rawColumnSpan) &&
          rawColumnSpan > 0
            ? rawColumnSpan
            : 1;

        consumed.add(child.id);
        maxRow = Math.max(maxRow, row + rowSpan - 1);
        maxColumn = Math.max(maxColumn, column + columnSpan - 1);
        const key = `${row}:${column}`;
        const cell = cellMap.get(key) ?? {
          text: [],
          blockId: null,
          rowSpan: 1,
          columnSpan: 1,
        };
        cell.rowSpan = Math.max(cell.rowSpan, rowSpan);
        cell.columnSpan = Math.max(cell.columnSpan, columnSpan);
        const text = (child.text ?? "").trim();
        if (text) {
          cell.text.push(text);
          // Merged mode: every cell of this table hovers to one table id.
          cell.blockId ??= evidenceIdForBlock(child, merge);
        }
        cellMap.set(key, cell);
      }

      if (maxRow >= 0) {
        const covered = new Set<string>();
        for (const [key, cell] of cellMap) {
          const [originRow, originColumn] = key.split(":").map(Number);
          for (let row = originRow; row < originRow + cell.rowSpan; row += 1) {
            for (
              let column = originColumn;
              column < originColumn + cell.columnSpan;
              column += 1
            ) {
              const coveredKey = `${row}:${column}`;
              if (coveredKey !== key) covered.add(coveredKey);
            }
          }
        }

        const rows: (ReadingCell | null)[][] = [];
        for (let row = 0; row <= maxRow; row += 1) {
          const cells: (ReadingCell | null)[] = [];
          for (let column = 0; column <= maxColumn; column += 1) {
            const key = `${row}:${column}`;
            const cell = cellMap.get(key);
            if (!cell && covered.has(key)) {
              cells.push(null);
              continue;
            }
            cells.push({
              text: cell?.text.join(" ") ?? "",
              evidenceBlockId: cell?.blockId ?? null,
              rowSpan: cell?.rowSpan ?? 1,
              columnSpan: cell?.columnSpan ?? 1,
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
 * Groups blocks that belong to the same table. New canonical blocks carry a
 * tableBlockId; older OpenDataLoader-shaped blocks fall back to the table root
 * encoded by `.../rows/<r>/cells/<c>/...` in rawJsonPointer. Returns null for
 * blocks that are not part of a table.
 */
function tableGroupRoot(block: CanonicalBlock): string | null {
  if (block.tableBlockId) return `block:${block.tableBlockId}`;
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
