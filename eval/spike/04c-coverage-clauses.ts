// Phase 1 repair: coverage v2 on the SAME fixed cohort as 04, with the clause representation.
// Run: pnpm spike:coverage2
// - Parser: MID, batched, schema rejects missing/duplicate/unexpected indices and non-verbatim sources
//   (one retry with the error fed back). A batch still invalid after the retry => its criteria are
//   UNRESOLVED (UNKNOWN downstream). Nothing is dropped; the denominator is ALL criteria.
// - Metrics: parsed vs unresolved; code-evaluable (every leaf an executable atom);
//   judge-reviewed full-logic (DEEP, independent of parser) on code-evaluable criteria;
//   partial coverage (some leaf typed) reported separately. Strata: inclusion/exclusion, simple/compound.
import pLimit from "p-limit";
import { z } from "zod";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getNebiusEnv, getPipelineEnv } from "../../src/lib/env";
import { dependsOn, leaves } from "../../src/lib/engine/clause";
import { COVERAGE_CHECK_VERSION } from "../../src/lib/engine/coverage";
import { reconcileBatch, type ParseOutcome, type SourceCriterion } from "../../src/lib/engine/reconcile";
import { buildClauseBatchUserPrompt, buildClauseParseSystemPrompt, CLAUSE_PARSE_PROMPT_VERSION } from "../../src/prompts/clause-parse";
import { makeClauseBatchSchema } from "../../src/schema/clause";
import { appendResults, COHORT, cohortCriteria, isCompound, loadFixture, saveJson, seededShuffle, fx } from "./lib";
import { callJson, CallCap, makeClient, THINKING_OFF } from "./llm";

const MAX_CALLS = 400;
const CHUNK = Number(process.env.COVERAGE_CHUNK ?? "15");
// COVERAGE_REASONING: off (enable_thinking=false) | low (reasoning_effort=low) | on (model default)
const REASONING = (process.env.COVERAGE_REASONING ?? "off") as "off" | "low" | "on";
const MAX_TOKENS = Number(process.env.COVERAGE_MAX_TOKENS ?? "8192");
const EXTRA: Record<string, unknown> | undefined = REASONING === "off" ? THINKING_OFF : REASONING === "low" ? { reasoning_effort: "low" } : undefined;
const OUT = fx("coverage-v2");
const REVIEW_SAMPLE_PATH = fileURLToPath(new URL(`./review-sample${COHORT === "fresh" ? "-fresh" : ""}.json`, import.meta.url));

const JudgeSchema = z.object({ verdicts: z.array(z.object({ index: z.number().int().nonnegative(), verdict: z.enum(["full", "partial", "wrong"]) })) });
const JUDGE_SYSTEM = `You audit structured clause representations of clinical-trial eligibility criteria.
Each item has the original criterion text and a clause tree: nodes "all"/"any" (children), "except" (base + exceptions), "if" (when/then: the requirement "then" applies only when "when" holds; if "when" is false the block is vacuously satisfied), and leaves. Leaves are atoms (fact_key, operator, value, unit), timing windows, or text. Every leaf states a condition AS WRITTEN in the criterion; "except" lists exceptions under which the condition does not apply; the condition = combine(items) AND NOT any(except).
Verdict:
- "full": the clause captures the ENTIRE logic of the criterion: no condition, alternative, exception, quantity, unit or time window is lost or added, and every atom's operator/value/unit is correct.
- "partial": correct as far as it goes but something in the criterion is not represented.
- "wrong": something represented is incorrect (wrong operator/value/unit/fact, wrong and/or, exception inverted).
Output ONLY JSON: {"verdicts":[{"index":<n>,"verdict":"full|partial|wrong"}]}, one entry per input index.`;

interface Row {
  c: SourceCriterion;
  outcome: ParseOutcome;
  verdict: "full" | "partial" | "wrong" | "unjudged" | "n/a";
}

async function main(): Promise<void> {
  const env = getNebiusEnv();
  if (!env.NEMOTRON_MODEL_MID || !env.NEMOTRON_MODEL_DEEP) throw new Error("set NEMOTRON_MODEL_MID and NEMOTRON_MODEL_DEEP");
  const conc = getPipelineEnv().LLM_CONCURRENCY;
  const client = makeClient();
  const cap = new CallCap(MAX_CALLS);
  const limit = pLimit(conc);
  const trials = loadFixture();
  const sources: SourceCriterion[] = cohortCriteria(trials).map((c) => ({ id: c.id, nct_id: c.nct_id, type: c.type, text: c.text }));
  console.log(`${trials.length} trials, ${sources.length} criteria, chunk ${CHUNK}`);

  const byTrial = new Map<string, SourceCriterion[]>();
  sources.forEach((s) => byTrial.set(s.nct_id, [...(byTrial.get(s.nct_id) ?? []), s]));
  const chunks: SourceCriterion[][] = [];
  for (const list of byTrial.values()) for (let i = 0; i < list.length; i += CHUNK) chunks.push(list.slice(i, i + CHUNK));

  const system = buildClauseParseSystemPrompt();
  const rows: Row[] = [];
  let firstValid = 0, retriedOk = 0, rejected = 0, truncated = 0, tokensIn = 0, tokensOut = 0;
  const why = new Map<string, number>(); // rejection reasons after the retry (sanitised)
  const classify = (p: string) => (/not valid JSON/.test(p) ? "not valid JSON (often truncation)" : /missing indices/.test(p) ? "missing indices" : /duplicate indices/.test(p) ? "duplicate indices" : /unexpected indices/.test(p) ? "unexpected indices" : /exact fragment/.test(p) ? "leaf source not verbatim" : /requires/.test(p) ? "atom/timing leaf missing required fields" : "other schema violation");
  const t0 = performance.now();
  await Promise.all(
    chunks.map((chunk) =>
      limit(async () => {
        const { data, stats } = await callJson({
          client, cap, model: env.NEMOTRON_MODEL_MID!, mode: "json_schema", system,
          schema: makeClauseBatchSchema(chunk.map((c) => c.text)), schemaName: "clause_batch",
          user: buildClauseBatchUserPrompt(chunk.map((c, i) => ({ index: i, type: c.type, text: c.text }))), maxTokens: MAX_TOKENS,
          ...(EXTRA ? { extraBody: EXTRA } : {}),
        });
        if (stats.firstValid) firstValid++; else if (stats.finalValid) retriedOk++; else { rejected++; const k = classify(stats.problems[stats.problems.length - 1] ?? ""); why.set(k, (why.get(k) ?? 0) + 1); }
        if (stats.truncated) truncated++;
        tokensIn += stats.promptTokens; tokensOut += stats.completionTokens;
        reconcileBatch(chunk, data, "batch_rejected").forEach((outcome, i) => rows.push({ c: chunk[i]!, outcome, verdict: "n/a" }));
      }),
    ),
  );
  const parseWall = Math.round(performance.now() - t0);
  rows.sort((a, b) => sources.indexOf(a.c) - sources.indexOf(b.c));
  console.log(`parse: ${chunks.length} batches: first-valid ${firstValid}, valid-after-retry ${retriedOk}, rejected ${rejected}; wall ${parseWall} ms`);

  // Judge every FULL (code-evaluable) criterion with DEEP
  const full = rows.filter((r) => r.outcome.state === "parsed" && r.outcome.completeness === "full");
  full.forEach((r) => (r.verdict = "unjudged"));
  let judgeFailed = 0;
  const groups = new Map<string, Row[]>();
  full.forEach((r) => groups.set(r.c.nct_id, [...(groups.get(r.c.nct_id) ?? []), r]));
  const parts: Row[][] = [];
  for (const g of groups.values()) for (let i = 0; i < g.length; i += 20) parts.push(g.slice(i, i + 20));
  await Promise.all(
    parts.map((part) =>
      limit(async () => {
        const user = part
          .map((r, i) => `[${i}] (${r.c.type}) TEXT: ${r.c.text}\n    CLAUSE: ${JSON.stringify((r.outcome as Extract<ParseOutcome, { state: "parsed" }>).clause)}`)
          .join("\n");
        const { data } = await callJson({ client, cap, model: env.NEMOTRON_MODEL_DEEP!, mode: "json_schema", system: JUDGE_SYSTEM, schema: JudgeSchema, schemaName: "judge", user, maxTokens: 8192 });
        if (!data) judgeFailed++;
        const v = new Map((data?.verdicts ?? []).map((x) => [x.index, x.verdict]));
        part.forEach((r, i) => (r.verdict = v.get(i) ?? "unjudged"));
      }),
    ),
  );

  // ---- metrics -------------------------------------------------------------------------------
  const parsed = (r: Row) => r.outcome.state === "parsed";
  const unresolved = rows.filter((r) => !parsed(r));
  // Scoring denominator: parser-scoring + ALL unresolved (conservative: unresolved are scoring).
  const scoring = rows.filter((r) => r.outcome.state === "unresolved" || r.outcome.scoring);
  const nonScoring = rows.length - scoring.length;
  const vetCounts = new Map<string, number>();
  rows.forEach((r) => r.outcome.state === "parsed" && vetCounts.set(r.outcome.vet, (vetCounts.get(r.outcome.vet) ?? 0) + 1));
  const isFull = (r: Row) => r.outcome.state === "parsed" && r.outcome.completeness === "full";
  const isReviewedFull = (r: Row) => isFull(r) && r.verdict === "full";
  const hasAtom = (r: Row) => r.outcome.state === "parsed" && leaves(r.outcome.clause).some((l) => l.kind === "atom");
  const touches = (r: Row) => r.outcome.state === "parsed" && dependsOn(r.outcome.clause).length > 0;
  const f = (x: number, d: number) => `${x}/${d} (${d ? Math.round((1000 * x) / d) / 10 : 0}%)`;
  const strata: Array<[string, (r: Row) => boolean]> = [
    ["all scoring (incl. unresolved)", () => true],
    ["inclusion", (r) => r.c.type === "inclusion"],
    ["exclusion", (r) => r.c.type === "exclusion"],
    ["simple wording (heuristic)", (r) => !isCompound(r.c.text)],
    ["compound wording (heuristic)", (r) => isCompound(r.c.text)],
  ];
  const headline = scoring.filter(isReviewedFull).length / scoring.length;

  const lines: string[] = [
    `\n## ${new Date().toISOString()} — 04c-coverage-clauses (${COHORT} cohort; clause representation; splitter + atom-semantics guards + coverage checks ${COVERAGE_CHECK_VERSION} active)\n`,
    `- Command: \`pnpm spike:coverage2\` (COVERAGE_CHUNK=${CHUNK}, COVERAGE_REASONING=${REASONING}, max_tokens ${MAX_TOKENS}; judge reasoning default ON). Parser MID \`${env.NEMOTRON_MODEL_MID}\`, prompt \`${CLAUSE_PARSE_PROMPT_VERSION}\`, json_schema mode, ${chunks.length} batch calls; judge DEEP \`${env.NEMOTRON_MODEL_DEEP}\` on code-evaluable criteria only.`,
    `- Batch validation (index set exact + every leaf source is a verbatim fragment): first-attempt valid ${firstValid}/${chunks.length}; valid after the one retry ${retriedOk}; **rejected after retry ${rejected}** (all their criteria → UNRESOLVED → UNKNOWN; last-attempt reasons: ${[...why].map(([k, v]) => `${k}×${v}`).join(", ") || "n/a"}); truncated outputs ${truncated}; judge batches failed ${judgeFailed}.`,
    `- Tokens (parse): prompt ${tokensIn}, completion ${tokensOut}; parse wall ${parseWall} ms at concurrency ${conc}; total HTTP calls ${cap.used}/${MAX_CALLS}.`,
    `- Denominator: ${rows.length} bullet-level criteria in the fixed cohort (${trials.length} trials; regex split). Parsed ${rows.length - unresolved.length}, **unresolved ${unresolved.length}** (kept as UNKNOWN scoring criteria). Non-scoring (category consent_logistics, derived in code): ${nonScoring}; scoring denominator = ${scoring.length} (non-consent parsed + all unresolved).`,
    `- Definitions: **code-evaluable** = every leaf is an atom whose operator/value/unit are valid and convertible in code (no text/timing leaves) · **reviewed full-logic (headline)** = code-evaluable AND the independent DEEP judge says the clause captures the entire criterion · **partial-typed** = ≥1 atom leaf but not fully executable (text/timing remain on the free-text path).`,
    "\n| Stratum (scoring, unresolved included) | n | unresolved | code-evaluable | reviewed full-logic (headline) | ≥1 atom (partial-typed) |",
    "|---|---|---|---|---|---|",
  ];
  for (const [name, pred] of strata) {
    const r = scoring.filter(pred);
    lines.push(`| ${name} | ${r.length} | ${f(r.filter((x) => !parsed(x)).length, r.length)} | ${f(r.filter(isFull).length, r.length)} | ${f(r.filter(isReviewedFull).length, r.length)} | ${f(r.filter(hasAtom).length, r.length)} |`);
  }
  const gate = headline >= 0.6 ? "PASS (≥60%)" : headline >= 0.4 ? "EXPAND VOCABULARY (40–60%)" : "STOP AND REASSESS (<40%)";
  const vc = (v: string) => full.filter((r) => r.verdict === v).length;
  lines.push(
    `\n**Gate (reviewed full-logic over all scoring incl. unresolved): ${f(scoring.filter(isReviewedFull).length, scoring.length)} → ${gate}.** Schedule gate only; not an accuracy or safety claim. The earlier 5.7% used a different denominator (parser-scoring only, 20 missing excluded) and a single-fact representation, so it is not directly comparable.`,
    `- Judge on ${full.length} code-evaluable criteria: full ${vc("full")}, partial ${vc("partial")}, wrong ${vc("wrong")}, unjudged ${vc("unjudged")}.`,
    `- Vocabulary-touch proxy (any leaf touches a vocabulary key, parsed criteria): ${f(scoring.filter(touches).length, scoring.length)}. **Unvalidated proxy, not a typed rate.**`,
  );
  lines.push(`- Coverage/scope vetting of parsed criteria (no tuned percentage; any omitted substantive logic fails): ${[...vetCounts].map(([k, v]) => `${k}×${v}`).join(", ")}. coverage_failed ⇒ whole criterion became one text leaf (UNKNOWN).`);
  const kinds = new Map<string, number>();
  rows.filter(parsed).forEach((r) => leaves((r.outcome as Extract<ParseOutcome, { state: "parsed" }>).clause).forEach((l) => kinds.set(l.kind, (kinds.get(l.kind) ?? 0) + 1)));
  lines.push(`- Leaf kinds across parsed criteria: ${[...kinds].map(([k, v]) => `${k}×${v}`).join(", ")}.`);

  saveJson(OUT, rows.map((r) => ({ id: r.c.id, type: r.c.type, text: r.c.text, outcome: r.outcome, verdict: r.verdict })));
  // deterministic review sample (ids only committed): 15 judged-full + 15 judged non-full... drawn from code-evaluable rows
  const pool = seededShuffle(full, 7).slice(0, 30).map((r) => r.c.id);
  writeFileSync(REVIEW_SAMPLE_PATH, JSON.stringify(pool, null, 2));
  appendResults(lines.join("\n") + "\n");
  console.log(lines.slice(1).join("\n"));
}

main().catch((e: unknown) => {
  console.error(`04c failed: ${(e as Error)?.message?.slice(0, 160)}`);
  process.exit(1);
});
