import {
  SAMPLE_DOCUMENT_TITLE,
  SAMPLE_PAGE_COUNT,
  SAMPLE_PDF_FILE_NAME,
} from "./sample-document-meta";

/**
 * The shelf of sample documents the landing page offers.
 *
 * Like `sample-document-meta.ts`, this module stays free of `node:` imports so
 * a "use client" component can name and count the samples without dragging a
 * Node built-in into the browser bundle.
 *
 * Every number here is measured, not estimated: `pageCount` comes from the PDF
 * itself, and each `descriptor` counts block kinds in that document's actual
 * parsed output (`fixtures/sample/<id>-opendataloader-parsed-document.json`).
 * They are the reason to pick one sample over another - Mistral genuinely
 * emits no table blocks, LLaMA emits 335 table cells - so they must stay tied
 * to the fixtures. Recount them if a fixture is regenerated.
 * See fixtures/sample/README.md for the runs behind them.
 */
export type SampleDocumentMeta = {
  /** URL-safe id, and the stem of the thumbnail file. */
  id: string;
  title: string;
  /** What fits under a 120px thumbnail. */
  shortTitle: string;
  /** arXiv identifier, e.g. "2302.13971". Each listing carries CC BY 4.0. */
  arxivId: string;
  /** File name under fixtures/sample/. */
  pdfFileName: string;
  pageCount: number;
  /** Path under public/, ready to use as an <img> src. */
  thumbnailPath: string;
  /** What makes this document interesting to a parser. */
  descriptor: string;
};

export const SAMPLE_DOCUMENTS: readonly SampleDocumentMeta[] = [
  {
    id: "llama",
    title: SAMPLE_DOCUMENT_TITLE,
    shortTitle: "LLaMA",
    arxivId: "2302.13971",
    pdfFileName: SAMPLE_PDF_FILE_NAME,
    pageCount: SAMPLE_PAGE_COUNT,
    thumbnailPath: "/samples/llama.webp",
    descriptor: "7 tables, 335 cells",
  },
  {
    id: "mistral",
    title: "Mistral 7B",
    shortTitle: "Mistral 7B",
    arxivId: "2310.06825",
    pdfFileName: "mistral-7b.pdf",
    pageCount: 9,
    thumbnailPath: "/samples/mistral.webp",
    descriptor: "6 figures, no tables",
  },
  {
    id: "mamba",
    title: "Mamba: Linear-Time Sequence Modeling with Selective State Spaces",
    shortTitle: "Mamba",
    arxivId: "2312.00752",
    pdfFileName:
      "mamba-linear-time-sequence-modeling-with-selective-state-spaces.pdf",
    pageCount: 36,
    thumbnailPath: "/samples/mamba.webp",
    descriptor: "17 tables, 285 list items",
  },
] as const;

/** The sample served at `/documents/demo`. */
export const DEFAULT_SAMPLE_DOCUMENT = SAMPLE_DOCUMENTS[0];
