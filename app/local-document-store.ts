"use client";

// Persistent browser data keeps its original stable key across the product rename.
const DATABASE_NAME = "parser-arena-local-documents";
const DATABASE_VERSION = 3;
const STORE_NAME = "documents";
const RESULTS_STORE = "parse-results";

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

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(RESULTS_STORE)) {
        database.createObjectStore(RESULTS_STORE, { keyPath: "key" });
      }
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
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

type StoredParseResult = {
  key: string;
  documentId: string;
  parser: string;
  savedAt: string;
  result: unknown;
};

/**
 * Persists a completed parse result so a refresh does not lose it. Results
 * live beside the document blob in the same device-local database.
 */
export async function saveLocalParseResult(
  documentId: string,
  parser: string,
  result: unknown,
): Promise<void> {
  const database = await openDatabase();
  if (!database.objectStoreNames.contains(RESULTS_STORE)) {
    // An older connection blocked the schema upgrade; skip persistence for
    // this session rather than throwing into the parse flow.
    database.close();
    return;
  }
  const record: StoredParseResult = {
    key: `${documentId}:${parser}`,
    documentId,
    parser,
    savedAt: new Date().toISOString(),
    result,
  };
  try {
    await runRequest(
      database,
      "readwrite",
      (store) => store.put(record),
      RESULTS_STORE,
    );
  } finally {
    database.close();
  }
}

export async function loadLocalParseResults(
  documentId: string,
  parsers: readonly string[],
): Promise<Record<string, unknown>> {
  if (!documentId.startsWith("local_")) return {};
  const database = await openDatabase();
  if (!database.objectStoreNames.contains(RESULTS_STORE)) {
    database.close();
    return {};
  }
  const results: Record<string, unknown> = {};
  try {
    for (const parser of parsers) {
      const record = (await runRequest(
        database,
        "readonly",
        (store) => store.get(`${documentId}:${parser}`),
        RESULTS_STORE,
      )) as StoredParseResult | undefined;
      if (record?.result) results[parser] = record.result;
    }
  } finally {
    database.close();
  }
  return results;
}
