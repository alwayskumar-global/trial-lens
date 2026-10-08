// Pure comparison helpers for selection snapshots (no network, no database, no model).
export type ScopeClass = "breast_specific" | "breast_with_other" | "no_breast_signal";

export interface ScopeInput { mesh: readonly string[]; ancestors: readonly string[]; conditions: readonly string[]; studyType: string | undefined }

const isBreastTerm = (t: string): boolean => /breast|mammary|\bTNBC\b|\bHER2\b/i.test(t);

/**
 * Scope of one study relative to the breast-cancer search. A "breast signal" is a breast MeSH term/ancestor OR a breast term in the free-text
 * condition list (new studies often have no MeSH mapping yet, so MeSH alone would call them out of scope).
 *  breast_specific   a breast signal and no non-breast MeSH condition term
 *  breast_with_other a breast signal AND at least one non-breast MeSH condition term (basket / pan-tumour / comorbidity)
 *  no_breast_signal  neither a breast MeSH term/ancestor nor a breast condition string (matched the query only through other free text)
 */
export function classifyScope(s: ScopeInput): ScopeClass {
  const signal = s.mesh.some(isBreastTerm) || s.ancestors.some((a) => /^Breast (Neoplasms|Diseases)$/i.test(a)) || s.conditions.some(isBreastTerm);
  if (!signal) return "no_breast_signal";
  return s.mesh.some((m) => !isBreastTerm(m)) ? "breast_with_other" : "breast_specific";
}

export interface SelectionRecord { policy: string; order: string[]; selected_union: string[]; filtered_by_profile?: Record<string, number>; scope?: Record<ScopeClass, number>; study_type?: Record<string, number>; cache?: { hit: number; uncached: number; chunks_to_parse: number } }
export interface Snapshot { taken_at: string; data_timestamp: string; note?: string; policies: Record<string, SelectionRecord> }

export const overlapCount = (a: readonly string[], b: readonly string[]): number => { const s = new Set(b); return a.filter((x) => s.has(x)).length; };
export const jaccard = (a: readonly string[], b: readonly string[]): number => { const u = new Set([...a, ...b]).size; return u === 0 ? 1 : overlapCount([...new Set(a)], b) / u; };
/** Fraction of positions where two ordered lists agree (rank stability, strict). */
export const samePosition = (a: readonly string[], b: readonly string[]): number => a.filter((x, i) => b[i] === x).length;

export interface PolicyComparison { policy: string; refresh_changed: boolean; selected: { before: number; after: number; kept: number; jaccard: number }; top120?: { kept: number; same_position: number } }

/** Compare one policy across two snapshots (typically on either side of a CT.gov data refresh). */
export function comparePolicy(before: Snapshot, after: Snapshot, policy: string): PolicyComparison {
  const a = before.policies[policy], b = after.policies[policy];
  if (!a || !b) throw new Error(`policy_missing:${policy}`);
  return {
    policy,
    refresh_changed: before.data_timestamp !== after.data_timestamp,
    selected: { before: a.selected_union.length, after: b.selected_union.length, kept: overlapCount(a.selected_union, b.selected_union), jaccard: Number(jaccard(a.selected_union, b.selected_union).toFixed(3)) },
    ...(a.order.length && b.order.length ? { top120: { kept: overlapCount(a.order, b.order), same_position: samePosition(a.order, b.order) } } : {}),
  };
}
