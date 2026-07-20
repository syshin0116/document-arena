/**
 * Facts about the sample document that the browser is allowed to know.
 *
 * These live apart from `sample-document.ts` because that module imports
 * `node:fs` to read the PDF off disk. A client component that wants to name the
 * sample - the landing shelf, for one - cannot import it without dragging a
 * Node built-in into the browser bundle. The landing page hardcoded "12 pages"
 * instead, which described the synthetic PDF that was replaced and had been
 * wrong ever since.
 *
 * `sample-document.ts` re-exports these, so the server side keeps one import.
 */
export const SAMPLE_PDF_FILE_NAME =
  "llama-open-and-efficient-foundation-language-models.pdf";

export const SAMPLE_DOCUMENT_TITLE =
  "LLaMA: Open and Efficient Foundation Language Models";

export const SAMPLE_PAGE_COUNT = 27;
