import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SAMPLE_DOCUMENTS,
  type SampleDocumentMeta,
} from "./sample-documents-meta";
import { SAMPLE_PDF_FILE_NAME } from "./sample-document-meta";

/**
 * The sample documents served under `/documents/<id>`.
 *
 * The demo used to be a PDF drawn at runtime out of raw text operators: a fake
 * paper with invented authors, an invented abstract, and eleven near-empty
 * continuation pages. It was paired with three bounding boxes typed in by hand
 * and labelled `provenance: "native"`, so the demo asserted parser-native
 * geometry for a document no parser had ever seen.
 *
 * Every sample is now a real arXiv PDF whose listing carries CC BY 4.0, and each
 * has been through an actual OpenDataLoader run. See fixtures/sample/README.md
 * for provenance, licensing, and how to regenerate.
 */
export {
  SAMPLE_PDF_FILE_NAME,
  SAMPLE_DOCUMENT_TITLE,
  SAMPLE_PAGE_COUNT,
} from "./sample-document-meta";

/**
 * `/documents/demo` predates the multi-sample shelf and is linked from outside
 * this repo, so it stays an alias for the first sample rather than a 404.
 */
export function sampleDocumentFor(
  documentId: string,
): SampleDocumentMeta | undefined {
  if (documentId === "demo") {
    return SAMPLE_DOCUMENTS.find(
      (sample) => sample.pdfFileName === SAMPLE_PDF_FILE_NAME,
    );
  }
  return SAMPLE_DOCUMENTS.find((sample) => sample.id === documentId);
}

const cache = new Map<string, Uint8Array>();

export function getSamplePdfFor(sample: SampleDocumentMeta) {
  let bytes = cache.get(sample.id);
  if (!bytes) {
    bytes = new Uint8Array(
      readFileSync(join(process.cwd(), "fixtures", "sample", sample.pdfFileName)),
    );
    cache.set(sample.id, bytes);
  }
  return bytes;
}

/** The PDF behind `/documents/demo`. */
export function getSamplePdf() {
  const sample = sampleDocumentFor("demo");
  if (!sample) throw new Error("The default sample document is missing.");
  return getSamplePdfFor(sample);
}
