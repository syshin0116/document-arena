export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    { ok: true, service: "document-arena-web" },
    { headers: { "cache-control": "no-store" } },
  );
}
