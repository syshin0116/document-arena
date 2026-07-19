import { connectionIsConfigured } from "./connections.mjs";

function unavailable(code, message) {
  return { code, message };
}

/**
 * Describe only readiness the local runner can prove without starting a job.
 * Connection env names and values stay runner-local; the browser receives a
 * generic reason that can disable execution while leaving the option catalog
 * visible for inspection.
 */
export function componentAvailability({
  imageAvailable,
  requirements = {},
  env = process.env,
  connectionValues = {},
}) {
  const reasons = [];
  if (!imageAvailable) {
    reasons.push(
      unavailable(
        "image-unavailable",
        "The pinned container image is not built on this runner.",
      ),
    );
  }

  if (requirements.network === "remote") {
    const connection = requirements.connection;
    const configured = connectionIsConfigured(
      connection,
      connectionValues,
      env,
    );
    if (!configured) {
      const connectionType =
        typeof connection?.type === "string" && connection.type.trim()
          ? connection.type.trim()
          : "remote service";
      reasons.push(
        unavailable(
          "connection-unavailable",
          `A ${connectionType} connection is not configured on this runner.`,
        ),
      );
    }
  }

  return {
    runnable: reasons.length === 0,
    reasons,
  };
}
