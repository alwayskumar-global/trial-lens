// DISABLED executor entry point. It refuses immediately unless EXECUTE_ENABLED is true in eval/lib/warm-run.ts, which stays false until Kumar separately
// approves the plan fingerprint, the maximum cache writes and a conditional spending budget. When enabled it additionally needs, in the environment:
//   WARM_CONFIRM=parse-and-insert-approved-plan   WARM_PLAN=<approved fingerprint>   WARM_BUDGET_USD=<budget>   WARM_PLAN_FILE=<plan json from eval/warm-cache.ts>
// and it re-verifies the price and recomputes the plan from live CT.gov before any model call (executeWarm refuses on any difference).
import { readFileSync } from "node:fs";
import { PARSER_VERSION } from "../src/lib/cache/criteria-cache";
import { CtgovError } from "../src/lib/ctgov/client";
import { buildClauseParseSystemPrompt } from "../src/prompts/clause-parse";
import { getSupabase } from "../src/lib/supabase";
import { PRICE } from "./cost-per-run";
import { makeCacheStore, makeProviderPort, priceMatches } from "./warm-bindings";
import { executeWarm } from "./lib/warm-executor";
import { EXECUTE_ENABLED, executeGate, type PlanFile } from "./lib/warm-run";
import { planWarm, type CachedRows, type ProfileFilter } from "./lib/warm-plan";

async function main(): Promise<number> {
  const plan = process.env["WARM_PLAN_FILE"] ? (JSON.parse(readFileSync(process.env["WARM_PLAN_FILE"], "utf8")) as PlanFile) : null;
  const gate = executeGate(process.env, plan);
  if (!gate.ok) { console.error(`warm-execute refused: ${gate.reason}. The warm-up is NOT approved; no model call, no write.`); return 2; }

  console.error(`warm-execute: gate passed; fingerprint ${gate.approval.fingerprint.slice(0, 8)}, budget $${gate.approval.budgetUsd}, attempt ceiling ${gate.approval.attemptCeiling}, max writes ${gate.approval.maxWrites}; one attempt at a time`);
  const sb = getSupabase();
  const { data: rc } = await sb.from("replay_cases").select("id,result").in("id", ["her2pos-stage3", "hrpos-stage2", "tnbc-caregiver"]);
  const { data: rows } = await sb.from("trial_criteria_cache").select("nct_id,source_version,parser_version,parsed");
  const cached: CachedRows = new Map();
  for (const r of rows ?? []) cached.set(r.nct_id, [...(cached.get(r.nct_id) ?? []), { sv: r.source_version, pv: r.parser_version, n: Array.isArray(r.parsed) ? r.parsed.length : -1 }]);
  const profiles: ProfileFilter[] = (rc ?? []).map((c) => {
    const facts = (c.result as { events?: Array<{ type: string; facts?: Array<{ key: string; state: string; value?: unknown }> }> }).events?.find((e) => e.type === "profile")?.facts ?? [];
    const age = Number(facts.find((f) => f.key === "age" && f.state === "known")?.value), sex = facts.find((f) => f.key === "sex" && f.state === "known")?.value;
    return { id: c.id as string, filter: { ...(Number.isFinite(age) ? { age } : {}), ...(sex ? { sex: String(sex) } : {}) } };
  });
  const base = process.env["CTGOV_API_BASE"] ?? "https://clinicaltrials.gov/api/v2";
  const model = process.env["NEMOTRON_MODEL_MID"] ?? "";

  const result = await executeWarm({
    port: makeProviderPort(), store: makeCacheStore(), price: PRICE.MID, sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    checkPrice: () => priceMatches({ baseUrl: process.env["NEBIUS_BASE_URL"] ?? "", apiKey: process.env["NEBIUS_API_KEY"] ?? "", modelId: model, price: PRICE.MID }),
    planNow: async () => {
      try { const p = await planWarm({ mode: "relevance-v1-interventional", base, profiles, cached, parserVersion: PARSER_VERSION }); return { fingerprint: p.fingerprint, trials: p.planned, warm: p.warm }; }
      catch (e) { console.error(`selection_unavailable ${e instanceof CtgovError ? e.code : "UNKNOWN"}`); return { fingerprint: "unavailable", trials: [], warm: [] }; }
    },
    model, system: buildClauseParseSystemPrompt(), maxTokens: 8192,
    // STRICTLY ONE ATTEMPT AT A TIME throughout (Kumar, 2026-10-10): every job is sequential, so at most one reservation is ever in flight.
    calibration: Number.MAX_SAFE_INTEGER, concurrency: 1,
    onResult: (r) => console.error(`job ${r.id} ${r.status}${r.status === "unparsed" ? ` (${r.reason})${r.problem ? ` problem=[${r.problem}]` : ""}` : ""} attempts=${r.attempts}`),
  }, gate.approval);
  console.log(JSON.stringify(result));
  return result.status === "done" && !result.summary.halted ? 0 : 1;
}
if (!EXECUTE_ENABLED) { console.error("warm-execute is DISABLED (EXECUTE_ENABLED=false): the warm-up is NOT approved; no model call, no write."); process.exit(2); }
main().then((c) => process.exit(c)).catch((e: unknown) => { console.error("warm-execute failed:", (e as Error)?.message?.slice(0, 80)); process.exit(1); });
