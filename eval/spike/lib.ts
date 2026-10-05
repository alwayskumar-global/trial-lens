// Shared helpers for spike scripts. No secrets, no response bodies in output.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { z } from "zod";

export const RESULTS_PATH = fileURLToPath(new URL("../../docs/spike-results.md", import.meta.url));
export const FIXTURE_PATH = fileURLToPath(new URL("./fixtures/ctgov-breast.json", import.meta.url));

export function appendResults(md: string): void {
  if (!existsSync(RESULTS_PATH)) writeFileSync(RESULTS_PATH, "# Spike results\n");
  appendFileSync(RESULTS_PATH, md);
}

export function saveJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2));
}

export function loadFixture(): Trial[] {
  if (!existsSync(FIXTURE_PATH)) throw new Error("fixture missing: run `pnpm spike:ctgov` first");
  return z.array(TrialSchema).parse(JSON.parse(readFileSync(FIXTURE_PATH, "utf8")));
}

export function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Math.round(sorted[Math.max(0, i)]!);
}

// Normalised trial as stored in the fixture (derived from CT.gov v2 response).
export const TrialSchema = z.object({
  nct_id: z.string(),
  title: z.string(),
  eligibility_text: z.string(),
  min_age: z.string().nullable(),
  max_age: z.string().nullable(),
  sex: z.string().nullable(),
  last_update: z.string().nullable(),
  sites: z.object({ total: z.number(), recruiting: z.number(), with_geo: z.number() }),
});
export type Trial = z.infer<typeof TrialSchema>;

export interface SplitCriterion {
  id: string; // `${nct}:${inclusion|exclusion}:${index}`
  nct_id: string;
  type: "inclusion" | "exclusion";
  text: string;
}

// Splits CT.gov free-text eligibility into bullet-level criteria. Heuristic; the
// split quality itself is part of what the spike measures (see 04-coverage).
export function splitCriteria(t: Trial): SplitCriterion[] {
  const text = t.eligibility_text.replace(/\r/g, "");
  const exIdx = text.search(/exclusion criteria\s*:?/i);
  const incPart = exIdx >= 0 ? text.slice(0, exIdx) : text;
  const excPart = exIdx >= 0 ? text.slice(exIdx) : "";
  const out: SplitCriterion[] = [];
  for (const [type, part] of [
    ["inclusion", incPart],
    ["exclusion", excPart],
  ] as const) {
    const items = part
      .split(/\n\s*(?:[*\-•]|\d+[.)])\s+/)
      .map((s) => s.replace(/\s+/g, " ").trim())
      .filter((s) => s.length >= 15 && !/^(inclusion|exclusion) criteria:?$/i.test(s));
    items.forEach((text2, i) => out.push({ id: `${t.nct_id}:${type}:${i}`, nct_id: t.nct_id, type, text: text2 }));
  }
  return out;
}

// Rough "compound" heuristic for stratification only.
export function isCompound(text: string): boolean {
  return /\b(and\/or|or|and)\b.*\b(or|and)\b|;|\bunless\b|\bexcept\b|\bwithin\b.*\b(or|and)\b/i.test(text) || text.length > 220;
}

// Deterministic seeded shuffle (mulberry32) so the sample is reproducible.
export function seededShuffle<T>(arr: T[], seed: number): T[] {
  const a = [...arr];
  let s = seed >>> 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** 50 distinct criteria: 25 inclusion / 25 exclusion; each split 13 simple + 12 compound (inc) / 12+13 (exc);
 *  at most 2 per trial so the sample is spread across trials. Deterministic. */
export function stratifiedSample(all: SplitCriterion[], seed = 20261005): { sample: SplitCriterion[]; strata: Record<string, number>; trials: number } {
  const shuffled = seededShuffle(all, seed);
  const perTrial = new Map<string, number>();
  const picked: SplitCriterion[] = [];
  const want: Record<string, number> = {
    "inclusion/simple": 13, "inclusion/compound": 12, "exclusion/simple": 12, "exclusion/compound": 13,
  };
  const got: Record<string, number> = { "inclusion/simple": 0, "inclusion/compound": 0, "exclusion/simple": 0, "exclusion/compound": 0 };
  const seen = new Set<string>();
  for (const c of shuffled) {
    const key = `${c.type}/${isCompound(c.text) ? "compound" : "simple"}`;
    if (got[key]! >= want[key]! || (perTrial.get(c.nct_id) ?? 0) >= 2 || seen.has(c.text)) continue;
    got[key]!++;
    seen.add(c.text);
    perTrial.set(c.nct_id, (perTrial.get(c.nct_id) ?? 0) + 1);
    picked.push(c);
  }
  return { sample: picked, strata: got, trials: perTrial.size };
}
