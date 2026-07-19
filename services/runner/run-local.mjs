#!/usr/bin/env bun

import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createReadStream } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeConnectionDefinition,
  resolveConnectionValues,
} from "./connections.mjs";

const MAX_INPUT_BYTES = 100 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 256 * 1024 * 1024;
const MAX_OUTPUT_ENTRIES = 20_000;
const MAX_OUTPUT_DEPTH = 32;
const DEFAULT_TMPFS_BYTES = 512 * 1024 * 1024;
const MAX_CREDENTIAL_EVENT_LINE_BYTES = 256 * 1024;
const CREDENTIAL_EVENT_TYPES = new Set([
  "stage.phase",
  "stage.progress",
  "stage.completed",
  "stage.failed",
]);
const CREDENTIAL_EVENT_PHASES = new Set([
  "inspecting",
  "preprocessing",
  "parsing",
  "normalizing",
  "postprocessing",
  "chunking",
  "embedding",
  "indexing",
  "completed",
  "failed",
]);

function assertRecord(value, message) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(message);
  }
  return value;
}

function assertOnlyProperties(value, allowed, label) {
  const unknown = Object.keys(value).find((name) => !allowed.has(name));
  if (unknown) throw new Error(`${label} has an unknown property '${unknown}'.`);
}

function assertNonEmptyString(value, message) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(message);
  }
  return value;
}

function sanitizeName(value) {
  return value
    .toLowerCase()
    .replaceAll(/[^a-z0-9_.-]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, 48);
}

function usage() {
  return "Usage: bun services/runner/run-local.mjs --manifest <component.json> --input <file.pdf> [--output <dir>] [--options <json>]";
}

function parseArguments(argv) {
  const parsed = { options: {} };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--help" || key === "-h") {
      parsed.help = true;
      continue;
    }
    if (!["--manifest", "--input", "--output", "--options"].includes(key)) {
      throw new Error(`Unknown argument: ${key}`);
    }
    const value = argv[index + 1];
    if (value === undefined) throw new Error(`Missing value for ${key}.`);
    index += 1;
    if (key === "--manifest") parsed.manifestPath = value;
    if (key === "--input") parsed.inputPath = value;
    if (key === "--output") parsed.outputPath = value;
    if (key === "--options") {
      try {
        parsed.options = assertRecord(
          JSON.parse(value),
          "--options must decode to a JSON object.",
        );
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "--options must decode to a JSON object."
        ) {
          throw error;
        }
        throw new Error("--options must be valid JSON.");
      }
    }
  }
  return parsed;
}

async function runCapture(command, args) {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code !== 0) {
        reject(
          new Error(
            `${command} exited with ${code ?? signal}: ${stderr.trim()}`,
          ),
        );
        return;
      }
      resolvePromise({ stdout, stderr });
    });
  });
}

/**
 * Credentialed components are untrusted producers. Do not relay their object
 * keys or free-form strings: project only a fixed progress vocabulary and
 * synthesize any visible detail inside the runner.
 */
export function projectCredentialedEvent(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.apiVersion !== "document-arena.dev/job-event/v1alpha1" ||
    !CREDENTIAL_EVENT_TYPES.has(value.type)
  ) {
    return null;
  }
  const projected = {
    apiVersion: "document-arena.dev/job-event/v1alpha1",
    type: value.type,
  };
  if (value.type === "stage.phase" || value.type === "stage.progress") {
    projected.phase = CREDENTIAL_EVENT_PHASES.has(value.phase)
      ? value.phase
      : "parsing";
  }
  if (value.type === "stage.progress") {
    const current = Number(value.current);
    const total = Number(value.total);
    if (
      Number.isSafeInteger(current) &&
      Number.isSafeInteger(total) &&
      current >= 0 &&
      total > 0 &&
      current <= total
    ) {
      projected.stage = "processing";
      projected.current = current;
      projected.total = total;
      projected.detail = `Processing ${current}/${total}`;
    }
  }
  return projected;
}

async function runStreaming(
  command,
  args,
  onEvent,
  { env = process.env, sensitiveValues = [] } = {},
) {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env,
    });
    let stdoutTail = "";
    let stderrTail = "";
    let stdoutBuffer = "";
    let stderrBuffer = "";
    const credentialed = sensitiveValues.length > 0;
    let discardCredentialedLine = false;
    const handleStdoutLine = (rawLine, newline = "\n") => {
      if (!credentialed) process.stdout.write(`${rawLine}${newline}`);
      if (!onEvent || !rawLine.trimStart().startsWith("{")) return;
      try {
        const event = JSON.parse(rawLine);
        if (event?.apiVersion === "document-arena.dev/job-event/v1alpha1") {
          const safeEvent = credentialed
            ? projectCredentialedEvent(event)
            : event;
          if (safeEvent) onEvent(safeEvent);
        }
      } catch {
        // Non-event stdout line; ignore.
      }
    };
    const flushLines = (stream) => {
      const stdout = stream === "stdout";
      let buffer = stdout ? stdoutBuffer : stderrBuffer;
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (stdout) handleStdoutLine(line);
        else if (!credentialed) process.stderr.write(`${line}\n`);
        newline = buffer.indexOf("\n");
      }
      if (stdout) stdoutBuffer = buffer;
      else stderrBuffer = buffer;
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (!credentialed) stdoutTail = (stdoutTail + chunk).slice(-16384);
      if (credentialed && discardCredentialedLine) {
        const newline = chunk.indexOf("\n");
        if (newline === -1) return;
        discardCredentialedLine = false;
        chunk = chunk.slice(newline + 1);
      }
      stdoutBuffer += chunk;
      flushLines("stdout");
      if (
        credentialed &&
        Buffer.byteLength(stdoutBuffer, "utf8") >
          MAX_CREDENTIAL_EVENT_LINE_BYTES
      ) {
        stdoutBuffer = "";
        discardCredentialedLine = true;
      }
    });
    child.stderr.on("data", (chunk) => {
      if (!credentialed) {
        stderrTail = (stderrTail + chunk).slice(-32768);
        stderrBuffer += chunk;
        flushLines("stderr");
      }
    });
    child.on("error", (error) => {
      reject(
        credentialed
          ? new Error("Credentialed component execution failed.")
          : error,
      );
    });
    child.on("close", (code, signal) => {
      if (stdoutBuffer) handleStdoutLine(stdoutBuffer, "");
      if (!credentialed && stderrBuffer) process.stderr.write(stderrBuffer);
      if (code !== 0) {
        if (credentialed) {
          reject(new Error("Credentialed component execution failed."));
          return;
        }
        const failure = componentFailureMessage(
          stdoutTail,
          stderrTail,
          `${command} exited with ${code ?? signal ?? "unknown"}.`,
        );
        reject(new Error(failure));
        return;
      }
      resolvePromise();
    });
  });
}

// The adapter reports its real failure as a stage.failed job event on stdout;
// surface that message instead of a generic exit code.
function componentFailureMessage(stdoutTail, stderrTail, fallback) {
  const lines = stdoutTail.split("\n").filter((line) => line.trim());
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const event = JSON.parse(lines[index]);
      if (
        event?.type === "stage.failed" &&
        typeof event.message === "string" &&
        event.message.length > 0
      ) {
        return event.message;
      }
    } catch {
      // Not a JSON event line; keep scanning.
    }
  }
  const stderrLine = stderrTail.trim().split("\n").pop();
  return stderrLine ? `${fallback} ${stderrLine}` : fallback;
}

export async function sha256File(path) {
  const hash = createHash("sha256");
  await new Promise((resolvePromise, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolvePromise);
  });
  return hash.digest("hex");
}

async function inspectImage(image) {
  const result = await runCapture("docker", [
    "image",
    "inspect",
    "--format",
    "{{.Id}}",
    image,
  ]);
  const imageId = result.stdout.trim();
  if (!/^sha256:[a-f0-9]{64}$/.test(imageId)) {
    throw new Error(`Docker returned an invalid image ID for ${image}.`);
  }
  return imageId;
}

export function validateManifest(value) {
  const manifest = assertRecord(value, "Component manifest must be an object.");
  assertOnlyProperties(
    manifest,
    new Set(["apiVersion", "kind", "metadata", "spec"]),
    "Component manifest",
  );
  if (manifest.apiVersion !== "document-arena.dev/component/v1alpha1") {
    throw new Error("Unsupported component manifest apiVersion.");
  }
  if (manifest.kind !== "Component") {
    throw new Error("Component manifest kind must be 'Component'.");
  }
  const metadata = assertRecord(
    manifest.metadata,
    "Component manifest metadata is required.",
  );
  const spec = assertRecord(manifest.spec, "Component manifest spec is required.");
  const executor = assertRecord(
    spec.executor,
    "Component manifest executor is required.",
  );
  const requirements = assertRecord(
    spec.requirements,
    "Component requirements are required.",
  );
  assertOnlyProperties(
    metadata,
    new Set(["id", "version", "displayName", "upstreamVersion"]),
    "Component metadata",
  );
  assertOnlyProperties(
    spec,
    new Set([
      "role",
      "accepts",
      "produces",
      "executor",
      "optionsSchema",
      "capabilities",
      "requirements",
    ]),
    "Component spec",
  );
  assertOnlyProperties(
    executor,
    new Set(["protocol", "image"]),
    "Component executor",
  );
  assertOnlyProperties(
    requirements,
    new Set(["gpu", "network", "memoryMiB", "cpus", "connection"]),
    "Component requirements",
  );
  if (spec.role !== "parser") {
    throw new Error("This local spike runner accepts parser components only.");
  }
  if (executor.protocol !== "oci-batch/v1") {
    throw new Error("This runner supports oci-batch/v1 only.");
  }
  if (
    !Array.isArray(spec.accepts) ||
    spec.accepts.length === 0 ||
    spec.accepts.some((value) => typeof value !== "string" || value.length === 0)
  ) {
    throw new Error("Component accepts must contain artifact types.");
  }
  assertNonEmptyString(spec.produces, "Component produces is required.");
  assertRecord(spec.capabilities, "Component capabilities are required.");
  if (
    spec.optionsSchema !== undefined &&
    (typeof spec.optionsSchema !== "string" || spec.optionsSchema.length === 0)
  ) {
    throw new Error("Component optionsSchema must be a non-empty string.");
  }
  // Most parsers run fully isolated (network=none). A component may instead
  // declare network=remote plus a connection; that opts it into outbound
  // network and credential injection, and nothing else.
  const network = requirements.network;
  if (network !== "none" && network !== "remote") {
    throw new Error("Component network must be 'none' or 'remote'.");
  }
  let connection = null;
  if (network === "remote") {
    const conn = assertRecord(
      requirements.connection,
      "A remote component must declare requirements.connection.",
    );
    connection = normalizeConnectionDefinition(conn);
  } else if (requirements.connection !== undefined) {
    throw new Error("A network-isolated component cannot declare a connection.");
  }
  if (typeof requirements.gpu !== "boolean") {
    throw new Error("Component gpu must be a boolean.");
  }
  const cpus = requirements.cpus;
  const memoryMiB = requirements.memoryMiB;
  if (typeof cpus !== "number" || !Number.isFinite(cpus) || cpus <= 0 || cpus > 32) {
    throw new Error("Component cpus must be between 0 and 32.");
  }
  if (!Number.isInteger(memoryMiB) || memoryMiB < 128 || memoryMiB > 65536) {
    throw new Error("Component memoryMiB must be between 128 and 65536.");
  }
  const id = assertNonEmptyString(
    metadata.id,
    "Component metadata.id is required.",
  );
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(id)) {
    throw new Error("Component metadata.id is invalid.");
  }
  if (
    metadata.upstreamVersion !== undefined &&
    (typeof metadata.upstreamVersion !== "string" ||
      metadata.upstreamVersion.length === 0)
  ) {
    throw new Error("Component metadata.upstreamVersion must be a non-empty string.");
  }
  return {
    manifest,
    id,
    version: assertNonEmptyString(
      metadata.version,
      "Component metadata.version is required.",
    ),
    displayName: assertNonEmptyString(
      metadata.displayName,
      "Component metadata.displayName is required.",
    ),
    image: assertNonEmptyString(
      executor.image,
      "Component executor.image is required.",
    ),
    cpus,
    memoryMiB,
    network,
    connection,
  };
}

async function directorySize(path) {
  let total = 0;
  const entries = await readdir(path, { withFileTypes: true });
  for (const entry of entries) {
    const childPath = resolve(path, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Output contains a forbidden symbolic link: ${entry.name}`);
    }
    if (entry.isDirectory()) {
      total += await directorySize(childPath);
    } else if (entry.isFile()) {
      total += (await stat(childPath)).size;
    } else {
      throw new Error(`Output contains an unsupported file type: ${entry.name}`);
    }
    if (total > MAX_OUTPUT_BYTES) {
      throw new Error(
        `Component output exceeds ${MAX_OUTPUT_BYTES} bytes.`,
      );
    }
  }
  return total;
}

function asciiJsonEscape(value) {
  const escaped = JSON.stringify(value).slice(1, -1);
  let result = "";
  for (const character of escaped) {
    const codePoint = character.codePointAt(0);
    if (codePoint <= 0x7f) {
      result += character;
    } else if (codePoint <= 0xffff) {
      result += `\\u${codePoint.toString(16).padStart(4, "0")}`;
    } else {
      const offset = codePoint - 0x10000;
      const high = 0xd800 + (offset >> 10);
      const low = 0xdc00 + (offset & 0x3ff);
      result += `\\u${high.toString(16)}\\u${low.toString(16)}`;
    }
  }
  return result;
}

/** Common encodings emitted by SDK errors, JSON serializers, and URLs. */
export function credentialSearchVariants(values) {
  const variants = new Set();
  for (const value of values) {
    if (typeof value !== "string" || value.length === 0) continue;
    const seeds = new Set([value]);
    if (value.endsWith("/")) seeds.add(value.slice(0, -1));
    for (const seed of seeds) {
      const jsonEscaped = JSON.stringify(seed).slice(1, -1);
      const urlEncoded = encodeURIComponent(seed);
      const formEncoded = new URLSearchParams({ value: seed })
        .toString()
        .slice("value=".length);
      const base64 = Buffer.from(seed, "utf8").toString("base64");
      for (const variant of [
        seed,
        jsonEscaped,
        jsonEscaped.replaceAll("/", "\\/"),
        asciiJsonEscape(seed),
        urlEncoded,
        urlEncoded.replaceAll(/%[0-9A-F]{2}/g, (match) => match.toLowerCase()),
        encodeURIComponent(urlEncoded),
        formEncoded,
        base64,
        base64.replaceAll("=", ""),
        Buffer.from(seed, "utf8").toString("base64url"),
      ]) {
        if (variant.length > 0) variants.add(variant);
      }
    }
  }
  return [...variants].map((variant) => Buffer.from(variant, "utf8"));
}

function bufferContainsVariant(buffer, variants) {
  return variants.some((variant) => buffer.indexOf(variant) !== -1);
}

async function fileContainsCredential(path, variants, maxVariantLength) {
  let carry = Buffer.alloc(0);
  for await (const chunk of createReadStream(path)) {
    const data = carry.length > 0 ? Buffer.concat([carry, chunk]) : chunk;
    if (bufferContainsVariant(data, variants)) return true;
    const carryLength = Math.min(maxVariantLength - 1, data.length);
    carry = carryLength > 0 ? data.subarray(data.length - carryLength) : Buffer.alloc(0);
  }
  return false;
}

async function scanCredentialedDirectory(
  path,
  variants,
  maxVariantLength,
  state,
  depth = 0,
) {
  if (depth > MAX_OUTPUT_DEPTH) {
    throw new Error("unsafe credentialed output depth");
  }
  const entries = await readdir(path, { withFileTypes: true });
  for (const entry of entries) {
    state.entries += 1;
    if (state.entries > MAX_OUTPUT_ENTRIES) {
      throw new Error("unsafe credentialed output entry count");
    }
    if (
      bufferContainsVariant(Buffer.from(entry.name, "utf8"), variants)
    ) {
      throw new Error("unsafe credential material");
    }
    const childPath = resolve(path, entry.name);
    const details = await lstat(childPath);
    if (details.isSymbolicLink()) {
      throw new Error("unsafe credentialed output type");
    }
    if (details.isDirectory()) {
      await scanCredentialedDirectory(
        childPath,
        variants,
        maxVariantLength,
        state,
        depth + 1,
      );
      continue;
    }
    if (!details.isFile()) {
      throw new Error("unsafe credentialed output type");
    }
    state.sizeBytes += details.size;
    if (state.sizeBytes > MAX_OUTPUT_BYTES) {
      throw new Error("unsafe credentialed output size");
    }
    if (await fileContainsCredential(childPath, variants, maxVariantLength)) {
      throw new Error("unsafe credential material");
    }
  }
}

async function discardCredentialedOutput(outputDirectory) {
  const target = resolve(outputDirectory);
  if (dirname(target) === target || target === resolve(".")) {
    throw new Error("Refusing to discard an unsafe output path.");
  }
  await rm(target, { recursive: true, force: true, maxRetries: 2 });
}

/**
 * Scan every retained output before bundle validation/publication. Any match or
 * unscannable entry removes the run-owned output directory and returns only a
 * generic error, so a failure artifact cannot become a credential side channel.
 */
export async function enforceCredentialSafeOutput(outputDirectory, values) {
  if (!Array.isArray(values) || values.length === 0) return;
  const variants = credentialSearchVariants(values);
  if (variants.length === 0) return;
  const maxVariantLength = Math.max(...variants.map((variant) => variant.length));
  try {
    await scanCredentialedDirectory(
      resolve(outputDirectory),
      variants,
      maxVariantLength,
      { entries: 0, sizeBytes: 0 },
    );
  } catch {
    try {
      await discardCredentialedOutput(outputDirectory);
    } catch {
      // Do not replace the generic public failure with a filesystem/path error.
    }
    throw new Error("Credentialed component output failed safety validation.");
  }
}

function safeOutputPath(outputRoot, relativePath) {
  if (
    typeof relativePath !== "string" ||
    relativePath.length === 0 ||
    isAbsolute(relativePath)
  ) {
    throw new Error("Artifact path must be a non-empty relative path.");
  }
  const absolutePath = resolve(outputRoot, relativePath);
  const relation = relative(outputRoot, absolutePath);
  if (
    relation === ".." ||
    relation.startsWith(`..${sep}`) ||
    isAbsolute(relation)
  ) {
    throw new Error(`Artifact path escapes the output directory: ${relativePath}`);
  }
  return absolutePath;
}

async function validateFileDescriptor(outputRoot, descriptor, label) {
  const file = assertRecord(descriptor, `${label} descriptor is required.`);
  assertNonEmptyString(file.mediaType, `${label}.mediaType is required.`);
  if (!Number.isInteger(file.sizeBytes) || file.sizeBytes < 1) {
    throw new Error(`${label}.sizeBytes must be a positive integer.`);
  }
  if (!/^[a-f0-9]{64}$/.test(file.sha256 ?? "")) {
    throw new Error(`${label}.sha256 is invalid.`);
  }
  const path = safeOutputPath(outputRoot, file.path);
  const details = await lstat(path);
  if (!details.isFile() || details.isSymbolicLink()) {
    throw new Error(`${label} must reference a regular file.`);
  }
  if (details.size !== file.sizeBytes) {
    throw new Error(`${label} size does not match its descriptor.`);
  }
  if ((await sha256File(path)) !== file.sha256) {
    throw new Error(`${label} SHA-256 does not match its descriptor.`);
  }
  return { ...file, absolutePath: path };
}

function validateCanonicalDocument(document, sourceArtifactId) {
  const parsed = assertRecord(
    document,
    "Canonical parsed document must be an object.",
  );
  if (parsed.apiVersion !== "document-arena.dev/parsed-document/v1alpha1") {
    throw new Error("Canonical parsed document apiVersion is invalid.");
  }
  if (parsed.sourceArtifactRef !== sourceArtifactId) {
    throw new Error("Canonical parsed document source lineage is invalid.");
  }
  if (!Array.isArray(parsed.pages)) {
    throw new Error("Canonical parsed document pages must be an array.");
  }

  let blockCount = 0;
  let nativeRegionCount = 0;
  for (const page of parsed.pages) {
    assertRecord(page, "Canonical page must be an object.");
    if (
      !Number.isInteger(page.pageNumber) ||
      page.pageNumber < 1 ||
      !Number.isFinite(page.width) ||
      page.width <= 0 ||
      !Number.isFinite(page.height) ||
      page.height <= 0 ||
      !Array.isArray(page.blocks)
    ) {
      throw new Error("Canonical page descriptor is invalid.");
    }
    for (const block of page.blocks) {
      assertRecord(block, "Canonical block must be an object.");
      blockCount += 1;
      if (block.sourceRegions === undefined) continue;
      if (!Array.isArray(block.sourceRegions)) {
        throw new Error("Block sourceRegions must be an array.");
      }
      for (const region of block.sourceRegions) {
        assertRecord(region, "Source region must be an object.");
        if (region.provenance !== "native") {
          throw new Error("Only parser-native source regions are accepted.");
        }
        if (
          region.pageNumber !== page.pageNumber ||
          !Array.isArray(region.bbox) ||
          region.bbox.length !== 4 ||
          !region.bbox.every(
            (coordinate) =>
              typeof coordinate === "number" &&
              Number.isFinite(coordinate) &&
              coordinate >= 0 &&
              coordinate <= 1,
          ) ||
          region.bbox[2] < region.bbox[0] ||
          region.bbox[3] < region.bbox[1]
        ) {
          throw new Error("Canonical source region bbox is invalid.");
        }
        const native = assertRecord(
          region.native,
          "Native source region metadata is required.",
        );
        if (
          typeof native.coordinateSystem !== "string" ||
          native.coordinateSystem.length === 0 ||
          !Array.isArray(native.bbox) ||
          native.bbox.length !== 4 ||
          !native.bbox.every(
            (coordinate) =>
              typeof coordinate === "number" && Number.isFinite(coordinate),
          ) ||
          typeof native.artifactId !== "string" ||
          typeof native.jsonPointer !== "string"
        ) {
          throw new Error("Native source region metadata is invalid.");
        }
        nativeRegionCount += 1;
      }
    }
  }
  return { parsed, blockCount, nativeRegionCount };
}

export async function validateResultBundle({
  outputRoot,
  manifest,
  sourceArtifactId,
  sourceSha256,
}) {
  const bundlePath = resolve(outputRoot, "bundle.json");
  const bundle = assertRecord(
    JSON.parse(await readFile(bundlePath, "utf8")),
    "Result bundle must be an object.",
  );
  if (
    bundle.apiVersion !== "document-arena.dev/result-bundle/v1alpha1" ||
    bundle.status !== "completed"
  ) {
    throw new Error("Result bundle status or apiVersion is invalid.");
  }
  if (bundle.component?.id !== manifest.metadata.id) {
    throw new Error("Result bundle component does not match the manifest.");
  }
  if (
    bundle.source?.artifactId !== sourceArtifactId ||
    bundle.source?.sha256 !== sourceSha256
  ) {
    throw new Error("Result bundle source lineage is invalid.");
  }
  if (
    bundle.progress?.mode !== "phase" ||
    bundle.progress?.partialResults !== "none"
  ) {
    throw new Error("Result bundle progress contract is invalid.");
  }

  const primary = await validateFileDescriptor(
    outputRoot,
    bundle.primary,
    "primary",
  );
  if (
    primary.mediaType !==
    "application/vnd.document-arena.parsed-document+json"
  ) {
    throw new Error("Result bundle primary media type is invalid.");
  }
  if (!Array.isArray(bundle.rawArtifacts) || bundle.rawArtifacts.length < 2) {
    throw new Error("Result bundle must preserve raw JSON and Markdown.");
  }
  const rawArtifacts = [];
  for (let index = 0; index < bundle.rawArtifacts.length; index += 1) {
    rawArtifacts.push(
      await validateFileDescriptor(
        outputRoot,
        bundle.rawArtifacts[index],
        `rawArtifacts[${index}]`,
      ),
    );
  }
  const rawMediaTypes = new Set(rawArtifacts.map((artifact) => artifact.mediaType));
  if (
    !rawMediaTypes.has("application/json") ||
    !rawMediaTypes.has("text/markdown")
  ) {
    throw new Error("Result bundle must include raw JSON and Markdown.");
  }

  const canonical = validateCanonicalDocument(
    JSON.parse(await readFile(primary.absolutePath, "utf8")),
    sourceArtifactId,
  );
  return {
    bundle,
    primary,
    rawArtifacts,
    parsed: canonical.parsed,
    blockCount: canonical.blockCount,
    nativeRegionCount: canonical.nativeRegionCount,
  };
}

async function createExclusiveDirectory(path) {
  await mkdir(dirname(path), { recursive: true });
  await mkdir(path);
}

export function connectionInjection(
  component,
  connectionValues = {},
  hostEnv = process.env,
) {
  // Docker receives only env variable names on argv. Values are supplied via
  // the Docker client's environment and become the running container's scoped
  // env (therefore visible to users who can inspect Docker), but never enter
  // process argv, request files, runner manifests, events, or result artifacts.
  const dockerArguments = [];
  const processEnvironment = { ...hostEnv };
  const sensitiveValues = [];
  const conn = component.connection;
  if (!conn) {
    return { dockerArguments, processEnvironment, sensitiveValues };
  }
  let resolved;
  try {
    resolved = resolveConnectionValues(conn, connectionValues, hostEnv);
  } catch {
    throw new Error(`Connection '${conn.type}' is not configured.`);
  }
  for (const field of conn.fields) {
    const envName = conn.env[field.name];
    const value = resolved[field.name];
    processEnvironment[envName] = value;
    dockerArguments.push("--env", envName);
    sensitiveValues.push(value);
  }
  return { dockerArguments, processEnvironment, sensitiveValues };
}

function dockerArguments({
  component,
  imageId,
  inputDirectory,
  requestPath,
  outputDirectory,
  containerName,
  connectionArguments = [],
}) {
  const args = [
    "run",
    "--rm",
    "--name",
    containerName,
    "--network",
    component.network === "remote" ? "bridge" : "none",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--pids-limit",
    "256",
    "--memory",
    `${component.memoryMiB}m`,
    "--cpus",
    String(component.cpus),
    "--env",
    "HOME=/tmp",
    ...connectionArguments,
    "--tmpfs",
    `/tmp:rw,noexec,nosuid,nodev,size=${DEFAULT_TMPFS_BYTES}`,
    "--volume",
    `${inputDirectory}:/arena/input:ro`,
    "--volume",
    `${requestPath}:/arena/request.json:ro`,
    "--volume",
    `${outputDirectory}:/arena/output:rw`,
  ];
  if (typeof process.getuid === "function" && typeof process.getgid === "function") {
    args.push("--user", `${process.getuid()}:${process.getgid()}`);
  }
  args.push(imageId);
  return args;
}

export async function runComponent({
  manifestPath,
  inputPath,
  outputPath,
  options = {},
  connectionValues = {},
  onEvent,
}) {
  const resolvedManifestPath = resolve(manifestPath);
  const component = validateManifest(
    JSON.parse(await readFile(resolvedManifestPath, "utf8")),
  );
  const resolvedInputPath = await realpath(resolve(inputPath));
  const inputDetails = await stat(resolvedInputPath);
  if (!inputDetails.isFile() || inputDetails.size === 0) {
    throw new Error("Input must be a non-empty regular file.");
  }
  if (inputDetails.size > MAX_INPUT_BYTES) {
    throw new Error(`Input exceeds ${MAX_INPUT_BYTES} bytes.`);
  }
  assertRecord(options, "Component options must be an object.");

  const sourceSha256 = await sha256File(resolvedInputPath);
  const sourceArtifactId = `sha256:${sourceSha256}`;
  const jobId = `job-${randomUUID()}`;
  const stageRunId = `stage-${randomUUID()}`;
  const runDirectory = resolve(
    "work/runs",
    `${sanitizeName(component.id)}-${new Date()
      .toISOString()
      .replaceAll(/[:.]/g, "-")}-${randomUUID()}`,
  );
  await createExclusiveDirectory(runDirectory);

  const outputDirectory = outputPath
    ? resolve(outputPath)
    : resolve(runDirectory, "output");
  await createExclusiveDirectory(outputDirectory);

  const imageId = await inspectImage(component.image);
  const request = {
    apiVersion: "document-arena.dev/stage-request/v1alpha1",
    jobId,
    stageRunId,
    component: {
      id: component.id,
      version: component.version,
      image: component.image,
      imageDigest: imageId,
    },
    source: {
      artifactId: sourceArtifactId,
      path: basename(resolvedInputPath),
      sha256: sourceSha256,
    },
    rawArtifactId: `raw:${stageRunId}:parser-output`,
    options,
  };
  const requestPath = resolve(runDirectory, "request.json");
  await writeFile(requestPath, `${JSON.stringify(request, null, 2)}\n`);

  const containerName = `document-arena-${sanitizeName(component.id)}-${randomUUID()
    .replaceAll("-", "")
    .slice(0, 12)}`;
  const connection = connectionInjection(component, connectionValues);
  let executionError = null;
  try {
    await runStreaming(
      "docker",
      dockerArguments({
        component,
        imageId,
        inputDirectory: dirname(resolvedInputPath),
        requestPath,
        outputDirectory,
        containerName,
        connectionArguments: connection.dockerArguments,
      }),
      onEvent,
      {
        env: connection.processEnvironment,
        sensitiveValues: connection.sensitiveValues,
      },
    );
  } catch (error) {
    executionError = error;
  }

  await enforceCredentialSafeOutput(
    outputDirectory,
    connection.sensitiveValues,
  );
  if (executionError) throw executionError;

  const outputSizeBytes = await directorySize(outputDirectory);
  const validated = await validateResultBundle({
    outputRoot: outputDirectory,
    manifest: component.manifest,
    sourceArtifactId,
    sourceSha256,
  });
  const runnerManifest = {
    apiVersion: "document-arena.dev/local-run/v1alpha1",
    jobId,
    stageRunId,
    component: {
      id: component.id,
      version: component.version,
      image: component.image,
      imageId,
    },
    source: {
      path: resolvedInputPath,
      artifactId: sourceArtifactId,
      sha256: sourceSha256,
      sizeBytes: inputDetails.size,
    },
    output: {
      path: outputDirectory,
      sizeBytes: outputSizeBytes,
      blockCount: validated.blockCount,
      nativeRegionCount: validated.nativeRegionCount,
    },
  };
  await writeFile(
    resolve(outputDirectory, "runner-manifest.json"),
    `${JSON.stringify(runnerManifest, null, 2)}\n`,
  );
  return {
    outputDirectory,
    requestPath,
    runnerManifest,
    ...validated,
  };
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (!args.manifestPath || !args.inputPath) {
    throw new Error(usage());
  }
  const result = await runComponent({
    manifestPath: args.manifestPath,
    inputPath: args.inputPath,
    outputPath: args.outputPath,
    options: args.options,
  });
  process.stdout.write(
    `Validated ${result.blockCount} blocks and ${result.nativeRegionCount} native regions.\n`,
  );
  process.stdout.write(`Output: ${result.outputDirectory}\n`);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : "Unknown runner error.";
    process.stderr.write(`Runner failed: ${message}\n`);
    process.exitCode = 1;
  });
}
