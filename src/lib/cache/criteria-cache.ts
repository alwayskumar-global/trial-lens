// Parsed-criteria cache keyed by (nct_id, source_version, parser_version). Trial criteria do not depend on the patient,
// so a parse is never repeated for a new patient. Stores public trial text parses only; never patient data.
// Reads are Zod-validated; any cache failure is a miss (the run continues and re-parses within budget).
import { z } from "zod";
import { COVERAGE_CHECK_VERSION } from "@/lib/engine/coverage";
import type { ParseOutcome } from "@/lib/engine/reconcile";
import { CLAUSE_PARSE_PROMPT_VERSION } from "@/prompts/clause-parse";
import { CategorySchema } from "@/schema/criteria";
import { ClauseNodeSchema } from "@/schema/clause";
import { getSupabase } from "@/lib/supabase";

/** Bump-by-construction: any parser prompt or coverage-check version change invalidates every cached parse. */
export const PARSER_VERSION = `${CLAUSE_PARSE_PROMPT_VERSION}+${COVERAGE_CHECK_VERSION}`;

export interface CacheKey {
  nct_id: string;
  source_version: string; // CT.gov last-update date ("unknown" when absent)
  parser_version: string;
}
export const cacheKeyFor = (nct_id: string, lastUpdate: string | null): CacheKey => ({ nct_id, source_version: lastUpdate ?? "unknown", parser_version: PARSER_VERSION });
const keyStr = (k: CacheKey) => `${k.nct_id}|${k.source_version}|${k.parser_version}`;

export interface CriteriaCache {
  get(key: CacheKey): Promise<ParseOutcome[] | null>;
  set(key: CacheKey, outcomes: ParseOutcome[]): Promise<void>;
}

const OutcomeSchema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("parsed"),
    category: CategorySchema,
    scoring: z.boolean(),
    clause: ClauseNodeSchema,
    completeness: z.enum(["full", "partial"]),
    vet: z.enum(["ok", "atoms_downgraded", "coverage_failed", "when_on_exclusion"]),
  }),
  z.object({ state: z.literal("unresolved"), reason: z.enum(["batch_rejected", "missing", "not_attempted"]) }),
]);
export const OutcomesSchema = z.array(OutcomeSchema);

/** Only fully parsed trials are cached: an unresolved criterion must be retried, not remembered. */
export const isCacheable = (o: readonly ParseOutcome[]): boolean => o.length > 0 && o.every((x) => x.state === "parsed");

export class MemoryCriteriaCache implements CriteriaCache {
  private m = new Map<string, ParseOutcome[]>();
  async get(k: CacheKey) {
    return this.m.get(keyStr(k)) ?? null;
  }
  async set(k: CacheKey, v: ParseOutcome[]) {
    if (isCacheable(v)) this.m.set(keyStr(k), v);
  }
}

export class SupabaseCriteriaCache implements CriteriaCache {
  async get(k: CacheKey): Promise<ParseOutcome[] | null> {
    try {
      const { data, error } = await getSupabase().from("trial_criteria_cache").select("parsed").eq("nct_id", k.nct_id).eq("source_version", k.source_version).eq("parser_version", k.parser_version).maybeSingle();
      if (error || !data) return null;
      const parsed = OutcomesSchema.safeParse(data.parsed);
      return parsed.success ? (parsed.data as ParseOutcome[]) : null;
    } catch {
      return null;
    }
  }
  async set(k: CacheKey, v: ParseOutcome[]): Promise<void> {
    if (!isCacheable(v)) return;
    try {
      await getSupabase().from("trial_criteria_cache").upsert({ ...k, parsed: v }, { onConflict: "nct_id,parser_version,source_version" });
    } catch {
      /* cache write failure is never fatal */
    }
  }
}

/**
 * Read-only view of the Supabase cache: `get` reads, `set` is a no-op. Holds no memory layer, so nothing from a run is retained either.
 * Used when CRITERIA_CACHE_WRITES=false; the only write path (`SupabaseCriteriaCache.set`) is unreachable through this class.
 */
export class ReadOnlyCriteriaCache implements CriteriaCache {
  constructor(private readonly source: Pick<CriteriaCache, "get">) {}
  get(k: CacheKey) {
    return this.source.get(k);
  }
  async set(): Promise<void> {
    /* intentionally nothing */
  }
}

/** Read-through: memory first, then Supabase; writes go to both. */
export class LayeredCriteriaCache implements CriteriaCache {
  constructor(private readonly layers: readonly CriteriaCache[]) {}
  async get(k: CacheKey) {
    for (let i = 0; i < this.layers.length; i++) {
      const hit = await this.layers[i]!.get(k);
      if (hit) {
        await Promise.all(this.layers.slice(0, i).map((l) => l.set(k, hit)));
        return hit;
      }
    }
    return null;
  }
  async set(k: CacheKey, v: ParseOutcome[]) {
    await Promise.all(this.layers.map((l) => l.set(k, v)));
  }
}
