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

// ---- "Typed" = fully executable in code (Phase 1 definition) --------------------------
import { VOCABULARY } from "../../src/schema/vocabulary";
import type { LlmCriterion } from "../../src/schema/criteria";

const NUM_OPS = new Set(["gte", "lte", "gt", "lt", "eq", "neq"]);
const SET_OPS = new Set(["eq", "neq", "in", "not_in"]);
const norm = (u: string) => u.toLowerCase().replace(/\s+/g, "").replace(/×/g, "x").replace(/µ/g, "u").replace(/\^/g, "");
// Units the (Phase 2) code normaliser could convert to the canonical unit. null unit => not evaluable
// for these keys (SCHEMA.md §3). Indexed creatinine clearance (/1.73m2) is deliberately NOT accepted.
const UNIT_OK: Record<string, (u: string) => boolean> = {
  anc: (u) => /^(\/mm3|\/ul|cells\/mm3|cells\/ul|10[39]\/l|x10[39]\/l|k\/ul|10e9\/l|x10e9\/l|10[39]\/ul)$/.test(u),
  platelets: (u) => /^(\/mm3|\/ul|cells\/mm3|cells\/ul|10[39]\/l|x10[39]\/l|k\/ul|10e9\/l|x10e9\/l|10[39]\/ul)$/.test(u),
  hemoglobin: (u) => /^(g\/dl|g\/l|mmol\/l)$/.test(u),
  bilirubin_x_uln: (u) => /uln/.test(u),
  ast_alt_x_uln: (u) => /uln/.test(u),
  lvef_percent: (u) => u === "%" || u === "percent",
  creatinine_clearance: (u) => u === "ml/min",
  days_since_last_systemic_therapy: (u) => /^(day|days|week|weeks|month|months)$/.test(u),
  age: (u) => /^(year|years|yrs|y)$/.test(u),
};

export function evaluabilityProblems(c: LlmCriterion): string[] {
  if (c.fact_key === null) return ["no_fact_key"];
  const v = VOCABULARY.find((e) => e.key === c.fact_key);
  if (!v) return ["unknown_key"];
  const p: string[] = [];
  const vals = Array.isArray(c.value) ? c.value : [c.value];
  if (v.type === "number") {
    if (!c.operator || !NUM_OPS.has(c.operator)) p.push("bad_operator_for_number");
    if (typeof c.value !== "number" || !Number.isFinite(c.value)) p.push("value_not_number");
    const need = UNIT_OK[c.fact_key];
    if (need && !(c.unit && need(norm(c.unit)))) p.push("unit_missing_or_unconvertible");
  } else if (v.type === "bool") {
    if (!c.operator || !["eq", "neq"].includes(c.operator)) p.push("bad_operator_for_bool");
    if (typeof c.value !== "boolean") p.push("value_not_bool");
  } else {
    if (!c.operator || !SET_OPS.has(c.operator)) p.push("bad_operator_for_enum");
    const allowed = "values" in v ? (v.values as readonly string[]) : [];
    if (!vals.every((x) => typeof x === "string" && allowed.includes(x))) p.push("enum_value_not_in_vocab");
    if ((c.operator === "in" || c.operator === "not_in") !== Array.isArray(c.value)) p.push("in_requires_array");
  }
  return p;
}

// Splitting helper reused by v2 scripts (same regex split as 04; fixed cohort).
export function cohortCriteria(trials: Trial[]): SplitCriterion[] {
  return trials.flatMap(splitCriteria);
}
