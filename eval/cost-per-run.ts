// ARITHMETIC ONLY: no network, no model call. Cost of one run of the pipeline from the account's per-token prices (confirmed from the Token Factory
// account API on 2026-10-07) and measured/bounded token counts. Run: pnpm exec tsx eval/cost-per-run.ts
// Measured (docs/spike-results.md, docs/hardened-1-dev-check.md): parse calls ≈ 2.8k prompt / 2.2k completion with parser thinking OFF
// (128,314 / 102,381 over 46 calls) and ≈ 2.3k / 6.6k with thinking ON (103,907 / 305,346 over the 46 parse calls). Free-text evaluation, verify and
// fail-check token counts were NOT recorded before run stats gained `usage` (u-1): they use the parse call as a proxy until a separately approved live
// run records them, and the upper bound uses the stage's max_tokens.
//
// PROJECTED WORST-CASE COST IS A FORECAST, NOT A LIMIT. The only enforced limits are call counts: MAX_LLM_CALLS_PER_RUN per run (RunBudget and CallCap)
// and DAILY_RUN_BUDGET runs per day (run guard). There is no dollar-denominated enforcement anywhere in the code.
import { SLOT_COST } from "../src/lib/engine/run-plan";

export const PRICE = { FAST: { p: 6e-8, c: 2.4e-7 }, MID: { p: 3e-7, c: 9e-7 }, DEEP: { p: 1e-6, c: 3e-6 } } as const; // per token
export const cost = (t: keyof typeof PRICE, prompt: number, completion: number): number => prompt * PRICE[t].p + completion * PRICE[t].c;

export const DEFAULTS = { maxCalls: 80, dailyRuns: 150 } as const; // MAX_LLM_CALLS_PER_RUN, DAILY_RUN_BUDGET (unchanged)

/** Typical run: `calls` HTTP calls (1 FAST extraction + the rest MID), measured 41 on the Preview run, 34 in the spike e2e runs. */
export const typicalRun = (calls: number, midPrompt: number, midCompletion: number): number => cost("FAST", 700, 3000) + (calls - 1) * cost("MID", midPrompt, midCompletion);

/**
 * Projected worst case for ONE run under the call cap: `maxCalls / SLOT_COST` slots, 1 FAST (extraction) slot and the rest MID; every slot uses
 * both of its calls (call + retry), each at max_tokens 8192 (verify's 4096 is rounded up) with a 4,000-token MID prompt and a 700-token FAST prompt.
 */
export function worstCasePerRun(maxCalls: number = DEFAULTS.maxCalls): number {
  const slots = Math.floor(maxCalls / SLOT_COST);
  return SLOT_COST * cost("FAST", 700, 8192) + Math.max(0, slots - 1) * SLOT_COST * cost("MID", 4000, 8192);
}

export interface BudgetCheck {
  /** projected worst-case daily cost = dailyRuns × worst case per run; a forecast, not an enforced limit */
  worstPerRun: number;
  worstDaily: number;
  /** typical daily cost range from the proxy figures (thinking OFF .. thinking ON), 41 calls */
  typicalDailyLow: number;
  typicalDailyHigh: number;
  /** true only if the PROJECTED worst-case daily cost fits inside the proposed daily dollar figure */
  fitsWorstCase: boolean;
  fitsTypicalHigh: boolean;
  /** largest dailyRuns whose projected worst-case daily cost fits the dollar figure (0 if even one run does not fit) */
  maxRunsAtWorstCase: number;
  maxRunsAtTypicalHigh: number;
  /** always "call-count-only": the code enforces runs and calls, never dollars */
  enforcement: "call-count-only";
}

/**
 * Run BEFORE changing MAX_LLM_CALLS_PER_RUN or DAILY_RUN_BUDGET: does `dailyRuns` runs/day at the cap fit the proposed daily dollar figure when every
 * run is a worst-case run? Passing is a projection only (prices, token use or retries can change); it is not a spending limit.
 */
export function checkDailyBudget(a: { dailyDollars: number; dailyRuns?: number; maxCalls?: number }): BudgetCheck {
  const dailyRuns = a.dailyRuns ?? DEFAULTS.dailyRuns;
  const maxCalls = a.maxCalls ?? DEFAULTS.maxCalls;
  const worstPerRun = worstCasePerRun(maxCalls);
  const lowPerRun = typicalRun(41, 2800, 2200);
  const highPerRun = typicalRun(41, 2300, 6600);
  const fit = (perRun: number) => Math.max(0, Math.floor(a.dailyDollars / perRun));
  return {
    worstPerRun, worstDaily: worstPerRun * dailyRuns,
    typicalDailyLow: lowPerRun * dailyRuns, typicalDailyHigh: highPerRun * dailyRuns,
    fitsWorstCase: worstPerRun * dailyRuns <= a.dailyDollars, fitsTypicalHigh: highPerRun * dailyRuns <= a.dailyDollars,
    maxRunsAtWorstCase: fit(worstPerRun), maxRunsAtTypicalHigh: fit(highPerRun),
    enforcement: "call-count-only",
  };
}

if (process.argv[1]?.endsWith("cost-per-run.ts")) {
  const rows: Array<[string, number]> = [
    ["typical, proxy = parse call, thinking OFF (2.8k in / 2.2k out), 41 calls", typicalRun(41, 2800, 2200)],
    ["typical, proxy = parse call, thinking ON (2.3k in / 6.6k out), 41 calls", typicalRun(41, 2300, 6600)],
    ["warm cache, thinking OFF proxy, 34 calls", typicalRun(34, 2800, 2200)],
    [`projected worst case under the ${DEFAULTS.maxCalls}-call cap (all retried, all at max_tokens)`, worstCasePerRun()],
  ];
  for (const [n, c] of rows) console.log(`${n}: $${c.toFixed(3)} per run; × ${DEFAULTS.dailyRuns} runs/day = $${(c * DEFAULTS.dailyRuns).toFixed(2)}/day`);
  const dollars = Number(process.argv[2]);
  if (Number.isFinite(dollars) && dollars > 0) {
    const r = checkDailyBudget({ dailyDollars: dollars });
    console.log(`\nCheck for a proposed $${dollars}/day at ${DEFAULTS.dailyRuns} runs/day (a PROJECTION; the code enforces call counts only, never dollars):`);
    console.log(`  worst case $${r.worstDaily.toFixed(2)}/day -> ${r.fitsWorstCase ? "fits" : "DOES NOT FIT"}; largest runs/day that fit the worst case: ${r.maxRunsAtWorstCase}`);
    console.log(`  typical $${r.typicalDailyLow.toFixed(2)}-$${r.typicalDailyHigh.toFixed(2)}/day -> upper typical ${r.fitsTypicalHigh ? "fits" : "DOES NOT FIT"}; largest runs/day at upper typical: ${r.maxRunsAtTypicalHigh}`);
  } else console.log("\nPass a proposed daily dollar figure as the first argument to check it against the projected worst case.");
}
