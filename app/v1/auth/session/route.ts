import { resolveNeonAuthConfiguration } from "@/lib/auth/config";
import { getNeonAuth } from "@/lib/auth/server";
import { hostedIdentityFromSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!resolveNeonAuthConfiguration().configured) {
    return Response.json(
      {
        configured: false,
        authenticated: false,
        identity: null,
      },
      { status: 503 },
    );
  }

  const { data, error } = await getNeonAuth().getSession();
  if (error) {
    return Response.json(
      {
        error: {
          code: "auth_upstream_unavailable",
          message: "Authentication could not be verified.",
        },
      },
      { status: 502 },
    );
  }

  const identity = hostedIdentityFromSession(data);
  return Response.json({
    configured: true,
    authenticated: identity !== null,
    identity,
  });
}
