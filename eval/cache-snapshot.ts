// Read-only evidence for "no cache writes": prints row counts and SHA-256 hashes only (never keys, payloads or secrets).
//   trial_criteria_cache: hash over rows sorted by (nct_id, source_version, parser_version), each as key + canonical JSON of `parsed`
//   replay_cases:         hash over rows sorted by id, each as id + canonical JSON of `result`
// Unlike a count or max(created_at), the hash changes if an existing row is overwritten with different content. An upsert that rewrites
// identical content is invisible to any snapshot, so this corroborates the code path and tests; it does not replace them.
// Usage: node --env-file=.env --import tsx eval/cache-snapshot.ts      (only SELECTs are issued)
import { createHash } from "node:crypto";
import { getSupabase } from "../src/lib/supabase";

const canon = (v: unknown): string => (v === null || typeof v !== "object" ? JSON.stringify(v) : Array.isArray(v) ? `[${v.map(canon).join(",")}]` : `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`).join(",")}}`);

async function all(table: string, cols: string, order: string[]): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 500) {
    let q = getSupabase().from(table).select(cols);
    for (const o of order) q = q.order(o, { ascending: true });
    const { data, error } = await q.range(from, from + 499);
    if (error) throw new Error(`select_failed:${table}`);
    rows.push(...((data ?? []) as unknown as Record<string, unknown>[]));
    if (!data || data.length < 500) return rows;
  }
}
const digest = (parts: string[]) => createHash("sha256").update(parts.join("\n")).digest("hex");

async function main() {
  const cache = await all("trial_criteria_cache", "nct_id,source_version,parser_version,parsed", ["nct_id", "source_version", "parser_version"]);
  const replay = await all("replay_cases", "id,result", ["id"]);
  const c = digest(cache.map((r) => `${r.nct_id}|${r.source_version}|${r.parser_version}|${canon(r.parsed)}`));
  const r = digest(replay.map((x) => `${x.id}|${canon(x.result)}`));
  console.log(JSON.stringify({ trial_criteria_cache: { rows: cache.length, sha256: c }, replay_cases: { rows: replay.length, sha256: r } }));
}
main().catch((e: unknown) => { console.error("snapshot failed:", (e as Error)?.message?.slice(0, 80)); process.exit(1); });
