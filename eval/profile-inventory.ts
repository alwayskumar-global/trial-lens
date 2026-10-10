// READ-ONLY per-profile inventory under the active selection mode (relevance-v1-interventional): for each prepared profile, the selected trials, exact
// cache hits, missing/stale parses and expected parse chunks, plus text FEATURES (counts only) of the trials that are not cached.
// Public CT.gov GETs + Supabase SELECTs. No model call, no write. Prints public NCT ids and counts only; never criterion text.
//   node --env-file=.env --import tsx eval/profile-inventory.ts
import { discoverBySelectionMode } from "../src/lib/ctgov/selection";
import { splitTrialCriteria } from "../src/lib/ctgov/split";
import { getSupabase } from "../src/lib/supabase";
import { CHUNK_SIZE, MAX_CANDIDATES, cacheStatus, type CachedRows } from "./lib/warm-plan";
import { selectFromDiscovered } from "../src/lib/ctgov/selection";

const BASE = process.env.CTGOV_API_BASE ?? "https://clinicaltrials.gov/api/v2";
const IDS = ["her2pos-stage3", "hrpos-stage2", "tnbc-caregiver"];

async function main() {
  const sb = getSupabase();
  const { data: rc } = await sb.from("replay_cases").select("id,result").in("id", IDS);
  const { data: rows } = await sb.from("trial_criteria_cache").select("nct_id,source_version,parser_version,parsed");
  const cached: CachedRows = new Map();
  for (const r of rows ?? []) cached.set(r.nct_id, [...(cached.get(r.nct_id) ?? []), { sv: r.source_version, pv: r.parser_version, n: Array.isArray(r.parsed) ? r.parsed.length : -1 }]);
  const all = await discoverBySelectionMode("relevance-v1-interventional", { base: BASE, maxPages: 2 });
  const uncached = new Map<string, (typeof all)[number]>();
  for (const id of IDS) {
    const facts = ((rc ?? []).find((c) => c.id === id)?.result as { events?: Array<{ type: string; facts?: Array<{ key: string; state: string; value?: unknown }> }> } | undefined)?.events?.find((e) => e.type === "profile")?.facts ?? [];
    const age = Number(facts.find((f) => f.key === "age" && f.state === "known")?.value), sex = facts.find((f) => f.key === "sex" && f.state === "known")?.value;
    const filter = { ...(Number.isFinite(age) ? { age } : {}), ...(sex ? { sex: String(sex) } : {}) };
    const r = selectFromDiscovered(all, filter, MAX_CANDIDATES);
    const by: Record<string, number> = {}; let chunks = 0; const missing: string[] = [];
    for (const t of r.candidates) {
      const st = cacheStatus(t, cached);
      by[st] = (by[st] ?? 0) + 1;
      if (st !== "hit") { chunks += Math.ceil(splitTrialCriteria(t.nct_id, t.eligibility_text).length / CHUNK_SIZE); missing.push(t.nct_id); uncached.set(t.nct_id, t); }
    }
    console.log(JSON.stringify({ profile: id, ...filter, discovered: r.discovered, filtered: r.filtered, selected: r.candidates.length, status: by, hits: by["hit"] ?? 0, uncached: missing.length, expected_parse_chunks_if_run_live: chunks, uncached_ids: missing }));
  }
  // Text features only (never the text): why a parse might fail validation.
  for (const t of uncached.values()) {
    const src = splitTrialCriteria(t.nct_id, t.eligibility_text);
    const texts = src.map((s) => s.text);
    const dup = texts.length - new Set(texts.map((x) => x.toLowerCase())).size;
    console.log(JSON.stringify({ nct: t.nct_id, criteria: src.length, chunks: Math.ceil(src.length / CHUNK_SIZE), inclusion: src.filter((s) => s.type === "inclusion").length, exclusion: src.filter((s) => s.type === "exclusion").length, max_len: Math.max(...texts.map((x) => x.length)), over_600_chars: texts.filter((x) => x.length > 600).length, non_ascii_chars: texts.join("").replace(/[\x00-\x7f]/g, "").length, with_newline: texts.filter((x) => /\n/.test(x)).length, with_table_pipes: texts.filter((x) => /\|/.test(x)).length, duplicate_texts: dup, last_update: t.last_update }));
  }
}
main().catch((e: unknown) => { console.error("inventory failed:", (e as Error)?.message?.slice(0, 80)); process.exit(1); });
