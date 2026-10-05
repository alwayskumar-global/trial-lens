// Phase 1 spike 04b: deterministic analysis of the saved 04 parse (no LLM calls).
// Answers: is the low typed-coverage a vocabulary gap, a one-fact_key-per-criterion representation
// limit, or splitter/parse noise? Informational only; the gate stays on 04's strict "typed (C)".
import { readFileSync } from "node:fs";
import { FIXTURE_PATH, appendResults } from "./lib";

interface Row { id: string; type: string; text: string; parsed: null | { scoring: boolean; fact_key: string | null; depends_on: string[]; category: string }; problems: string[]; verdict: string }
const rows: Row[] = JSON.parse(readFileSync(FIXTURE_PATH.replace("ctgov-breast.json", "coverage-parsed.json"), "utf8"));
const sc = rows.filter((r) => r.parsed?.scoring);
const f = (x: number, d: number) => `${x}/${d} (${d ? Math.round((1000 * x) / d) / 10 : 0}%)`;

const typedC = (r: Row) => r.problems.length === 0 && r.verdict === "full";
const touches = (r: Row) => !!r.parsed && (r.parsed.fact_key !== null || r.parsed.depends_on.length > 0);
const bundles = (r: Row) => !!r.parsed && new Set(r.parsed.depends_on).size >= 2;
const merged = (r: Row) => /(^|\s)\d{1,2}\s*[.)]\s*[A-Z][^.]{3,}.*\s\d{1,2}\s*[.)]\s*[A-Z]/.test(r.text) || /;\s*(ANC|Hb|PLT|platelet|neutrophil)/i.test(r.text);
const untyped = sc.filter((r) => !typedC(r));

const lines = [
  `\n## ${new Date().toISOString()} — 04b-coverage-analysis (no LLM calls; reads \`fixtures/coverage-parsed.json\`)\n`,
  `- Typed (C, strict headline): ${f(sc.filter(typedC).length, sc.length)}.`,
  `- **Touches the vocabulary** (fact_key set OR depends_on non-empty), any representation: ${f(sc.filter(touches).length, sc.length)}. Upper-bound proxy for coverage if every touching criterion were decomposed into independently typed clauses with logic preserved. NOT a typed rate and not validated.`,
  `- Untyped criteria that touch the vocabulary: ${f(untyped.filter(touches).length, untyped.length)}; of those, bundle ≥2 distinct vocabulary keys in one bullet: ${f(untyped.filter((r) => touches(r) && bundles(r)).length, untyped.filter(touches).length)}.`,
  `- Untyped criteria that do not touch the vocabulary at all: ${f(untyped.filter((r) => !touches(r)).length, untyped.length)} (genuine vocabulary gap, free-text path).`,
  `- Criteria possibly merged by the regex splitter (numbered items or ';'-joined labs in one bullet; heuristic): ${f(sc.filter(merged).length, sc.length)}.`,
  `- Criteria missing from parser batch output (index not returned; count not enforced by the Zod batch schema): ${rows.filter((r) => !r.parsed).length}/${rows.length}. Phase 2 must enforce exact index coverage.`,
  `- Judge on code-valid typed candidates: partial ${rows.filter((r) => r.problems.length === 0 && r.verdict === "partial").length}, wrong ${rows.filter((r) => r.problems.length === 0 && r.verdict === "wrong").length}, full ${rows.filter(typedC).length}.`,
  `- Reading: (1) The strict typed rate (5.7%) is far below the 40% line, so per TASKS.md this is a **STOP: reassess the adaptive-demo scope with the founder** before Phase 2. (2) Representation is the largest recoverable loss: single fact_key/operator/value per criterion drops compound and bundled bullets, and the judge rejected most code-valid typed rows as partial. (3) Even a perfect decomposition would, by the 'touches vocabulary' proxy, reach only about the 40–60% band, because roughly half of scoring criteria do not touch the 35 keys at all (large free-text, comorbidity, washout and drug-specific blocks). (4) Splitter noise is minor by this heuristic. (5) Parse prompt \`spike-0\` is untuned and deliberately conservative (rule 2); tuning may lift 'full' typed counts modestly but cannot recover bundled bullets without clause decomposition.`,
];
appendResults(lines.join("\n") + "\n");
console.log(lines.slice(1, 8).join("\n"));
