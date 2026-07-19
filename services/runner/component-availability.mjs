function unavailable(code, message) {
  return { code, message };
}

/**
 * Describe only readiness the local runner can prove without starting a job.
 * Connection field names and values stay runner-local; the browser receives a
 * generic reason that can disable execution while leaving the option catalog
 * visible for inspection.
 */
export function componentAvailability({
  imageAvailable,
  requirements = {},
  env = process.env,
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
    const envNames =
      connection && typeof connection === "object" && connection.env
        ? Object.values(connection.env)
        : [];
    const configured =
      envNames.length > 0 &&
      envNames.every(
        (name) =>
          typeof name === "string" &&
          typeof env[name] === "string" &&
          env[name].trim().length > 0,
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
