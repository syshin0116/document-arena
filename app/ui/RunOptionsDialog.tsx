"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type {
  LocalRunnerComponent,
  OptionsSchemaPrimitive,
  OptionsSchemaProperty,
} from "../local-runner";
import {
  cleanRunOptionValues,
  defaultRunOptionValues,
  formatOptionValue,
  hasChoiceConstraint,
  humanizeOptionKey,
  optionChoices,
  optionValueToken,
  optionValuesEqual,
  runOptionsInvalidReason,
  schemaDisablement,
  schemaSourceUrl,
  type NormalizedOptionChoice,
  type RunAvailability,
} from "../run-options";

type RunOptionsSchema = NonNullable<LocalRunnerComponent["optionsSchema"]>;

function setOptionValue(
  current: Record<string, unknown>,
  key: string,
  value: unknown,
): Record<string, unknown> {
  const next = { ...current };
  if (value === undefined) delete next[key];
  else next[key] = value;
  return next;
}

function choiceIsDefault(
  property: OptionsSchemaProperty,
  value: OptionsSchemaPrimitive | undefined,
): boolean {
  if (value === undefined) return false;
  const initialValue =
    property.default !== undefined ? property.default : property.const;
  return property.type === "array"
    ? Array.isArray(initialValue) &&
        initialValue.some((entry) => optionValuesEqual(entry, value))
    : optionValuesEqual(initialValue, value);
}

function DisablementBadge({
  state,
}: {
  state: "fixed" | "unavailable";
}) {
  return (
    <span className="run-option-state" data-state={state}>
      {state === "fixed" ? "Fixed" : "Unavailable"}
    </span>
  );
}

function ChoiceList({
  id,
  property,
  choices,
  value,
  multiple,
  disabled,
  onChange,
}: {
  id: string;
  property: OptionsSchemaProperty;
  choices: NormalizedOptionChoice[];
  value: unknown;
  multiple: boolean;
  disabled: boolean;
  onChange: (value: unknown) => void;
}) {
  const selectedValues = Array.isArray(value) ? value : [];
  return (
    <div
      className="run-option-choice-list"
      role="group"
      aria-labelledby={`${id}-label`}
    >
      {choices.map((choice) => {
        const choiceDisabled =
          disabled || choice.value === undefined || Boolean(choice.disablement);
        const checked =
          choice.value !== undefined &&
          (multiple
            ? selectedValues.some((entry) =>
                optionValuesEqual(entry, choice.value),
              )
            : optionValuesEqual(value, choice.value));
        return (
          <div
            key={choice.id}
            className="run-option-choice"
            data-disabled={choiceDisabled || undefined}
          >
            <label>
              <input
                data-run-option-control
                type={multiple ? "checkbox" : "radio"}
                name={multiple ? undefined : `${id}-choice`}
                checked={checked}
                disabled={choiceDisabled}
                onChange={(event) => {
                  if (choice.value === undefined) return;
                  if (!multiple) {
                    onChange(choice.value);
                    return;
                  }
                  const availableValues = selectedValues.filter((entry) =>
                    choices.some(
                      (candidate) =>
                        candidate.value !== undefined &&
                        !candidate.disablement &&
                        optionValuesEqual(candidate.value, entry),
                    ),
                  );
                  onChange(
                    event.target.checked
                      ? [...availableValues, choice.value]
                      : availableValues.filter(
                          (entry) =>
                            !optionValuesEqual(entry, choice.value),
                        ),
                  );
                }}
              />
              <span className="run-option-choice-copy">
                <span className="run-option-choice-title">
                  <strong>{choice.label}</strong>
                  {choiceIsDefault(property, choice.value) && (
                    <span className="run-option-default">Default</span>
                  )}
                  {choice.disablement && (
                    <DisablementBadge state={choice.disablement.state} />
                  )}
                </span>
                {choice.description && <small>{choice.description}</small>}
                {choice.disablement && (
                  <small className="run-option-disabled-reason">
                    {choice.disablement.reason}
                  </small>
                )}
              </span>
            </label>
            {choice.sourceUrl && (
              <a href={choice.sourceUrl} target="_blank" rel="noreferrer">
                Source ↗
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
}

function OptionPropertyField({
  fieldId,
  optionKey,
  property,
  value,
  componentDisabled,
  required,
  onChange,
}: {
  fieldId: string;
  optionKey: string;
  property: OptionsSchemaProperty;
  value: unknown;
  componentDisabled: boolean;
  required: boolean;
  onChange: (value: unknown) => void;
}) {
  const propertyDisablement = schemaDisablement(property);
  const disabled = componentDisabled || Boolean(propertyDisablement);
  const label = property.title?.trim() || humanizeOptionKey(optionKey);
  const descriptionId = property.description ? `${fieldId}-description` : undefined;
  const initialValue =
    property.default !== undefined ? property.default : property.const;
  const displayValue = value === undefined ? initialValue : value;
  const sourceUrl = schemaSourceUrl(property);
  const scalarChoices = optionChoices(property);
  const hasScalarChoices = hasChoiceConstraint(property);
  const itemSchema = property.items ?? { type: "string" as const };
  const itemChoices = optionChoices(itemSchema);
  const hasItemChoices =
    property.type === "array" && hasChoiceConstraint(itemSchema);
  const constraints = [
    property.pattern ? `Pattern: ${property.pattern}` : null,
    property.minimum !== undefined ? `Minimum: ${property.minimum}` : null,
    property.maximum !== undefined ? `Maximum: ${property.maximum}` : null,
    property.minItems !== undefined
      ? `Minimum values: ${property.minItems}`
      : null,
    property.maxItems !== undefined
      ? `Maximum values: ${property.maxItems}`
      : null,
    property.minLength !== undefined
      ? `Minimum length: ${property.minLength}`
      : null,
    property.maxLength !== undefined
      ? `Maximum length: ${property.maxLength}`
      : null,
    property.items?.minLength !== undefined
      ? `Item minimum length: ${property.items.minLength}`
      : null,
    property.items?.maxLength !== undefined
      ? `Item maximum length: ${property.items.maxLength}`
      : null,
    property.uniqueItems ? "Unique values" : null,
    property.not?.const !== undefined
      ? `Excluded value: ${formatOptionValue(property.not.const)}`
      : null,
  ].filter((constraint): constraint is string => constraint !== null);

  let control;
  if (property.type === "array" && hasItemChoices) {
    control = (
      <ChoiceList
        id={fieldId}
        property={property}
        choices={itemChoices}
        value={displayValue}
        multiple
        disabled={disabled}
        onChange={onChange}
      />
    );
  } else if (hasScalarChoices && Array.isArray(property.oneOf)) {
    control = (
      <ChoiceList
        id={fieldId}
        property={property}
        choices={scalarChoices}
        value={displayValue}
        multiple={false}
        disabled={disabled}
        onChange={onChange}
      />
    );
  } else if (hasScalarChoices) {
    const selectedChoice = scalarChoices.find(
      (choice) =>
        choice.value !== undefined &&
        optionValuesEqual(choice.value, displayValue),
    );
    control = (
      <select
        id={fieldId}
        data-run-option-control
        value={
          selectedChoice?.value === undefined
            ? "__parser_arena_unset__"
            : optionValueToken(selectedChoice.value)
        }
        disabled={disabled || scalarChoices.every((choice) => choice.disablement)}
        aria-describedby={descriptionId}
        aria-required={required}
        onChange={(event) => {
          const selected = scalarChoices.find(
            (choice) =>
              choice.value !== undefined &&
              optionValueToken(choice.value) === event.target.value,
          );
          onChange(selected?.value);
        }}
      >
        <option value="__parser_arena_unset__">Choose…</option>
        {scalarChoices.map((choice) => (
          <option
            key={choice.id}
            value={
              choice.value === undefined
                ? `__parser_arena_invalid_${choice.id}`
                : optionValueToken(choice.value)
            }
            disabled={choice.value === undefined || Boolean(choice.disablement)}
          >
            {choice.label}
            {choice.disablement ? ` — ${choice.disablement.reason}` : ""}
          </option>
        ))}
      </select>
    );
  } else if (property.type === "boolean") {
    control = (
      <label className="run-option-boolean" htmlFor={fieldId}>
        <input
          id={fieldId}
          data-run-option-control
          type="checkbox"
          checked={Boolean(displayValue ?? false)}
          disabled={disabled}
          aria-describedby={descriptionId}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>Enabled</span>
      </label>
    );
  } else if (property.type === "number" || property.type === "integer") {
    control = (
      <input
        id={fieldId}
        data-run-option-control
        type="number"
        value={displayValue === undefined ? "" : String(displayValue)}
        min={property.minimum}
        max={property.maximum}
        step={property.type === "integer" ? 1 : "any"}
        disabled={disabled}
        aria-describedby={descriptionId}
        aria-required={required}
        onChange={(event) =>
          onChange(event.target.value === "" ? undefined : event.target.value)
        }
      />
    );
  } else if (property.type === "array") {
    const text = Array.isArray(displayValue)
      ? displayValue.map(formatOptionValue).join("\n")
      : typeof displayValue === "string"
        ? displayValue
        : "";
    control = (
      <textarea
        id={fieldId}
        data-run-option-control
        value={text}
        disabled={disabled}
        rows={4}
        aria-describedby={descriptionId}
        aria-required={required}
        placeholder="One value per line or comma separated"
        onChange={(event) =>
          onChange(
            event.target.value.trim().length === 0
              ? undefined
              : event.target.value,
          )
        }
      />
    );
  } else {
    control = (
      <input
        id={fieldId}
        data-run-option-control
        type="text"
        value={displayValue === undefined ? "" : String(displayValue)}
        pattern={property.pattern}
        disabled={disabled}
        aria-describedby={descriptionId}
        aria-required={required}
        onChange={(event) =>
          onChange(event.target.value === "" ? undefined : event.target.value)
        }
      />
    );
  }

  return (
    <section
      className="run-option-property"
      data-disabled={disabled || undefined}
    >
      <div className="run-option-property-heading">
        <div>
          <label id={`${fieldId}-label`} htmlFor={fieldId}>
            {label}
            {required && <span aria-label="required"> *</span>}
          </label>
          <code>{optionKey}</code>
        </div>
        <div className="run-option-property-meta">
          {initialValue !== undefined && (
            <span className="run-option-default">
              {property.default !== undefined ? "Default" : "Value"}: {formatOptionValue(initialValue)}
            </span>
          )}
          {propertyDisablement && (
            <DisablementBadge state={propertyDisablement.state} />
          )}
        </div>
      </div>
      {property.description && (
        <p id={descriptionId}>{property.description}</p>
      )}
      {constraints.length > 0 && (
        <div className="run-option-constraints" aria-label="Constraints">
          {constraints.map((constraint) => (
            <code key={constraint}>{constraint}</code>
          ))}
        </div>
      )}
      {control}
      {propertyDisablement && (
        <p className="run-option-disabled-reason">
          {propertyDisablement.reason}
        </p>
      )}
      {sourceUrl && (
        <a
          className="run-option-source"
          href={sourceUrl}
          target="_blank"
          rel="noreferrer"
        >
          Option source ↗
        </a>
      )}
    </section>
  );
}

export function RunOptionFields({
  properties,
  required = [],
  values,
  componentDisabled = false,
  onChange,
}: {
  properties: Record<string, OptionsSchemaProperty>;
  required?: readonly string[];
  values: Record<string, unknown>;
  componentDisabled?: boolean;
  onChange: (key: string, value: unknown) => void;
}) {
  const idPrefix = useId();
  const requiredKeys = new Set(required);
  return (
    <div className="run-option-fields">
      {Object.entries(properties).map(([key, property], index) => (
        <OptionPropertyField
          key={key}
          fieldId={`${idPrefix}-option-${index}`}
          optionKey={key}
          property={property}
          value={values[key]}
          componentDisabled={componentDisabled}
          required={requiredKeys.has(key)}
          onChange={(value) => onChange(key, value)}
        />
      ))}
    </div>
  );
}

export function RunOptionsDialog({
  componentName,
  schema,
  availability,
  submitting = false,
  onCancel,
  onConfirm,
}: {
  componentName: string;
  schema: RunOptionsSchema | null;
  availability: RunAvailability;
  submitting?: boolean;
  onCancel: () => void;
  onConfirm: (options: Record<string, unknown>) => void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLFormElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const properties = schema?.properties ?? {};
  const required = schema?.required ?? [];
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    defaultRunOptionValues(properties),
  );
  const invalidReason = runOptionsInvalidReason(properties, values, required);
  const runDisabled =
    submitting || !availability.available || invalidReason !== null;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => {
      const initialControl =
        dialogRef.current?.querySelector<HTMLElement>(
          "[data-run-option-control]:not([disabled])",
        ) ?? cancelRef.current;
      initialControl?.focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (runDisabled) return;
    onConfirm(cleanRunOptionValues(properties, values));
  }

  return (
    <div
      className="run-options-backdrop"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !submitting) onCancel();
      }}
    >
      <form
        ref={dialogRef}
        className="run-options-dialog"
        role="dialog"
        aria-modal="true"
        aria-busy={submitting}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onSubmit={submit}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            if (!submitting) onCancel();
            return;
          }
          if (event.key !== "Tab") return;
          const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          );
          if (!focusable || focusable.length === 0) return;
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <header className="run-options-header">
          <p className="eyebrow">Review run configuration</p>
          <h2 id={titleId}>Run {componentName}</h2>
          <p id={descriptionId}>
            {schema?.description ??
              "Review the resolved defaults before this parser starts."}
          </p>
        </header>

        <div className="run-options-scroll">
          {!availability.available && (
            <div className="run-options-availability" role="alert">
              <strong>Unavailable in this environment</strong>
              {availability.reasons && availability.reasons.length > 0 ? (
                <ul>
                  {availability.reasons.map((reason, index) => (
                    <li key={reason.code ?? index}>{reason.message}</li>
                  ))}
                </ul>
              ) : (
                <span>{availability.disabledReason}</span>
              )}
            </div>
          )}
          {schema?.title && <p className="run-options-schema-title">{schema.title}</p>}
          {Object.keys(properties).length > 0 ? (
            <RunOptionFields
              properties={properties}
              required={required}
              values={values}
              componentDisabled={!availability.available}
              onChange={(key, value) =>
                setValues((current) => setOptionValue(current, key, value))
              }
            />
          ) : (
            <p className="run-options-empty">
              This component does not expose configurable options.
            </p>
          )}
        </div>

        <footer className="run-options-footer">
          <div className="run-options-validation" role="status">
            {invalidReason ??
              (!availability.available
                ? availability.disabledReason
                : "Resolved values will be recorded with this run.")}
          </div>
          <div className="run-options-actions">
            <button
              ref={cancelRef}
              className="secondary-button"
              type="button"
              disabled={submitting}
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              className="primary-button"
              type="submit"
              disabled={runDisabled}
            >
              {submitting ? "Starting…" : `Run ${componentName}`}
            </button>
          </div>
        </footer>
      </form>
    </div>
  );
}
