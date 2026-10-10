// READ-ONLY snapshot of what each selection policy would pick right now, for comparison across CT.gov data refreshes.
// Policies: "api-default" (today's production query, no sort) and "relevance" (the same query with sort=@relevance).
// Reads: public CT.gov GETs, Supabase SELECTs (cache keys, replay profile events). Writes: ONE local gitignored file under eval/data/selection-snapshots/
// (public NCT ids and counts only). No model call, no database write.
//   node --env-file=.env --import tsx eval/selection-snapshot.ts            take a snapshot
//   node --env-file=.env --import tsx eval/selection-snapshot.ts --due                       has CT.gov refreshed since the latest snapshot of this scope?
//   node --env-file=.env --import tsx eval/selection-snapshot.ts --compare <older.json> <newer.json>
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { cacheKeyFor } from "../src/lib/cache/criteria-cache";
import { discoverRecruitingBreastTrials, prefilterTrials, type Trial } from "../src/lib/ctgov/client";
import { splitTrialCriteria } from "../src/lib/ctgov/split";
import { getSupabase } from "../src/lib/supabase";
import { fetchWindow } from "./lib/ctgov-window";
import { comparePolicy, type ScopeClass, type SelectionRecord, type Snapshot } from "./lib/selection-compare";

const BASE = process.env.CTGOV_API_BASE ?? "https://clinicaltrials.gov/api/v2";
const DIR = "eval/data/selection-snapshots";
const IDS = ["her2pos-stage3", "hrpos-stage2", "tnbc-caregiver"];
const CHUNK = 15, N = 30;
const SCOPE = process.argv.includes("--scope=all") ? "all" : "interventional"; // default is the demo scope Kumar prefers: interventional studies only
const INT = SCOPE === "interventional";

if (process.argv.includes("--due")) {
  // Manual refresh check (no job needed): is CT.gov's dataTimestamp newer than the latest saved snapshot of this scope?
  const names = existsSync(DIR) ? readdirSync(DIR).filter((f) => f.startsWith("2026-") || /^\d{4}-/.test(f)).sort() : [];
  const snaps = names.map((f) => ({ f, s: JSON.parse(readFileSync(`${DIR}/${f}`, "utf8")) as Snapshot })).filter((x) => (x.s.scope_filter ?? "all") === SCOPE);
  const last = snaps.at(-1);
  const now = ((await (await fetch(`${BASE}/version`)).json()) as { dataTimestamp: string }).dataTimestamp;
  console.log(JSON.stringify({ scope: SCOPE, latest_snapshot: last?.f ?? null, snapshot_data_timestamp: last?.s.data_timestamp ?? null, ctgov_data_timestamp: now, new_refresh_since_snapshot: !!last && last.s.data_timestamp !== now }));
  process.exit(0);
}
if (process.argv.includes("--compare")) {
  const [a, b] = process.argv.slice(process.argv.indexOf("--compare") + 1);
  if (!a || !b) { console.error("usage: --compare <older.json> <newer.json>"); process.exit(2); }
  const s0 = JSON.parse(readFileSync(a, "utf8")) as Snapshot, s1 = JSON.parse(readFileSync(b, "utf8")) as Snapshot;
  console.log(JSON.stringify({ before: { taken_at: s0.taken_at, data_timestamp: s0.data_timestamp, note: s0.note }, after: { taken_at: s1.taken_at, data_timestamp: s1.data_timestamp } }));
  for (const p of Object.keys(s0.policies).filter((k) => k in s1.policies)) console.log(JSON.stringify(comparePolicy(s0, s1, p)));
  process.exit(0);
}

async function main() {
  const version = (await (await fetch(`${BASE}/version`)).json()) as { dataTimestamp: string };
  const sb = getSupabase();
  const { data: rc } = await sb.from("replay_cases").select("id,result").in("id", IDS);
  const { data: rows } = await sb.from("trial_criteria_cache").select("nct_id,source_version,parser_version,parsed");
  const have = new Map<string, Array<{ sv: string; pv: string; n: number }>>();
  for (const r of rows ?? []) have.set(r.nct_id, [...(have.get(r.nct_id) ?? []), { sv: r.source_version, pv: r.parser_version, n: Array.isArray(r.parsed) ? r.parsed.length : -1 }]);
  const profiles = IDS.map((id) => {
    const facts = ((rc ?? []).find((c) => c.id === id)?.result as { events?: Array<{ type: string; facts?: Array<{ key: string; state: string; value?: unknown }> }> } | undefined)?.events?.find((e) => e.type === "profile")?.facts ?? [];
    const age = Number(facts.find((f) => f.key === "age" && f.state === "known")?.value), sex = facts.find((f) => f.key === "sex" && f.state === "known")?.value;
    return { id, filter: { ...(Number.isFinite(age) ? { age } : {}), ...(sex ? { sex: String(sex) } : {}) } };
  });
  const prod = await discoverRecruitingBreastTrials({ base: BASE, maxPages: 2 }); // the exact production call, to prove the extended-field query keeps its order
  const policies: Record<string, SelectionRecord> = {};
  for (const [name, sort] of [["api-default", null], ["relevance", "@relevance"]] as const) {
    const win = await fetchWindow(BASE, sort, { interventionalOnly: INT });
    const trials = win.map((w) => w.trial);
    if (name === "api-default" && !INT) console.log(JSON.stringify({ check: "extended-field api-default order equals production discovery", equal: trials.length === prod.length && trials.every((t, i) => t.nct_id === prod[i]!.nct_id) }));
    const byId = new Map(win.map((w) => [w.trial.nct_id, w]));
    const filtered: Record<string, number> = {}, union = new Map<string, Trial>();
    for (const p of profiles) { const f = prefilterTrials(trials, p.filter); filtered[p.id] = f.length; for (const t of f.slice(0, N)) union.set(t.nct_id, t); }
    const scope: Record<ScopeClass, number> = { breast_specific: 0, breast_with_other: 0, no_breast_signal: 0 }, st: Record<string, number> = {};
    for (const id of union.keys()) { const w = byId.get(id)!; scope[w.scope]++; st[w.studyType] = (st[w.studyType] ?? 0) + 1; }
    let hit = 0, chunks = 0;
    for (const t of union.values()) {
      const n = splitTrialCriteria(t.nct_id, t.eligibility_text).length, k = cacheKeyFor(t.nct_id, t.last_update);
      const ex = (have.get(t.nct_id) ?? []).find((h) => h.sv === k.source_version && h.pv === k.parser_version);
      if (ex && ex.n === n) hit++; else chunks += Math.ceil(n / CHUNK);
    }
    policies[name] = { policy: name, order: trials.map((t) => t.nct_id), selected_union: [...union.keys()], filtered_by_profile: filtered, scope, study_type: st, cache: { hit, uncached: union.size - hit, chunks_to_parse: chunks } };
    const win120Scope: Record<ScopeClass, number> = { breast_specific: 0, breast_with_other: 0, no_breast_signal: 0 };
    for (const w of win) win120Scope[w.scope]++;
    console.log(JSON.stringify({ policy: name, window: trials.length, window_scope: win120Scope, filtered_by_profile: filtered, selected_union: union.size, selected_scope: scope, selected_study_type: st, cache: policies[name]!.cache }));
  }
  const snap: Snapshot = { taken_at: new Date().toISOString(), data_timestamp: version.dataTimestamp, scope_filter: SCOPE, policies };
  mkdirSync(DIR, { recursive: true });
  const file = `${DIR}/${snap.taken_at.replace(/[:.]/g, "-")}.json`;
  writeFileSync(file, JSON.stringify(snap));
  const cmp = comparePolicy(snap, snap, "api-default");
  void cmp;
  const a = policies["api-default"]!, r = policies["relevance"]!;
  const ov = (x: string[], y: string[]) => x.filter((i) => y.includes(i)).length;
  console.log(JSON.stringify({ scope: SCOPE, data_timestamp: snap.data_timestamp, file, same_snapshot_api_default_vs_relevance: { window_overlap: ov(a.order, r.order), selected_overlap: ov(a.selected_union, r.selected_union) } }));
}
main().catch((e: unknown) => { console.error("snapshot failed:", (e as Error)?.message?.slice(0, 80)); process.exit(1); });
