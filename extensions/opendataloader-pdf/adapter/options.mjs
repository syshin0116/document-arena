import { isAbsolute } from "node:path";

const MAX_JAVA_PAGE_NUMBER = 2_147_483_647;

const PAGE_SELECTION_PATTERN =
  /^\s*[1-9]\d*(?:\s*-\s*[1-9]\d*)?(?:\s*,\s*[1-9]\d*(?:\s*-\s*[1-9]\d*)?)*\s*$/;

const USER_OPTION_KEYS = new Set([
  "pages",
  "tableMethod",
  "readingOrder",
  "includeHeaderFooter",
  "useStructTree",
  "detectStrikethrough",
  "sanitize",
  "keepLineBreaks",
  "replaceInvalidChars",
  "markdownPageSeparator",
  "markdownWithHtml",
]);

const FIXED_OPTION_KEYS = new Set([
  "outputDir",
  "format",
  "imageOutput",
  "quiet",
  "threads",
  "hybrid",
]);

export const FIXED_RECORDED_OPTIONS = Object.freeze({
  outputDir: "raw",
  format: Object.freeze(["json", "markdown"]),
  imageOutput: "off",
  quiet: true,
  threads: "1",
  hybrid: "off",
});

function assertRecord(value, message) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(message);
  }
  return value;
}

function enumOption(input, key, values, fallback) {
  const value = Object.hasOwn(input, key) ? input[key] : fallback;
  if (!values.includes(value)) {
    throw new Error(`Invalid ${key} option.`);
  }
  return value;
}

function booleanOption(input, key, fallback) {
  const value = Object.hasOwn(input, key) ? input[key] : fallback;
  if (typeof value !== "boolean") {
    throw new Error(`Invalid ${key} option.`);
  }
  return value;
}

function stringOption(input, key, fallback, { allowEmpty = true } = {}) {
  const value = Object.hasOwn(input, key) ? input[key] : fallback;
  if (typeof value !== "string" || (!allowEmpty && value.length === 0)) {
    throw new Error(`Invalid ${key} option.`);
  }
  return value;
}

function validateFixedOptions(input) {
  const exactValues = {
    outputDir: "raw",
    imageOutput: "off",
    quiet: true,
    threads: "1",
    hybrid: "off",
  };
  for (const [key, expected] of Object.entries(exactValues)) {
    if (Object.hasOwn(input, key) && input[key] !== expected) {
      throw new Error(`Invalid fixed ${key} option.`);
    }
  }
  if (
    Object.hasOwn(input, "format") &&
    (!Array.isArray(input.format) ||
      input.format.length !== 2 ||
      input.format[0] !== "json" ||
      input.format[1] !== "markdown")
  ) {
    throw new Error("Invalid fixed format option.");
  }
}

function normalizePages(value) {
  if (typeof value !== "string" || !PAGE_SELECTION_PATTERN.test(value)) {
    throw new Error("Invalid pages option.");
  }

  return value
    .trim()
    .split(/\s*,\s*/)
    .map((part) => {
      const bounds = part.split(/\s*-\s*/).map(Number);
      if (
        bounds.some(
          (page) =>
            !Number.isSafeInteger(page) ||
            page < 1 ||
            page > MAX_JAVA_PAGE_NUMBER,
        ) ||
        (bounds.length === 2 && bounds[0] > bounds[1])
      ) {
        throw new Error("Invalid pages option.");
      }
      return bounds.join("-");
    })
    .join(",");
}

export function resolveOptions(options) {
  const input = assertRecord(
    options === undefined ? {} : options,
    "Request options must be an object.",
  );
  for (const key of Object.keys(input)) {
    if (!USER_OPTION_KEYS.has(key) && !FIXED_OPTION_KEYS.has(key)) {
      throw new Error(`Unsupported option: ${key}`);
    }
  }
  validateFixedOptions(input);

  return {
    ...FIXED_RECORDED_OPTIONS,
    format: [...FIXED_RECORDED_OPTIONS.format],
    tableMethod: enumOption(
      input,
      "tableMethod",
      ["default", "cluster"],
      "default",
    ),
    readingOrder: enumOption(input, "readingOrder", ["xycut", "off"], "xycut"),
    includeHeaderFooter: booleanOption(input, "includeHeaderFooter", false),
    useStructTree: booleanOption(input, "useStructTree", false),
    detectStrikethrough: booleanOption(input, "detectStrikethrough", false),
    sanitize: booleanOption(input, "sanitize", false),
    keepLineBreaks: booleanOption(input, "keepLineBreaks", false),
    replaceInvalidChars: stringOption(input, "replaceInvalidChars", " ", {
      allowEmpty: false,
    }),
    markdownPageSeparator: stringOption(input, "markdownPageSeparator", ""),
    markdownWithHtml: booleanOption(input, "markdownWithHtml", false),
    ...(Object.hasOwn(input, "pages")
      ? { pages: normalizePages(input.pages) }
      : {}),
  };
}

export function conversionOptions(recordedOptions, absoluteOutputDir) {
  const options = resolveOptions(recordedOptions);
  if (
    typeof absoluteOutputDir !== "string" ||
    !isAbsolute(absoluteOutputDir)
  ) {
    throw new Error("OpenDataLoader output directory must be an absolute path.");
  }
  const upstreamOptions = Object.fromEntries(
    Object.entries(options).filter(([key]) => key !== "outputDir"),
  );
  return {
    ...upstreamOptions,
    outputDir: absoluteOutputDir,
  };
}
