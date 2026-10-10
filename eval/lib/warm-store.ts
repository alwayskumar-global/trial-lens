// Insert-only writer for trial_criteria_cache, over a minimal Supabase-like interface (a real client is bound by the not-yet-approved executor
// entry point; tests use a fake). The ONLY write it can issue is an upsert with ignoreDuplicates (INSERT ... ON CONFLICT DO NOTHING): it can never
// update or delete an existing row, and it re-checks the exact key just before writing.
import type { CacheKey } from "../../src/lib/cache/criteria-cache";
import type { ParseOutcome } from "../../src/lib/engine/reconcile";

export interface SelectQuery { eq(col: string, v: string): SelectQuery; maybeSingle(): PromiseLike<{ data: unknown; error: unknown }> }
export interface SupabaseLike {
  from(table: "trial_criteria_cache"): {
    select(cols: string): SelectQuery;
    upsert(row: Record<string, unknown>, opts: { onConflict: string; ignoreDuplicates: true }): PromiseLike<{ error: unknown }>;
  };
}
export interface CacheStore {
  exists(key: CacheKey): Promise<boolean>;
  insertIfAbsent(key: CacheKey, outcomes: readonly ParseOutcome[]): Promise<"inserted" | "exists">;
}

export class StoreError extends Error { constructor(readonly code: "STORE_SELECT" | "STORE_INSERT") { super(code); } }

export function makeInsertOnlyStore(sb: SupabaseLike): CacheStore {
  const exists = async (k: CacheKey): Promise<boolean> => {
    const { data, error } = await sb.from("trial_criteria_cache").select("nct_id").eq("nct_id", k.nct_id).eq("source_version", k.source_version).eq("parser_version", k.parser_version).maybeSingle();
    if (error) throw new StoreError("STORE_SELECT");
    return data !== null && data !== undefined;
  };
  return {
    exists,
    async insertIfAbsent(k, outcomes) {
      if (await exists(k)) return "exists";
      const { error } = await sb.from("trial_criteria_cache").upsert({ nct_id: k.nct_id, source_version: k.source_version, parser_version: k.parser_version, parsed: outcomes }, { onConflict: "nct_id,parser_version,source_version", ignoreDuplicates: true });
      if (error) throw new StoreError("STORE_INSERT");
      return "inserted";
    },
  };
}
