import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, relative, resolve, sep } from "node:path";
import { convert } from "@opendataloader/pdf";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { normalizeOdlDocument } from "./normalize.mjs";
import { conversionOptions, resolveOptions } from "./options.mjs";

const REQUEST_PATH = process.env.ARENA_REQUEST_PATH ?? "/arena/request.json";
const INPUT_ROOT = resolve(process.env.ARENA_INPUT_DIR ?? "/arena/input");
const OUTPUT_ROOT = resolve(process.env.ARENA_OUTPUT_DIR ?? "/arena/output");

function emit(type, fields = {}) {
  process.stdout.write(
    `${JSON.stringify({
      apiVersion: "parser-arena.dev/job-event/v1alpha1",
      type,
      ...fields,
    })}\n`,
  );
}

function assertRecord(value, message) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(message);
  }
  return value;
}

function safeInputPath(relativePath) {
  if (typeof relativePath !== "string" || relativePath.length === 0) {
    throw new Error("Request source.path must be a non-empty string.");
  }
  const absolutePath = resolve(INPUT_ROOT, relativePath);
  if (
    absolutePath !== INPUT_ROOT &&
    !absolutePath.startsWith(`${INPUT_ROOT}${sep}`)
  ) {
    throw new Error("Request source.path escapes the input directory.");
  }
  return absolutePath;
}

async function sha256File(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function fileDescriptor(path, mediaType) {
  const details = await stat(path);
  return {
    path: relative(OUTPUT_ROOT, path).split(sep).join("/"),
    mediaType,
    sizeBytes: details.size,
    sha256: await sha256File(path),
  };
}

async function findSingleOutput(directory, extension) {
  const entries = await readdir(directory, { withFileTypes: true });
  const matches = entries.filter(
    (entry) => entry.isFile() && entry.name.toLowerCase().endsWith(extension),
  );
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one ${extension} output, found ${matches.length}.`,
    );
  }
  const path = resolve(directory, matches[0].name);
  if ((await stat(path)).size === 0) {
    throw new Error(`OpenDataLoader wrote an empty ${extension} output.`);
  }
  return path;
}

async function inspectPages(sourcePath) {
  const bytes = new Uint8Array(await readFile(sourcePath));
  const loadingTask = getDocument({
    data: bytes,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  });
  const pdf = await loadingTask.promise;
  try {
    const pages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      pages.push({
        pageNumber,
        width: viewport.width,
        height: viewport.height,
        rotation: viewport.rotation,
        view: [...page.view],
        transform: [...viewport.transform],
      });
      page.cleanup();
    }
    return pages;
  } finally {
    await loadingTask.destroy();
  }
}

async function run() {
  const startedAt = new Date();
  const request = assertRecord(
    JSON.parse(await readFile(REQUEST_PATH, "utf8")),
    "Stage request must be an object.",
  );
  if (request.apiVersion !== "parser-arena.dev/stage-request/v1alpha1") {
    throw new Error("Unsupported stage request apiVersion.");
  }
  if (request.component?.id !== "opendataloader-pdf") {
    throw new Error("Stage request component does not match this extension.");
  }

  const source = assertRecord(request.source, "Stage request source is required.");
  if (typeof source.artifactId !== "string" || source.artifactId.length === 0) {
    throw new Error("Stage request source.artifactId is required.");
  }
  const sourcePath = safeInputPath(source.path);
  if (!basename(sourcePath).toLowerCase().endsWith(".pdf")) {
    throw new Error("OpenDataLoader extension accepts PDF inputs only.");
  }
  const sourceSha256 = await sha256File(sourcePath);
  if (source.sha256 && source.sha256 !== sourceSha256) {
    throw new Error("Source SHA-256 does not match the stage request.");
  }

  const options = resolveOptions(request.options);
  const rawDirectory = resolve(OUTPUT_ROOT, "raw");
  const primaryDirectory = resolve(OUTPUT_ROOT, "primary");
  await mkdir(rawDirectory, { recursive: true });
  await mkdir(primaryDirectory, { recursive: true });

  emit("stage.phase", {
    jobId: request.jobId,
    stageRunId: request.stageRunId,
    phase: "inspecting",
  });
  const pages = await inspectPages(sourcePath);

  emit("stage.phase", {
    jobId: request.jobId,
    stageRunId: request.stageRunId,
    phase: "parsing",
  });
  await convert(sourcePath, conversionOptions(options, rawDirectory));

  const rawJsonPath = await findSingleOutput(rawDirectory, ".json");
  const rawMarkdownPath = await findSingleOutput(rawDirectory, ".md");
  emit("stage.phase", {
    jobId: request.jobId,
    stageRunId: request.stageRunId,
    phase: "normalizing",
  });

  const rawJson = JSON.parse(await readFile(rawJsonPath, "utf8"));
  const markdown = await readFile(rawMarkdownPath, "utf8");
  const canonical = normalizeOdlDocument({
    raw: rawJson,
    markdown,
    pages,
    rawArtifactId:
      request.rawArtifactId ?? `raw:${request.stageRunId}:opendataloader-json`,
    sourceArtifactId: source.artifactId,
  });
  const primaryPath = resolve(primaryDirectory, "parsed-document.json");
  await writeFile(primaryPath, `${JSON.stringify(canonical, null, 2)}\n`);

  const primary = await fileDescriptor(
    primaryPath,
    "application/vnd.parser-arena.parsed-document+json",
  );
  const rawArtifacts = [
    await fileDescriptor(rawJsonPath, "application/json"),
    await fileDescriptor(rawMarkdownPath, "text/markdown"),
  ];
  const completedAt = new Date();
  const bundle = {
    apiVersion: "parser-arena.dev/result-bundle/v1alpha1",
    status: "completed",
    jobId: request.jobId,
    stageRunId: request.stageRunId,
    component: {
      id: "opendataloader-pdf",
      adapterVersion: "0.1.0",
      upstreamVersion: "2.5.0",
      image: request.component.image,
      imageDigest: request.component.imageDigest,
    },
    source: {
      artifactId: source.artifactId,
      sha256: sourceSha256,
    },
    options,
    progress: {
      mode: "phase",
      partialResults: "none",
    },
    primary,
    rawArtifacts,
    timing: {
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - startedAt.getTime(),
    },
  };
  await writeFile(
    resolve(OUTPUT_ROOT, "bundle.json"),
    `${JSON.stringify(bundle, null, 2)}\n`,
  );

  emit("stage.completed", {
    jobId: request.jobId,
    stageRunId: request.stageRunId,
    bundlePath: "bundle.json",
  });
}

try {
  await run();
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown adapter error.";
  try {
    await mkdir(OUTPUT_ROOT, { recursive: true });
    await writeFile(
      resolve(OUTPUT_ROOT, "failure.json"),
      `${JSON.stringify(
        {
          apiVersion: "parser-arena.dev/stage-failure/v1alpha1",
          status: "failed",
          error: {
            type: error instanceof Error ? error.name : "Error",
            message,
          },
        },
        null,
        2,
      )}\n`,
    );
  } catch {
    // The runner still receives the non-zero exit when the output mount failed.
  }
  emit("stage.failed", { message });
  process.exitCode = 1;
}
