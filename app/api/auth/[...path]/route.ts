import { getNeonAuth } from "@/lib/auth/server";
import { resolveNeonAuthConfiguration } from "@/lib/auth/config";

type AuthRouteContext = Readonly<{
  params: Promise<{ path: string[] }>;
}>;

function unavailableResponse() {
  return Response.json(
    {
      error: {
        code: "auth_not_configured",
        message: "Hosted authentication is not configured.",
      },
    },
    { status: 503 },
  );
}

async function handle(
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH",
  request: Request,
  context: AuthRouteContext,
) {
  if (!resolveNeonAuthConfiguration().configured) {
    return unavailableResponse();
  }

  return getNeonAuth().handler()[method](request, context);
}

export const GET = (request: Request, context: AuthRouteContext) =>
  handle("GET", request, context);
export const POST = (request: Request, context: AuthRouteContext) =>
  handle("POST", request, context);
export const PUT = (request: Request, context: AuthRouteContext) =>
  handle("PUT", request, context);
export const DELETE = (request: Request, context: AuthRouteContext) =>
  handle("DELETE", request, context);
export const PATCH = (request: Request, context: AuthRouteContext) =>
  handle("PATCH", request, context);
