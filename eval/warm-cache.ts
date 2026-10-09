// DRY-RUN ONLY cache-warming planner. It makes NO model call and NO Supabase write; it does not import the model client, and `--execute` is refused.
// Reads: public ClinicalTrials.gov GETs, Supabase SELECTs (cache keys, replay profile events). Prints counts, public NCT ids, versions and dollars only.
//   node --env-file=.env --import tsx eval/warm-cache.ts [--policy=api-default|relevance] [--budget=0.75] [--bound=bytes|estimate] [--check-price]
// Policies: api-default = today's production query order; relevance = same query with sort=@relevance and a breast-signal guard (PROPOSED, under review).
// Selection is computed by the SAME code the live route uses (src/lib/ctgov/selection.ts): api-default -> mode "api-default" (all study types, today's behavior),
// relevance -> mode "relevance-v1-interventional" (sort=@relevance + filter.advanced=AREA[StudyType]INTERVENTIONAL + breast-signal guard).
// FAIL CLOSED: if the chosen policy's CT.gov request fails or returns an out-of-scope study, the script stops (exit 3); it never substitutes another ordering.
// --check-price additionally reads the provider's model metadata (a GET, NOT an inference call) and stops if the MID price differs from the constants.
// What it plans (see docs/cache-warming-proposal.md): which trials the chosen selection policy would warm, how many parse chunks that is, the
// worst-case dollars of every attempt BEFORE dispatch, and how much the enforceable SpendGuard bound would let through.
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { PARSER_VERSION } from "../src/lib/cache/criteria-cache";
import { CtgovError } from "../src/lib/ctgov/client";
import type { SelectionMode } from "../src/lib/ctgov/modes";
import { buildClauseBatchUserPrompt, buildClauseParseSystemPrompt } from "../src/prompts/clause-parse";
import { makeClauseBatchSchema } from "../src/schema/clause";
import { getSupabase } from "../src/lib/supabase";
import { PRICE } from "./cost-per-run";
import { planWarm } from "./lib/warm-plan";
import { SpendGuard, estTokens, promptTokensUpperBoundFromBytes, worstAttemptUsd } from "./lib/warm-guard";

if (process.argv.includes("--execute")) { console.error("--execute is not implemented: the warm-up is NOT approved. This script is dry-run only."); process.exit(2); }
const arg = (k: string, d: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? d;
const POLICY = arg("policy", "relevance");
const BUDGET = Number(arg("budget", "0.75"));
if (!["api-default", "relevance"].includes(arg("policy", "relevance"))) { console.error("bad --policy"); process.exit(2); }
const BOUND = arg("bound", "bytes"); // which worst-case figure drives the SpendGuard simulation
const BASE = process.env.CTGOV_API_BASE ?? "https://clinicaltrials.gov/api/v2";
const CHUNK = 15, MAX_TOKENS = 8192, CONCURRENCY = 6, RETRY_ECHO_CHARS = 4000 + 300;
const MEASURED_PARSE_CALL_USD = 0.0021; // two live runs: 1.9-2.0k tokens in, 1.6-1.65k out at MID prices (docs/cost-per-run.md)
const IDS = ["her2pos-stage3", "hrpos-stage2", "tnbc-caregiver"];
const sha = (xs: readonly string[]) => createHash("sha256").update(xs.join("\n")).digest("hex").slice(0, 16);

async function checkMidPrice(): Promise<{ ok: boolean; prompt: string; completion: string }> {
  const base = (process.env.NEBIUS_BASE_URL ?? "").replace(/\/$/, "");
  const r = await fetch(`${base}/models?verbose=true`, { headers: { authorization: `Bearer ${process.env.NEBIUS_API_KEY ?? ""}` } });
  if (!r.ok) throw new Error("price_check_http");
  const j = (await r.json()) as { data?: Array<{ id: string; pricing?: { prompt?: string; completion?: string } }> };
  const m = (j.data ?? []).find((x) => x.id === process.env.NEMOTRON_MODEL_MID);
  const prompt = m?.pricing?.prompt ?? "missing", completion = m?.pricing?.completion ?? "missing";
  return { ok: Math.abs(Number(prompt) - PRICE.MID.p) < 1e-15 && Math.abs(Number(completion) - PRICE.MID.c) < 1e-15, prompt, completion };
}

async function main() {
  const sb = getSupabase();
  const { data: rc, error: e1 } = await sb.from("replay_cases").select("id,result").in("id", IDS);
  const { data: rows, error: e2 } = await sb.from("trial_criteria_cache").select("nct_id,source_version,parser_version,parsed");
  if (e1 || e2) throw new Error("select_failed");
  const cached = new Map<string, Array<{ sv: string; pv: string; n: number }>>();
  for (const r of rows ?? []) cached.set(r.nct_id, [...(cached.get(r.nct_id) ?? []), { sv: r.source_version, pv: r.parser_version, n: Array.isArray(r.parsed) ? r.parsed.length : -1 }]);
  const profiles = IDS.map((id) => {
    const facts = ((rc ?? []).find((c) => c.id === id)?.result as { events?: Array<{ type: string; facts?: Array<{ key: string; state: string; value?: unknown }> }> } | undefined)?.events?.find((e) => e.type === "profile")?.facts ?? [];
    const age = Number(facts.find((f) => f.key === "age" && f.state === "known")?.value);
    const sex = facts.find((f) => f.key === "sex" && f.state === "known")?.value;
    return { id, filter: { ...(Number.isFinite(age) ? { age } : {}), ...(sex ? { sex: String(sex) } : {}) } };
  });

  // ---- plan for each policy, computed by the SAME selection code as the live route (src/lib/ctgov/selection.ts) ----
  // FAIL CLOSED: any CT.gov failure stops the script (exit 3); no policy is ever substituted for another.
  const modeOf = (policy: string): SelectionMode => (policy === "relevance" ? "relevance-v1-interventional" : "api-default");
  const planFor = async (policy: string) => { try { return await planWarm({ mode: modeOf(policy), base: BASE, profiles, cached }); } catch (e) { console.error(`selection_unavailable ${e instanceof CtgovError ? e.code : "UNKNOWN"}: stopping (no fallback ordering)`); process.exit(3); } };
  const plans = { "api-default": await planFor("api-default"), relevance: await planFor("relevance") };
  console.log(JSON.stringify({ at: new Date().toISOString(), parser_version: PARSER_VERSION, profiles: profiles.map((p) => ({ id: p.id, ...p.filter })) }));
  for (const [pol, pl] of Object.entries(plans)) console.log(JSON.stringify({ policy: pol, mode: pl.mode, discovered: pl.discovered, per_profile: pl.perProfile, union: pl.selected.length, hit: pl.hits, uncached: pl.warm.length, ids_sha: sha(pl.selected.map((t) => t.nct_id)) }));

  // ---- cost plan for the chosen policy ----
  const plan = plans[POLICY as "api-default" | "relevance"];
  const todo = plan.warm;
  const sys = buildClauseParseSystemPrompt();
  const planned = plan.planned, chunks: Array<{ nct: string; estIn: number; first: number; retry: number; firstB: number; retryB: number; bytes: number }> = [];
  for (const t of todo) {
    const src = t.sources;
    for (let i = 0; i < src.length; i += CHUNK) {
      const part = src.slice(i, i + CHUNK);
      const user = buildClauseBatchUserPrompt(part.map((c, k) => ({ index: k, type: c.type, text: c.text })));
      const schemaObj = z.toJSONSchema(makeClauseBatchSchema(part.map((c) => c.text)), { io: "input" });
      const schemaChars = JSON.stringify(schemaObj).length;
      const estIn = estTokens(sys.length + user.length + schemaChars);
      // The request body exactly as the parse call sends it (json_schema mode, reasoning_effort low), serialized: its UTF-8 size bounds the prompt tokens.
      const body = JSON.stringify({ model: "nvidia/nemotron-3-super-120b-a12b", messages: [{ role: "system", content: sys }, { role: "user", content: user }], temperature: 0, max_tokens: MAX_TOKENS, response_format: { type: "json_schema", json_schema: { name: "clause_batch", strict: true, schema: schemaObj } }, reasoning_effort: "low" });
      const bytes = Buffer.byteLength(body);
      const retryExtraBytes = 4 * 4000 + 4 * 300; // echoed previous output (<= 4000 chars) + correction note, at the 4-byte-per-character worst case
      chunks.push({ nct: t.nct_id, estIn, bytes, first: worstAttemptUsd(estIn, MAX_TOKENS, PRICE.MID), retry: worstAttemptUsd(estTokens(sys.length + user.length + schemaChars + RETRY_ECHO_CHARS), MAX_TOKENS, PRICE.MID), firstB: worstAttemptUsd(promptTokensUpperBoundFromBytes(bytes), MAX_TOKENS, PRICE.MID), retryB: worstAttemptUsd(promptTokensUpperBoundFromBytes(bytes + retryExtraBytes), MAX_TOKENS, PRICE.MID) });
    }
  }
  const sum = (f: (c: (typeof chunks)[number]) => number) => chunks.reduce((x, c) => x + f(c), 0);
  const A = 2 * chunks.length;
  const policyLabel = plan.policyLabel;
  const fp = plan.fingerprint;
  const smallest14 = [...chunks].sort((a, b) => a.estIn - b.estIn).slice(0, 14);
  console.log(JSON.stringify({ plan: { policy: policyLabel, trials_to_warm: todo.length, max_cache_writes: todo.length, chunks: chunks.length, attempt_ceiling: A, fingerprint: fp, request_body_bytes: { min: Math.min(...chunks.map((c) => c.bytes)), max: Math.max(...chunks.map((c) => c.bytes)) }, est_input_tokens_chars_div_2_5: { min: Math.min(...chunks.map((c) => c.estIn)), max: Math.max(...chunks.map((c) => c.estIn)), mean: Math.round(sum((c) => c.estIn) / Math.max(1, chunks.length)) }, calibration_14_smallest_chunks_mean_est_in: Math.round(smallest14.reduce((a, c) => a + c.estIn, 0) / Math.max(1, smallest14.length)), measured_live_mean_in_per_parse_call: "1886-2033" } }));
  // Local, gitignored copy of the exact plan (public NCT ids, versions, counts) so a later plan can be diffed against an approved one.
  mkdirSync("eval/data/warm-plans", { recursive: true });
  const planFile = `eval/data/warm-plans/${new Date().toISOString().replace(/[:.]/g, "-")}-${fp.slice(0, 8)}.json`;
  writeFileSync(planFile, JSON.stringify({ policy: policyLabel, parser_version: PARSER_VERSION, fingerprint: fp, trials: planned, keys: planned.map((t) => `${t.nct_id}|${t.source_version}|${PARSER_VERSION}`) }));
  console.log(JSON.stringify({ plan_file: planFile, planned_keys: planned.length }));
  const usd = (n: number) => Number(n.toFixed(4));
  const exposure = (first: (c: (typeof chunks)[number]) => number, retry: (c: (typeof chunks)[number]) => number) => ({ first_attempts: usd(sum(first)), retries: usd(sum(retry)), all_attempts_at_ceiling: usd(sum(first) + sum(retry)), max_single_attempt: usd(Math.max(0, ...chunks.map(retry))) });
  console.log(JSON.stringify({ max_forecast_exposure_usd_at_attempt_ceiling: { attempts: A, assumption_chars_div_2_5_estimate: exposure((c) => c.first, (c) => c.retry), assumption_bytes_bound_no_tokenizer_ratio: exposure((c) => c.firstB, (c) => c.retryB), "if_actual_prompt_were_2x_the_byte_bound": usd(sum((c) => c.firstB + c.retryB) + sum((c) => promptTokensUpperBoundFromBytes(c.bytes) * PRICE.MID.p + promptTokensUpperBoundFromBytes(c.bytes + 16_000) * PRICE.MID.p)), expected_at_measured_average: usd(chunks.length * MEASURED_PARSE_CALL_USD) } }));

  // ---- what the enforceable bound lets through ----
  const firstOf = (c: (typeof chunks)[number]) => (BOUND === "estimate" ? c.first : c.firstB);
  const sim = (budget: number, actualOf: (c: (typeof chunks)[number]) => number) => {
    const g = new SpendGuard(budget, A || 1); let done = 0; const open: Array<{ r: { id: number; worst: number }; a: number }> = [];
    for (const c of chunks) {
      while (open.length >= CONCURRENCY) { const o = open.shift()!; g.settle(o.r, o.a); }
      const t = g.tryReserve(firstOf(c));
      if (!t.ok) break;
      open.push({ r: t.reservation, a: actualOf(c) }); done++;
    }
    for (const o of open) g.settle(o.r, o.a);
    return { chunks_dispatched: done, of: chunks.length, spent_usd: usd(g.spentUsd) };
  };
  console.log(JSON.stringify({ bound_mode: BOUND, rule: "dispatch only if actual_spent + in_flight_worst_case + this_worst_case <= budget", budgets: [0.5, 0.75, 1, 1.5].map((b) => ({ budget_usd: b, if_every_attempt_hits_its_worst_case: sim(b, firstOf), at_measured_average: sim(b, (c) => Math.min(firstOf(c), MEASURED_PARSE_CALL_USD)) })), note: "first attempts only; a validation retry is a second reservation against the same bound" }));
  void BUDGET;
  if (process.argv.includes("--check-price")) console.log(JSON.stringify({ price_check: await checkMidPrice(), constants: PRICE.MID }));
}
main().catch((e: unknown) => { console.error("warm-cache dry-run failed:", (e as Error)?.message?.slice(0, 80)); process.exit(1); });
