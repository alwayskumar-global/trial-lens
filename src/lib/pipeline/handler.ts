// POST /api/run handler (SSE). Framework-agnostic and dependency-injected so the whole flow is testable offline.
//
// Contract: body {text} (live run from text; extraction is stage 1), {replay_id} (stored replay of a fictional profile), or
// {profile, extract_token} (live run from a profile the visitor reviewed on the Confirm screen; no extraction call; the token is required). Events: mode,
// stage, counts, profile, trial_result, question, done, error. For text runs, a guard refusal or provider outage falls back to a
// LABELLED replay. For profile runs there is NO silent replay (someone else's results would mislead): refusals are HTTP 429/503
// and failures are an error event. Which facts the visitor edited is derived by the server from the signed extraction
// (src/lib/profile/token.ts), never from a client label. Visitor text is never logged, cached or persisted; only counts, timings
// and fixed codes are logged.
import { z } from "zod";
import type { ConcurrencyGate, RunGuard } from "@/lib/guards/run-guard";
import { isReplayId, replayEvents, type ReplayStore } from "@/lib/cache/replay";
import { PipelineError, runPipeline, type PipelineDeps, type PipelineInput } from "@/lib/pipeline/run";
import { selfEditedKeys, verifyExtraction } from "@/lib/profile/token";
import { isPreparedText, stripControlChars } from "@/lib/sample/prepared";
import { FactSchema, FactStateSchema, type PatientProfile } from "@/schema/profile";
import { assertEmittable, enforceTrialCeiling } from "@/lib/engine/ceiling";
import { SseEventSchema, type SseEvent } from "@/schema/sse";
import { FACT_KEYS, FactKeySchema } from "@/schema/vocabulary";

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
  /** `samples`: only the prepared fictional texts (and profiles extracted from them) are accepted. `open`: any text. Required, no default. */
  visitorInputMode: "samples" | "open";
  /** Secret that signs/verifies extract tokens. Without it no token verifies (every fact counts as visitor-edited). */
  signingSecret?: string | undefined;
  now?: () => Date;
  /** Global cap on in-flight live runs. Optional so tests and local runs need no Redis. */
  gate?: () => ConcurrencyGate;
}

// A client profile is untrusted: strict shapes (an unknown key such as a `provenance` label is a 400), bounded strings, every
// vocabulary key present, no notes (free text). The server derives which facts were edited; the client cannot claim it.
const ClientFact = z
  .strictObject({ key: FactKeySchema, state: FactStateSchema, value: z.union([z.number(), z.string().max(64), z.boolean()]).optional() })
  .pipe(FactSchema);
const ClientProfile = z
  .strictObject({ facts: z.record(FactKeySchema, ClientFact) })
  .superRefine((p, ctx) => {
    for (const k of FACT_KEYS) {
      if (p.facts[k]?.key !== k) ctx.addIssue({ code: "custom", path: ["facts", k], message: "missing or mismatched fact" });
    }
  });
const RELEASE_WAIT_MS = 2000;
const Body = z.strictObject({ text: z.string().optional(), replay_id: z.string().optional(), profile: ClientProfile.optional(), extract_token: z.string().max(8192).optional() });

const json = (status: number, code: string) => Response.json({ code }, { status, headers: { "cache-control": "no-store" } });

/** Browser-initiated cross-site POSTs are refused (cost abuse from another origin). Scripts and same-origin pages send no foreign Origin. */
export function isCrossSite(req: Request): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site) return site !== "same-origin" && site !== "none";
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host !== (req.headers.get("host") ?? new URL(req.url).host);
  } catch {
    return true;
  }
}

export async function handleRun(req: Request, deps: RunHandlerDeps): Promise<Response> {
  if (isCrossSite(req)) return json(403, "forbidden");
  // Bounded read: refuse oversized bodies before parsing (text cap is in characters; allow JSON overhead).
  const raw = await req.text();
  if (raw.length > deps.maxInputChars * 6 + 1024) return json(413, "input_too_long");
  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(JSON.parse(raw));
  } catch {
    return json(400, "bad_request");
  }
  const { replay_id, profile, extract_token } = parsed;
  const text = parsed.text === undefined ? undefined : stripControlChars(parsed.text);
  if ([text, replay_id, profile].filter((v) => v !== undefined).length !== 1) return json(400, "bad_request"); // exactly one
  if (extract_token !== undefined && profile === undefined) return json(400, "bad_request");
  if (text !== undefined && text.trim().length === 0) return json(400, "bad_request");
  if (text !== undefined && text.length > deps.maxInputChars) return json(413, "input_too_long");
  if (replay_id !== undefined && !isReplayId(replay_id)) return json(400, "bad_request");
  if (text !== undefined && deps.visitorInputMode === "samples" && !isPreparedText(text)) return json(403, "visitor_input_disabled");

  // A profile run is authenticated by the server's own signed extraction: a missing, forged or expired token is refused (the visitor
  // simply re-runs extraction), never run as an unauthenticated profile. The server then derives, by comparison, which facts were
  // edited. Samples mode accepts only an UNCHANGED profile from a token issued for a prepared fictional sample.
  let input: PipelineInput | undefined;
  let editedCount = 0; // counts only (log line); edits do not affect any tier under Policy R2
  if (profile !== undefined) {
    const verified = verifyExtraction(extract_token, deps.signingSecret, deps.now?.());
    if (verified === null) return json(401, "invalid_token");
    const clean: PatientProfile = { facts: profile.facts as PatientProfile["facts"] };
    const edited = selfEditedKeys(clean, verified.facts);
    if (deps.visitorInputMode === "samples" && (!verified.sample || edited.size > 0)) return json(403, "visitor_input_disabled");
    input = { profile: clean };
    editedCount = edited.size;
  }
  const visitorRun = input !== undefined; // no silent replay for these

  // Decide live vs replay BEFORE opening the stream so a refusal without fallback can still be an HTTP status.
  let fallback: ModeReason | null = replay_id !== undefined ? "requested" : null;
  let release: (() => Promise<void>) | undefined;
  if (fallback === null) {
    let decision: Awaited<ReturnType<RunGuard["check"]>>;
    try {
      decision = await deps.guard().check(deps.ip(req));
    } catch {
      decision = { ok: false, reason: "guard_unavailable" };
    }
    if (!decision.ok) fallback = decision.reason;
    else if (deps.gate) {
      let g: Awaited<ReturnType<ConcurrencyGate["acquire"]>>;
      try {
        g = await deps.gate().acquire();
      } catch {
        g = { ok: false, reason: "guard_unavailable" };
      }
      if (g.ok) release = g.release;
      else fallback = g.reason === "busy" ? "rate_limited" : "guard_unavailable"; // "busy" is shown as the rate-limit state
    }
  }
  if (fallback !== null && fallback !== "requested" && (visitorRun || !deps.replayFallbackEnabled)) return json(fallback === "rate_limited" ? 429 : 503, fallback);

  const enc = new TextEncoder();
  const t0 = Date.now();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const emit = (e: SseEvent) => {
        if (closed) return;
        const v = SseEventSchema.safeParse(e);
        if (!v.success) throw new Error("SSE_CONTRACT"); // internal contract bug: never forward an unvalidated event
        // Policy R2 backstop for live AND replayed results: cap, then refuse anything still above the ceiling.
        const out = enforceTrialCeiling(v.data);
        assertEmittable(out);
        controller.enqueue(enc.encode(`data: ${JSON.stringify(out)}\n\n`));
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
          if (visitorRun) {
            emit({ type: "error", code: "model_unavailable", message: "Live analysis is unavailable right now. Please try again in a moment.", fallback_to_replay: false });
            deps.log({ evt: "run", mode: "live", ok: false, reason: "model_unavailable", ms: Date.now() - t0 });
            return;
          }
          await streamReplay("model_unavailable");
          return;
        }
        emit({ type: "mode", mode: "live" });
        let calls = 0;
        // Token usage totals for the log line: integers and a flag only. When the provider reported none the token fields are OMITTED
        // (unavailable is not zero); calls_without_usage > 0 means the totals are a lower bound.
        let usageLog: Record<string, number> = {};
        try {
          await runPipeline(input ?? text!, pipeline, (e) => {
            if (e.type === "done" && e.stats) {
              calls = e.stats.llm_calls;
              const u = e.stats.usage?.total;
              if (u) usageLog = { calls_without_usage: u.calls_without_usage, ...(u.prompt_tokens !== null ? { prompt_tokens: u.prompt_tokens } : {}), ...(u.completion_tokens !== null ? { completion_tokens: u.completion_tokens } : {}) };
            }
            emit(e);
          });
          deps.log({ evt: "run", mode: "live", input: input ? "profile" : "text", ok: true, calls, ...usageLog, ms: Date.now() - t0, ...(input ? { edited: editedCount } : {}) });
        } catch (err) {
          if (err instanceof PipelineError && err.kind === "aborted") return;
          const kind: ModeReason = err instanceof PipelineError && err.kind === "ctgov_unavailable" ? "ctgov_unavailable" : "model_unavailable";
          const fallbackToReplay = deps.replayFallbackEnabled && !visitorRun;
          emit({ type: "error", code: err instanceof PipelineError ? err.kind : "internal", message: fallbackToReplay ? "Live analysis is unavailable, so a saved example is shown instead." : "Live analysis is unavailable right now. Please try again in a moment.", fallback_to_replay: fallbackToReplay });
          if (fallbackToReplay) await streamReplay(kind);
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
        // Release BEFORE closing the stream: once the response ends the serverless instance may be frozen, and a decrement still in flight
        // would be lost (the in-flight counter then stays up until its TTL). Bounded so a hung Redis call cannot hold the response open.
        if (release) {
          let timer: ReturnType<typeof setTimeout> | undefined;
          await Promise.race([Promise.resolve().then(release).catch(() => undefined), new Promise((r) => (timer = setTimeout(r, RELEASE_WAIT_MS)))]);
          clearTimeout(timer);
        }
        finish();
      }
    },
    async cancel() {
      await release?.();
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store, no-transform", "x-accel-buffering": "no" } });
}
