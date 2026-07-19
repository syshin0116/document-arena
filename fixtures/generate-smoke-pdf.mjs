import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;

function escapePdfText(value) {
  return value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

function text(font, size, x, y, value) {
  return [
    "BT",
    `/${font} ${size} Tf`,
    `${x} ${y} Td`,
    `(${escapePdfText(value)}) Tj`,
    "ET",
  ].join("\n");
}

function streamObject(content) {
  const body = `${content}\n`;
  return `<< /Length ${Buffer.byteLength(body, "ascii")} >>\nstream\n${body}endstream`;
}

function pageOneContent() {
  return [
    "0 G",
    "0 g",
    "1 w",
    text("F2", 18, 72, 724, "Document Arena Smoke Fixture"),
    text("F1", 11, 72, 692, "A deterministic two-page PDF for parser adapter tests."),
    text("F1", 11, 72, 674, "The first page contains a paragraph and a simple ruled table."),
    text("F2", 14, 72, 620, "Structured table"),
    "72 576 m 540 576 l S",
    "72 528 m 540 528 l S",
    "72 480 m 540 480 l S",
    "72 480 m 72 576 l S",
    "306 480 m 306 576 l S",
    "540 480 m 540 576 l S",
    text("F2", 11, 88, 550, "Metric"),
    text("F2", 11, 322, 550, "Value"),
    text("F1", 11, 88, 502, "native bbox"),
    text("F1", 11, 322, 502, "enabled"),
    text("F1", 10, 72, 430, "PAGE_ONE_SENTINEL: ALPHA-4107"),
    text("F1", 9, 72, 54, "Document Arena generated fixture - page 1"),
  ].join("\n");
}

function pageTwoContent() {
  return [
    "0 G",
    "0 g",
    text("F2", 18, 72, 724, "Two-column reading order"),
    text("F2", 12, 72, 680, "Left column"),
    text("F1", 10, 72, 652, "LEFT-1 begins before the right column."),
    text("F1", 10, 72, 632, "LEFT-2 checks reading order."),
    text("F1", 10, 72, 612, "LEFT-3 ends the first column."),
    text("F2", 12, 324, 680, "Right column"),
    text("F1", 10, 324, 652, "RIGHT-1 follows the left column."),
    text("F1", 10, 324, 632, "RIGHT-2 contains a unique marker."),
    text("F1", 10, 324, 612, "RIGHT-3 ends the second column."),
    text("F1", 10, 72, 540, "PAGE_TWO_SENTINEL: OMEGA-9231"),
    text("F1", 9, 72, 54, "Document Arena generated fixture - page 2"),
  ].join("\n");
}

export function buildSmokePdf() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 7 0 R >>`,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 8 0 R >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold >>",
    streamObject(pageOneContent()),
    streamObject(pageTwoContent()),
  ];

  const chunks = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "latin1")];
  const offsets = [0];
  let position = chunks[0].length;

  objects.forEach((object, index) => {
    offsets.push(position);
    const chunk = Buffer.from(`${index + 1} 0 obj\n${object}\nendobj\n`, "ascii");
    chunks.push(chunk);
    position += chunk.length;
  });

  const xrefOffset = position;
  const xrefRows = offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  const trailer = [
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
  ].join("\n");
  chunks.push(Buffer.from(trailer, "ascii"));

  return Buffer.concat(chunks);
}

export async function generateSmokePdf(outputPath) {
  const pdf = buildSmokePdf();
  const absolutePath = resolve(outputPath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, pdf);
  return {
    path: absolutePath,
    bytes: pdf.length,
    sha256: createHash("sha256").update(pdf).digest("hex"),
  };
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  const outputPath = process.argv[2] ?? "work/fixtures/document-arena-smoke.pdf";
  const result = await generateSmokePdf(outputPath);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
