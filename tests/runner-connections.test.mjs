import assert from "node:assert/strict";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  collectConnectionDefinitions,
  handleConnectionRequest,
  normalizeConnectionDefinition,
  publicRunnerRequirements,
  SessionConnectionStore,
} from "../services/runner/connections.mjs";
import { componentAvailability } from "../services/runner/component-availability.mjs";
import {
  connectionInjection,
  credentialSearchVariants,
  enforceCredentialSafeOutput,
  projectCredentialedEvent,
  validateManifest,
} from "../services/runner/run-local.mjs";

const azureManifest = JSON.parse(
  await readFile(
    new URL("../extensions/azure-di/component.json", import.meta.url),
    "utf8",
  ),
);
const runnerServiceSource = await readFile(
  new URL("../services/runner/serve.mjs", import.meta.url),
  "utf8",
);
const azureConnection = azureManifest.spec.requirements.connection;
const endpoint = "https://document-arena.cognitiveservices.azure.com/";
const key = "0123456789abcdef0123456789abcdef";
const environment = {
  AZURE_DI_ENDPOINT: "https://environment.cognitiveservices.azure.com/",
  AZURE_DI_KEY: "environment-key-0123456789abcdef",
};

function store() {
  return new SessionConnectionStore(
    collectConnectionDefinitions([azureManifest]),
  );
}

function request(path, init = {}) {
  return new Request(`http://127.0.0.1:8799${path}`, init);
}

test("the service discovers extensions without a component-id registry", () => {
  assert.match(runnerServiceSource, /readdir\(EXTENSIONS_ROOT/);
  assert.doesNotMatch(runnerServiceSource, /COMPONENT_DIRECTORIES/);
  assert.doesNotMatch(runnerServiceSource, /"azure-di"\s*:/);
});

test("credentialed events are projected onto runner-owned keys and strings", () => {
  const secret = "0123456789abcdef0123456789abcdef";
  const encoded = Buffer.from(secret).toString("base64");
  const projected = projectCredentialedEvent({
    apiVersion: "document-arena.dev/job-event/v1alpha1",
    type: "stage.progress",
    phase: secret,
    stage: secret,
    detail: encoded,
    message: secret,
    current: 2,
    total: 5,
    [secret]: encoded,
  });

  assert.deepEqual(projected, {
    apiVersion: "document-arena.dev/job-event/v1alpha1",
    type: "stage.progress",
    phase: "parsing",
    stage: "processing",
    current: 2,
    total: 5,
    detail: "Processing 2/5",
  });
  assert.doesNotMatch(JSON.stringify(projected), new RegExp(secret));
  assert.doesNotMatch(JSON.stringify(projected), new RegExp(encoded));
  assert.deepEqual(
    projectCredentialedEvent({
      apiVersion: "document-arena.dev/job-event/v1alpha1",
      type: "stage.failed",
      message: secret,
    }),
    {
      apiVersion: "document-arena.dev/job-event/v1alpha1",
      type: "stage.failed",
    },
  );
});

test("credential artifact scanning covers plain, escaped, URL, and base64 forms", async () => {
  const credentials = [
    'json-secret-"-0123456789',
    "url secret/0123456789",
    "base64-secret-0123456789",
  ];
  const jsonEscaped = JSON.stringify(credentials[0]).slice(1, -1);
  const urlEncoded = encodeURIComponent(credentials[1]);
  const base64 = Buffer.from(credentials[2]).toString("base64");
  const cases = [credentials[0], jsonEscaped, urlEncoded, base64];

  for (const [index, leaked] of cases.entries()) {
    const output = await mkdtemp(join(tmpdir(), "document-arena-output-"));
    await mkdir(join(output, "raw"));
    await writeFile(join(output, "raw", `provider-${index}.bin`), leaked);
    await assert.rejects(
      enforceCredentialSafeOutput(output, credentials),
      (error) => {
        assert.equal(
          error.message,
          "Credentialed component output failed safety validation.",
        );
        assert.doesNotMatch(error.message, /json-secret|url secret|base64-secret/);
        return true;
      },
    );
    await assert.rejects(access(output), { code: "ENOENT" });
  }

  const cleanOutput = await mkdtemp(join(tmpdir(), "document-arena-output-"));
  try {
    await writeFile(cleanOutput + "/provider.json", '{"status":"ok"}\n');
    await enforceCredentialSafeOutput(cleanOutput, credentials);
    await access(cleanOutput + "/provider.json");
  } finally {
    await rm(cleanOutput, { recursive: true, force: true });
  }

  const variants = credentialSearchVariants(credentials);
  assert.ok(
    variants.some((variant) => variant.equals(Buffer.from(jsonEscaped))),
  );
  assert.ok(variants.some((variant) => variant.equals(Buffer.from(urlEncoded))));
  assert.ok(variants.some((variant) => variant.equals(Buffer.from(base64))));
});

test("credential scanning catches stream boundaries and unsafe directory depth", async () => {
  const secret = "boundary-secret-0123456789abcdef";
  const boundaryOutput = await mkdtemp(join(tmpdir(), "document-arena-output-"));
  await writeFile(
    join(boundaryOutput, "provider.bin"),
    Buffer.concat([Buffer.alloc(65_520, 0x78), Buffer.from(secret)]),
  );
  await assert.rejects(
    enforceCredentialSafeOutput(boundaryOutput, [secret]),
    /failed safety validation/,
  );
  await assert.rejects(access(boundaryOutput), { code: "ENOENT" });

  const deepOutput = await mkdtemp(join(tmpdir(), "document-arena-output-"));
  let directory = deepOutput;
  for (let depth = 0; depth < 34; depth += 1) {
    directory = join(directory, `d${depth}`);
    await mkdir(directory);
  }
  await writeFile(join(directory, "safe.txt"), "safe");
  await assert.rejects(
    enforceCredentialSafeOutput(deepOutput, [secret]),
    /failed safety validation/,
  );
  await assert.rejects(access(deepOutput), { code: "ENOENT" });
});

test("connection env targets cannot influence the host or Docker client", () => {
  for (const reservedName of [
    "PATH",
    "home",
    "DOCKER_HOST",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NODE_OPTIONS",
    "BUN_CONFIG_VERBOSE_FETCH",
    "LD_PRELOAD",
    "DYLD_INSERT_LIBRARIES",
  ]) {
    const connection = structuredClone(azureConnection);
    connection.env.endpoint = reservedName;
    assert.throws(
      () => normalizeConnectionDefinition(connection),
      /reserved env name/,
      reservedName,
    );
  }
});

test("runtime manifest admission mirrors the versioned connection contract", () => {
  assert.equal(validateManifest(azureManifest).id, "azure-di");

  const invalidCases = [];
  const unknownFieldPolicy = structuredClone(azureManifest);
  unknownFieldPolicy.spec.requirements.connection.fields[1].pattern = "(a+)+$";
  invalidCases.push(unknownFieldPolicy);

  const localWithConnection = structuredClone(azureManifest);
  localWithConnection.spec.requirements.network = "none";
  invalidCases.push(localWithConnection);

  const misspelledRequirement = structuredClone(azureManifest);
  misspelledRequirement.spec.requirements.memroyMiB = 2048;
  invalidCases.push(misspelledRequirement);

  const stringCpu = structuredClone(azureManifest);
  stringCpu.spec.requirements.cpus = "2";
  invalidCases.push(stringCpu);

  for (const manifest of invalidCases) {
    assert.throws(() => validateManifest(manifest));
  }
});

test("connection values reject controls and size overflows and canonicalize URIs", () => {
  const connectionStore = store();
  assert.throws(
    () =>
      connectionStore.configure(
        "azure-di",
        { endpoint: `\t${endpoint}\t`, key },
        {},
      ),
    /invalid length/,
  );
  assert.throws(
    () =>
      connectionStore.configure(
        "azure-di",
        { endpoint, key: `0123456789abcdef\t` },
        {},
      ),
    /invalid length/,
  );
  assert.throws(
    () =>
      connectionStore.configure(
        "azure-di",
        { endpoint, key: "가".repeat(6) },
        {},
      ),
    /invalid length/,
    "manifest minLength retains its JSON Schema character semantics",
  );
  assert.throws(
    () =>
      connectionStore.configure(
        "azure-di",
        { endpoint, key: "가".repeat(3_000) },
        {},
      ),
    /invalid length/,
    "a UTF-8 byte cap also bounds connection memory and request handling",
  );
  assert.throws(
    () =>
      connectionStore.configure(
        "azure-di",
        { endpoint, key: `0123456789abcdef\ud800` },
        {},
      ),
    /invalid length/,
  );

  const noTrailingSlash = endpoint.slice(0, -1);
  connectionStore.configure(
    "azure-di",
    { endpoint: noTrailingSlash, key },
    {},
  );
  assert.equal(connectionStore.valuesFor("azure-di").endpoint, endpoint);

  const missingPolicy = structuredClone(azureConnection);
  delete missingPolicy.fields[0].allowedHostSuffixes;
  assert.throws(
    () => normalizeConnectionDefinition(missingPolicy),
    /requires approved host suffixes/,
  );
});

test("one connection type requires an identical descriptor, policy, and env mapping", () => {
  const reordered = structuredClone(azureManifest);
  reordered.spec.requirements.connection.env = {
    key: "AZURE_DI_KEY",
    endpoint: "AZURE_DI_ENDPOINT",
  };
  assert.equal(
    collectConnectionDefinitions([azureManifest, reordered]).size,
    1,
    "object key order must not create a false conflict",
  );

  const conflicting = structuredClone(azureManifest);
  conflicting.spec.requirements.connection.env.endpoint = "AZURE_ENDPOINT_OTHER";
  assert.throws(
    () => collectConnectionDefinitions([azureManifest, conflicting]),
    /conflicting field declarations/,
  );
});

async function route(connectionStore, path, init = {}, env = {}) {
  const browserOrigin = init.headers?.Origin ?? init.headers?.origin ?? null;
  return handleConnectionRequest(request(path, init), {
    store: connectionStore,
    env,
    corsHeaders: new Headers(
      browserOrigin
        ? { "Access-Control-Allow-Origin": browserOrigin }
        : undefined,
    ),
    allowedBrowserOrigin: browserOrigin === "http://localhost:3000",
  });
}

test("connection discovery returns only public descriptors and no values", async () => {
  const connectionStore = store();
  const response = await route(connectionStore, "/v1/connections", {}, environment);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(body.connections[0], {
    type: "azure-di",
    title: "Azure Document Intelligence",
    description:
      "Uses your Azure Document Intelligence resource for this local runner session.",
    configured: true,
    source: "environment",
    fields: [
      {
        name: "endpoint",
        label: "Endpoint",
        description:
          "The HTTPS endpoint for your Azure Document Intelligence resource.",
        secret: false,
        format: "uri",
        placeholder: "https://<resource>.cognitiveservices.azure.com/",
        minLength: 39,
        maxLength: 2048,
      },
      {
        name: "key",
        label: "API key",
        description:
          "An Azure resource key. It stays only in runner memory for this session.",
        secret: true,
        format: "text",
        placeholder: "Enter an Azure resource key",
        minLength: 16,
        maxLength: 4096,
      },
    ],
  });
  const serialized = JSON.stringify(body);
  assert.doesNotMatch(serialized, /AZURE_DI_|environment-key|environment\.cognitive/);
  assert.doesNotMatch(serialized, /allowedHostSuffixes/);
});

test("an allowed browser can atomically override an environment connection", async () => {
  const connectionStore = store();
  const response = await route(
    connectionStore,
    "/v1/connections/azure-di",
    {
      method: "PUT",
      headers: {
        Origin: "http://localhost:3000",
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ values: { endpoint, key } }),
    },
    environment,
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(body.connection.configured, true);
  assert.equal(body.connection.source, "session");
  assert.deepEqual(connectionStore.valuesFor("azure-di"), { endpoint, key });
  assert.doesNotMatch(JSON.stringify(body), new RegExp(key));
  assert.doesNotMatch(JSON.stringify(body), /document-arena\.cognitiveservices/);

  const partial = await route(
    store(),
    "/v1/connections/azure-di",
    {
      method: "PUT",
      headers: {
        Origin: "http://localhost:3000",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ values: { key } }),
    },
    environment,
  );
  assert.equal(partial.status, 400);
  assert.match((await partial.json()).error, /provided together/);
});

test("credential mutations reject origin-less callers and invalid bodies", async () => {
  const connectionStore = store();
  const originless = await route(connectionStore, "/v1/connections/azure-di", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ values: { endpoint, key } }),
  });
  assert.equal(originless.status, 403);
  assert.deepEqual(connectionStore.valuesFor("azure-di"), {});

  const wrongType = await route(connectionStore, "/v1/connections/azure-di", {
    method: "PUT",
    headers: {
      Origin: "http://localhost:3000",
      "Content-Type": "text/plain",
    },
    body: JSON.stringify({ values: { endpoint, key } }),
  });
  assert.equal(wrongType.status, 415);
  assert.equal(wrongType.headers.get("cache-control"), "no-store");

  const extra = await route(connectionStore, "/v1/connections/azure-di", {
    method: "PUT",
    headers: {
      Origin: "http://localhost:3000",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ values: { endpoint, key }, echoedKey: key }),
  });
  assert.equal(extra.status, 400);
  assert.doesNotMatch(JSON.stringify(await extra.json()), new RegExp(key));
});

test("manifest endpoint policy rejects exfiltration and SSRF targets generically", () => {
  const rejectedEndpoints = [
    "http://document-arena.cognitiveservices.azure.com/",
    "https://user:pass@document-arena.cognitiveservices.azure.com/",
    "https://document-arena.cognitiveservices.azure.com/?key=value",
    "https://document-arena.cognitiveservices.azure.com/#fragment",
    "https://document-arena.cognitiveservices.azure.com:444/",
    "https://cognitiveservices.azure.com/",
    "https://cognitiveservices.azure.com.evil.test/",
    "https://127.0.0.1/",
  ];

  for (const invalidEndpoint of rejectedEndpoints) {
    const connectionStore = store();
    assert.throws(
      () =>
        connectionStore.configure(
          "azure-di",
          { endpoint: invalidEndpoint, key },
          {},
        ),
      /approved|valid URL|invalid length/,
      invalidEndpoint,
    );
    assert.deepEqual(connectionStore.valuesFor("azure-di"), {});
  }
});

test("clearing session credentials restores environment status without returning values", async () => {
  const connectionStore = store();
  connectionStore.configure("azure-di", { endpoint, key }, environment);
  const response = await route(
    connectionStore,
    "/v1/connections/azure-di",
    {
      method: "DELETE",
      headers: { Origin: "http://localhost:3000" },
    },
    environment,
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.connection.configured, true);
  assert.equal(body.connection.source, "environment");
  assert.deepEqual(connectionStore.valuesFor("azure-di"), {});
  assert.doesNotMatch(JSON.stringify(body), /environment-key|environment\.cognitive/);
});

test("OCI injection keeps connection values out of Docker argv and run metadata", () => {
  const component = {
    connection: normalizeConnectionDefinition(azureConnection),
  };
  const session = connectionInjection(component, { endpoint, key }, environment);

  assert.deepEqual(session.dockerArguments, [
    "--env",
    "AZURE_DI_ENDPOINT",
    "--env",
    "AZURE_DI_KEY",
  ]);
  assert.equal(session.processEnvironment.AZURE_DI_ENDPOINT, endpoint);
  assert.equal(session.processEnvironment.AZURE_DI_KEY, key);
  assert.deepEqual(session.sensitiveValues, [endpoint, key]);
  assert.doesNotMatch(JSON.stringify(session.dockerArguments), new RegExp(key));
  assert.doesNotMatch(
    JSON.stringify(session.dockerArguments),
    /document-arena\.cognitiveservices/,
  );

  const fromEnvironment = connectionInjection(component, {}, environment);
  assert.equal(
    fromEnvironment.processEnvironment.AZURE_DI_ENDPOINT,
    environment.AZURE_DI_ENDPOINT,
  );
  assert.throws(
    () => connectionInjection(component, { endpoint }, environment),
    /not configured/,
    "a partial session must not fall back to environment fields",
  );
});

test("health requirements omit env mappings and session readiness stays generic", () => {
  assert.deepEqual(publicRunnerRequirements(azureManifest.spec.requirements), {
    gpu: false,
    network: "remote",
    memoryMiB: 2048,
    cpus: 2,
    connection: { type: "azure-di" },
  });

  const unavailable = componentAvailability({
    imageAvailable: true,
    requirements: azureManifest.spec.requirements,
    env: environment,
    connectionValues: { endpoint },
  });
  assert.equal(unavailable.runnable, false);
  assert.doesNotMatch(JSON.stringify(unavailable), /AZURE_DI_|environment-key|endpoint/);

  const available = componentAvailability({
    imageAvailable: true,
    requirements: azureManifest.spec.requirements,
    env: {},
    connectionValues: { endpoint, key },
  });
  assert.deepEqual(available, { runnable: true, reasons: [] });
});
