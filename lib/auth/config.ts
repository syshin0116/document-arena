export type NeonAuthConfiguration =
  | Readonly<{
      configured: true;
      baseUrl: string;
      cookieSecret: string;
    }>
  | Readonly<{
      configured: false;
      reason: "missing" | "invalid-url" | "weak-cookie-secret";
    }>;

type AuthEnvironment = Readonly<
  Record<string, string | undefined> & {
    NEON_AUTH_BASE_URL?: string;
    NEON_AUTH_COOKIE_SECRET?: string;
  }
>;

export function resolveNeonAuthConfiguration(
  environment: AuthEnvironment = process.env,
): NeonAuthConfiguration {
  const baseUrl = environment.NEON_AUTH_BASE_URL?.trim();
  const cookieSecret = environment.NEON_AUTH_COOKIE_SECRET;

  if (!baseUrl || !cookieSecret) {
    return { configured: false, reason: "missing" };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(baseUrl);
  } catch {
    return { configured: false, reason: "invalid-url" };
  }

  if (
    parsedUrl.protocol !== "https:" ||
    parsedUrl.username ||
    parsedUrl.password ||
    parsedUrl.search ||
    parsedUrl.hash ||
    parsedUrl.pathname !== "/"
  ) {
    return { configured: false, reason: "invalid-url" };
  }

  if (cookieSecret.length < 32) {
    return { configured: false, reason: "weak-cookie-secret" };
  }

  return {
    configured: true,
    baseUrl: parsedUrl.origin,
    cookieSecret,
  };
}
