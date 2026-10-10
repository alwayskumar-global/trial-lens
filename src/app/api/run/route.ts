// SSE pipeline endpoint (SPEC §3, §6). Node runtime (not edge): Supabase, Upstash and the OpenAI SDK need it.
// VERIFY: Vercel plan limit for maxDuration. Measured runs: ~60-95 s warm/cold; 300 s needs a plan that allows it.
import { clientIp, createUpstashConcurrencyGate, createUpstashRunGuard } from "@/lib/guards/run-guard";
import { SupabaseReplayStore } from "@/lib/cache/replay";
import { getGuardEnv, getPipelineEnv } from "@/lib/env";
import { effectiveConfigLogFields } from "@/lib/pipeline/log-fields";
import { handleRun } from "@/lib/pipeline/handler";
import { createPipelineDeps } from "@/lib/pipeline/deps";
import { visitorConfig } from "@/lib/visitor-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export function POST(req: Request): Promise<Response> {
  const v = visitorConfig();
  return handleRun(req, {
    visitorInputMode: v.mode,
    signingSecret: v.signingSecret,
    gate: createUpstashConcurrencyGate,
    maxInputChars: getPipelineEnv().MAX_INPUT_CHARS,
    replayFallbackEnabled: getGuardEnv().REPLAY_FALLBACK_ENABLED,
    guard: createUpstashRunGuard,
    replay: new SupabaseReplayStore(),
    makePipeline: createPipelineDeps,
    ip: (r) => clientIp(r.headers),
    log: (line) => process.stdout.write(JSON.stringify({ ...line, ...effectiveConfigLogFields() }) + "\n"), // counts, timings and fixed codes only
  });
}
