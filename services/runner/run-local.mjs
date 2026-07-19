#!/usr/bin/env bun

import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import { createReadStream } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_INPUT_BYTES = 100 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 256 * 1024 * 1024;
const DEFAULT_TMPFS_BYTES = 512 * 1024 * 1024;

function assertRecord(value, message) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(message);
  }
  return value;
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

async function runStreaming(command, args, onEvent) {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdoutTail = "";
    let stderrTail = "";
    let lineBuffer = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
      stdoutTail = (stdoutTail + chunk).slice(-16384);
      if (!onEvent) return;
      lineBuffer += chunk;
      let newline = lineBuffer.indexOf("\n");
      while (newline !== -1) {
        const line = lineBuffer.slice(0, newline).trim();
        lineBuffer = lineBuffer.slice(newline + 1);
        if (line.startsWith("{")) {
          try {
            const event = JSON.parse(line);
            if (event?.apiVersion === "parser-arena.dev/job-event/v1alpha1") {
              onEvent(event);
            }
          } catch {
            // Non-event stdout line; ignore.
          }
        }
        newline = lineBuffer.indexOf("\n");
      }
    });
    child.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
      stderrTail = (stderrTail + chunk).slice(-4096);
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code !== 0) {
        reject(
          new Error(
            componentFailureMessage(
              stdoutTail,
              stderrTail,
              `${command} exited with ${code ?? signal ?? "unknown"}.`,
            ),
          ),
        );
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

function validateManifest(value) {
  const manifest = assertRecord(value, "Component manifest must be an object.");
  if (manifest.apiVersion !== "parser-arena.dev/component/v1alpha1") {
    throw new Error("Unsupported component manifest apiVersion.");
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
  if (spec.role !== "parser") {
    throw new Error("This local spike runner accepts parser components only.");
  }
  if (executor.protocol !== "oci-batch/v1") {
    throw new Error("This runner supports oci-batch/v1 only.");
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
    const envMap = assertRecord(
      conn.env,
      "requirements.connection.env must map fields to env var names.",
    );
    connection = { type: conn.type, env: envMap };
  }
  const cpus = Number(requirements.cpus);
  const memoryMiB = Number(requirements.memoryMiB);
  if (!Number.isFinite(cpus) || cpus <= 0 || cpus > 32) {
    throw new Error("Component cpus must be between 0 and 32.");
  }
  if (!Number.isInteger(memoryMiB) || memoryMiB < 128 || memoryMiB > 65536) {
    throw new Error("Component memoryMiB must be between 128 and 65536.");
  }
  return {
    manifest,
    id: assertNonEmptyString(metadata.id, "Component metadata.id is required."),
    version: assertNonEmptyString(
      metadata.version,
      "Component metadata.version is required.",
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
  if (parsed.apiVersion !== "parser-arena.dev/parsed-document/v1alpha1") {
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
    bundle.apiVersion !== "parser-arena.dev/result-bundle/v1alpha1" ||
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
    "application/vnd.parser-arena.parsed-document+json"
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

function connectionEnv(component) {
  // For a remote component, map each declared connection field to the local
  // env var the runner reads. Values come from the runner's own environment
  // (loaded from .env); they are passed to the container but never logged or
  // written to any artifact.
  const injected = [];
  const conn = component.connection;
  if (!conn) return injected;
  for (const [field, envName] of Object.entries(conn.env)) {
    const value = process.env[envName];
    if (!value) {
      throw new Error(
        `Connection '${conn.type}' field '${field}' is not set: define ${envName} in your .env.`,
      );
    }
    injected.push("--env", `${envName}=${value}`);
  }
  return injected;
}

function dockerArguments({
  component,
  imageId,
  inputDirectory,
  requestPath,
  outputDirectory,
  containerName,
}) {
  const args = [
    "run",
    "--rm",
    "--name",
    containerName,
    "--network",
    component.network === "remote" ? "bridge" : "none",
    // The default bridge's embedded DNS is not reachable in every host
    // setup; give remote components explicit public resolvers.
    ...(component.network === "remote"
      ? ["--dns", "8.8.8.8", "--dns", "1.1.1.1"]
      : []),
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
    ...connectionEnv(component),
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
    apiVersion: "parser-arena.dev/stage-request/v1alpha1",
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

  const containerName = `parser-arena-${sanitizeName(component.id)}-${randomUUID()
    .replaceAll("-", "")
    .slice(0, 12)}`;
  await runStreaming(
    "docker",
    dockerArguments({
      component,
      imageId,
      inputDirectory: dirname(resolvedInputPath),
      requestPath,
      outputDirectory,
      containerName,
    }),
    onEvent,
  );

  const outputSizeBytes = await directorySize(outputDirectory);
  const validated = await validateResultBundle({
    outputRoot: outputDirectory,
    manifest: component.manifest,
    sourceArtifactId,
    sourceSha256,
  });
  const runnerManifest = {
    apiVersion: "parser-arena.dev/local-run/v1alpha1",
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
