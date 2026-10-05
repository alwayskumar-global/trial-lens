// SPIKE ONLY (Phase 1): hello-world SSE route to verify streaming through the platform.
// Disabled (404) unless SPIKE_SSE_ENABLED=true so it is never a live public endpoint by default.
// No LLM calls, no secrets, no user input beyond a capped duration. REMOVE before Phase 2 ships.
// VERIFY: Vercel plan limit for maxDuration and whether streaming survives >= 60 s on this plan.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export function GET(req: Request): Response {
  if (process.env.SPIKE_SSE_ENABLED !== "true") return new Response("Not found", { status: 404 });
  const url = new URL(req.url);
  const seconds = Math.min(120, Math.max(1, Number(url.searchParams.get("seconds") ?? "70") || 70));
  const intervalMs = 5000;
  const enc = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const startedAt = Date.now();
      let n = 0;
      const send = (obj: unknown) => controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
      send({ type: "stage", stage: "spike", status: "start", t: 0 });
      timer = setInterval(() => {
        n++;
        const t = Math.round((Date.now() - startedAt) / 1000);
        if (t >= seconds) {
          send({ type: "done", replay: false, t, ticks: n });
          clearInterval(timer);
          controller.close();
          return;
        }
        send({ type: "counts", analyzed: n, t });
      }, intervalMs);
    },
    cancel() {
      if (timer) clearInterval(timer);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
