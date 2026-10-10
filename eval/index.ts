// Eval harness entry point (Phase 3). Runs locally, never on Vercel. OFFLINE: no model call is wired here.
//   pnpm exec tsx eval/index.ts --dry-run       data availability and the plan (no network)
//   pnpm exec tsx eval/index.ts --self-test     offline evaluators over tiny bundled fixtures (no network)
//   pnpm exec tsx eval/index.ts --fetch-sigir   explicit download of the SIGIR 2016 files into gitignored eval/data/sigir (public GitHub raw only)
import { existsSync } from "node:fs";
import { expandAblations } from "./lib/ablations";
import { ensureSigir, loadSigir, SIGIR_FILES } from "./lib/loaders";
import { alwaysPassEvaluator, alwaysUnknownEvaluator, oracleEvaluator, runEval } from "./lib/runner";
import { renderMarkdown } from "./lib/report";
import { DEFAULT_SWITCHES } from "./lib/ablations";
import type { EvalCriterionCase } from "./lib/types";

const DATA = "eval/data/sigir";
const say = (s: string) => console.warn(s);

const FIXTURES: EvalCriterionCase[] = [
  { caseId: "fx-1", patientId: "fx-p1", trialId: "NCT00000001", criterionId: "c1", type: "inclusion", text: "(fixture)", gold: "PASS", source: "fixture" },
  { caseId: "fx-2", patientId: "fx-p1", trialId: "NCT00000001", criterionId: "c2", type: "exclusion", text: "(fixture)", gold: "FAIL", source: "fixture" },
  { caseId: "fx-3", patientId: "fx-p1", trialId: "NCT00000002", criterionId: "c3", type: "inclusion", text: "(fixture)", gold: "UNKNOWN", source: "fixture" },
];

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode === "--dry-run") {
    say("Eval harness (offline). Datasets: docs/eval-datasets.md");
    for (const f of SIGIR_FILES) say(`  SIGIR ${f}: ${existsSync(`${DATA}/${f}`) ? "present" : "not downloaded (--fetch-sigir)"}`);
    say("  TREC 2021/2022 and the criterion-level annotations: not available from this environment");
    say(`  default ablation switches: ${JSON.stringify(DEFAULT_SWITCHES)}; full grid: ${expandAblations({ evaluator: ["hybrid", "pure_llm"], tier: ["FAST", "MID", "DEEP"], routing: [true, false], verifier: [true, false] }).length} configs`);
    say("  live evaluator: not wired (first full eval run needs a separately approved ceiling)");
  } else if (mode === "--self-test") {
    for (const ev of [oracleEvaluator, alwaysUnknownEvaluator, alwaysPassEvaluator]) say(renderMarkdown(await runEval({ cases: FIXTURES, evaluator: ev, config: DEFAULT_SWITCHES })));
  } else if (mode === "--fetch-sigir") {
    const m = await ensureSigir(DATA);
    for (const f of m) say(`  ${f.file}: ${f.bytes} bytes sha256 ${f.sha256.slice(0, 12)}…`);
    const d = loadSigir(DATA);
    say(`parsed: ${d.queries.length} patient descriptions, ${d.corpus.length} trials, ${d.qrels.length} qrels rows`);
  } else throw new Error("usage: --dry-run | --self-test | --fetch-sigir");
}
main().then(() => process.exit(0), (e: unknown) => { console.error(`eval stopped: ${(e as Error)?.message?.slice(0, 200) ?? "unknown"}`); process.exit(1); });
