#!/usr/bin/env bun

// Local runner service: exposes the existing OCI batch runner over HTTP so the
// browser can parse a device-local PDF on this machine's Docker engine. The
// document is posted directly from the browser to this process; it never
// passes through the web control plane.

import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  runnerAllowedOrigins,
  runnerCorsPolicy,
} from "./origin-policy.mjs";
import { componentAvailability } from "./component-availability.mjs";
import {
  collectConnectionDefinitions,
  handleConnectionRequest,
  normalizeConnectionDefinition,
  publicRunnerRequirements,
  SessionConnectionStore,
} from "./connections.mjs";
import { runComponent, validateManifest } from "./run-local.mjs";

const PORT = Number(
  process.env.DOCUMENT_ARENA_RUNNER_PORT ??
    process.env.PARSER_ARENA_RUNNER_PORT ??
    8799,
);
const EXTENSIONS_ROOT = resolve(import.meta.dirname, "../../extensions");
const SERVICE_RUN_ROOT = resolve(import.meta.dirname, "../../work/service-runs");
const MAX_INPUT_BYTES = 100 * 1024 * 1024;
const ALLOWED_ORIGINS = runnerAllowedOrigins();

function json(status, body, corsHeaders) {
  const headers = new Headers(corsHeaders);
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify(body), {
    status,
    headers,
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

async function discoverComponents() {
  const discovered = new Map();
  const directories = await readdir(EXTENSIONS_ROOT, { withFileTypes: true });
  for (const directory of directories) {
    if (!directory.isDirectory()) continue;
    const path = resolve(EXTENSIONS_ROOT, directory.name, "component.json");
    let manifest;
    try {
      manifest = JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    const id = validateManifest(manifest).id;
    if (discovered.has(id)) {
      throw new Error(`Duplicate component id '${id}'.`);
    }
    discovered.set(id, { path, manifest });
  }
  return discovered;
}

const COMPONENTS = await discoverComponents();
const componentManifests = [...COMPONENTS.values()].map(
  (component) => component.manifest,
);
const CONNECTIONS = new SessionConnectionStore(
  collectConnectionDefinitions(componentManifests),
);

function manifestPath(componentId) {
  return COMPONENTS.get(componentId)?.path ?? null;
}

function connectionValues(requirements) {
  if (requirements?.network !== "remote") return {};
  try {
    const definition = normalizeConnectionDefinition(requirements.connection);
    return CONNECTIONS.valuesFor(definition.type);
  } catch {
    return {};
  }
}

async function componentInfo(componentId) {
  const discovered = COMPONENTS.get(componentId);
  if (!discovered) throw new Error(`Unknown component: ${componentId}`);
  const { path, manifest } = discovered;
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
  const imageAvailable = inspect.status === 0;
  const requirements = manifest.spec.requirements ?? {};
  const sessionConnectionValues = connectionValues(requirements);
  return {
    id: manifest.metadata.id,
    version: manifest.metadata.version,
    upstreamVersion: manifest.metadata.upstreamVersion,
    displayName: manifest.metadata.displayName,
    image,
    imageAvailable,
    capabilities: manifest.spec.capabilities ?? {},
    requirements: publicRunnerRequirements(requirements),
    availability: componentAvailability({
      imageAvailable,
      requirements,
      connectionValues: sessionConnectionValues,
    }),
    optionsSchema,
  };
}

async function handleParse(request, componentId, corsHeaders) {
  const path = manifestPath(componentId);
  if (!path) {
    return json(404, { error: `Unknown component: ${componentId}` }, corsHeaders);
  }

  const component = await componentInfo(componentId);
  if (!component.availability.runnable) {
    return json(
      409,
      {
        error: "Component is not runnable on this runner.",
        availability: component.availability,
      },
      corsHeaders,
    );
  }

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length === 0) {
    return json(400, { error: "Empty request body." }, corsHeaders);
  }
  if (bytes.length > MAX_INPUT_BYTES) {
    return json(
      413,
      { error: `Input exceeds ${MAX_INPUT_BYTES} bytes.` },
      corsHeaders,
    );
  }
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") {
    return json(415, { error: "Body must be a PDF file." }, corsHeaders);
  }

  const fileName = sanitizeFileName(
    request.headers.get("x-document-arena-filename"),
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
      return json(
        400,
        { error: "options must be a JSON object." },
        corsHeaders,
      );
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
          connectionValues: CONNECTIONS.valuesFor(
            component.requirements?.connection?.type,
          ),
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
  const headers = new Headers(corsHeaders);
  headers.set("content-type", "application/x-ndjson");
  return new Response(stream, {
    headers,
  });
}

const components = await Promise.all(
  [...COMPONENTS.keys()].map((id) => componentInfo(id)),
);

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: PORT,
  idleTimeout: 240,
  async fetch(request) {
    const url = new URL(request.url);
    const cors = runnerCorsPolicy(
      request.headers.get("origin"),
      ALLOWED_ORIGINS,
    );
    if (!cors.allowed) {
      return json(
        403,
        { error: "Origin is not allowed by the local runner." },
        cors.headers,
      );
    }
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors.headers });
    }
    const connectionResponse = await handleConnectionRequest(request, {
      store: CONNECTIONS,
      corsHeaders: cors.headers,
      allowedBrowserOrigin:
        cors.allowed && request.headers.get("origin") !== null,
    });
    if (connectionResponse) return connectionResponse;
    if (request.method === "GET" && url.pathname === "/v1/health") {
      const fresh = await Promise.all(
        [...COMPONENTS.keys()].map((id) => componentInfo(id)),
      );
      return json(
        200,
        {
          ok: true,
          protocol: "oci-batch/v1",
          // Kept for older clients: the first component mirrors the previous
          // single-component shape.
          component: fresh[0],
          components: fresh,
        },
        cors.headers,
      );
    }
    if (request.method === "POST" && url.pathname === "/v1/parse") {
      const componentId =
        url.searchParams.get("component") ?? "opendataloader-pdf";
      try {
        return await handleParse(request, componentId, cors.headers);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown runner error.";
        console.error(`parse failed (${componentId}): ${message}`);
        return json(500, { error: message }, cors.headers);
      }
    }
    return json(404, { error: "Not found." }, cors.headers);
  },
});

console.log(
  `Document Arena local runner listening on http://localhost:${server.port}`,
);
for (const component of components) {
  console.log(
    `Component: ${component.id}@${component.version} (${component.image})` +
      (component.imageAvailable ? "" : " — image not built yet"),
  );
}
