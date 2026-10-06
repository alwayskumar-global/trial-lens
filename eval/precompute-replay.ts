// Precompute replay cases (SPEC §6): run the REAL pipeline once per FICTIONAL profile and store the event stream in
// Supabase `replay_cases` (service role, server-side only). Run: pnpm precompute:replay [--write]
//   default  : dry run. Runs the pipeline, prints counts only, writes nothing.
//   --write  : upserts the three cases (needs supabase/migrations/0001_init.sql applied).
// Needs: NEBIUS_API_KEY, NEBIUS_BASE_URL, NEMOTRON_MODEL_FAST|MID, (--write) SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// Each case costs up to MAX_LLM_CALLS_PER_RUN (80) calls. Output: counts only; no profile text, no model output.
import { SupabaseReplayStore, type StoredEvent } from "../src/lib/cache/replay";
import { createPipelineDeps } from "../src/lib/pipeline/deps";
import { runPipeline } from "../src/lib/pipeline/run";
import { REPLAY_PROFILES } from "../src/lib/sample/replay-profiles";

async function main(): Promise<void> {
  const write = process.argv.includes("--write");
  const store = write ? new SupabaseReplayStore() : null;
  for (const p of REPLAY_PROFILES) {
    const events: StoredEvent[] = [];
    let calls = 0, ms = 0;
    await runPipeline(p.text, createPipelineDeps(new AbortController().signal), (e) => {
      if (e.type === "done") { calls = e.stats?.llm_calls ?? 0; ms = e.stats?.wall_ms ?? 0; }
      else if (e.type !== "mode" && e.type !== "error") events.push(e);
    });
    const tiers: Record<string, number> = {};
    for (const e of events) if (e.type === "trial_result") tiers[e.assessment.tier] = (tiers[e.assessment.tier] ?? 0) + 1;
    console.warn(`${p.id}: ${events.length} events, ${calls} LLM calls, ${ms} ms, tiers ${JSON.stringify(tiers)}${write ? " [writing]" : " [dry run]"}`);
    if (store) await store.put({ id: p.id, label: p.label, profile_text: p.text, events });
  }
}

main().then(
  () => process.exit(0),
  (e: unknown) => {
    console.error(`precompute-replay failed: ${(e as Error)?.message?.slice(0, 120) ?? "unknown"}`);
    process.exit(1);
  },
);
