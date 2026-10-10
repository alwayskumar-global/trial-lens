// The warm-up PLAN, computed from the SAME selection code the live route uses (src/lib/ctgov/selection.ts): discoverBySelectionMode for the window and
// selectFromDiscovered for the per-profile age/sex prefilter and cap. The dry-run planner and the (disabled) executor both call planWarm, so the
// fingerprint a human approves is the fingerprint the executor recomputes. No network of its own beyond the injected `discover`; no database.
import { cacheKeyFor, PARSER_VERSION } from "../../src/lib/cache/criteria-cache";
import type { Trial } from "../../src/lib/ctgov/client";
import type { SelectionMode } from "../../src/lib/ctgov/modes";
import { discoverBySelectionMode, selectFromDiscovered } from "../../src/lib/ctgov/selection";
import { splitTrialCriteria } from "../../src/lib/ctgov/split";
import type { WarmTrial } from "./warm-executor";
import { planFingerprint, type PlannedTrial } from "./warm-guard";

export const CHUNK_SIZE = 15;
export const MAX_CANDIDATES = 30; // MAX_CANDIDATE_TRIALS default

export interface ProfileFilter { id: string; filter: { age?: number; sex?: string } }
export type CachedRows = Map<string, Array<{ sv: string; pv: string; n: number }>>;
export type CacheStatus = "hit" | "length_mismatch" | "stale_source" | "stale_parser" | "missing";

export const policyLabelOf = (mode: SelectionMode): string => (mode === "relevance-v1-interventional" ? "relevance-v1:interventional" : "api-default:all");

export function cacheStatus(t: Trial, cached: CachedRows, parserVersion: string = PARSER_VERSION): CacheStatus {
  const n = splitTrialCriteria(t.nct_id, t.eligibility_text).length, k = cacheKeyFor(t.nct_id, t.last_update), have = cached.get(t.nct_id) ?? [];
  const exact = have.find((h) => h.sv === k.source_version && h.pv === parserVersion);
  return exact ? (exact.n === n ? "hit" : "length_mismatch") : have.some((h) => h.pv === parserVersion) ? "stale_source" : have.length ? "stale_parser" : "missing";
}

export interface WarmPlan {
  mode: SelectionMode; policyLabel: string; discovered: number;
  perProfile: Array<{ id: string; discovered: number; filtered: number; selected: number }>;
  selected: Trial[]; hits: number; warm: WarmTrial[]; planned: PlannedTrial[]; chunks: number; fingerprint: string;
}

export async function planWarm(o: {
  mode: SelectionMode; base: string; profiles: readonly ProfileFilter[]; cached: CachedRows; max?: number;
  discover?: (mode: SelectionMode, base: string) => Promise<Trial[]>; parserVersion?: string;
}): Promise<WarmPlan> {
  const parserVersion = o.parserVersion ?? PARSER_VERSION, max = o.max ?? MAX_CANDIDATES;
  const all = await (o.discover ?? ((m, base) => discoverBySelectionMode(m, { base, maxPages: 2 })))(o.mode, o.base); // throws CtgovError: fail closed, no fallback
  const union = new Map<string, Trial>();
  const perProfile = o.profiles.map((p) => {
    const r = selectFromDiscovered(all, p.filter, max);
    for (const t of r.candidates) union.set(t.nct_id, t);
    return { id: p.id, discovered: r.discovered, filtered: r.filtered, selected: r.candidates.length };
  });
  const selected = [...union.values()].sort((a, b) => a.nct_id.localeCompare(b.nct_id));
  const todo = selected.filter((t) => cacheStatus(t, o.cached, parserVersion) !== "hit");
  const warm: WarmTrial[] = todo.map((t) => ({ nct_id: t.nct_id, last_update: t.last_update, sources: splitTrialCriteria(t.nct_id, t.eligibility_text) }));
  const planned: PlannedTrial[] = warm.map((w) => ({ nct_id: w.nct_id, source_version: cacheKeyFor(w.nct_id, w.last_update).source_version, criteria: w.sources.length, chunks: Math.ceil(w.sources.length / CHUNK_SIZE) }));
  const policyLabel = policyLabelOf(o.mode);
  return { mode: o.mode, policyLabel, discovered: all.length, perProfile, selected, hits: selected.length - todo.length, warm, planned, chunks: planned.reduce((a, t) => a + t.chunks, 0), fingerprint: planFingerprint(parserVersion, policyLabel, planned) };
}
