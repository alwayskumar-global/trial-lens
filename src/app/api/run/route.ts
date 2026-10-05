// SSE pipeline endpoint. Implemented in Phase 2; scaffold stub only.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(): Response {
  return Response.json({ code: "not_implemented" }, { status: 501 });
}
