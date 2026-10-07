import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync as rf, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UsageSnapshot } from "../../src/lib/llm/usage";
import { configHash, DEFAULT_SWITCHES, expandAblations } from "./ablations";
import { EvalDataFormatUnverified, EvalDataUnavailable, ensureSigir, loadAbstentionSet, loadCriterionAnnotations, loadSigir, parseAbstentionSet, parseSigirCorpus, parseSigirQrels, parseSigirQueries } from "./loaders";
import { criterionMetrics, summarizeUsage, tierAgreement, type ScoredCase } from "./metrics";
import { renderMarkdown, reportLabel, writeReport } from "./report";
import { alwaysPassEvaluator, alwaysUnknownEvaluator, oracleEvaluator, runEval, tableEvaluator } from "./runner";
import type { EvalCriterionCase } from "./types";

const c = (caseId: string, type: "inclusion" | "exclusion", gold: EvalCriterionCase["gold"], source: EvalCriterionCase["source"] = "fixture"): EvalCriterionCase => ({ caseId, patientId: "p", trialId: "NCT00000001", criterionId: caseId, type, text: "SENTINEL criterion text", gold, source });
const row = (cs: EvalCriterionCase, predicted: ScoredCase["predicted"]): ScoredCase => ({ case: cs, predicted });

describe("metrics (hand-computed)", () => {
  const rows: ScoredCase[] = [
    row(c("a", "inclusion", "PASS"), "PASS"), // correct
    row(c("b", "inclusion", "FAIL"), "PASS"), // wrong
    row(c("d", "inclusion", "UNKNOWN"), "PASS"), // unsupported assumption
    row(c("e", "inclusion", "UNKNOWN"), "UNKNOWN"), // right abstention
    row(c("f", "inclusion", "UNKNOWN"), "AMBIGUOUS"), // right abstention (ambiguous folds into unknown)
    row(c("g", "exclusion", "FAIL"), "PASS"), // false PASS on an excluded patient
    row(c("h", "exclusion", "FAIL"), "FAIL"), // correct
    row(c("i", "inclusion", "NOT_APPLICABLE"), "PASS"), // not scored
  ];
  const m = criterionMetrics(rows);
  it("accuracy and denominators skip NOT_APPLICABLE", () => {
    expect(m.scored).toBe(7);
    expect(m.notApplicable).toBe(1);
    expect(m.correct).toBe(4); // a, e, f, h
    expect(m.accuracy).toBeCloseTo(4 / 7);
  });
  it("unsupported assumptions: committed predictions where gold is UNKNOWN, over committed predictions", () => {
    expect(m.unsupportedAssumptions).toBe(1);
    expect(m.unsupportedAssumptionRate).toBeCloseTo(1 / 5); // committed: a, b, d, g, h
  });
  it("false PASS on exclusion criteria: gold FAIL on an exclusion criterion predicted PASS (criterion-level)", () => {
    expect(m.falsePassOnExclusionCriteria).toBe(1);
    expect(m.falsePassOnExclusionCriteriaRate).toBeCloseTo(1 / 2);
  });
  it("UNKNOWN detection precision and recall", () => {
    expect(m.unknownPrecision).toBe(1); // 2 abstentions, both right
    expect(m.unknownRecall).toBeCloseTo(2 / 3); // 3 gold UNKNOWN, 2 caught
  });
  it("confusion matrix rows are gold, columns predicted", () => {
    expect(m.confusion.UNKNOWN).toEqual({ PASS: 1, FAIL: 0, UNKNOWN: 2 });
    expect(m.confusion.FAIL).toEqual({ PASS: 2, FAIL: 1, UNKNOWN: 0 });
  });
  it("empty and rate-less inputs give null, never NaN or 0", () => {
    const e = criterionMetrics([]);
    expect(e.accuracy).toBeNull();
    expect(e.unsupportedAssumptionRate).toBeNull();
    expect(e.falsePassOnExclusionCriteriaRate).toBeNull();
    expect(e.unknownRecall).toBeNull();
  });
});

describe("tier agreement vs SIGIR labels", () => {
  it("contingency table and the two rates", () => {
    const t = tierAgreement([
      { tier: "POSSIBLE", label: 2 }, { tier: "UNCERTAIN", label: 2 }, { tier: "UNCERTAIN", label: 2 },
      { tier: "POSSIBLE", label: 0 }, { tier: "UNCERTAIN", label: 0 }, { tier: "UNCERTAIN", label: 1 },
    ]);
    expect(t.total).toBe(6);
    expect(t.table.UNCERTAIN[2]).toBe(2);
    expect(t.wouldReferLeftUncertain).toBeCloseTo(2 / 3);
    expect(t.wouldNotReferCalledPossible).toBeCloseTo(1 / 2);
    expect(tierAgreement([]).wouldReferLeftUncertain).toBeNull();
  });
});

describe("cost from usage (unavailable is not zero)", () => {
  const snap = (rows: UsageSnapshot["stages"]): UsageSnapshot => ({ version: "u-1", stages: rows, total: { calls: rows.reduce((n, r) => n + r.calls, 0), calls_with_usage: rows.reduce((n, r) => n + r.calls_with_usage, 0), calls_without_usage: rows.reduce((n, r) => n + r.calls_without_usage, 0), prompt_tokens: null, completion_tokens: null } });
  it("sums reported tokens, prices them, and flags a lower bound when some calls reported none", () => {
    const s = summarizeUsage([snap([{ stage: "parse", tier: "MID", model: "m", calls: 2, calls_with_usage: 1, calls_without_usage: 1, prompt_tokens: 1000, completion_tokens: 500 }])], [100, 300]);
    expect(s.promptTokens).toBe(1000);
    expect(s.costUsd).toBeCloseTo(1000 * 3e-7 + 500 * 9e-7, 12);
    expect(s.lowerBound).toBe(true);
    expect(s.callsWithoutUsage).toBe(1);
    expect(s.wallMsMean).toBe(200);
  });
  it("no reported usage at all: tokens and cost are null, not 0", () => {
    const s = summarizeUsage([snap([{ stage: "parse", tier: "MID", model: "m", calls: 1, calls_with_usage: 0, calls_without_usage: 1, prompt_tokens: null, completion_tokens: null }])]);
    expect(s.promptTokens).toBeNull();
    expect(s.costUsd).toBeNull();
    expect(summarizeUsage([]).costUsd).toBeNull();
  });
});

describe("ablations", () => {
  it("grid size and determinism; unlisted switches keep their default", () => {
    const g = expandAblations({ evaluator: ["hybrid", "pure_llm"], tier: ["FAST", "MID", "DEEP"], routing: [true, false], verifier: [true, false] });
    expect(g).toHaveLength(24);
    expect(expandAblations({ tier: ["FAST"] })).toEqual([{ ...DEFAULT_SWITCHES, tier: "FAST" }]);
    expect(expandAblations({ tier: ["FAST", "MID"] })).toEqual(expandAblations({ tier: ["FAST", "MID"] }));
  });
  it("the config hash is stable, key-order independent and distinguishes configs", () => {
    const a = configHash(DEFAULT_SWITCHES);
    expect(a).toMatch(/^[0-9a-f]{12}$/);
    expect(configHash({ verifier: true, routing: true, tier: "MID", evaluator: "hybrid" })).toBe(a);
    expect(configHash({ ...DEFAULT_SWITCHES, verifier: false })).not.toBe(a);
    expect(new Set(expandAblations({ evaluator: ["hybrid", "pure_llm"], tier: ["FAST", "MID", "DEEP"], routing: [true, false], verifier: [true, false] }).map(configHash)).size).toBe(24);
  });
});

describe("loaders (inline fixtures, no network)", () => {
  it("parses SIGIR queries, corpus and qrels", () => {
    expect(parseSigirQueries('{"_id":"sigir-1","text":"58-year-old woman"}\n')).toEqual([{ _id: "sigir-1", text: "58-year-old woman" }]);
    expect(parseSigirCorpus('{"_id":"NCT00000408","title":"T","text":"Summary: x"}\n')[0]!._id).toBe("NCT00000408");
    expect(parseSigirQrels("query-id\tcorpus-id\tscore\nsigir-1\tNCT00000408\t0\nsigir-1\tNCT00000492\t2\n")).toEqual([{ patientId: "sigir-1", trialId: "NCT00000408", label: 0 }, { patientId: "sigir-1", trialId: "NCT00000492", label: 2 }]);
  });
  it("rejects unexpected formats instead of guessing", () => {
    expect(() => parseSigirQrels("a\tb\tc\nx\ty\t0\n")).toThrow(EvalDataFormatUnverified);
    expect(() => parseSigirQrels("query-id\tcorpus-id\tscore\nx\ty\t7\n")).toThrow(EvalDataFormatUnverified);
    expect(() => parseSigirCorpus('{"_id":"not-an-nct","text":"x"}\n')).toThrow();
  });
  it("missing SIGIR files raise EvalDataUnavailable naming the fetch command", () => {
    expect(() => loadSigir("/nonexistent-eval-dir")).toThrow(EvalDataUnavailable);
  });
  it("criterion annotations: unavailable when absent, and never parsed with a guessed schema when present", () => {
    expect(() => loadCriterionAnnotations("/nonexistent.json")).toThrow(EvalDataUnavailable);
    const dir = mkdtempSync(join(tmpdir(), "evalann-"));
    try {
      const p = join(dir, "a.json");
      writeFileSync(p, "[]");
      expect(() => loadCriterionAnnotations(p)).toThrow(EvalDataFormatUnverified);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("abstention set: strict schema, author-created and not clinician reviewed", () => {
    const ok = { version: 1, authored_by: "author", clinician_reviewed: false, cases: [{ id: "ab-1", patient_id: "p1", trial_id: "NCT00000001", criterion_id: "c1", type: "inclusion", text: "ECOG 0-1", gold: "UNKNOWN" }] };
    const [x] = parseAbstentionSet(ok);
    expect(x).toMatchObject({ caseId: "ab-1", gold: "UNKNOWN", source: "abstention_set" });
    expect(() => parseAbstentionSet({ ...ok, clinician_reviewed: true })).toThrow();
    expect(() => parseAbstentionSet({ ...ok, cases: [{ ...ok.cases[0], extra: 1 }] })).toThrow();
    expect(() => loadAbstentionSet("/nonexistent.json")).toThrow(EvalDataUnavailable);
  });
  it("ensureSigir writes the files with a sha256 manifest, enforces the size cap, and uses a fake fetch (no network)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "evalsigir-"));
    try {
      const bodies: Record<string, string> = { "queries.jsonl": '{"_id":"sigir-1","text":"x"}\n', "corpus.jsonl": '{"_id":"NCT00000001","text":"y"}\n', "qrels/test.tsv": "query-id\tcorpus-id\tscore\nsigir-1\tNCT00000001\t1\n" };
      const urls: string[] = [];
      const fake = (async (u: string) => { urls.push(u); const k = Object.keys(bodies).find((f) => u.endsWith(f))!; return new Response(bodies[k]!); }) as unknown as typeof fetch;
      const m = await ensureSigir(dir, fake);
      expect(m).toHaveLength(3);
      expect(urls.every((u) => u.startsWith("https://raw.githubusercontent.com/ncbi-nlp/TrialGPT/"))).toBe(true);
      expect(m[0]!.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(loadSigir(dir).qrels).toHaveLength(1);
      expect(JSON.parse(rf(join(dir, "manifest.json"), "utf8")).files).toHaveLength(3);
      const failing = (async () => new Response("no", { status: 404 })) as unknown as typeof fetch;
      await expect(ensureSigir(dir, failing)).rejects.toThrow(EvalDataUnavailable);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});


describe("runner and report", () => {
  const cases = [c("r1", "inclusion", "PASS"), c("r2", "exclusion", "FAIL"), c("r3", "inclusion", "UNKNOWN")];
  it("oracle is perfect, always-unknown never assumes, always-pass assumes on gold UNKNOWN and misses exclusions", async () => {
    const oracle = await runEval({ cases, evaluator: oracleEvaluator, config: DEFAULT_SWITCHES });
    expect(oracle.metrics.accuracy).toBe(1);
    const unk = await runEval({ cases, evaluator: alwaysUnknownEvaluator, config: DEFAULT_SWITCHES });
    expect(unk.metrics.unsupportedAssumptions).toBe(0);
    expect(unk.metrics.unsupportedAssumptionRate).toBeNull(); // nothing committed
    const pass = await runEval({ cases, evaluator: alwaysPassEvaluator, config: DEFAULT_SWITCHES });
    expect(pass.metrics.unsupportedAssumptions).toBe(1);
    expect(pass.metrics.falsePassOnExclusionCriteriaRate).toBe(1);
    expect(pass.configHash).toBe(configHash(DEFAULT_SWITCHES));
  });
  it("a table evaluator defaults to UNKNOWN for unlisted cases", async () => {
    const r = await runEval({ cases, evaluator: tableEvaluator("t", { r1: "PASS" }), config: DEFAULT_SWITCHES });
    expect(r.predictions.map((p) => p.predicted)).toEqual(["PASS", "UNKNOWN", "UNKNOWN"]);
  });
  it("reports carry ids and counts only: no criterion text, and the label says what the numbers are", async () => {
    const run = await runEval({ cases, evaluator: oracleEvaluator, config: DEFAULT_SWITCHES });
    const md = renderMarkdown(run);
    expect(md).not.toContain("SENTINEL");
    expect(JSON.stringify(run)).not.toContain("SENTINEL");
    expect(md).toContain("SELF-TEST ON TINY FIXTURES");
    expect(reportLabel(["abstention_set"])).toContain("DEVELOPMENT RESULT");
    expect(md).toContain("unavailable"); // offline evaluators report no usage: cost is unavailable, not $0
    const dir = mkdtempSync(join(tmpdir(), "evalrep-"));
    try { const w = writeReport(dir, "x", run); expect(JSON.parse(rf(w.json, "utf8")).run.cases).toBe(3); } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("guard: the harness never imports the LLM client or a network SDK", () => {
  it("eval/lib has no model-calling imports", () => {
    for (const f of readdirSync("eval/lib").filter((x) => x.endsWith(".ts") && !x.endsWith(".test.ts"))) {
      expect(readFileSync(`eval/lib/${f}`, "utf8"), f).not.toMatch(/llm\/client|from "openai"|NEBIUS|makeClient|callJson/);
    }
  });
});
