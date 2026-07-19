#!/usr/bin/env bun

// Local runner service: exposes the existing OCI batch runner over HTTP so the
// browser can parse a device-local PDF on this machine's Docker engine. The
// document is posted directly from the browser to this process; it never
// passes through the web control plane.

import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { runComponent } from "./run-local.mjs";

const PORT = Number(process.env.PARSER_ARENA_RUNNER_PORT ?? 8799);
const EXTENSIONS_ROOT = resolve(import.meta.dirname, "../../extensions");
const SERVICE_RUN_ROOT = resolve(import.meta.dirname, "../../work/service-runs");
const MAX_INPUT_BYTES = 100 * 1024 * 1024;

const COMPONENT_DIRECTORIES = {
  "opendataloader-pdf": "opendataloader-pdf",
  "mineru-pipeline": "mineru-pipeline",
  "azure-di": "azure-di",
};

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, x-parser-arena-filename",
  "access-control-max-age": "600",
};

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS_HEADERS },
  });
}

function sanitizeFileName(value) {
  const name = (value ?? "document.pdf")
    .split(/[\\/]/)
    .pop()
    .replaceAll(/[^A-Za-z0-9가-힣_. -]+/g, "-")
    .slice(0, 120);
  return name.toLowerCase().endsWith(".pdf") ? name : `${name || "document"}.pdf`;
}

function manifestPath(componentId) {
  const directory = COMPONENT_DIRECTORIES[componentId];
  if (!directory) return null;
  return resolve(EXTENSIONS_ROOT, directory, "component.json");
}

async function componentInfo(componentId) {
  const path = manifestPath(componentId);
  const manifest = JSON.parse(await readFile(path, "utf8"));
  const image = manifest.spec.executor.image;
  const inspect = spawnSync("docker", ["image", "inspect", image], {
    stdio: "ignore",
  });
  let optionsSchema = null;
  try {
    const schemaPath = resolve(
      dirname(path),
      manifest.spec.optionsSchema ?? "./options.schema.json",
    );
    optionsSchema = JSON.parse(await readFile(schemaPath, "utf8"));
  } catch {
    // A component without a readable options schema simply renders no form.
  }
  return {
    id: manifest.metadata.id,
    version: manifest.metadata.version,
    upstreamVersion: manifest.metadata.upstreamVersion,
    displayName: manifest.metadata.displayName,
    image,
    imageAvailable: inspect.status === 0,
    capabilities: manifest.spec.capabilities ?? {},
    requirements: manifest.spec.requirements ?? {},
    optionsSchema,
  };
}

async function handleParse(request, componentId) {
  const path = manifestPath(componentId);
  if (!path) {
    return json(404, { error: `Unknown component: ${componentId}` });
  }

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length === 0) return json(400, { error: "Empty request body." });
  if (bytes.length > MAX_INPUT_BYTES) {
    return json(413, { error: `Input exceeds ${MAX_INPUT_BYTES} bytes.` });
  }
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") {
    return json(415, { error: "Body must be a PDF file." });
  }

  const fileName = sanitizeFileName(
    request.headers.get("x-parser-arena-filename"),
  );
  let requestOptions = {};
  const rawOptions = new URL(request.url).searchParams.get("options");
  if (rawOptions) {
    try {
      const parsed = JSON.parse(rawOptions);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        requestOptions = parsed;
      }
    } catch {
      return json(400, { error: "options must be a JSON object." });
    }
  }
  const runId = `service-${randomUUID()}`;
  const inputDirectory = resolve(SERVICE_RUN_ROOT, runId, "input");
  await mkdir(inputDirectory, { recursive: true });
  const inputPath = resolve(inputDirectory, fileName);
  await writeFile(inputPath, bytes);

  // Stream the container's job events as NDJSON lines, then a final result
  // (or error) line. Progress stays phase-only and truthful: the lines are
  // the adapter's own events, not invented percentages.
  const startedAt = Date.now();
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
      try {
        const result = await runComponent({
          manifestPath: path,
          inputPath,
          options: requestOptions,
          onEvent: (event) => send(event),
        });
        send({
          type: "result",
          ok: true,
          component: result.runnerManifest.component,
          source: result.runnerManifest.source,
          options: result.bundle?.options ?? {},
          durationMs: Date.now() - startedAt,
          blockCount: result.blockCount,
          nativeRegionCount: result.nativeRegionCount,
          outputDirectory: result.outputDirectory,
          parsedDocument: result.parsed,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown runner error.";
        console.error(`parse failed (${componentId}): ${message}`);
        send({ type: "error", error: message });
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson", ...CORS_HEADERS },
  });
}

const components = await Promise.all(
  Object.keys(COMPONENT_DIRECTORIES).map((id) => componentInfo(id)),
);

const server = Bun.serve({
  port: PORT,
  idleTimeout: 240,
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (request.method === "GET" && url.pathname === "/v1/health") {
      const fresh = await Promise.all(
        Object.keys(COMPONENT_DIRECTORIES).map((id) => componentInfo(id)),
      );
      return json(200, {
        ok: true,
        protocol: "oci-batch/v1",
        // Kept for older clients: the first component mirrors the previous
        // single-component shape.
        component: fresh[0],
        components: fresh,
      });
    }
    if (request.method === "POST" && url.pathname === "/v1/parse") {
      const componentId =
        url.searchParams.get("component") ?? "opendataloader-pdf";
      try {
        return await handleParse(request, componentId);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown runner error.";
        console.error(`parse failed (${componentId}): ${message}`);
        return json(500, { error: message });
      }
    }
    return json(404, { error: "Not found." });
  },
});

console.log(
  `Parser Arena local runner listening on http://localhost:${server.port}`,
);
for (const component of components) {
  console.log(
    `Component: ${component.id}@${component.version} (${component.image})` +
      (component.imageAvailable ? "" : " — image not built yet"),
  );
}
