// READ-ONLY inventory of which public trials the prepared demo profiles select and whether their parsed criteria are cached.
// Network: one public ClinicalTrials.gov GET sequence (same call the live route makes). Supabase: SELECTs only (cache rows, replay profile events).
// No model call, no write. Prints NCT ids (public), versions, counts and chunk arithmetic only; never criterion text or payloads.
//   node --env-file=.env --import tsx eval/cache-inventory.ts
import { PARSER_VERSION, cacheKeyFor } from "../src/lib/cache/criteria-cache";
import { discoverRecruitingBreastTrials, prefilterTrials } from "../src/lib/ctgov/client";
import { splitTrialCriteria } from "../src/lib/ctgov/split";
import { getSupabase } from "../src/lib/supabase";

const CHUNK = 15; // run.ts
const MAX_CANDIDATES = 30; // MAX_CANDIDATE_TRIALS default
const PARSE_SLOTS = 14; // RunBudget parse allowance per run (docs/run-plan.md)
const IDS = ["her2pos-stage3", "hrpos-stage2", "tnbc-caregiver"];

async function main() {
  const sb = getSupabase();
  const { data: rc, error: e1 } = await sb.from("replay_cases").select("id,result").in("id", IDS);
  if (e1) throw new Error("select_replay_failed");
  const { data: rows, error: e2 } = await sb.from("trial_criteria_cache").select("nct_id,source_version,parser_version,parsed");
  if (e2) throw new Error("select_cache_failed");
  const cached = new Map<string, Array<{ sv: string; pv: string; n: number }>>();
  for (const r of rows ?? []) {
    const n = Array.isArray(r.parsed) ? r.parsed.length : -1;
    cached.set(r.nct_id, [...(cached.get(r.nct_id) ?? []), { sv: r.source_version, pv: r.parser_version, n }]);
  }
  const all = await discoverRecruitingBreastTrials({ base: process.env.CTGOV_API_BASE ?? "https://clinicaltrials.gov/api/v2", maxPages: 2 });
  console.log(JSON.stringify({ parser_version: PARSER_VERSION, discovered: all.length, cache_rows: rows?.length ?? 0 }));

  type Row = { nct: string; sv: string; n: number; chunks: number; status: "hit" | "stale_source" | "stale_parser" | "length_mismatch" | "missing" };
  const union = new Map<string, Row>();
  for (const id of IDS) {
    const events = ((rc ?? []).find((c) => c.id === id)?.result as { events?: Array<{ type: string; facts?: Array<{ key: string; state: string; value?: unknown }> }> } | undefined)?.events ?? [];
    const facts = events.find((e) => e.type === "profile")?.facts ?? [];
    const age = Number(facts.find((f) => f.key === "age" && f.state === "known")?.value);
    const sexF = facts.find((f) => f.key === "sex" && f.state === "known")?.value;
    const sel = prefilterTrials(all, { ...(Number.isFinite(age) ? { age } : {}), ...(sexF ? { sex: String(sexF) } : {}) }).slice(0, MAX_CANDIDATES);
    const rowsFor = sel.map((t): Row => {
      const n = splitTrialCriteria(t.nct_id, t.eligibility_text).length;
      const k = cacheKeyFor(t.nct_id, t.last_update);
      const have = cached.get(t.nct_id) ?? [];
      const exact = have.find((h) => h.sv === k.source_version && h.pv === k.parser_version);
      const status: Row["status"] = exact ? (exact.n === n ? "hit" : "length_mismatch") : have.some((h) => h.pv === k.parser_version) ? "stale_source" : have.length ? "stale_parser" : "missing";
      return { nct: t.nct_id, sv: k.source_version, n, chunks: Math.ceil(n / CHUNK), status };
    });
    rowsFor.sort((a, b) => a.n - b.n); // the pipeline sorts cheapest-to-complete first
    for (const r of rowsFor) union.set(r.nct, r);
    const tally = (xs: string[]) => xs.reduce<Record<string, number>>((a, k) => ((a[k] = (a[k] ?? 0) + 1), a), {});
    const miss = rowsFor.filter((r) => r.status !== "hit");
    console.log(JSON.stringify({ profile: id, age: Number.isFinite(age) ? age : null, sex: sexF ?? null, filtered: prefilterTrials(all, { ...(Number.isFinite(age) ? { age } : {}), ...(sexF ? { sex: String(sexF) } : {}) }).length, selected: sel.length, status: tally(rowsFor.map((r) => r.status)), uncached_chunks: miss.reduce((a, r) => a + r.chunks, 0), parse_slots_per_run: PARSE_SLOTS }));
    console.log("  selected (nct|source_version|criteria|chunks|status): " + rowsFor.map((r) => `${r.nct}|${r.sv}|${r.n}|${r.chunks}|${r.status}`).join(" "));
  }
  const u = [...union.values()];
  const miss = u.filter((r) => r.status !== "hit");
  console.log(JSON.stringify({ union_trials: u.length, union_hit: u.length - miss.length, union_uncached: miss.length, uncached_chunks: miss.reduce((a, r) => a + r.chunks, 0), chunk_hist: miss.reduce<Record<string, number>>((a, r) => ((a[r.chunks] = (a[r.chunks] ?? 0) + 1), a), {}) }));
}
main().catch((e: unknown) => { console.error("inventory failed:", (e as Error)?.message?.slice(0, 80)); process.exit(1); });
