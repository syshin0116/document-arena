const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const PAGE_COUNT = 12;
const encoder = new TextEncoder();

function escapePdfText(value: string) {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)");
}

function text(
  font: "F1" | "F2",
  size: number,
  x: number,
  y: number,
  value: string,
) {
  return [
    "BT",
    `/${font} ${size} Tf`,
    `${x} ${y} Td`,
    `(${escapePdfText(value)}) Tj`,
    "ET",
  ].join("\n");
}

function streamObject(content: string) {
  const body = `${content}\n`;
  return `<< /Length ${encoder.encode(body).length} >>\nstream\n${body}endstream`;
}

function firstPageContent() {
  return [
    "0 G",
    "0 g",
    "0.8 w",
    text("F1", 8, 72, 750, "DOCUMENT ARENA / SOURCE-LINKED DEMO"),
    text("F2", 24, 142, 704, "Attention Is All You Need"),
    text("F1", 10, 143, 682, "A reproducible study of document understanding systems"),
    text("F1", 9, 185, 654, "A. Researcher / B. Engineer / C. Scientist"),
    "72 636 m 540 636 l S",
    text("F2", 13, 96, 606, "Abstract"),
    text("F1", 9, 96, 584, "We compare structured document parsers using source-linked evidence,"),
    text("F1", 9, 96, 568, "layout preservation, and reading-order quality. Each result remains"),
    text("F1", 9, 96, 552, "traceable to the immutable original document."),
    text("F2", 12, 72, 498, "1. Introduction"),
    text("F1", 8, 72, 478, "Document parsing is not one score. Text,"),
    text("F1", 8, 72, 464, "hierarchy, tables, and geometry expose"),
    text("F1", 8, 72, 450, "different failure modes."),
    text("F2", 12, 324, 498, "2. Evaluation"),
    text("F1", 8, 324, 478, "Results are normalized without inventing"),
    text("F1", 8, 324, 464, "geometry. Native coordinates retain"),
    text("F1", 8, 324, 450, "their provenance."),
    text("F2", 11, 72, 394, "Table 1. Parser output comparison"),
    "72 374 m 540 374 l S",
    "72 338 m 540 338 l S",
    "72 302 m 540 302 l S",
    "72 266 m 540 266 l S",
    "72 266 m 72 374 l S",
    "292 266 m 292 374 l S",
    "380 266 m 380 374 l S",
    "460 266 m 460 374 l S",
    "540 266 m 540 374 l S",
    text("F2", 8, 84, 352, "Parser"),
    text("F2", 8, 306, 352, "Text"),
    text("F2", 8, 394, 352, "Layout"),
    text("F2", 8, 474, 352, "Time"),
    text("F1", 8, 84, 316, "OpenDataLoader"),
    text("F1", 8, 306, 316, "0.96"),
    text("F1", 8, 394, 316, "0.91"),
    text("F1", 8, 474, 316, "4.2s"),
    text("F1", 8, 84, 280, "MinerU"),
    text("F1", 8, 306, 280, "0.94"),
    text("F1", 8, 394, 280, "0.95"),
    text("F1", 8, 474, 280, "11.8s"),
    text("F1", 8, 72, 54, "Document Arena demo source / page 1"),
  ].join("\n");
}

function continuationPageContent(pageNumber: number) {
  return [
    "0 G",
    "0 g",
    text("F1", 8, 72, 750, "DOCUMENT ARENA / SOURCE-LINKED DEMO"),
    text("F2", 22, 72, 700, `Evaluation notes / page ${pageNumber}`),
    text("F1", 10, 72, 660, "This continuation page exercises real PDF navigation."),
    text("F1", 10, 72, 640, "Parser-native evidence in the demo belongs to page 1 only."),
    text("F1", 8, 72, 54, `Document Arena demo source / page ${pageNumber}`),
  ].join("\n");
}

function concatBytes(chunks: Uint8Array[]) {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

export function buildDemoPdf() {
  const firstPageObject = 3;
  const fontRegularObject = firstPageObject + PAGE_COUNT;
  const fontBoldObject = fontRegularObject + 1;
  const firstContentObject = fontBoldObject + 1;
  const pageObjects = Array.from({ length: PAGE_COUNT }, (_, index) => {
    const contentObject = firstContentObject + index;
    return `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 ${fontRegularObject} 0 R /F2 ${fontBoldObject} 0 R >> >> /Contents ${contentObject} 0 R >>`;
  });
  const pageReferences = pageObjects
    .map((_, index) => `${firstPageObject + index} 0 R`)
    .join(" ");
  const contentObjects = Array.from({ length: PAGE_COUNT }, (_, index) =>
    streamObject(index === 0 ? firstPageContent() : continuationPageContent(index + 1)),
  );
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageReferences}] /Count ${PAGE_COUNT} >>`,
    ...pageObjects,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
    ...contentObjects,
  ];

  const chunks = [encoder.encode("%PDF-1.4\n")];
  const offsets = [0];
  let position = chunks[0].length;

  objects.forEach((object, index) => {
    offsets.push(position);
    const chunk = encoder.encode(`${index + 1} 0 obj\n${object}\nendobj\n`);
    chunks.push(chunk);
    position += chunk.length;
  });

  const xrefOffset = position;
  const xrefRows = offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  chunks.push(
    encoder.encode(
      [
        "xref",
        `0 ${objects.length + 1}`,
        "0000000000 65535 f ",
        xrefRows.trimEnd(),
        "trailer",
        `<< /Size ${objects.length + 1} /Root 1 0 R >>`,
        "startxref",
        String(xrefOffset),
        "%%EOF",
        "",
      ].join("\n"),
    ),
  );

  return concatBytes(chunks);
}

let cachedDemoPdf: Uint8Array | undefined;

export function getDemoPdf() {
  cachedDemoPdf ??= buildDemoPdf();
  return cachedDemoPdf;
}
