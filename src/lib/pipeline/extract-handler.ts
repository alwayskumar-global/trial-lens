// POST /api/extract: reads the visitor's description ONCE (one FAST call) and returns the extracted facts plus a signed token,
// so the visitor can review and correct them on the Confirm screen BEFORE any trial analysis starts. JSON, not SSE.
// The token lets /api/run derive, server-side, which facts the visitor later changed (Policy R). The text is held only in memory:
// never logged, cached or persisted; only counts, timings and fixed codes are logged.
import { z } from "zod";
import type { RunGuard } from "@/lib/guards/run-guard";
import { isCrossSite } from "@/lib/pipeline/handler";
import { extractProfileWithStats } from "@/lib/pipeline/extract";
import type { LlmPort } from "@/lib/pipeline/run";
import { signExtraction } from "@/lib/profile/token";
import { isPreparedText, stripControlChars } from "@/lib/sample/prepared";
import { FACT_KEYS } from "@/schema/vocabulary";

export interface ExtractHandlerDeps {
  maxInputChars: number;
  visitorInputMode: "samples" | "open";
  signingSecret: string | undefined;
  guard: () => RunGuard; // its own window and daily budget (not the run guard's)
  /** One extraction call plus its single retry. May throw (missing model env). */
  makeLlm: () => LlmPort;
  ip: (req: Request) => string;
  /** Counts/timings/codes only. Never pass request content. */
  log: (line: Record<string, string | number | boolean>) => void;
  now?: () => Date;
}

const Body = z.strictObject({ text: z.string() });
const json = (status: number, code: string) => Response.json({ code }, { status, headers: { "cache-control": "no-store" } });

export async function handleExtract(req: Request, deps: ExtractHandlerDeps): Promise<Response> {
  const t0 = Date.now();
  if (isCrossSite(req)) return json(403, "forbidden");
  const raw = await req.text();
  if (raw.length > deps.maxInputChars * 6 + 1024) return json(413, "input_too_long");
  let text: string;
  try {
    text = stripControlChars(Body.parse(JSON.parse(raw)).text);
  } catch {
    return json(400, "bad_request");
  }
  if (text.trim().length === 0) return json(400, "bad_request");
  if (text.length > deps.maxInputChars) return json(413, "input_too_long");
  if (deps.visitorInputMode === "samples" && !isPreparedText(text)) return json(403, "visitor_input_disabled");
  if (!deps.signingSecret) return json(503, "unavailable"); // without a secret no token can be issued

  let decision: Awaited<ReturnType<RunGuard["check"]>>;
  try {
    decision = await deps.guard().check(deps.ip(req));
  } catch {
    decision = { ok: false, reason: "guard_unavailable" };
  }
  if (!decision.ok) {
    deps.log({ evt: "extract", ok: false, reason: decision.reason, ms: Date.now() - t0 });
    return json(decision.reason === "rate_limited" ? 429 : 503, decision.reason);
  }

  let llm: LlmPort;
  try {
    llm = deps.makeLlm();
  } catch {
    deps.log({ evt: "extract", ok: false, reason: "model_unavailable", detail: "config", ms: Date.now() - t0 });
    return json(503, "model_unavailable");
  }
  const result = await extractProfileWithStats(text, llm).catch(() => null);
  const profile = result?.profile;
  if (!profile) {
    const kind = result?.stats.errorKind;
    // Only fixed error classes from our LLM client. Never log a thrown provider message or visitor text.
    const detail = kind && /^(HTTP_\d{3}|HTTP_\?|RATE_LIMITED|TIMEOUT|NETWORK|CALL_CAP_EXCEEDED|CALL_FAILED|ZOD_INVALID_AFTER_RETRY)$/.test(kind) ? kind : "unexpected";
    deps.log({ evt: "extract", ok: false, reason: "model_unavailable", detail, calls: llm.used(), ms: Date.now() - t0 });
    return json(503, "model_unavailable");
  }
  // Facts only: state and value. The model's free-text notes are not returned and are never accepted back.
  const facts = FACT_KEYS.map((k) => {
    const f = profile.facts[k];
    return f.state === "unknown" || f.value === undefined ? { key: k, state: "unknown" as const } : { key: k, state: f.state, value: f.value };
  });
  deps.log({ evt: "extract", ok: true, facts: facts.filter((f) => f.state !== "unknown").length, calls: llm.used(), ms: Date.now() - t0 });
  return Response.json({ profile: { facts: Object.fromEntries(facts.map((f) => [f.key, f])) }, extract_token: signExtraction(profile, deps.signingSecret, deps.now?.(), { sample: isPreparedText(text) }) }, { headers: { "cache-control": "no-store" } });
}
