const CONNECTION_TYPE_PATTERN = /^[a-z0-9][a-z0-9.-]{0,63}$/;
const FIELD_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED_ENV_NAMES = new Set([
  "ALL_PROXY",
  "BASH_ENV",
  "CDPATH",
  "ENV",
  "GLOBIGNORE",
  "HOME",
  "HOSTALIASES",
  "IFS",
  "NODE_OPTIONS",
  "NO_PROXY",
  "PATH",
  "SHELL",
  "SSLKEYLOGFILE",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
]);
const RESERVED_ENV_PREFIXES = [
  "BUN_",
  "DOCKER_",
  "DYLD_",
  "LD_",
];
const CONNECTION_PROPERTIES = new Set([
  "type",
  "title",
  "description",
  "fields",
  "env",
]);
const CONNECTION_FIELD_PROPERTIES = new Set([
  "name",
  "label",
  "description",
  "secret",
  "format",
  "placeholder",
  "minLength",
  "maxLength",
  "allowedHostSuffixes",
]);
const MAX_CONNECTION_VALUE_BYTES = 8 * 1024;
export const MAX_CONNECTION_BODY_BYTES = 32 * 1024;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function rejectUnknownProperties(value, allowed, label) {
  const unknown = Object.keys(value).find((name) => !allowed.has(name));
  if (unknown) throw new Error(`${label} has an unknown property '${unknown}'.`);
}

export function isReservedConnectionEnvName(value) {
  const name = value.toUpperCase();
  return (
    RESERVED_ENV_NAMES.has(name) ||
    RESERVED_ENV_PREFIXES.some((prefix) => name.startsWith(prefix)) ||
    /^HTTPS?.*_PROXY$/u.test(name)
  );
}

function nonEmptyString(value, label, maxLength = 512) {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > maxLength
  ) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function optionalString(value, label, maxLength) {
  if (value === undefined) return undefined;
  return nonEmptyString(value, label, maxLength);
}

function normalizeAllowedHostSuffixes(value, fieldName) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(
      `Connection field '${fieldName}' allowedHostSuffixes must be a non-empty array.`,
    );
  }
  const normalized = value.map((suffix) => {
    const result = nonEmptyString(
      suffix,
      `Connection field '${fieldName}' host suffix`,
      253,
    ).toLowerCase();
    if (!/^\.[a-z0-9.-]+$/.test(result) || result.endsWith(".")) {
      throw new Error(
        `Connection field '${fieldName}' has an invalid host suffix policy.`,
      );
    }
    return result;
  });
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(
      `Connection field '${fieldName}' repeats a host suffix policy.`,
    );
  }
  return normalized;
}

function normalizeField(rawField, fallbackName) {
  const source =
    typeof rawField === "string"
      ? { name: rawField }
      : isRecord(rawField)
        ? rawField
        : { name: fallbackName };
  rejectUnknownProperties(
    source,
    CONNECTION_FIELD_PROPERTIES,
    "Connection field",
  );
  const name = nonEmptyString(source.name ?? fallbackName, "Connection field name", 64);
  if (!FIELD_NAME_PATTERN.test(name)) {
    throw new Error(`Connection field '${name}' has an invalid name.`);
  }
  const format = optionalString(source.format, `Connection field '${name}' format`, 32);
  if (format !== undefined && format !== "uri" && format !== "text") {
    throw new Error(`Connection field '${name}' has an unsupported format.`);
  }
  if (source.secret !== undefined && typeof source.secret !== "boolean") {
    throw new Error(`Connection field '${name}' secret must be a boolean.`);
  }
  const minLength = source.minLength ?? 1;
  const maxLength = source.maxLength ?? MAX_CONNECTION_VALUE_BYTES;
  if (
    !Number.isInteger(minLength) ||
    minLength < 1 ||
    !Number.isInteger(maxLength) ||
    maxLength < minLength ||
    maxLength > MAX_CONNECTION_VALUE_BYTES
  ) {
    throw new Error(`Connection field '${name}' has invalid length limits.`);
  }
  const allowedHostSuffixes = normalizeAllowedHostSuffixes(
    source.allowedHostSuffixes,
    name,
  );
  if (format === "uri" && !allowedHostSuffixes) {
    throw new Error(
      `Connection field '${name}' URI format requires approved host suffixes.`,
    );
  }
  return {
    name,
    label: optionalString(source.label, `Connection field '${name}' label`, 120),
    description: optionalString(
      source.description,
      `Connection field '${name}' description`,
      500,
    ),
    secret: source.secret ?? true,
    format,
    placeholder: optionalString(
      source.placeholder,
      `Connection field '${name}' placeholder`,
      300,
    ),
    minLength,
    maxLength,
    allowedHostSuffixes,
  };
}

/**
 * Parse the connection declaration shared by component discovery and OCI
 * execution. UI descriptors and validation policy come entirely from the
 * manifest; the runner never switches on a provider or component id.
 */
export function normalizeConnectionDefinition(value) {
  if (!isRecord(value)) {
    throw new Error("A remote component must declare a connection object.");
  }
  rejectUnknownProperties(
    value,
    CONNECTION_PROPERTIES,
    "Connection definition",
  );
  const type = nonEmptyString(value.type, "Connection type", 64);
  if (!CONNECTION_TYPE_PATTERN.test(type)) {
    throw new Error("Connection type has an invalid identifier.");
  }
  if (!isRecord(value.env) || Object.keys(value.env).length === 0) {
    throw new Error(`Connection '${type}' must declare an env mapping.`);
  }

  const env = {};
  for (const [fieldName, envNameValue] of Object.entries(value.env)) {
    if (!FIELD_NAME_PATTERN.test(fieldName)) {
      throw new Error(`Connection '${type}' has an invalid env field name.`);
    }
    const envName = nonEmptyString(
      envNameValue,
      `Connection '${type}' env name`,
      128,
    );
    if (!ENV_NAME_PATTERN.test(envName)) {
      throw new Error(`Connection '${type}' has an invalid env name.`);
    }
    if (isReservedConnectionEnvName(envName)) {
      throw new Error(`Connection '${type}' targets a reserved env name.`);
    }
    env[fieldName] = envName;
  }
  if (new Set(Object.values(env)).size !== Object.keys(env).length) {
    throw new Error(`Connection '${type}' maps multiple fields to one env name.`);
  }

  const rawFields = value.fields ?? Object.keys(env);
  if (!Array.isArray(rawFields) || rawFields.length === 0) {
    throw new Error(`Connection '${type}' must declare fields.`);
  }
  const fields = rawFields.map((field, index) =>
    normalizeField(field, Object.keys(env)[index]),
  );
  const names = fields.map((field) => field.name);
  if (
    new Set(names).size !== names.length ||
    names.length !== Object.keys(env).length ||
    names.some((name) => !Object.hasOwn(env, name))
  ) {
    throw new Error(
      `Connection '${type}' fields must match its env mapping exactly.`,
    );
  }

  return {
    type,
    title: optionalString(value.title, `Connection '${type}' title`, 120),
    description: optionalString(
      value.description,
      `Connection '${type}' description`,
      500,
    ),
    fields,
    env: Object.fromEntries(
      Object.entries(env).sort(([left], [right]) => left.localeCompare(right)),
    ),
  };
}

function compatibleDescriptor(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function collectConnectionDefinitions(manifests) {
  const definitions = new Map();
  for (const manifest of manifests) {
    const requirements = manifest?.spec?.requirements;
    if (requirements?.network !== "remote") continue;
    const definition = normalizeConnectionDefinition(requirements.connection);
    const existing = definitions.get(definition.type);
    if (existing && !compatibleDescriptor(existing, definition)) {
      throw new Error(
        `Connection type '${definition.type}' has conflicting field declarations.`,
      );
    }
    if (!existing) definitions.set(definition.type, definition);
  }
  return definitions;
}

function isConfiguredValue(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isWellFormedUnicode(value) {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function validateUri(value, field) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Connection field '${field.name}' must be a valid URL.`);
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    (url.port && url.port !== "443")
  ) {
    throw new Error(
      `Connection field '${field.name}' must use an approved HTTPS endpoint.`,
    );
  }
  if (field.allowedHostSuffixes) {
    const hostname = url.hostname.toLowerCase();
    const allowed = field.allowedHostSuffixes.some(
      (suffix) =>
        hostname.length > suffix.length && hostname.endsWith(suffix),
    );
    if (!allowed) {
      throw new Error(
        `Connection field '${field.name}' does not use an approved service host.`,
      );
    }
  }
  return url.href;
}

function validateConnectionValue(value, field) {
  if (typeof value !== "string") {
    throw new Error(`Connection field '${field.name}' must be a string.`);
  }
  if (
    value !== value.trim() ||
    !isWellFormedUnicode(value) ||
    value.length < field.minLength ||
    value.length > field.maxLength ||
    Buffer.byteLength(value, "utf8") > MAX_CONNECTION_VALUE_BYTES ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) {
    throw new Error(`Connection field '${field.name}' has an invalid length.`);
  }
  if (field.format === "uri") return validateUri(value, field);
  return value;
}

export function resolveConnectionValues(
  connection,
  sessionValues = {},
  env = process.env,
) {
  const definition = normalizeConnectionDefinition(connection);
  const values = resolveValues(definition, sessionValues, env);
  for (const field of definition.fields) {
    if (!isConfiguredValue(values[field.name])) {
      throw new Error(`Connection '${definition.type}' is not configured.`);
    }
    values[field.name] = validateConnectionValue(values[field.name], field);
  }
  return values;
}

export function connectionIsConfigured(
  connection,
  sessionValues = {},
  env = process.env,
) {
  try {
    resolveConnectionValues(connection, sessionValues, env);
    return true;
  } catch {
    return false;
  }
}

function publicField(field) {
  return Object.fromEntries(
    Object.entries({
      name: field.name,
      label: field.label,
      description: field.description,
      secret: field.secret,
      format: field.format,
      placeholder: field.placeholder,
      minLength: field.minLength,
      maxLength: field.maxLength,
    }).filter(([, value]) => value !== undefined),
  );
}

function resolveValues(definition, sessionValues, env) {
  const values = {};
  const useSession =
    isRecord(sessionValues) && Object.keys(sessionValues).length > 0;
  for (const field of definition.fields) {
    const value = useSession
      ? sessionValues[field.name]
      : env[definition.env[field.name]];
    if (isConfiguredValue(value)) {
      values[field.name] = value;
    }
  }
  return values;
}

export class SessionConnectionStore {
  #definitions;
  #sessionValues = new Map();

  constructor(definitions) {
    this.#definitions = new Map(definitions);
  }

  has(type) {
    return this.#definitions.has(type);
  }

  valuesFor(type) {
    const values = this.#sessionValues.get(type);
    return values ? { ...values } : {};
  }

  resolvedValuesFor(type, env = process.env) {
    const definition = this.#definitions.get(type);
    if (!definition) return {};
    return resolveConnectionValues(
      definition,
      this.#sessionValues.get(type),
      env,
    );
  }

  descriptor(type, env = process.env) {
    const definition = this.#definitions.get(type);
    if (!definition) return null;
    const sessionValues = this.#sessionValues.get(type);
    const configured = connectionIsConfigured(definition, sessionValues, env);
    return Object.fromEntries(
      Object.entries({
        type: definition.type,
        title: definition.title,
        description: definition.description,
        configured,
        source: configured
          ? sessionValues && Object.keys(sessionValues).length > 0
            ? "session"
            : "environment"
          : null,
        fields: definition.fields.map(publicField),
      }).filter(([, value]) => value !== undefined),
    );
  }

  descriptors(env = process.env) {
    return [...this.#definitions.keys()].map((type) =>
      this.descriptor(type, env),
    );
  }

  configure(type, rawValues, env = process.env) {
    const definition = this.#definitions.get(type);
    if (!definition) throw new ConnectionRequestError(404, "Unknown connection type.");
    if (!isRecord(rawValues) || Object.keys(rawValues).length === 0) {
      throw new ConnectionRequestError(
        400,
        "values must contain at least one connection field.",
      );
    }
    const fields = new Map(
      definition.fields.map((field) => [field.name, field]),
    );
    const submitted = {};
    for (const [name, value] of Object.entries(rawValues)) {
      const field = fields.get(name);
      if (!field) {
        throw new ConnectionRequestError(400, "values contains an unknown field.");
      }
      try {
        submitted[name] = validateConnectionValue(value, field);
      } catch (error) {
        throw new ConnectionRequestError(
          400,
          error instanceof Error ? error.message : "Invalid connection value.",
        );
      }
    }
    if (
      submitted &&
      (Object.keys(submitted).length !== definition.fields.length ||
        definition.fields.some((field) => !Object.hasOwn(submitted, field.name)))
    ) {
      throw new ConnectionRequestError(
        400,
        "All connection fields must be provided together.",
      );
    }
    const nextSession = submitted;
    try {
      resolveConnectionValues(definition, nextSession, env);
    } catch {
      throw new ConnectionRequestError(
        400,
        "All connection fields must be configured.",
      );
    }
    this.#sessionValues.set(type, nextSession);
    return this.descriptor(type, env);
  }

  clear(type, env = process.env) {
    if (!this.#definitions.has(type)) {
      throw new ConnectionRequestError(404, "Unknown connection type.");
    }
    this.#sessionValues.delete(type);
    return this.descriptor(type, env);
  }
}

export class ConnectionRequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function responseHeaders(corsHeaders) {
  const headers = new Headers(corsHeaders);
  headers.set("Cache-Control", "no-store");
  return headers;
}

function json(status, body, corsHeaders) {
  const headers = responseHeaders(corsHeaders);
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(body), { status, headers });
}

async function readJsonObject(request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw new ConnectionRequestError(415, "Content-Type must be application/json.");
  }
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_CONNECTION_BODY_BYTES) {
    throw new ConnectionRequestError(413, "Connection request body is too large.");
  }
  if (!request.body) {
    throw new ConnectionRequestError(400, "A JSON request body is required.");
  }
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_CONNECTION_BODY_BYTES) {
      await reader.cancel();
      throw new ConnectionRequestError(413, "Connection request body is too large.");
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ConnectionRequestError(400, "Request body must be valid JSON.");
  }
  if (!isRecord(parsed)) {
    throw new ConnectionRequestError(400, "Request body must be a JSON object.");
  }
  return parsed;
}

function requestedType(pathname) {
  const prefix = "/v1/connections/";
  if (!pathname.startsWith(prefix)) return null;
  const encoded = pathname.slice(prefix.length);
  if (!encoded || encoded.includes("/")) return null;
  try {
    const decoded = decodeURIComponent(encoded);
    return CONNECTION_TYPE_PATTERN.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

/**
 * Handle only /v1/connections routes. Returns null for unrelated routes.
 * The caller supplies whether the Origin already passed its exact allowlist;
 * native/origin-less clients may read status but may never mutate credentials.
 */
export async function handleConnectionRequest(request, {
  store,
  env = process.env,
  corsHeaders,
  allowedBrowserOrigin,
}) {
  const url = new URL(request.url);
  if (url.pathname === "/v1/connections") {
    if (request.method !== "GET") {
      return json(405, { error: "Method not allowed." }, corsHeaders);
    }
    return json(200, { connections: store.descriptors(env) }, corsHeaders);
  }

  if (!url.pathname.startsWith("/v1/connections/")) return null;
  const type = requestedType(url.pathname);
  if (!type || !store.has(type)) {
    return json(404, { error: "Unknown connection type." }, corsHeaders);
  }
  if (request.method !== "PUT" && request.method !== "DELETE") {
    return json(405, { error: "Method not allowed." }, corsHeaders);
  }
  if (!allowedBrowserOrigin || request.headers.get("origin") === null) {
    return json(
      403,
      { error: "Credential changes require an allowed browser origin." },
      corsHeaders,
    );
  }

  try {
    if (request.method === "DELETE") {
      const connection = store.clear(type, env);
      return json(200, { connection }, corsHeaders);
    }
    const body = await readJsonObject(request);
    if (!isRecord(body.values) || Object.keys(body).some((key) => key !== "values")) {
      throw new ConnectionRequestError(
        400,
        "Request body must contain only a values object.",
      );
    }
    const connection = store.configure(type, body.values, env);
    return json(200, { connection }, corsHeaders);
  } catch (error) {
    if (error instanceof ConnectionRequestError) {
      return json(error.status, { error: error.message }, corsHeaders);
    }
    return json(400, { error: "Invalid connection request." }, corsHeaders);
  }
}

export function publicRunnerRequirements(requirements = {}) {
  const result = {};
  for (const name of ["gpu", "network", "memoryMiB", "cpus"]) {
    if (requirements[name] !== undefined) result[name] = requirements[name];
  }
  if (requirements.connection !== undefined) {
    try {
      const connection = normalizeConnectionDefinition(requirements.connection);
      result.connection = { type: connection.type };
    } catch {
      // An invalid manifest is rejected before execution. Do not reflect its
      // internal connection mapping through the public health response.
    }
  }
  return result;
}
