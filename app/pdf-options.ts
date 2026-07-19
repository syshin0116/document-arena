// Shared PDF.js document options: pinned local assets so Korean, legacy-font,
// and JPEG 2000 documents render without a third-party CDN.
export const PDF_OPTIONS = {
  cMapPacked: true,
  cMapUrl: "/pdfjs/5.4.296/cmaps/",
  enableXfa: false,
  iccUrl: "/pdfjs/5.4.296/iccs/",
  isEvalSupported: false,
  standardFontDataUrl: "/pdfjs/5.4.296/standard_fonts/",
  wasmUrl: "/pdfjs/5.4.296/wasm/",
} as const;
