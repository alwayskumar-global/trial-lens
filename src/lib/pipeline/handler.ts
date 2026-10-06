// POST /api/run handler (SSE). Framework-agnostic and dependency-injected so the whole flow is testable offline.
//
// Contract: body {text} (live run) or {replay_id} (stored replay of a fictional profile). Events: mode, stage, counts,
// profile, trial_result, question, done, error. Any guard refusal or provider outage falls back to a LABELLED replay
// (never a blank error). Patient text is never logged, cached or persisted; only counts, timings and codes are logged.
import { z } from "zod";
import type { RunGuard } from "@/lib/guards/run-guard";
import { isReplayId, replayEvents, type ReplayStore } from "@/lib/cache/replay";
import { PipelineError, runPipeline, type PipelineDeps } from "@/lib/pipeline/run";
import { SseEventSchema, type SseEvent } from "@/schema/sse";

type ModeReason = NonNullable<Extract<SseEvent, { type: "mode" }>["reason"]>;

export interface RunHandlerDeps {
  maxInputChars: number;
  replayFallbackEnabled: boolean;
  guard: () => RunGuard; // may throw if the guard backend is not configured ⇒ treated as guard_unavailable
  replay: ReplayStore;
  /** Builds live pipeline deps; may throw (e.g. missing model env) ⇒ model_unavailable. */
  makePipeline: (signal: AbortSignal) => PipelineDeps;
  ip: (req: Request) => string;
  /** Counts/timings/codes only. Never pass request content. */
  log: (line: Record<string, string | number | boolean>) => void;
}

const Body = z.object({ text: z.string().optional(), replay_id: z.string().optional() }).strict();

const json = (status: number, code: string) => Response.json({ code }, { status, headers: { "cache-control": "no-store" } });

export async function handleRun(req: Request, deps: RunHandlerDeps): Promise<Response> {
  // Bounded read: refuse oversized bodies before parsing (text cap is in characters; allow JSON overhead).
  const raw = await req.text();
  if (raw.length > deps.maxInputChars * 6 + 1024) return json(413, "input_too_long");
  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(JSON.parse(raw));
  } catch {
    return json(400, "bad_request");
  }
  const { text, replay_id } = parsed;
  if ((text === undefined) === (replay_id === undefined)) return json(400, "bad_request"); // exactly one
  if (text !== undefined && text.trim().length === 0) return json(400, "bad_request");
  if (text !== undefined && text.length > deps.maxInputChars) return json(413, "input_too_long");
  if (replay_id !== undefined && !isReplayId(replay_id)) return json(400, "bad_request");

  // Decide live vs replay BEFORE opening the stream so a refusal without fallback can still be an HTTP status.
  let fallback: ModeReason | null = replay_id !== undefined ? "requested" : null;
  if (fallback === null) {
    let decision: Awaited<ReturnType<RunGuard["check"]>>;
    try {
      decision = await deps.guard().check(deps.ip(req));
    } catch {
      decision = { ok: false, reason: "guard_unavailable" };
    }
    if (!decision.ok) fallback = decision.reason;
  }
  if (fallback !== null && fallback !== "requested" && !deps.replayFallbackEnabled) return json(fallback === "rate_limited" ? 429 : 503, fallback);

  const enc = new TextEncoder();
  const t0 = Date.now();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const emit = (e: SseEvent) => {
        if (closed) return;
        const v = SseEventSchema.safeParse(e);
        if (!v.success) throw new Error("SSE_CONTRACT"); // internal contract bug: never forward an unvalidated event
        controller.enqueue(enc.encode(`data: ${JSON.stringify(v.data)}\n\n`));
      };
      const finish = () => {
        if (!closed) {
          closed = true;
          controller.close();
        }
      };
      const streamReplay = async (reason: ModeReason, id?: string) => {
        const c = await deps.replay.get(id);
        if (!c) {
          emit({ type: "error", code: "replay_unavailable", message: "No saved example is available right now.", fallback_to_replay: false });
          deps.log({ evt: "run", mode: "replay", reason, ok: false, ms: Date.now() - t0 });
          return;
        }
        for (const e of replayEvents(c, reason)) emit(e);
        deps.log({ evt: "run", mode: "replay", reason, ok: true, ms: Date.now() - t0 });
      };
      try {
        if (fallback !== null) {
          await streamReplay(fallback, replay_id);
          return;
        }
        let pipeline: PipelineDeps;
        try {
          pipeline = deps.makePipeline(req.signal);
        } catch {
          await streamReplay("model_unavailable");
          return;
        }
        emit({ type: "mode", mode: "live" });
        let calls = 0;
        try {
          await runPipeline(text!, pipeline, (e) => {
            if (e.type === "done" && e.stats) calls = e.stats.llm_calls;
            emit(e);
          });
          deps.log({ evt: "run", mode: "live", ok: true, calls, ms: Date.now() - t0 });
        } catch (err) {
          if (err instanceof PipelineError && err.kind === "aborted") return;
          const kind: ModeReason = err instanceof PipelineError && err.kind === "ctgov_unavailable" ? "ctgov_unavailable" : "model_unavailable";
          emit({ type: "error", code: err instanceof PipelineError ? err.kind : "internal", message: "Live analysis is unavailable, so a saved example is shown instead.", fallback_to_replay: deps.replayFallbackEnabled });
          if (deps.replayFallbackEnabled) await streamReplay(kind);
          else deps.log({ evt: "run", mode: "live", ok: false, reason: kind, ms: Date.now() - t0 });
        }
      } catch {
        // Contract/internal failure: fixed code only.
        try {
          emit({ type: "error", code: "internal", message: "Something went wrong.", fallback_to_replay: false });
        } catch {
          /* stream already unusable */
        }
      } finally {
        finish();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store, no-transform", "x-accel-buffering": "no" } });
}
