// Pure clause engine: build tree from parser output, classify completeness, evaluate in code.
// No LLM, no I/O. Unit conversion is code-only (CLAUDE.md rule 4).
import type { Operator, Status } from "@/schema/criteria";
import type {
  AtomNode,
  ClauseNode,
  LeafNode,
  LlmClauseCriterion,
  LlmLeaf,
  ParseCompleteness,
} from "@/schema/clause";
import type { PatientProfile } from "@/schema/profile";
import { VOCABULARY, type FactKey } from "@/schema/vocabulary";
import { atomSemanticProblems } from "./atom-checks";

export type Tri = "true" | "false" | "unknown";

// ---- Build ---------------------------------------------------------------------------------
export function leafToNode(l: LlmLeaf): LeafNode {
  if (l.kind === "atom" && l.fact_key !== null && l.operator !== null && l.value !== null) {
    return { kind: "atom", source: l.source, fact_key: l.fact_key, operator: l.operator, value: l.value, unit: l.unit };
  }
  if (l.kind === "timing" && l.relation !== null && l.amount !== null && l.time_unit !== null) {
    return { kind: "timing", source: l.source, relation: l.relation, amount: l.amount, time_unit: l.time_unit, depends_on: l.depends_on };
  }
  // Text leaf, or an atom/timing leaf missing required fields: downgraded to the free-text path.
  const dep = new Set(l.depends_on);
  if (l.fact_key !== null) dep.add(l.fact_key);
  return { kind: "text", source: l.source, depends_on: [...dep] };
}

export function toClauseTree(c: Pick<LlmClauseCriterion, "combine" | "items" | "except">): ClauseNode {
  const items = c.items.map(leafToNode);
  const base: ClauseNode = items.length === 1 ? items[0]! : { kind: c.combine, children: items };
  return c.except.length > 0 ? { kind: "except", base, exceptions: c.except.map(leafToNode) } : base;
}

export function leaves(n: ClauseNode): LeafNode[] {
  switch (n.kind) {
    case "atom":
    case "text":
    case "timing":
      return [n];
    case "all":
    case "any":
      return n.children.flatMap(leaves);
    case "except":
      return [...leaves(n.base), ...n.exceptions.flatMap(leaves)];
  }
}

export function dependsOn(n: ClauseNode): FactKey[] {
  const keys = new Set<FactKey>();
  for (const l of leaves(n)) {
    if (l.kind === "atom") keys.add(l.fact_key);
    else l.depends_on.forEach((k) => keys.add(k));
  }
  return [...keys];
}

// ---- Executability + unit canonicalisation ---------------------------------------------------
const NUM_OPS = new Set<Operator>(["gte", "lte", "gt", "lt", "eq", "neq"]);
const SET_OPS = new Set<Operator>(["eq", "neq", "in", "not_in"]);
const normUnit = (u: string) => u.toLowerCase().replace(/\s+/g, "").replace(/×/g, "x").replace(/µ/g, "u").replace(/\^/g, "");

// factor to canonical, or null if the unit is not convertible for that key.
// Indexed creatinine clearance (/1.73m2) is deliberately NOT accepted (needs BSA; not equivalent).
// Keys whose canonical value needs no unit conversion (counts, lines). A missing unit is fine for these.
const UNITLESS = new Set<FactKey>(["metastatic_line"]);
function unitFactor(key: FactKey, unit: string | null): number | null {
  if (UNITLESS.has(key)) return 1; // REGRESSION: null unit used to yield factor null ⇒ criterion value × 0 ⇒ false code FAIL
  if (unit === null) return null;
  const u = normUnit(unit);
  switch (key) {
    case "anc":
    case "platelets":
      if (/^(\/mm3|\/ul|cells\/mm3|cells\/ul)$/.test(u)) return 1 / 1000; // per mm3 → x10^9/L
      if (/^(10[39]\/l|x10[39]\/l|10e9\/l|x10e9\/l|k\/ul|10[39]\/ul|x10[39]\/ul)$/.test(u)) return 1;
      return null;
    case "hemoglobin":
      if (u === "g/dl") return 1;
      if (u === "g/l") return 1 / 10;
      if (u === "mmol/l") return 1.61; // VERIFY: mmol/L→g/dL factor before shipping
      return null;
    case "bilirubin_x_uln":
    case "ast_alt_x_uln":
      return /uln/.test(u) ? 1 : null; // absolute values (mg/dL, U/L) are NOT convertible without ULN
    case "lvef_percent":
      return u === "%" || u === "percent" ? 1 : null;
    case "creatinine_clearance":
      return u === "ml/min" ? 1 : null;
    case "days_since_last_systemic_therapy":
      if (/^days?$/.test(u)) return 1;
      if (/^weeks?$/.test(u)) return 7;
      if (/^months?$/.test(u)) return 30; // VERIFY: month≈30 d approximation; prefer days from the source
      return null;
    case "age":
      return /^(years?|yrs?|y)$/.test(u) ? 1 : null;
    default:
      return 1; // no unit conversion needed (counts, grades, lines)
  }
}

export function atomProblems(a: AtomNode): string[] {
  const v = VOCABULARY.find((e) => e.key === a.fact_key);
  if (!v) return ["unknown_key"];
  const p: string[] = [];
  const vals = Array.isArray(a.value) ? a.value : [a.value];
  if (v.type === "number") {
    if (!NUM_OPS.has(a.operator)) p.push("bad_operator_for_number");
    if (typeof a.value !== "number" || !Number.isFinite(a.value)) p.push("value_not_number");
    if (unitFactor(a.fact_key, a.unit) === null) p.push("unit_missing_or_unconvertible");
  } else if (v.type === "bool") {
    if (a.operator !== "eq" && a.operator !== "neq") p.push("bad_operator_for_bool");
    if (typeof a.value !== "boolean") p.push("value_not_bool");
  } else {
    if (!SET_OPS.has(a.operator)) p.push("bad_operator_for_enum");
    const allowed = "values" in v ? (v.values as readonly string[]) : [];
    if (!vals.every((x) => typeof x === "string" && allowed.includes(x))) p.push("enum_value_not_in_vocab");
    if ((a.operator === "in" || a.operator === "not_in") !== Array.isArray(a.value)) p.push("in_requires_array");
  }
  p.push(...atomSemanticProblems(a));
  return p;
}

/** full: every leaf is an executable atom. partial: has text/timing leaf or a non-executable atom. unresolved: null. */
export function classifyCompleteness(n: ClauseNode | null): ParseCompleteness {
  if (n === null) return "unresolved";
  return leaves(n).every((l) => l.kind === "atom" && atomProblems(l).length === 0) ? "full" : "partial";
}

// ---- Evaluation (Kleene three-valued) ----------------------------------------------------------
const tri = (b: boolean): Tri => (b ? "true" : "false");
const not = (t: Tri): Tri => (t === "true" ? "false" : t === "false" ? "true" : "unknown");
function and(ts: Tri[]): Tri {
  if (ts.includes("false")) return "false";
  return ts.every((t) => t === "true") ? "true" : "unknown";
}
function or(ts: Tri[]): Tri {
  if (ts.includes("true")) return "true";
  return ts.every((t) => t === "false") ? "false" : "unknown";
}

function evalAtom(a: AtomNode, profile: PatientProfile, evidence: Set<FactKey>): Tri {
  if (atomProblems(a).length > 0) return "unknown";
  const fact = profile.facts[a.fact_key];
  if (!fact || fact.state !== "known" || fact.value === undefined) return "unknown";
  const entry = VOCABULARY.find((e) => e.key === a.fact_key)!;
  let result: Tri;
  if (entry.type === "number") {
    const f = unitFactor(a.fact_key, a.unit)!;
    const crit = (a.value as number) * f; // criterion value → canonical unit
    const x = fact.value;
    if (typeof x !== "number") return "unknown";
    result =
      a.operator === "gte" ? tri(x >= crit)
      : a.operator === "lte" ? tri(x <= crit)
      : a.operator === "gt" ? tri(x > crit)
      : a.operator === "lt" ? tri(x < crit)
      : a.operator === "eq" ? tri(x === crit)
      : tri(x !== crit);
  } else {
    const x = fact.value;
    const inSet = Array.isArray(a.value) ? (a.value as Array<string | number>).some((y) => String(y) === String(x)) : false;
    result =
      a.operator === "eq" ? tri(String(a.value) === String(x))
      : a.operator === "neq" ? tri(String(a.value) !== String(x))
      : a.operator === "in" ? tri(inSet)
      : tri(!inSet);
  }
  evidence.add(a.fact_key);
  return result;
}

function evalNode(n: ClauseNode, profile: PatientProfile, evidence: Set<FactKey>): Tri {
  switch (n.kind) {
    case "atom":
      return evalAtom(n, profile, evidence);
    case "text":
    case "timing":
      return "unknown"; // free-text path; never decided in code
    case "all":
      return and(n.children.map((c) => evalNode(c, profile, evidence)));
    case "any":
      return or(n.children.map((c) => evalNode(c, profile, evidence)));
    case "except":
      return and([evalNode(n.base, profile, evidence), not(or(n.exceptions.map((c) => evalNode(c, profile, evidence))))]);
  }
}

export interface ClauseEvaluation {
  truth: Tri;
  /** Fact keys of known facts that were actually compared (citable evidence for the abstention guard). */
  evidence: FactKey[];
}

export function evaluateClause(n: ClauseNode, profile: PatientProfile): ClauseEvaluation {
  const evidence = new Set<FactKey>();
  const truth = evalNode(n, profile, evidence);
  return { truth, evidence: [...evidence] };
}

/** truth of the condition AS WRITTEN → effect on the patient. */
export function statusFromTruth(type: "inclusion" | "exclusion", truth: Tri): Status {
  if (truth === "unknown") return "UNKNOWN";
  const holds = truth === "true";
  return type === "inclusion" ? (holds ? "PASS" : "FAIL") : holds ? "FAIL" : "PASS";
}
