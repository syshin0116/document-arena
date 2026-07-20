import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The document served at `/documents/demo`.
 *
 * This used to be a PDF drawn at runtime out of raw text operators: a fake
 * paper with invented authors, an invented abstract, and eleven near-empty
 * continuation pages. It was paired with three bounding boxes typed in by hand
 * and labelled `provenance: "native"`, so the demo asserted parser-native
 * geometry for a document no parser had ever seen.
 *
 * It is now the real arXiv PDF of "LLaMA: Open and Efficient Foundation
 * Language Models" (CC BY 4.0), and the evidence shown beside it comes from an
 * actual OpenDataLoader run over these exact bytes. See fixtures/sample/README.md
 * for provenance, licensing, and how to regenerate.
 */
export const SAMPLE_PDF_FILE_NAME =
  "llama-open-and-efficient-foundation-language-models.pdf";

export const SAMPLE_DOCUMENT_TITLE =
  "LLaMA: Open and Efficient Foundation Language Models";

export const SAMPLE_PAGE_COUNT = 27;

const SAMPLE_PDF_PATH = join(
  process.cwd(),
  "fixtures",
  "sample",
  SAMPLE_PDF_FILE_NAME,
);

let cachedSamplePdf: Uint8Array | undefined;

export function getSamplePdf() {
  cachedSamplePdf ??= new Uint8Array(readFileSync(SAMPLE_PDF_PATH));
  return cachedSamplePdf;
}
