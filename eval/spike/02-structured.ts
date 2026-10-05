// Phase 1 spike 02: structured-output reliability. Run: pnpm spike:structured
// 1) Probe json_schema / json_object / prompt-only per tier on one criterion.
// 2) Run 50 distinct stratified criteria per tier (best supported mode), concurrency = LLM_CONCURRENCY,
//    Zod-validate with ONE retry. Reports first-attempt and after-retry validity separately.
// Public CT.gov criteria text only; no patient data. Hard cap on total HTTP calls.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pLimit from "p-limit";
import { getNebiusEnv, getPipelineEnv } from "../../src/lib/env";
import { buildCriteriaParseSystemPrompt, buildSingleCriterionUserPrompt, CRITERIA_PARSE_PROMPT_VERSION } from "../../src/prompts/criteria-parse";
import { LlmCriterionSchema } from "../../src/schema/criteria";
import { appendResults, loadFixture, pct, splitCriteria, stratifiedSample } from "./lib";
import { callJson, CallCap, makeClient, type CallStats, type Mode } from "./llm";

const MAX_CALLS = 600; // probes + 3 tiers x 50 x (1 + retry) + 429 retries, with headroom
const SAMPLE_IDS_PATH = fileURLToPath(new URL("./sample-50.json", import.meta.url));

async function main(): Promise<void> {
  const env = getNebiusEnv();
  const conc = getPipelineEnv().LLM_CONCURRENCY;
  const tiers = [
    ["FAST", env.NEMOTRON_MODEL_FAST],
    ["MID", env.NEMOTRON_MODEL_MID],
    ["DEEP", env.NEMOTRON_MODEL_DEEP],
  ].filter((t): t is [string, string] => !!t[1]);
  if (tiers.length === 0) throw new Error("set NEMOTRON_MODEL_FAST/MID/DEEP");

  const trials = loadFixture();
  const { sample, strata, trials: nTrials } = stratifiedSample(trials.flatMap(splitCriteria));
  writeFileSync(SAMPLE_IDS_PATH, JSON.stringify(sample.map((c) => c.id), null, 2));
  console.log(`sample: ${sample.length} criteria from ${nTrials} trials; strata ${JSON.stringify(strata)}`);

  const client = makeClient();
  const cap = new CallCap(MAX_CALLS);
  const system = buildCriteriaParseSystemPrompt();
  const lines: string[] = [
    `\n## ${new Date().toISOString()} — 02-structured\n`,
    `- Prompt version \`${CRITERIA_PARSE_PROMPT_VERSION}\`; temperature 0; max_tokens 2048; one Zod retry with the validation error fed back; client maxRetries 0 with own 429 backoff (1s,2s,4s).`,
    `- Sample (ids in \`eval/spike/sample-50.json\`): ${sample.length} distinct criteria from ${nTrials} trials (max 2 per trial); strata ${JSON.stringify(strata)}. "compound" is a regex heuristic (multi-conjunction, ';', 'unless/except', >220 chars).`,
    `- Concurrency: ${conc} (LLM_CONCURRENCY). Hard call cap: ${MAX_CALLS}.`,
    `- Zod validity includes semantic refine (fact_key set ⇒ operator+value set; null ⇒ both null).`,
  ];

  // 1) Mode probe
  lines.push("\n### Response-format support (one criterion per cell; 'ok' = accepted by API and Zod-valid on first attempt)\n", "| Tier | json_schema | json_object | prompt_only |", "|---|---|---|---|");
  const probeText = sample[0]!;
  const best: Record<string, Mode> = {};
  for (const [tier, model] of tiers) {
    const cells: string[] = [];
    let chosen: Mode | null = null;
    for (const mode of ["json_schema", "json_object", "prompt_only"] as Mode[]) {
      const { stats } = await callJson({
        client, cap, model, mode, system, schema: LlmCriterionSchema, schemaName: "criterion",
        user: buildSingleCriterionUserPrompt(probeText.type, probeText.text),
      });
      const status = stats.firstValid ? "ok" : stats.finalValid ? "ok after retry" : `fail (${stats.errorKind})`;
      cells.push(status);
      if (!chosen && stats.finalValid) chosen = mode;
    }
    best[tier] = chosen ?? "prompt_only";
    lines.push(`| ${tier} | ${cells.join(" | ")} |`);
    console.log(`${tier}: modes ${cells.join(" / ")} -> using ${best[tier]}`);
  }

  // 2) 50-criteria run per tier
  lines.push("\n### 50-criteria parse (per tier, best supported mode)\n", "| Tier | Mode | First-attempt valid | Valid after 1 retry | p50 ms | p95 ms | prompt tok | completion tok | 429s | other API errs | truncated | fenced | Gate ≥95% |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  const limit = pLimit(conc);
  const notes: string[] = [];
  for (const [tier, model] of tiers) {
    const t0 = performance.now();
    const results: CallStats[] = await Promise.all(
      sample.map((c) =>
        limit(async () => {
          const { stats } = await callJson({
            client, cap, model, mode: best[tier]!, system, schema: LlmCriterionSchema, schemaName: "criterion",
            user: buildSingleCriterionUserPrompt(c.type, c.text),
          });
          return stats;
        }),
      ),
    );
    const wall = Math.round(performance.now() - t0);
    const n = results.length;
    const first = results.filter((r) => r.firstValid).length;
    const fin = results.filter((r) => r.finalValid).length;
    const lat = results.map((r) => r.latencyMs).sort((a, b) => a - b);
    const sum = (f: (r: CallStats) => number) => results.reduce((a, r) => a + f(r), 0);
    const fails = new Map<string, number>();
    results.forEach((r) => r.errorKind && fails.set(r.errorKind, (fails.get(r.errorKind) ?? 0) + 1));
    const gate = fin / n >= 0.95 ? "PASS" : "FAIL";
    lines.push(
      `| ${tier} | ${best[tier]} | ${first}/${n} (${Math.round((100 * first) / n)}%) | ${fin}/${n} (${Math.round((100 * fin) / n)}%) | ${pct(lat, 50)} | ${pct(lat, 95)} | ${sum((r) => r.promptTokens)} | ${sum((r) => r.completionTokens)} | ${sum((r) => r.rateLimited)} | ${sum((r) => r.httpErrors)} | ${results.filter((r) => r.truncated).length} | ${results.filter((r) => r.fenced).length} | ${gate} |`,
    );
    console.log(`${tier}: first ${first}/${n}, final ${fin}/${n}, p50 ${pct(lat, 50)}ms p95 ${pct(lat, 95)}ms, 429s ${sum((r) => r.rateLimited)}, wall ${wall}ms, failures ${JSON.stringify([...fails])}`);
    if (fails.size) notes.push(`  - ${tier} failure kinds: ${[...fails].map(([k, v]) => `${k}×${v}`).join(", ")}`);
    notes.push(`  - ${tier} wall time for ${n} calls at concurrency ${conc}: ${wall} ms`);
  }
  lines.push("\nPer-tier notes:", ...notes);
  lines.push(`\n- Total HTTP calls used (incl. probes, retries, 429 retries): ${cap.used}/${MAX_CALLS}.`);
  appendResults(lines.join("\n") + "\n");
}

main().catch((e: unknown) => {
  console.error(`02-structured failed: ${(e as Error)?.message?.slice(0, 120)}`);
  process.exit(1);
});
