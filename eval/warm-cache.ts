// DRY-RUN ONLY cache-warming planner. It makes NO model call and NO Supabase write; it does not import the model client, and `--execute` is refused.
// Reads: public ClinicalTrials.gov GETs, Supabase SELECTs (cache keys, replay profile events). Prints counts, public NCT ids, versions and dollars only.
//   node --env-file=.env --import tsx eval/warm-cache.ts [--policy=api-default|hash-ranked-v1] [--budget=0.50]
// What it plans (see docs/cache-warming-proposal.md): which trials the chosen selection policy would warm, how many parse chunks that is, the
// worst-case dollars of every attempt BEFORE dispatch, and how much the enforceable SpendGuard bound would let through.
import { createHash } from "node:crypto";
import { z } from "zod";
import { PARSER_VERSION, cacheKeyFor } from "../src/lib/cache/criteria-cache";
import { discoverRecruitingBreastTrials, mapStudy, prefilterTrials, type Trial } from "../src/lib/ctgov/client";
import { splitTrialCriteria } from "../src/lib/ctgov/split";
import { buildClauseBatchUserPrompt, buildClauseParseSystemPrompt } from "../src/prompts/clause-parse";
import { makeClauseBatchSchema } from "../src/schema/clause";
import { getSupabase } from "../src/lib/supabase";
import { PRICE } from "./cost-per-run";
import { POLICY_ID, chooseInRankOrder, rankPool } from "./lib/selection-policy";
import { SpendGuard, estTokens, planFingerprint, worstAttemptUsd, type PlannedTrial } from "./lib/warm-guard";

if (process.argv.includes("--execute")) { console.error("--execute is not implemented: the warm-up is NOT approved. This script is dry-run only."); process.exit(2); }
const arg = (k: string, d: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? d;
const POLICY = arg("policy", "api-default");
const BUDGET = Number(arg("budget", "0.50"));
const BASE = process.env.CTGOV_API_BASE ?? "https://clinicaltrials.gov/api/v2";
const CHUNK = 15, MAX_CANDIDATES = 30, MAX_TOKENS = 8192, CONCURRENCY = 6, RETRY_ECHO_CHARS = 4000 + 300;
const MEASURED_PARSE_CALL_USD = 0.0021; // two live runs: 1.9-2.0k tokens in, 1.6-1.65k out at MID prices (docs/cost-per-run.md)
const IDS = ["her2pos-stage3", "hrpos-stage2", "tnbc-caregiver"];
const sha = (xs: readonly string[]) => createHash("sha256").update(xs.join("\n")).digest("hex").slice(0, 16);

async function poolIds(): Promise<string[]> {
  const out: string[] = []; let tok: string | undefined;
  do {
    const q = new URLSearchParams({ "query.cond": "breast cancer", "filter.overallStatus": "RECRUITING", pageSize: "1000", fields: "NCTId", format: "json" });
    if (tok) q.set("pageToken", tok);
    const j = (await (await fetch(`${BASE}/studies?${q}`)).json()) as { studies: Array<{ protocolSection: { identificationModule: { nctId: string } } }>; nextPageToken?: string };
    out.push(...j.studies.map((s) => s.protocolSection.identificationModule.nctId));
    tok = j.nextPageToken;
  } while (tok);
  return out;
}
async function detailsByIds(ids: readonly string[]): Promise<Map<string, Trial>> {
  const fields = "NCTId|BriefTitle|OverallStatus|EligibilityCriteria|MinimumAge|MaximumAge|Sex|LastUpdatePostDate|LocationStatus|LocationGeoPoint";
  const got = new Map<string, Trial>();
  for (let i = 0; i < ids.length; i += 30) {
    const q = new URLSearchParams({ "filter.ids": ids.slice(i, i + 30).join("|"), "filter.overallStatus": "RECRUITING", fields, format: "json", pageSize: "100" });
    const j = (await (await fetch(`${BASE}/studies?${q}`)).json()) as { studies: Parameters<typeof mapStudy>[0][] };
    for (const s of j.studies) { const t = mapStudy(s); if (t) got.set(t.nct_id, t); }
  }
  return got;
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

  // ---- selection under each policy (the chosen one drives the cost plan) ----
  const apiOrder = await discoverRecruitingBreastTrials({ base: BASE, maxPages: 2 });
  const pool = await poolIds();
  const ranked = rankPool(pool);
  const rankedDetails = await detailsByIds(ranked.slice(0, 90)); // buffer well beyond 30 for the prefilter
  const rankedList = ranked.slice(0, 90).flatMap((id) => (rankedDetails.has(id) ? [rankedDetails.get(id)!] : []));
  const select = (policy: string): Map<string, Trial> => {
    const u = new Map<string, Trial>();
    for (const p of profiles) {
      const sel = policy === POLICY_ID ? chooseInRankOrder(rankedList, (t) => prefilterTrials([t], p.filter).length === 1, MAX_CANDIDATES) : prefilterTrials(apiOrder, p.filter).slice(0, MAX_CANDIDATES);
      for (const t of sel) u.set(t.nct_id, t);
    }
    return u;
  };
  type St = "hit" | "length_mismatch" | "stale_source" | "stale_parser" | "missing";
  const status = (t: Trial): St => {
    const n = splitTrialCriteria(t.nct_id, t.eligibility_text).length, k = cacheKeyFor(t.nct_id, t.last_update), have = cached.get(t.nct_id) ?? [];
    const exact = have.find((h) => h.sv === k.source_version && h.pv === k.parser_version);
    return exact ? (exact.n === n ? "hit" : "length_mismatch") : have.some((h) => h.pv === k.parser_version) ? "stale_source" : have.length ? "stale_parser" : "missing";
  };
  console.log(JSON.stringify({ at: new Date().toISOString(), parser_version: PARSER_VERSION, pool_recruiting_breast: pool.length, api_order_first30_sha: sha(apiOrder.slice(0, 30).map((t) => t.nct_id)), api_order_first120_sha: sha(apiOrder.map((t) => t.nct_id)), hash_rank_top30_sha: sha(ranked.slice(0, 30)), profiles: profiles.map((p) => ({ id: p.id, ...p.filter })) }));
  for (const pol of ["api-default", POLICY_ID]) {
    const u = select(pol), st = [...u.values()].map(status);
    console.log(JSON.stringify({ policy: pol, union: u.size, hit: st.filter((s) => s === "hit").length, uncached: st.filter((s) => s !== "hit").length, ids_sha: sha([...u.keys()].sort()) }));
  }

  // ---- cost plan for the chosen policy ----
  const sel = [...select(POLICY).values()].sort((a, b) => a.nct_id.localeCompare(b.nct_id));
  const todo = sel.filter((t) => status(t) !== "hit");
  const sys = buildClauseParseSystemPrompt();
  const planned: PlannedTrial[] = [], chunks: Array<{ nct: string; estIn: number; first: number; retry: number }> = [];
  for (const t of todo) {
    const src = splitTrialCriteria(t.nct_id, t.eligibility_text);
    planned.push({ nct_id: t.nct_id, source_version: cacheKeyFor(t.nct_id, t.last_update).source_version, criteria: src.length, chunks: Math.ceil(src.length / CHUNK) });
    for (let i = 0; i < src.length; i += CHUNK) {
      const part = src.slice(i, i + CHUNK);
      const user = buildClauseBatchUserPrompt(part.map((c, k) => ({ index: k, type: c.type, text: c.text })));
      const schemaChars = JSON.stringify(z.toJSONSchema(makeClauseBatchSchema(part.map((c) => c.text)), { io: "input" })).length;
      const estIn = estTokens(sys.length + user.length + schemaChars);
      chunks.push({ nct: t.nct_id, estIn, first: worstAttemptUsd(estIn, MAX_TOKENS, PRICE.MID), retry: worstAttemptUsd(estTokens(sys.length + user.length + schemaChars + RETRY_ECHO_CHARS), MAX_TOKENS, PRICE.MID) });
    }
  }
  const W1 = chunks.reduce((a, c) => a + c.first, 0), W2 = chunks.reduce((a, c) => a + c.retry, 0), A = 2 * chunks.length;
  const fp = planFingerprint(PARSER_VERSION, POLICY, planned);
  const smallest14 = [...chunks].sort((a, b) => a.estIn - b.estIn).slice(0, 14);
  console.log(JSON.stringify({ plan: { policy: POLICY, trials_to_warm: todo.length, chunks: chunks.length, attempt_ceiling: A, fingerprint: fp, est_input_tokens_per_chunk: { min: Math.min(...chunks.map((c) => c.estIn)), max: Math.max(...chunks.map((c) => c.estIn)), mean: Math.round(chunks.reduce((a, c) => a + c.estIn, 0) / Math.max(1, chunks.length)) }, calibration_14_smallest_chunks_mean_est_in: Math.round(smallest14.reduce((a, c) => a + c.estIn, 0) / Math.max(1, smallest14.length)), measured_live_mean_in_per_parse_call: "1886-2033" } }));
  const usd = (n: number) => Number(n.toFixed(4));
  console.log(JSON.stringify({ worst_case_usd: { first_attempts_all_chunks: usd(W1), retries_all_chunks: usd(W2), all_attempts_at_ceiling: usd(W1 + W2), max_single_attempt: usd(Math.max(0, ...chunks.map((c) => c.retry))) } }));

  // ---- what the enforceable bound lets through ----
  const sim = (actualOf: (c: { first: number }) => number) => {
    const g = new SpendGuard(BUDGET, A || 1); let done = 0; const open: Array<{ r: { id: number; worst: number }; a: number }> = [];
    for (const c of chunks) {
      while (open.length >= CONCURRENCY) { const o = open.shift()!; g.settle(o.r, o.a); }
      const t = g.tryReserve(c.first);
      if (!t.ok) break;
      open.push({ r: t.reservation, a: actualOf(c) }); done++;
    }
    for (const o of open) g.settle(o.r, o.a);
    return { chunks_dispatched: done, of: chunks.length, spent_usd: usd(g.spentUsd), within_budget: g.spentUsd <= BUDGET + 1e-9 };
  };
  console.log(JSON.stringify({ budget_usd: BUDGET, bound: "dispatch only if actual_spent + in_flight_worst_case + this_worst_case <= budget", at_measured_average: sim((c) => Math.min(c.first, MEASURED_PARSE_CALL_USD)), if_every_attempt_hit_its_worst_case: sim((c) => c.first), note: "first attempts only; a validation retry is a second reservation against the same bound" }));
}
main().catch((e: unknown) => { console.error("warm-cache dry-run failed:", (e as Error)?.message?.slice(0, 80)); process.exit(1); });
