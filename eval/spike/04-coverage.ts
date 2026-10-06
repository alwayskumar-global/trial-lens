// Phase 1 spike 04: vocabulary coverage. Run: pnpm spike:coverage
// MID parses every criterion of the ~30 fixture trials (batched, one call per trial chunk).
// "Typed" (headline) = fact_key set AND passes the code evaluability check (operator/value/unit
// valid for the vocabulary type) AND an independent DEEP judge says the representation captures the
// FULL criterion. A populated fact_key alone does NOT count. Gate on scoring criteria.
import { z } from "zod";
import pLimit from "p-limit";
import { getNebiusEnv, getPipelineEnv } from "../../src/lib/env";
import { buildBatchUserPrompt, buildCriteriaParseSystemPrompt, CRITERIA_PARSE_PROMPT_VERSION } from "../../src/prompts/criteria-parse";
import { LlmCriteriaBatchSchema, type LlmCriterion } from "../../src/schema/criteria";
import { FACT_KEYS } from "../../src/schema/vocabulary";
import { appendResults, evaluabilityProblems, isCompound, loadFixture, saveJson, splitCriteria, type SplitCriterion, fx } from "./lib";
import { callJson, CallCap, makeClient } from "./llm";

const MAX_CALLS = 400;
const CHUNK = 25;

const JudgeSchema = z.object({
  verdicts: z.array(z.object({ index: z.number().int().nonnegative(), verdict: z.enum(["full", "partial", "wrong"]) })),
});
const JUDGE_SYSTEM = `You audit structured representations of clinical-trial eligibility criteria.
For each item you get the original criterion text and a structured form: fact_key, operator, value, unit.
operator/value state the CONDITION DESCRIBED BY THE CRITERION TEXT.
Verdict:
- "full": the structured form captures the ENTIRE meaning of the criterion; nothing (extra condition, exception, alternative, timing window) is lost, and operator/value/unit are correct.
- "partial": correct but loses part of the criterion (e.g. an "or", an exception, a time window, another condition).
- "wrong": operator, value, unit or fact_key is incorrect for the text.
Output ONLY JSON: {"verdicts":[{"index":<n>,"verdict":"full|partial|wrong"}]} with one entry per input index.`;

// Keyword themes for criteria that did NOT become typed (counts only; no text is logged).
const THEMES: Array<[string, RegExp]> = [
  ["prior therapy / washout timing", /within\s+\d+|prior to|before (?:the )?(?:first|start|randomi|enroll|study)|washout|last dose|weeks? (?:of|from|since)|days? (?:of|from|since)/i],
  ["brain/CNS metastases", /brain|cns|leptomeningeal|central nervous/i],
  ["infection (HIV/hepatitis/active)", /hiv|hepatitis|hbv|hcv|infection|tubercul|covid/i],
  ["cardiac (QTc/MI/heart failure)", /qtc|myocardial|heart failure|cardiac|arrhythm|lvef|ejection|cardio/i],
  ["other malignancy", /other (?:active )?(?:malignan|cancer)|second primary|prior malignan/i],
  ["biomarker / genomic detail", /her2|er[ -]?positive|hormone receptor|brca|pik3ca|esr1|mutation|ihc|fish|pd-?l1|tnbc|triple/i],
  ["performance status", /ecog|karnofsky|performance status/i],
  ["labs / organ function", /anc|neutrophil|platelet|hemoglobin|bilirubin|ast|alt|creatinine|clearance|albumin|inr|egfr|liver|renal|kidney/i],
  ["pregnancy / contraception", /pregnan|lactat|breast.?feed|contracept|childbearing/i],
  ["consent / compliance", /consent|comply|compliance|protocol|willing|able to/i],
  ["concomitant meds / hypersensitivity", /hypersensitiv|allerg|concomitant|cyp|inhibitor|inducer|anticoag|steroid|immunosuppress/i],
  ["measurable / imaging / RECIST", /measurable|recist|imaging|lesion|biopsy|tissue/i],
  ["surgery / radiation", /surgery|surgical|radiation|radiotherapy|resection/i],
  ["life expectancy / age / sex", /life expectancy|years of age|aged|age ≥|age >=|male|female/i],
];

interface Row {
  c: SplitCriterion;
  p: LlmCriterion | null; // null = parse failed/missing
  problems: string[];
  verdict: "full" | "partial" | "wrong" | "unjudged";
}

async function main(): Promise<void> {
  const env = getNebiusEnv();
  if (!env.NEMOTRON_MODEL_MID || !env.NEMOTRON_MODEL_DEEP) throw new Error("set NEMOTRON_MODEL_MID and NEMOTRON_MODEL_DEEP");
  const conc = getPipelineEnv().LLM_CONCURRENCY;
  const client = makeClient();
  const cap = new CallCap(MAX_CALLS);
  const limit = pLimit(conc);
  const trials = loadFixture();
  const criteria = trials.flatMap(splitCriteria);
  console.log(`${trials.length} trials, ${criteria.length} criteria`);

  // --- parse (MID), batched per trial in chunks of CHUNK
  const system = buildCriteriaParseSystemPrompt();
  const byTrial = new Map<string, SplitCriterion[]>();
  criteria.forEach((c) => byTrial.set(c.nct_id, [...(byTrial.get(c.nct_id) ?? []), c]));
  const chunks: SplitCriterion[][] = [];
  for (const list of byTrial.values()) for (let i = 0; i < list.length; i += CHUNK) chunks.push(list.slice(i, i + CHUNK));

  let parseFailedChunks = 0;
  let parseFirstValid = 0;
  const parsedRows: Row[] = [];
  const t0 = performance.now();
  await Promise.all(
    chunks.map((chunk) =>
      limit(async () => {
        const items = chunk.map((c, i) => ({ index: i, type: c.type, text: c.text }));
        const { data, stats } = await callJson({
          client, cap, model: env.NEMOTRON_MODEL_MID!, mode: "json_schema", system, schema: LlmCriteriaBatchSchema,
          schemaName: "criteria_batch", user: buildBatchUserPrompt(items), maxTokens: 8192,
        });
        if (stats.firstValid) parseFirstValid++;
        const byIdx = new Map((data?.criteria ?? []).map((x) => [x.index, x]));
        if (!data) parseFailedChunks++;
        chunk.forEach((c, i) => {
          const x = byIdx.get(i);
          const p: LlmCriterion | null = x
            ? { category: x.category, fact_key: x.fact_key, operator: x.operator, value: x.value, unit: x.unit, depends_on: x.depends_on, scoring: x.scoring }
            : null;
          parsedRows.push({ c, p, problems: p ? evaluabilityProblems(p) : ["parse_missing"], verdict: "unjudged" });
        });
      }),
    ),
  );
  const parseWall = Math.round(performance.now() - t0);
  console.log(`parsed: ${chunks.length} chunk calls, first-attempt valid ${parseFirstValid}, failed ${parseFailedChunks}, wall ${parseWall}ms`);

  // --- judge (DEEP) only candidates that pass the code check
  const cand = parsedRows.filter((r) => r.p && r.p.scoring && r.problems.length === 0);
  const judgeChunks = new Map<string, Row[]>();
  cand.forEach((r) => judgeChunks.set(r.c.nct_id, [...(judgeChunks.get(r.c.nct_id) ?? []), r]));
  let judgeFailed = 0;
  await Promise.all(
    [...judgeChunks.values()].flatMap((rows) => {
      const parts: Row[][] = [];
      for (let i = 0; i < rows.length; i += CHUNK) parts.push(rows.slice(i, i + CHUNK));
      return parts.map((part) =>
        limit(async () => {
          const user = part
            .map((r, i) => `[${i}] (${r.c.type}) TEXT: ${r.c.text}\n    STRUCTURED: ${JSON.stringify({ fact_key: r.p!.fact_key, operator: r.p!.operator, value: r.p!.value, unit: r.p!.unit })}`)
            .join("\n");
          const { data } = await callJson({
            client, cap, model: env.NEMOTRON_MODEL_DEEP!, mode: "json_schema", system: JUDGE_SYSTEM, schema: JudgeSchema,
            schemaName: "judge", user, maxTokens: 8192,
          });
          if (!data) judgeFailed++;
          const v = new Map((data?.verdicts ?? []).map((x) => [x.index, x.verdict]));
          part.forEach((r, i) => (r.verdict = v.get(i) ?? "unjudged"));
        }),
      );
    }),
  );

  // --- metrics
  const scoring = parsedRows.filter((r) => r.p?.scoring);
  const nonScoring = parsedRows.filter((r) => r.p && !r.p.scoring).length;
  const missing = parsedRows.filter((r) => !r.p).length;
  const A = (rows: Row[]) => rows.filter((r) => r.p?.fact_key != null).length;
  const B = (rows: Row[]) => rows.filter((r) => r.p?.fact_key != null && r.problems.length === 0).length;
  const C = (rows: Row[]) => rows.filter((r) => r.problems.length === 0 && r.verdict === "full").length;
  const f = (x: number, d: number) => `${x}/${d} (${d ? Math.round((1000 * x) / d) / 10 : 0}%)`;
  const strata: Array<[string, (r: Row) => boolean]> = [
    ["all scoring", () => true],
    ["inclusion", (r) => r.c.type === "inclusion"],
    ["exclusion", (r) => r.c.type === "exclusion"],
    ["simple wording (heuristic)", (r) => !isCompound(r.c.text)],
    ["compound wording (heuristic)", (r) => isCompound(r.c.text)],
  ];
  const headline = C(scoring) / Math.max(1, scoring.length);
  const gate = headline >= 0.6 ? "PASS (≥60%)" : headline >= 0.4 ? "EXPAND VOCABULARY (40–60%)" : "STOP AND REASSESS (<40%)";

  const lines: string[] = [
    `\n## ${new Date().toISOString()} — 04-coverage\n`,
    `- Parser: MID \`${env.NEMOTRON_MODEL_MID}\`, prompt \`${CRITERIA_PARSE_PROMPT_VERSION}\`, json_schema mode, ${chunks.length} batched calls (≤${CHUNK} criteria each); first-attempt batch validity ${parseFirstValid}/${chunks.length}; batches failing after retry ${parseFailedChunks}; criteria missing from output ${missing}.`,
    `- Judge: DEEP \`${env.NEMOTRON_MODEL_DEEP}\` (independent of parser), run only on criteria passing the code check; judge batches failed ${judgeFailed}. VERIFY: LLM judge is not clinician review; spot-check below.`,
    `- ${trials.length} trials, ${criteria.length} bullet-level criteria (regex split), ${scoring.length} flagged scoring by the parser, ${nonScoring} non-scoring (consent/logistics).`,
    `- Definitions: **A** fact_key populated · **B** A + operator/value/unit valid and convertible for that vocabulary type (code check) · **C (typed, headline)** B + judge says "full" (entire logic captured).`,
    "\n| Stratum (scoring only) | n | A: fact_key set | B: code-evaluable | C: typed (headline) |",
    "|---|---|---|---|---|",
  ];
  for (const [name, pred] of strata) {
    const rows = scoring.filter(pred);
    lines.push(`| ${name} | ${rows.length} | ${f(A(rows), rows.length)} | ${f(B(rows), rows.length)} | ${f(C(rows), rows.length)} |`);
  }
  lines.push(`\n**Gate result (C over all scoring criteria): ${f(C(scoring), scoring.length)} → ${gate}.** (Schedule gate, not a safety or accuracy claim.)`);

  const judged = cand.length;
  const vc = (v: string) => cand.filter((r) => r.verdict === v).length;
  lines.push(`\n- Code-evaluable candidates judged: ${judged} → full ${vc("full")}, partial ${vc("partial")}, wrong ${vc("wrong")}, unjudged ${vc("unjudged")}. Judge rejection of code-valid typed criteria = how often fact_key+operator+value looked fine but lost logic.`);
  const probs = new Map<string, number>();
  scoring.filter((r) => r.p?.fact_key != null).forEach((r) => r.problems.forEach((p) => probs.set(p, (probs.get(p) ?? 0) + 1)));
  lines.push(`- Code-check failures among fact_key-populated criteria: ${[...probs].map(([k, v]) => `${k}×${v}`).join(", ") || "none"}.`);

  const keyUse = new Map<string, number>();
  scoring.filter((r) => r.problems.length === 0 && r.verdict === "full").forEach((r) => keyUse.set(r.p!.fact_key!, (keyUse.get(r.p!.fact_key!) ?? 0) + 1));
  const top = [...keyUse].sort((a, b) => b[1] - a[1]);
  lines.push(`- fact_keys used by typed (C) criteria: ${top.map(([k, v]) => `${k}×${v}`).join(", ")}.`);
  lines.push(`- Vocabulary keys never typed in this sample (${FACT_KEYS.length - top.length}/${FACT_KEYS.length}): ${FACT_KEYS.filter((k) => !keyUse.has(k)).join(", ")}.`);

  const untyped = scoring.filter((r) => !(r.problems.length === 0 && r.verdict === "full"));
  const themeCount = new Map<string, number>();
  let unthemed = 0;
  untyped.forEach((r) => {
    const hit = THEMES.find(([, re]) => re.test(r.c.text));
    if (hit) themeCount.set(hit[0], (themeCount.get(hit[0]) ?? 0) + 1);
    else unthemed++;
  });
  lines.push(`\n**Untyped scoring criteria by keyword theme (first match; heuristic, counts only; n=${untyped.length}):**\n`, "| Theme | Count |", "|---|---|");
  [...themeCount].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => lines.push(`| ${k} | ${v} |`));
  lines.push(`| (no keyword match) | ${unthemed} |`);

  // Spot-check list: ids only; texts stay in the gitignored fixture.
  const spot = scoring.filter((r) => r.problems.length === 0 && r.verdict === "full").slice(0, 12).map((r) => r.c.id);
  lines.push(`\n- Manual spot-check list (typed-C ids; read text/structure in \`eval/spike/fixtures/coverage-parsed.json\`): ${spot.join(", ")}.`);
  lines.push(`- Total HTTP calls: ${cap.used}/${MAX_CALLS}; parse wall ${parseWall} ms at concurrency ${conc}.`);

  saveJson(fx("coverage-parsed"), parsedRows.map((r) => ({ id: r.c.id, type: r.c.type, text: r.c.text, parsed: r.p, problems: r.problems, verdict: r.verdict })));
  appendResults(lines.join("\n") + "\n");
  console.log(lines.slice(1, 12).join("\n"));
}

main().catch((e: unknown) => {
  console.error(`04-coverage failed: ${(e as Error)?.message?.slice(0, 120)}`);
  process.exit(1);
});
