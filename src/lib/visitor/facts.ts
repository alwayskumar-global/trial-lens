// Editable fact model for the Confirm screen. Pure: no React, no network. Labels are plain-language; values are validated against the
// vocabulary exactly as the server's FactSchema does (known needs a value of the right type), so a profile that passes here passes there.
import { z } from "zod";
import { FACT_KEYS, FactKeySchema, VOCABULARY, type FactKey } from "@/schema/vocabulary";
import { FactStateSchema, type FactState } from "@/schema/profile";

export type FactValue = string | number | boolean;
export interface FactDraft { key: FactKey; state: FactState; value?: FactValue }
export type Drafts = Record<FactKey, FactDraft>;

export const FACT_LABEL: Record<FactKey, string> = {
  age: "Age", sex: "Sex", stage: "Cancer stage", disease_setting: "Disease setting", ecog: "Daily activity level (ECOG)",
  pregnant: "Pregnant", lactating: "Breastfeeding", lvef_percent: "Heart pumping strength (LVEF)", anc: "Neutrophil count (ANC)",
  platelets: "Platelet count", hemoglobin: "Hemoglobin", creatinine_clearance: "Kidney function (creatinine clearance)",
  bilirubin_x_uln: "Bilirubin (× upper limit of normal)", ast_alt_x_uln: "Liver enzymes AST/ALT (× upper limit of normal)",
  cardiac_disease: "Heart disease", prior_other_malignancy: "Another cancer before", neuropathy_grade: "Nerve damage (neuropathy) grade",
  cns_mets: "Cancer in the brain or spinal cord", measurable_disease: "Measurable disease", her2_status: "HER2 status",
  er_status: "Estrogen receptor (ER) status", pr_status: "Progesterone receptor (PR) status", brca_germline: "BRCA gene change (inherited)",
  pik3ca_mutation: "PIK3CA mutation", menopausal_status: "Menopausal status", metastatic_line: "Treatment line for spread disease",
  prior_anthracycline: "Had an anthracycline drug", prior_taxane: "Had a taxane drug", prior_trastuzumab: "Had trastuzumab",
  prior_adc: "Had an antibody-drug conjugate", prior_cdk46i: "Had a CDK4/6 inhibitor", prior_endocrine: "Had hormone therapy",
  prior_chemo_any: "Had any chemotherapy", prior_radiation: "Had radiation", days_since_last_systemic_therapy: "Days since last drug treatment",
};

const ENUM_LABEL: Partial<Record<string, string>> = {
  female: "Female", male: "Male", other: "Other", early: "Early", locally_advanced: "Locally advanced", metastatic: "Metastatic (spread)",
  none: "None", history: "In the past", active: "Active now", treated_stable: "Treated and stable", positive: "Positive", negative: "Negative",
  low: "Low", pre: "Before menopause", peri: "Around menopause", post: "After menopause",
};

const entry = (k: FactKey) => VOCABULARY.find((e) => e.key === k)!;
export const factType = (k: FactKey): "number" | "enum" | "bool" => entry(k).type;
export const factUnit = (k: FactKey): string | undefined => (entry(k) as { unit?: string }).unit;
export const enumOptions = (k: FactKey): Array<{ value: string; label: string }> => {
  const e = entry(k) as { values?: readonly string[] };
  return (e.values ?? []).map((v) => ({ value: v, label: ENUM_LABEL[v] ?? v }));
};

/** Human-readable value for a fact (a chip or a read-only line). */
export function valueLabel(k: FactKey, v: FactValue | undefined): string {
  if (v === undefined) return "";
  const t = factType(k);
  if (t === "bool") return v === true ? "Yes" : v === false ? "No" : String(v);
  if (t === "enum") return ENUM_LABEL[String(v)] ?? String(v);
  const u = factUnit(k);
  return u ? `${v} ${u}` : String(v);
}

const RANGE: Partial<Record<FactKey, [number, number]>> = { age: [0, 120], lvef_percent: [0, 100], metastatic_line: [0, 20], days_since_last_systemic_therapy: [0, 36500] };
const DEFAULT_RANGE: [number, number] = [0, 100000];

export function emptyDrafts(): Drafts {
  return Object.fromEntries(FACT_KEYS.map((k) => [k, { key: k, state: "unknown" as FactState }])) as Drafts;
}

const ExtractResponse = z.object({
  profile: z.object({ facts: z.partialRecord(FactKeySchema, z.object({ key: FactKeySchema, state: FactStateSchema, value: z.union([z.number(), z.string(), z.boolean()]).optional() })) }),
  extract_token: z.string().min(1).max(8192),
});
/** Validates /api/extract's JSON body into drafts + token. null = malformed (never rendered). */
export function parseExtractResponse(json: unknown): { drafts: Drafts; token: string } | null {
  const p = ExtractResponse.safeParse(json);
  if (!p.success) return null;
  const drafts = emptyDrafts();
  for (const k of FACT_KEYS) {
    const f = p.data.profile.facts[k];
    if (f && f.state !== "unknown" && f.value !== undefined) drafts[k] = { key: k, state: f.state, value: f.value };
  }
  return { drafts, token: p.data.extract_token };
}

export const clone = (d: Drafts): Drafts => Object.fromEntries(FACT_KEYS.map((k) => [k, { ...d[k] }])) as Drafts;

/** Remove a detail: it becomes unknown and carries no value. */
export function remove(d: Drafts, k: FactKey): Drafts {
  return { ...d, [k]: { key: k, state: "unknown" } };
}
/** Add a detail we missed: known with no value yet (invalid until the visitor enters one). */
export function add(d: Drafts, k: FactKey): Drafts {
  return { ...d, [k]: { key: k, state: "known" } };
}
export function setSure(d: Drafts, k: FactKey, sure: boolean): Drafts {
  const cur = d[k];
  if (cur.state === "unknown") return d;
  return { ...d, [k]: { ...cur, state: sure ? "known" : "uncertain" } };
}
/** `raw` comes from an input/select. "" clears the value. */
export function setValue(d: Drafts, k: FactKey, raw: string): Drafts {
  const cur = d[k];
  if (cur.state === "unknown") return d;
  const next: FactDraft = { key: k, state: cur.state };
  if (raw !== "") {
    const t = factType(k);
    next.value = t === "number" ? Number(raw) : t === "bool" ? raw === "true" : raw;
    if (t === "number" && Number.isNaN(next.value)) next.value = raw; // kept so validate() can say "enter a number"
  }
  return { ...d, [k]: next };
}

/** Error text per key; an empty object means the profile can be submitted. Known needs a valid value; uncertain may be empty but not invalid. */
export function validate(d: Drafts, messages: { needValue: string; badNumber: string; outOfRange: string }): Partial<Record<FactKey, string>> {
  const out: Partial<Record<FactKey, string>> = {};
  for (const k of FACT_KEYS) {
    const f = d[k];
    if (f.state === "unknown") continue;
    const t = factType(k);
    const v = f.value;
    if (v === undefined) { if (f.state === "known") out[k] = messages.needValue; continue; }
    if (t === "number") {
      if (typeof v !== "number" || !Number.isFinite(v)) out[k] = messages.badNumber;
      else { const [lo, hi] = RANGE[k] ?? DEFAULT_RANGE; if (v < lo || v > hi) out[k] = messages.outOfRange; }
    } else if (t === "bool") { if (typeof v !== "boolean") out[k] = messages.needValue; }
    else if (typeof v !== "string" || !enumOptions(k).some((o) => o.value === v)) out[k] = messages.needValue;
  }
  return out;
}

/** The body's `profile`: exhaustive over the vocabulary, unknown facts carry no value. Mirrors the server's strict client shape. */
export function toRunProfile(d: Drafts): { facts: Record<FactKey, { key: FactKey; state: FactState; value?: FactValue }> } {
  return { facts: Object.fromEntries(FACT_KEYS.map((k) => { const f = d[k]; return [k, f.state === "unknown" || f.value === undefined ? { key: k, state: f.state === "unknown" ? "unknown" : f.state } : { key: k, state: f.state, value: f.value }]; })) as never };
}

export const countProvided = (d: Drafts): number => FACT_KEYS.filter((k) => d[k].state !== "unknown").length;
export const keysWhere = (d: Drafts, pred: (f: FactDraft) => boolean): FactKey[] => FACT_KEYS.filter((k) => pred(d[k]));
