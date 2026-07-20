"use client";

import type {
  LocalParseResult,
  LocalRawArtifactMetadata,
} from "./local-runner";

// Persistent browser data keeps its original stable key across the product rename.
const DATABASE_NAME = "parser-arena-local-documents";
const DATABASE_VERSION = 4;
const STORE_NAME = "documents";
const LEGACY_RESULTS_STORE = "parse-results";
const RUNS_STORE = "parse-runs";
const RUNS_BY_DOCUMENT = "by-document";
const RUNS_BY_DOCUMENT_PARSER_TIME = "by-document-parser-time";

type StoredLocalDocument = {
  id: string;
  name: string;
  mediaType: string;
  size: number;
  lastModified: number;
  createdAt: string;
  blob: Blob;
};

export type LocalDocument = {
  id: string;
  file: File;
};

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(
      new Error("This browser cannot keep a local PDF workspace."),
    );
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    let settled = false;

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(LEGACY_RESULTS_STORE)) {
        database.createObjectStore(LEGACY_RESULTS_STORE, { keyPath: "key" });
      }
      if (!database.objectStoreNames.contains(RUNS_STORE)) {
        const runs = database.createObjectStore(RUNS_STORE, {
          keyPath: "recordId",
        });
        runs.createIndex(RUNS_BY_DOCUMENT, "documentId", { unique: false });
        runs.createIndex(
          RUNS_BY_DOCUMENT_PARSER_TIME,
          ["documentId", "parser", "savedAt", "runId"],
          { unique: false },
        );
      }
    };
    request.onblocked = () => {
      if (settled) return;
      settled = true;
      reject(
        new Error(
          "Another Document Arena tab blocked the browser history upgrade. Close it and try again.",
        ),
      );
    };
    request.onerror = () => {
      if (settled) return;
      settled = true;
      reject(request.error);
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      if (settled) {
        database.close();
        return;
      }
      settled = true;
      resolve(database);
    };
  });
}

function runRequest<T>(
  database: IDBDatabase,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
  storeName: string = STORE_NAME,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const request = operation(transaction.objectStore(storeName));
    let result!: T;

    request.onsuccess = () => {
      result = request.result;
    };
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function saveLocalDocument(file: File): Promise<LocalDocument> {
  const database = await openDatabase();
  const id = `local_${crypto.randomUUID()}`;
  const record: StoredLocalDocument = {
    id,
    name: file.name.slice(0, 120) || "uploaded-document.pdf",
    mediaType: "application/pdf",
    size: file.size,
    lastModified: file.lastModified,
    createdAt: new Date().toISOString(),
    blob: file.slice(0, file.size, "application/pdf"),
  };

  try {
    await runRequest(database, "readwrite", (store) => store.put(record));
  } finally {
    database.close();
  }

  return {
    id,
    file: new File([record.blob], record.name, {
      type: record.mediaType,
      lastModified: record.lastModified,
    }),
  };
}

export async function loadLocalDocument(
  documentId: string,
): Promise<LocalDocument | null> {
  if (!documentId.startsWith("local_")) return null;

  const database = await openDatabase();
  let record: StoredLocalDocument | undefined;

  try {
    record = await runRequest(database, "readonly", (store) =>
      store.get(documentId),
    );
  } finally {
    database.close();
  }

  if (!record) return null;

  return {
    id: record.id,
    file: new File([record.blob], record.name, {
      type: record.mediaType,
      lastModified: record.lastModified,
    }),
  };
}

export type LocalDocumentSummary = {
  id: string;
  name: string;
  size: number;
  createdAt: string;
};

/**
 * Lists stored documents newest first, without their blobs. A cursor is used
 * rather than getAll so a shelf of 50 MB PDFs is not materialised at once just
 * to read four metadata fields.
 */
export async function listLocalDocuments(
  limit = 6,
): Promise<LocalDocumentSummary[]> {
  if (typeof indexedDB === "undefined") return [];

  let database: IDBDatabase;
  try {
    database = await openDatabase();
  } catch {
    return [];
  }

  try {
    return await new Promise<LocalDocumentSummary[]>((resolve, reject) => {
      const summaries: LocalDocumentSummary[] = [];
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).openCursor();

      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const record = cursor.value as StoredLocalDocument;
        summaries.push({
          id: record.id,
          name: record.name,
          size: record.size,
          createdAt: record.createdAt,
        });
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
      transaction.oncomplete = () => {
        summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        resolve(summaries.slice(0, limit));
      };
    });
  } catch {
    return [];
  } finally {
    database.close();
  }
}

type LegacyStoredParseResult = {
  key: string;
  documentId: string;
  parser: string;
  savedAt: string;
  result: unknown;
};

export type LocalParseRunReceipt = {
  apiVersion: "document-arena.dev/browser-run-receipt/v1alpha1";
  recordId: string;
  runId: string;
  documentId: string;
  parser: string;
  savedAt: string;
  completedAt: string;
  status: "completed";
  component: LocalParseResult["component"];
  options: Record<string, unknown>;
  rawArtifacts: readonly LocalRawArtifactMetadata[];
  /** Raw bytes remain in the runner output until an explicit import exists. */
  rawArtifactBytes: "not-imported";
  result: LocalParseResult;
};

export type LocalParseRunSummary = Omit<LocalParseRunReceipt, "result">;

export function createLocalParseRunReceipt(
  documentId: string,
  parser: string,
  result: LocalParseResult,
  savedAt = new Date().toISOString(),
): LocalParseRunReceipt {
  if (!documentId.startsWith("local_")) {
    throw new Error("A local run receipt requires a local document id.");
  }
  if (parser.trim().length === 0) {
    throw new Error("A local run receipt requires a parser name.");
  }
  if (typeof result.runId !== "string" || result.runId.trim().length === 0) {
    throw new Error("The runner result is missing its immutable run id.");
  }

  return {
    apiVersion: "document-arena.dev/browser-run-receipt/v1alpha1",
    recordId: `${documentId}:${parser}:${result.runId}`,
    runId: result.runId,
    documentId,
    parser,
    savedAt,
    completedAt: result.completedAt,
    status: result.status,
    component: result.component,
    options: result.options ?? {},
    rawArtifacts: result.rawArtifacts,
    rawArtifactBytes: "not-imported",
    result,
  };
}

/**
 * Appends a completed parse run so reruns, component upgrades, and option
 * changes retain their own immutable receipts. `add` deliberately rejects a
 * duplicate run id instead of replacing an earlier record.
 */
export async function saveLocalParseResult(
  documentId: string,
  parser: string,
  result: LocalParseResult,
): Promise<LocalParseRunReceipt> {
  const database = await openDatabase();
  if (!database.objectStoreNames.contains(RUNS_STORE)) {
    database.close();
    throw new Error("The browser run-history store is unavailable.");
  }
  const receipt = createLocalParseRunReceipt(documentId, parser, result);
  try {
    await runRequest(
      database,
      "readwrite",
      (store) => store.add(receipt),
      RUNS_STORE,
    );
  } finally {
    database.close();
  }
  return receipt;
}

function loadLatestParseRun(
  database: IDBDatabase,
  documentId: string,
  parser: string,
): Promise<LocalParseRunReceipt | undefined> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(RUNS_STORE, "readonly");
    const index = transaction
      .objectStore(RUNS_STORE)
      .index(RUNS_BY_DOCUMENT_PARSER_TIME);
    const range = IDBKeyRange.bound(
      [documentId, parser, "", ""],
      [documentId, parser, "\uffff", "\uffff"],
    );
    const request = index.openCursor(range, "prev");
    let receipt: LocalParseRunReceipt | undefined;

    request.onsuccess = () => {
      receipt = request.result?.value as LocalParseRunReceipt | undefined;
    };
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => resolve(receipt);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function loadLocalParseResults(
  documentId: string,
  parsers: readonly string[],
): Promise<Record<string, LocalParseResult>> {
  if (!documentId.startsWith("local_")) return {};
  const database = await openDatabase();
  if (!database.objectStoreNames.contains(RUNS_STORE)) {
    database.close();
    throw new Error("The browser run-history store is unavailable.");
  }
  const results: Record<string, LocalParseResult> = {};
  try {
    for (const parser of parsers) {
      const receipt = await loadLatestParseRun(database, documentId, parser);
      if (receipt?.result) {
        results[parser] = receipt.result;
        continue;
      }

      // Read the former one-result-per-parser store only as a compatibility
      // fallback. New writes never use this overwrite-prone key.
      if (database.objectStoreNames.contains(LEGACY_RESULTS_STORE)) {
        const legacy = (await runRequest(
          database,
          "readonly",
          (store) => store.get(`${documentId}:${parser}`),
          LEGACY_RESULTS_STORE,
        )) as LegacyStoredParseResult | undefined;
        if (legacy?.result) {
          results[parser] = legacy.result as LocalParseResult;
        }
      }
    }
  } finally {
    database.close();
  }
  return results;
}

/**
 * Returns receipt metadata newest first without claiming raw artifact bytes
 * were imported into the browser. Canonical result payloads stay internal to
 * the object store and are omitted from the returned history summaries.
 */
export async function listLocalParseRunHistory(
  documentId: string,
  parser?: string,
): Promise<LocalParseRunSummary[]> {
  if (!documentId.startsWith("local_")) return [];
  const database = await openDatabase();
  if (!database.objectStoreNames.contains(RUNS_STORE)) {
    database.close();
    throw new Error("The browser run-history store is unavailable.");
  }

  try {
    return await new Promise<LocalParseRunSummary[]>((resolve, reject) => {
      const summaries: LocalParseRunSummary[] = [];
      const transaction = database.transaction(RUNS_STORE, "readonly");
      const index = transaction
        .objectStore(RUNS_STORE)
        .index(RUNS_BY_DOCUMENT);
      const request = index.openCursor(IDBKeyRange.only(documentId));

      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const receipt = cursor.value as LocalParseRunReceipt;
        if (!parser || receipt.parser === parser) {
          summaries.push({
            apiVersion: receipt.apiVersion,
            recordId: receipt.recordId,
            runId: receipt.runId,
            documentId: receipt.documentId,
            parser: receipt.parser,
            savedAt: receipt.savedAt,
            completedAt: receipt.completedAt,
            status: receipt.status,
            component: receipt.component,
            options: receipt.options,
            rawArtifacts: receipt.rawArtifacts,
            rawArtifactBytes: receipt.rawArtifactBytes,
          });
        }
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
      transaction.oncomplete = () => {
        summaries.sort((a, b) =>
          b.savedAt === a.savedAt
            ? b.runId.localeCompare(a.runId)
            : b.savedAt.localeCompare(a.savedAt),
        );
        resolve(summaries);
      };
    });
  } finally {
    database.close();
  }
}
