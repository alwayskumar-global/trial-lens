// Pure comparison helpers for selection snapshots (no network, no database, no model).
import { classifyScope, type ScopeClass, type ScopeInput } from "../../src/lib/ctgov/scope";
export { classifyScope };
export type { ScopeClass, ScopeInput };

export interface SelectionRecord { policy: string; order: string[]; selected_union: string[]; filtered_by_profile?: Record<string, number>; scope?: Record<ScopeClass, number>; study_type?: Record<string, number>; cache?: { hit: number; uncached: number; chunks_to_parse: number } }
export interface Snapshot { taken_at: string; data_timestamp: string; note?: string; /** "all" (default when absent) or "interventional": snapshots with different scopes are never compared. */ scope_filter?: string; policies: Record<string, SelectionRecord> }

export const overlapCount = (a: readonly string[], b: readonly string[]): number => { const s = new Set(b); return a.filter((x) => s.has(x)).length; };
export const jaccard = (a: readonly string[], b: readonly string[]): number => { const u = new Set([...a, ...b]).size; return u === 0 ? 1 : overlapCount([...new Set(a)], b) / u; };
/** Fraction of positions where two ordered lists agree (rank stability, strict). */
export const samePosition = (a: readonly string[], b: readonly string[]): number => a.filter((x, i) => b[i] === x).length;

export interface PolicyComparison { policy: string; refresh_changed: boolean; selected: { before: number; after: number; kept: number; jaccard: number }; top120?: { kept: number; same_position: number } }

/** Compare one policy across two snapshots (typically on either side of a CT.gov data refresh). */
export function comparePolicy(before: Snapshot, after: Snapshot, policy: string): PolicyComparison {
  const a = before.policies[policy], b = after.policies[policy];
  if (!a || !b) throw new Error(`policy_missing:${policy}`);
  if ((before.scope_filter ?? "all") !== (after.scope_filter ?? "all")) throw new Error("scope_mismatch");
  return {
    policy,
    refresh_changed: before.data_timestamp !== after.data_timestamp,
    selected: { before: a.selected_union.length, after: b.selected_union.length, kept: overlapCount(a.selected_union, b.selected_union), jaccard: Number(jaccard(a.selected_union, b.selected_union).toFixed(3)) },
    ...(a.order.length && b.order.length ? { top120: { kept: overlapCount(a.order, b.order), same_position: samePosition(a.order, b.order) } } : {}),
  };
}
