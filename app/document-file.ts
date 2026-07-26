"use client";

import { loadLocalDocument } from "./local-document-store";
import { SAMPLE_DOCUMENTS } from "./lib/sample-documents-meta";

/** `/documents/demo` predates the shelf and still aliases the first sample. */
const DEFAULT_SAMPLE_ID = SAMPLE_DOCUMENTS[0]?.id;

function sampleIdFor(documentId: string): string | undefined {
  if (documentId === "demo") return DEFAULT_SAMPLE_ID;
  return SAMPLE_DOCUMENTS.find((sample) => sample.id === documentId)?.id;
}

/**
 * The PDF bytes behind a document id, wherever they live.
 *
 * Uploads are in this browser's store; samples are served by the app and were
 * never written there. Every caller that reached for `loadLocalDocument`
 * directly got a null for a sample and reported it as a missing upload - the
 * run path did until recently, and the figure-crop renderer still did after
 * that was fixed, which drew a sample's figures as empty boxes. One resolver so
 * the next caller cannot repeat it.
 */
export async function loadDocumentFile(documentId: string): Promise<File> {
  const sampleId = sampleIdFor(documentId);
  if (sampleId) {
    const response = await fetch(
      `/v1/documents/${encodeURIComponent(sampleId)}/content`,
    );
    if (!response.ok) {
      throw new Error(
        `The sample PDF could not be loaded (HTTP ${response.status}).`,
      );
    }
    const blob = await response.blob();
    return new File([blob], `${sampleId}.pdf`, { type: "application/pdf" });
  }

  const stored = await loadLocalDocument(documentId);
  if (!stored) {
    throw new Error("This PDF is no longer available in the browser store.");
  }
  return stored.file;
}
