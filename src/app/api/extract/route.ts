// Profile extraction endpoint (see src/lib/pipeline/extract-handler.ts). Node runtime: the OpenAI SDK and Upstash need it.
// One FAST call; measured extraction stage 18.6 s locally and 44.8 s inside a Preview run, so allow up to 90 s.
import { clientIp, createUpstashExtractGuard } from "@/lib/guards/run-guard";
import { getPipelineEnv } from "@/lib/env";
import { handleExtract } from "@/lib/pipeline/extract-handler";
import { createLlmPort } from "@/lib/pipeline/deps";
import { visitorConfig } from "@/lib/visitor-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

export function POST(req: Request): Promise<Response> {
  const v = visitorConfig();
  return handleExtract(req, {
    maxInputChars: getPipelineEnv().MAX_INPUT_CHARS,
    visitorInputMode: v.mode,
    signingSecret: v.signingSecret,
    guard: createUpstashExtractGuard,
    makeLlm: () => createLlmPort(2), // one extraction slot = the call and its single retry
    ip: (r) => clientIp(r.headers),
    log: (line) => process.stdout.write(JSON.stringify(line) + "\n"), // counts, timings and fixed codes only
  });
}
