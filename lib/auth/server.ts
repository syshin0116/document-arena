import "server-only";

import {
  createNeonAuth,
  type NeonAuth,
} from "@neondatabase/auth/next/server";
import { resolveNeonAuthConfiguration } from "./config";

let authInstance: NeonAuth | undefined;

export function getNeonAuth(): NeonAuth {
  const configuration = resolveNeonAuthConfiguration();
  if (!configuration.configured) {
    throw new Error(`Neon Auth is not configured: ${configuration.reason}.`);
  }

  authInstance ??= createNeonAuth({
    baseUrl: configuration.baseUrl,
    cookies: {
      secret: configuration.cookieSecret,
      sessionDataTtl: 300,
      sameSite: "strict",
    },
    logLevel: "warn",
  });

  return authInstance;
}
