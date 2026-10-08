// Pure helpers for the PROPOSED demo-candidate selection policy "hash-ranked-v1" (nothing in production uses it yet).
// Idea: the pool is every currently RECRUITING breast-cancer study (ids only, a few requests); candidates are ranked by a salted SHA-256 of the
// NCT id, so rank does not depend on the API's undocumented default order, does not drift with new registrations, and changes only when a
// trial enters or leaves the pool. The age/sex prefilter then runs in rank order and the first N are taken.
import { createHash } from "node:crypto";

export const POLICY_ID = "hash-ranked-v1";
const SALT = "triallens-demo-candidates-v1";

export const rankKey = (nctId: string): string => createHash("sha256").update(`${SALT}|${nctId}`).digest("hex");

/** Pool ids ranked ascending by rankKey (ties impossible for distinct ids in practice; broken by id for total order). */
export const rankPool = (ids: readonly string[]): string[] => [...new Set(ids)].sort((a, b) => (rankKey(a) < rankKey(b) ? -1 : rankKey(a) > rankKey(b) ? 1 : a < b ? -1 : 1));

/** First `n` ranked ids that pass `keep` (the prefilter), scanning only the ranked prefix whose details were fetched. */
export function chooseInRankOrder<T extends { nct_id: string }>(rankedDetails: readonly T[], keep: (t: T) => boolean, n: number): T[] {
  return rankedDetails.filter(keep).slice(0, n);
}

/** How many of the previous selection survive in the new one (membership stability), as a fraction of the previous size. */
export const retained = (prev: readonly string[], next: readonly string[]): number => (prev.length === 0 ? 1 : prev.filter((x) => next.includes(x)).length / prev.length);
