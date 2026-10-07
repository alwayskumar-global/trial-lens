// Report writer: counts and ids only (no criterion text, patient text or model output). Labels say what the numbers are.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { EvalRun } from "./runner";

const pct = (x: number | null) => (x === null ? "n/a" : (100 * x).toFixed(1) + "%");

export function reportLabel(sources: readonly string[]): string {
  if (sources.length && sources.every((s) => s === "fixture")) return "SELF-TEST ON TINY FIXTURES: checks the harness, not the system";
  if (sources.includes("abstention_set")) return "DEVELOPMENT RESULT: author-created abstention set, no clinician review";
  return "RESULT ON PUBLIC ANNOTATIONS: see the dataset notes for scope and limits";
}

export function renderMarkdown(run: EvalRun): string {
  const m = run.metrics;
  return [
    `# Eval run: ${run.evaluator} (config ${run.configHash})`,
    "",
    `**${reportLabel(run.sources)}**`,
    "",
    `Config: ${JSON.stringify(run.config)}`,
    `Cases: ${run.cases} (scored ${m.scored}, not applicable ${m.notApplicable}); sources: ${run.sources.join(", ")}`,
    "",
    "| Metric | Value |",
    "|---|---|",
    `| Criterion-level accuracy | ${pct(m.accuracy)} (${m.correct}/${m.scored}) |`,
    `| Unsupported-assumption rate | ${pct(m.unsupportedAssumptionRate)} (${m.unsupportedAssumptions} committed predictions with gold UNKNOWN) |`,
    `| False-PASS rate on excluded patients | ${pct(m.falsePassExclusionRate)} (${m.falsePassExclusion}) |`,
    `| UNKNOWN detection precision / recall | ${pct(m.unknownPrecision)} / ${pct(m.unknownRecall)} |`,
    `| Tokens (prompt / completion) | ${run.cost.promptTokens ?? "unavailable"} / ${run.cost.completionTokens ?? "unavailable"}${run.cost.lowerBound ? " (lower bound: some calls reported no usage)" : ""} |`,
    `| Cost (account prices) | ${run.cost.costUsd === null ? "unavailable" : "$" + run.cost.costUsd.toFixed(4)}${run.cost.lowerBound ? " (lower bound)" : ""} |`,
    "",
    "Confusion (rows gold, columns predicted):",
    "",
    "| gold \\ predicted | PASS | FAIL | UNKNOWN |",
    "|---|---|---|---|",
    ...(["PASS", "FAIL", "UNKNOWN"] as const).map((g) => `| ${g} | ${m.confusion[g].PASS} | ${m.confusion[g].FAIL} | ${m.confusion[g].UNKNOWN} |`),
    "",
  ].join("\n");
}

export function writeReport(dir: string, name: string, run: EvalRun): { json: string; md: string } {
  mkdirSync(dir, { recursive: true });
  const json = join(dir, `${name}.json`), md = join(dir, `${name}.md`);
  writeFileSync(json, JSON.stringify({ label: reportLabel(run.sources), run }, null, 1) + "\n");
  writeFileSync(md, renderMarkdown(run));
  return { json, md };
}
