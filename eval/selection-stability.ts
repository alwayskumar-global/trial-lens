// READ-ONLY selection-stability investigation: compares the cache, the stored replays and live CT.gov records. Public GETs + Supabase SELECTs only; no model call, no write.
// Prints counts and public NCT ids only.   node --env-file=.env --import tsx eval/selection-stability.ts

import { createClient } from "@supabase/supabase-js";
import { discoverRecruitingBreastTrials } from "../src/lib/ctgov/client";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const base = "https://clinicaltrials.gov/api/v2";
const all = await discoverRecruitingBreastTrials({ base, maxPages: 2 });
const pos = new Map(all.map((t, i) => [t.nct_id, i]));
const { data: rc } = await sb.from("replay_cases").select("id,result");
const replayIds = new Set<string>();
const perReplay: Record<string, string[]> = {};
for (const r of rc!) { const ids = (r.result as { events: Array<{ type: string; assessment?: { nct_id: string } }> }).events.filter((e) => e.type === "trial_result").map((e) => e.assessment!.nct_id); perReplay[r.id] = ids; ids.forEach((i: string) => replayIds.add(i)); }
const { data: cr } = await sb.from("trial_criteria_cache").select("nct_id,source_version,created_at");
const cached = new Map(cr!.map((r) => [r.nct_id, r]));
const day6 = cr!.filter((r) => r.created_at.startsWith("2026-10-06")).map((r) => r.nct_id), day7 = cr!.filter((r) => r.created_at.startsWith("2026-10-07")).map((r) => r.nct_id);
const inNow = (ids: string[]) => ids.filter((i) => pos.has(i)).length;
console.log(JSON.stringify({ replay_union: replayIds.size, replay_union_in_today_120: inNow([...replayIds]), replay_per_profile_in_today_120: Object.fromEntries(Object.entries(perReplay).map(([k, v]) => [k, `${inNow(v)}/${v.length}`])), cache_10_06: day6.length, cache_10_06_in_replay_union: day6.filter((i) => replayIds.has(i)).length, cache_10_06_in_today_120: inNow(day6), cache_10_07: day7.length, cache_10_07_in_today_120: inNow(day7), cache_10_07_positions: day7.map((i) => pos.get(i) ?? null) }));
// current record of every cached trial
const fields = "NCTId,OverallStatus,LastUpdatePostDate,StatusVerifiedDate,Condition";
type Row = { id: string; http?: number; status?: string; upd?: string; verified?: string; cached_sv?: string; created?: string; inNow?: boolean; breast?: boolean };
const rows: Row[] = [];
for (const [id, row] of cached) {
  const res = await fetch(`${base}/studies/${id}?fields=${fields}&format=json`);
  if (!res.ok) { rows.push({ id, http: res.status }); continue; }
  const j = (await res.json()) as { protocolSection: { statusModule: { overallStatus: string; lastUpdatePostDateStruct?: { date: string }; statusVerifiedDate?: string }; conditionsModule?: { conditions?: string[] } } }; const p = j.protocolSection;
  rows.push({ id, status: p.statusModule.overallStatus, upd: p.statusModule.lastUpdatePostDateStruct?.date, verified: p.statusModule.statusVerifiedDate, cached_sv: row.source_version, created: row.created_at.slice(0, 10), inNow: pos.has(id), breast: JSON.stringify(p.conditionsModule?.conditions ?? []).toLowerCase().includes("breast") });
}
const t = (xs: string[]) => xs.reduce<Record<string, number>>((a, k) => ((a[k] = (a[k] ?? 0) + 1), a), {});
console.log(JSON.stringify({ n: rows.length, http_errors: rows.filter((r) => r.http).length, status_now: t(rows.flatMap((r) => (r.status ? [r.status] : []))), recruiting_but_not_in_120: rows.filter((r) => r.status === "RECRUITING" && !r.inNow).length, not_recruiting_now: rows.filter((r) => r.status && r.status !== "RECRUITING").length, source_version_unchanged: rows.filter((r) => r.upd === r.cached_sv).length, source_version_changed: rows.filter((r) => r.upd && r.upd !== r.cached_sv).length, breast_condition: rows.filter((r) => r.breast).length }));
console.log(JSON.stringify(rows.filter((r) => r.status === "RECRUITING" && !r.inNow).slice(0, 5).map((r) => ({ id: r.id, upd: r.upd, sv: r.cached_sv, created: r.created }))));
