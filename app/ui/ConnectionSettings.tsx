"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  clearRunnerConnection,
  configureRunnerConnection,
  listRunnerConnections,
  type RunnerConnection,
} from "../local-runner";
import { Brand } from "./Brand";

type FieldValues = Record<string, Record<string, string>>;
type ConnectionFeedback = Record<
  string,
  { kind: "success" | "error"; text: string }
>;

function blankConnectionValues(connection: RunnerConnection): Record<string, string> {
  return Object.fromEntries(connection.fields.map((field) => [field.name, ""]));
}

function blankValues(connections: readonly RunnerConnection[]): FieldValues {
  return Object.fromEntries(
    connections.map((connection) => [
      connection.type,
      blankConnectionValues(connection),
    ]),
  );
}

function connectionStatus(connection: RunnerConnection): string {
  if (connection.source === "session") return "Configured for session · not verified";
  if (connection.source === "environment") return "Loaded from environment · not verified";
  return "Not configured";
}

export function ConnectionSettings({ returnTo }: { returnTo: string }) {
  const [connections, setConnections] = useState<RunnerConnection[] | null>(null);
  const [values, setValues] = useState<FieldValues>({});
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [pendingType, setPendingType] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [feedback, setFeedback] = useState<ConnectionFeedback>({});
  const primaryButtons = useRef<Record<string, HTMLButtonElement | null>>({});

  const focusPrimaryAction = (type: string) => {
    requestAnimationFrame(() => primaryButtons.current[type]?.focus());
  };

  const refresh = useCallback(async (clearType?: string) => {
    try {
      const next = await listRunnerConnections();
      setConnections(next);
      setValues((current) =>
        Object.fromEntries(
          next.map((connection) => [
            connection.type,
            connection.type === clearType
              ? blankConnectionValues(connection)
              : current[connection.type] ?? blankConnectionValues(connection),
          ]),
        ),
      );
      setLoadingError(null);
    } catch {
      setConnections(null);
      setLoadingError(
        "The local runner is unavailable. Start it with `make runner-serve`, then try again.",
      );
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void listRunnerConnections()
      .then((next) => {
        if (cancelled) return;
        setConnections(next);
        setValues(blankValues(next));
        setLoadingError(null);
      })
      .catch(() => {
        if (cancelled) return;
        setConnections(null);
        setLoadingError(
          "The local runner is unavailable. Start it with `make runner-serve`, then try again.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function saveConnection(
    event: FormEvent<HTMLFormElement>,
    connection: RunnerConnection,
  ) {
    event.preventDefault();
    setPendingType(connection.type);
    setFeedback((current) => {
      const next = { ...current };
      delete next[connection.type];
      return next;
    });
    try {
      await configureRunnerConnection(
        connection.type,
        values[connection.type] ?? {},
      );
      await refresh(connection.type);
      setFeedback((current) => ({
        ...current,
        [connection.type]: {
          kind: "success",
          text: `${connection.title ?? connection.type} is configured for this runner session. Provider access will be verified when a run starts.`,
        },
      }));
    } catch (error) {
      setFeedback((current) => ({
        ...current,
        [connection.type]: {
          kind: "error",
          text:
            error instanceof Error
              ? error.message
              : "The connection could not be configured.",
        },
      }));
    } finally {
      setPendingType(null);
      focusPrimaryAction(connection.type);
    }
  }

  async function clearConnection(connection: RunnerConnection) {
    setPendingType(connection.type);
    setFeedback((current) => {
      const next = { ...current };
      delete next[connection.type];
      return next;
    });
    try {
      await clearRunnerConnection(connection.type);
      await refresh(connection.type);
      setFeedback((current) => ({
        ...current,
        [connection.type]: {
          kind: "success",
          text: `${connection.title ?? connection.type} session values were cleared.`,
        },
      }));
    } catch (error) {
      setFeedback((current) => ({
        ...current,
        [connection.type]: {
          kind: "error",
          text:
            error instanceof Error
              ? error.message
              : "The session connection could not be cleared.",
        },
      }));
    } finally {
      setPendingType(null);
      focusPrimaryAction(connection.type);
    }
  }

  async function retryRunner() {
    setRetrying(true);
    await refresh();
    setRetrying(false);
  }

  return (
    <main className="connections-shell">
      <header className="workspace-header">
        <div className="workspace-identity">
          <Link
            className="back-button"
            href={returnTo}
            aria-label={returnTo === "/" ? "Back to upload" : "Back to document workspace"}
          >
            ←
          </Link>
          <Link className="workspace-brand" href="/" aria-label="Document Arena home">
            <Brand compact />
          </Link>
          <span className="header-separator" aria-hidden="true" />
          <div className="document-identity">
            <strong>Connections</strong>
            <span>Local runner · bring your own key</span>
          </div>
        </div>
        <div className="workspace-actions">
          <Link
            className="secondary-button"
            href={returnTo === "/" ? "/documents/demo" : returnTo}
          >
            {returnTo === "/" ? "Open demo" : "Return to run"}
          </Link>
        </div>
      </header>

      <section className="connections-main" aria-labelledby="connections-title">
        <div className="connections-intro">
          <p className="eyebrow">
            <span className="eyebrow-dot" aria-hidden="true" />
            Provider access
          </p>
          <h1 id="connections-title">Use your own provider connection.</h1>
          <p>
            Connection fields come from installed component manifests. Secrets
            are sent only to the loopback runner, kept in memory for its current
            session, and injected only into the component that declares them.
          </p>
        </div>

        <aside className="connection-security-note" aria-label="Credential storage policy">
          <strong>Session-only by default</strong>
          <p>
            Document Arena does not write these values to browser storage,
            URLs, run options, artifacts, or log output. Restarting the runner
            clears values entered here. For a persistent local setup, keep
            them in your ignored `.env` file. Browser extensions and password
            managers remain governed by your browser settings.
            Saving checks the declared field policy; provider access is verified
            only when its component starts a run.
          </p>
        </aside>

        {loadingError ? (
          <div className="connection-empty" role="alert">
            <strong>Runner not connected</strong>
            <p>{loadingError}</p>
            <button
              className="secondary-button"
              type="button"
              disabled={retrying}
              aria-busy={retrying}
              onClick={() => void retryRunner()}
            >
              {retrying ? "Checking…" : "Try again"}
            </button>
          </div>
        ) : connections === null ? (
          <div className="connection-empty" role="status">
            <strong>Checking the local runner…</strong>
          </div>
        ) : connections.length === 0 ? (
          <div className="connection-empty">
            <strong>No remote connections are required.</strong>
            <p>Installed components do not currently declare connection fields.</p>
          </div>
        ) : (
          <div className="connection-list">
            {connections.map((connection) => {
              const pending = pendingType === connection.type;
              const connectionFeedback = feedback[connection.type];
              return (
                <form
                  className="connection-card"
                  key={connection.type}
                  onSubmit={(event) => void saveConnection(event, connection)}
                  aria-busy={pending}
                >
                  <div className="connection-card-heading">
                    <div>
                      <h2>{connection.title ?? connection.type}</h2>
                      {connection.description && <p>{connection.description}</p>}
                    </div>
                    <span
                      className="connection-status"
                      data-configured={connection.configured || undefined}
                    >
                      {connectionStatus(connection)}
                    </span>
                  </div>

                  {connection.configured && (
                    <p className="connection-replace-note">
                      Re-enter every field to replace the current connection.
                      Existing values are never returned to the browser.
                    </p>
                  )}

                  <div className="connection-fields">
                    {connection.fields.map((field) => {
                      const inputId = `connection-${connection.type}-${field.name}`;
                      const helpId = `${inputId}-help`;
                      return (
                        <label key={field.name} htmlFor={inputId}>
                          <span>
                            {field.label ?? field.name}
                            {field.secret && <small>Secret</small>}
                          </span>
                          {field.description && (
                            <span className="connection-field-help" id={helpId}>
                              {field.description}
                            </span>
                          )}
                          <input
                            id={inputId}
                            name={field.name}
                            type={field.secret ? "password" : field.format === "uri" ? "url" : "text"}
                            value={values[connection.type]?.[field.name] ?? ""}
                            placeholder={field.placeholder}
                            required
                            minLength={field.minLength ?? 1}
                            maxLength={field.maxLength ?? 4096}
                            autoComplete={field.secret ? "off" : field.format === "uri" ? "url" : "off"}
                            autoCapitalize="none"
                            spellCheck={false}
                            aria-describedby={field.description ? helpId : undefined}
                            onChange={(event) =>
                              setValues((current) => ({
                                ...current,
                                [connection.type]: {
                                  ...current[connection.type],
                                  [field.name]: event.target.value,
                                },
                              }))
                            }
                          />
                        </label>
                      );
                    })}
                  </div>

                  <div className="connection-actions">
                    <button
                      ref={(node) => {
                        primaryButtons.current[connection.type] = node;
                      }}
                      className="primary-button"
                      type="submit"
                      disabled={pending}
                    >
                      {pending ? "Saving…" : connection.configured ? "Replace connection" : "Save for session"}
                    </button>
                    {connection.source === "session" && (
                      <button
                        className="secondary-button"
                        type="button"
                        disabled={pending}
                        onClick={() => void clearConnection(connection)}
                      >
                        Clear session values
                      </button>
                    )}
                  </div>
                  {connectionFeedback && (
                    <p
                      className="connection-message"
                      data-error={connectionFeedback.kind === "error" || undefined}
                      role={connectionFeedback.kind === "error" ? "alert" : "status"}
                    >
                      {connectionFeedback.text}
                    </p>
                  )}
                </form>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
