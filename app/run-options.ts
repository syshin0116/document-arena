import type {
  LocalRunnerComponent,
  OptionsSchemaAnnotation,
  OptionsSchemaChoice,
  OptionsSchemaItems,
  OptionsSchemaPrimitive,
  OptionsSchemaProperty,
} from "./local-runner";

export type RunAvailability = {
  available: boolean;
  disabledReason?: string;
  reasons?: readonly {
    code?: string;
    message: string;
  }[];
};

export type SchemaDisablement = {
  state: "fixed" | "unavailable";
  reason: string;
  reasonCode?: string;
};

export type NormalizedOptionChoice = {
  id: string;
  value: OptionsSchemaPrimitive | undefined;
  label: string;
  description?: string;
  disablement?: SchemaDisablement;
  sourceUrl?: string;
};

type ChoiceSchema = Pick<OptionsSchemaProperty, "enum" | "oneOf"> | OptionsSchemaItems;
type AnnotatedSchema = {
  "x-parser-arena"?: OptionsSchemaAnnotation;
};

const hasOwn = (value: object, key: PropertyKey) =>
  Object.prototype.hasOwnProperty.call(value, key);

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function isPrimitive(value: unknown): value is OptionsSchemaPrimitive {
  return (
    value === null ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value)) ||
    typeof value === "boolean"
  );
}

export function safeSchemaSourceUrl(value: unknown): string | undefined {
  const source = nonEmptyString(value);
  if (!source) return undefined;
  try {
    const url = new URL(source);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

export function schemaDisablement(
  schema: AnnotatedSchema | null | undefined,
): SchemaDisablement | undefined {
  const annotation = schema?.["x-parser-arena"];
  const availability = annotation?.availability;
  if (
    availability &&
    (availability.state === "fixed" ||
      availability.state === "unavailable")
  ) {
    const reason = nonEmptyString(availability.reason);
    if (reason) {
      return {
        state: availability.state,
        reason,
        reasonCode: nonEmptyString(availability.reasonCode),
      };
    }
  }
  const disabledReason = nonEmptyString(annotation?.disabledReason);
  return disabledReason
    ? { state: "unavailable", reason: disabledReason }
    : undefined;
}

export function schemaSourceUrl(
  schema: AnnotatedSchema | null | undefined,
): string | undefined {
  return safeSchemaSourceUrl(schema?.["x-parser-arena"]?.sourceUrl);
}

export function formatOptionValue(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return value.map(formatOptionValue).join(", ");
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

export function humanizeOptionKey(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
  return words.length > 0
    ? words.charAt(0).toUpperCase() + words.slice(1)
    : key;
}

export function optionValueToken(value: OptionsSchemaPrimitive): string {
  return JSON.stringify(value);
}

function choiceValue(
  choice: OptionsSchemaChoice,
): OptionsSchemaPrimitive | undefined {
  if (hasOwn(choice, "const") && isPrimitive(choice.const)) {
    return choice.const;
  }
  if (
    Array.isArray(choice.enum) &&
    choice.enum.length === 1 &&
    isPrimitive(choice.enum[0])
  ) {
    return choice.enum[0];
  }
  return undefined;
}

export function optionChoices(schema: ChoiceSchema): NormalizedOptionChoice[] {
  if (Array.isArray(schema.oneOf)) {
    return schema.oneOf.map((choice, index) => {
      const value = choiceValue(choice);
      const declaredDisablement = schemaDisablement(choice);
      const disablement =
        value === undefined
          ? declaredDisablement ?? {
              state: "unavailable" as const,
              reason: "This choice does not declare a supported primitive value.",
            }
          : declaredDisablement;
      return {
        id: `one-of-${index}`,
        value,
        label:
          nonEmptyString(choice.title) ??
          (value === undefined
            ? `Choice ${index + 1}`
            : formatOptionValue(value)),
        description: nonEmptyString(choice.description),
        disablement,
        sourceUrl: schemaSourceUrl(choice),
      };
    });
  }

  if (Array.isArray(schema.enum)) {
    return schema.enum.map((value, index) => ({
      id: `enum-${index}`,
      value: isPrimitive(value) ? value : undefined,
      label: isPrimitive(value)
        ? formatOptionValue(value)
        : `Choice ${index + 1}`,
      disablement: isPrimitive(value)
        ? undefined
        : {
            state: "unavailable" as const,
            reason: "This choice is not a supported primitive value.",
          },
    }));
  }

  return [];
}

export function hasChoiceConstraint(schema: ChoiceSchema): boolean {
  return Array.isArray(schema.oneOf) || Array.isArray(schema.enum);
}

export function optionValuesEqual(
  left: unknown,
  right: unknown,
): boolean {
  return Object.is(left, right);
}

function availableChoiceForValue(
  schema: ChoiceSchema,
  value: unknown,
): NormalizedOptionChoice | undefined {
  return optionChoices(schema).find(
    (choice) =>
      choice.value !== undefined &&
      !choice.disablement &&
      optionValuesEqual(choice.value, value),
  );
}

export function parseStringArray(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function normalizeArrayItem(
  item: unknown,
  type: OptionsSchemaItems["type"],
): OptionsSchemaPrimitive | undefined {
  if (type === "boolean") return typeof item === "boolean" ? item : undefined;
  if (type === "number" || type === "integer") {
    const parsed =
      typeof item === "number"
        ? item
        : typeof item === "string" && item.trim().length > 0
          ? Number(item)
          : Number.NaN;
    if (!Number.isFinite(parsed)) return undefined;
    if (type === "integer" && !Number.isInteger(parsed)) return undefined;
    return parsed;
  }
  return typeof item === "string" ? item : undefined;
}

export function normalizeRunOptionValue(
  property: OptionsSchemaProperty,
  value: unknown,
): unknown | undefined {
  if (property.type === "array") {
    const items = property.items ?? { type: "string" as const };
    const rawValues =
      typeof value === "string"
        ? parseStringArray(value)
        : Array.isArray(value)
          ? value
          : undefined;
    if (!rawValues) return undefined;
    if (hasChoiceConstraint(items)) {
      return rawValues.flatMap((item) => {
        const choice = availableChoiceForValue(items, item);
        return choice?.value === undefined ? [] : [choice.value];
      });
    }
    return rawValues.flatMap((item) => {
      const normalized = normalizeArrayItem(item, items.type ?? "string");
      return normalized === undefined ? [] : [normalized];
    });
  }

  if (hasChoiceConstraint(property)) {
    return availableChoiceForValue(property, value)?.value;
  }
  if (property.type === "boolean") {
    return typeof value === "boolean" ? value : undefined;
  }
  if (property.type === "number" || property.type === "integer") {
    const parsed =
      typeof value === "number"
        ? value
        : typeof value === "string" && value.trim().length > 0
          ? Number(value)
          : Number.NaN;
    if (!Number.isFinite(parsed)) return undefined;
    if (property.type === "integer" && !Number.isInteger(parsed)) {
      return undefined;
    }
    return parsed;
  }
  if (property.type === "string" || property.type === undefined) {
    return typeof value === "string" ? value : undefined;
  }
  return isPrimitive(value) ? value : undefined;
}

export function defaultRunOptionValues(
  properties: Record<string, OptionsSchemaProperty>,
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [key, property] of Object.entries(properties)) {
    if (schemaDisablement(property)) continue;
    const initialValue =
      property.default !== undefined ? property.default : property.const;
    if (initialValue === undefined) continue;
    const normalized = normalizeRunOptionValue(property, initialValue);
    if (normalized !== undefined) values[key] = normalized;
  }
  return values;
}

export function cleanRunOptionValues(
  properties: Record<string, OptionsSchemaProperty>,
  values: Record<string, unknown>,
): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [key, property] of Object.entries(properties)) {
    if (schemaDisablement(property) || !hasOwn(values, key)) continue;
    const normalized = normalizeRunOptionValue(property, values[key]);
    if (normalized !== undefined) cleaned[key] = normalized;
  }
  return cleaned;
}

function choiceSchemaForProperty(
  property: OptionsSchemaProperty,
): ChoiceSchema | null {
  return property.type === "array" ? property.items ?? null : property;
}

function valueIsMissing(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === "string" && value.length === 0) ||
    (Array.isArray(value) && value.length === 0)
  );
}

export function runOptionsInvalidReason(
  properties: Record<string, OptionsSchemaProperty>,
  values: Record<string, unknown>,
  required: readonly string[] = [],
): string | null {
  const requiredKeys = new Set(required);
  for (const [key, property] of Object.entries(properties)) {
    const label = property.title?.trim() || humanizeOptionKey(key);
    const propertyDisablement = schemaDisablement(property);
    if (propertyDisablement) {
      if (requiredKeys.has(key)) {
        return `${label} is required but ${propertyDisablement.state}.`;
      }
      continue;
    }

    const choiceSchema = choiceSchemaForProperty(property);
    if (choiceSchema && hasChoiceConstraint(choiceSchema)) {
      const choices = optionChoices(choiceSchema);
      if (
        !choices.some(
          (choice) => choice.value !== undefined && !choice.disablement,
        )
      ) {
        return `No available choice exists for ${label}.`;
      }
    }

    const rawValue = hasOwn(values, key) ? values[key] : undefined;
    const normalized = normalizeRunOptionValue(property, rawValue);
    if (requiredKeys.has(key) && valueIsMissing(normalized)) {
      return `${label} is required.`;
    }
    if (rawValue !== undefined && normalized === undefined) {
      return `${label} does not contain a valid value.`;
    }
    if (normalized === undefined) continue;

    if (
      property.const !== undefined &&
      !optionValuesEqual(normalized, property.const)
    ) {
      return `${label} must stay ${formatOptionValue(property.const)}.`;
    }
    if (
      property.not &&
      hasOwn(property.not, "const") &&
      optionValuesEqual(normalized, property.not.const)
    ) {
      return `${label} cannot be ${formatOptionValue(property.not.const)}.`;
    }

    if (typeof normalized === "string" && property.pattern) {
      try {
        if (!new RegExp(property.pattern).test(normalized)) {
          return `${label} does not match the required pattern.`;
        }
      } catch {
        return `${label} has an invalid schema pattern.`;
      }
    }
    if (typeof normalized === "string") {
      if (
        property.minLength !== undefined &&
        normalized.length < property.minLength
      ) {
        return `${label} must contain at least ${property.minLength} characters.`;
      }
      if (
        property.maxLength !== undefined &&
        normalized.length > property.maxLength
      ) {
        return `${label} must contain at most ${property.maxLength} characters.`;
      }
    }
    if (typeof normalized === "number") {
      if (property.minimum !== undefined && normalized < property.minimum) {
        return `${label} must be at least ${property.minimum}.`;
      }
      if (property.maximum !== undefined && normalized > property.maximum) {
        return `${label} must be at most ${property.maximum}.`;
      }
    }
    if (Array.isArray(normalized)) {
      if (
        property.minItems !== undefined &&
        normalized.length < property.minItems
      ) {
        return `${label} needs at least ${property.minItems} values.`;
      }
      if (
        property.maxItems !== undefined &&
        normalized.length > property.maxItems
      ) {
        return `${label} accepts at most ${property.maxItems} values.`;
      }
      if (
        property.uniqueItems &&
        new Set(normalized.map((item) => JSON.stringify(item))).size !==
          normalized.length
      ) {
        return `${label} cannot contain duplicate values.`;
      }
      const itemType = property.items?.type;
      if (itemType === "string") {
        const tooShort = normalized.find(
          (item) =>
            typeof item === "string" &&
            property.items?.minLength !== undefined &&
            item.length < property.items.minLength,
        );
        if (tooShort !== undefined) {
          return `${label} values need at least ${property.items?.minLength} characters.`;
        }
        const tooLong = normalized.find(
          (item) =>
            typeof item === "string" &&
            property.items?.maxLength !== undefined &&
            item.length > property.items.maxLength,
        );
        if (tooLong !== undefined) {
          return `${label} values accept at most ${property.items?.maxLength} characters.`;
        }
      }
    }
  }
  return null;
}

export function localComponentRunAvailability(
  component: LocalRunnerComponent | null | undefined,
): RunAvailability {
  if (!component) {
    return {
      available: false,
      disabledReason:
        "This component is not advertised by the current runner environment.",
    };
  }
  if (typeof component.availability?.runnable === "boolean") {
    if (component.availability.runnable) return { available: true };
    const reasons = (component.availability.reasons ?? []).flatMap((reason) => {
      const message = nonEmptyString(reason?.message);
      return message
        ? [{ code: nonEmptyString(reason?.code), message }]
        : [];
    });
    const disabledReason =
      reasons.map((reason) => reason.message).join(" ") ||
      "This component is not runnable in the current runner environment.";
    return {
      available: false,
      disabledReason,
      reasons,
    };
  }
  if (component.imageAvailable === false) {
    return {
      available: false,
      disabledReason:
        "This component image is not available in the current runner environment.",
    };
  }
  return { available: true };
}
