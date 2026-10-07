// ARITHMETIC ONLY: no network, no model call. Cost of one run of the pipeline from the account's per-token prices (confirmed from the Token Factory
// account API on 2026-10-10) and measured/bounded token counts. Run: pnpm exec tsx eval/cost-per-run.ts
// Measured (docs/spike-results.md, docs/hardened-1-dev-check.md): parse calls ≈ 2.8k prompt / 2.2k completion with parser thinking OFF
// (128,314 / 102,381 over 46 calls) and ≈ 2.3k / 6.6k with thinking ON (103,907 / 305,346 over the 46 parse calls). Free-text evaluation, verify and
// fail-check token counts were NOT recorded anywhere: they use the parse call as a proxy, and the upper bound uses the stage's max_tokens.
const PRICE = { FAST: { p: 6e-8, c: 2.4e-7 }, MID: { p: 3e-7, c: 9e-7 }, DEEP: { p: 1e-6, c: 3e-6 } } as const; // per token
const cost = (t: keyof typeof PRICE, prompt: number, completion: number) => prompt * PRICE[t].p + completion * PRICE[t].c;

const MAX_CALLS = 80; // MAX_LLM_CALLS_PER_RUN; every slot reserves 2 calls (call + retry) → 40 slots, 1 FAST (extraction) and 39 MID
const DAILY_RUNS = 150; // DAILY_RUN_BUDGET

// Typical run: 41 HTTP calls measured on the Preview run (1 FAST extraction + 40 MID), 34 in the spike e2e runs.
const typical = (calls: number, midPrompt: number, midCompletion: number) => cost("FAST", 700, 3000) + (calls - 1) * cost("MID", midPrompt, midCompletion);
// Hard upper bound for ONE run under the cap: all 80 calls used (every slot retried), each at its max_tokens (8192; 4096 for verify) and a 4,000-token prompt.
const worst = 2 * cost("FAST", 700, 8192) + (MAX_CALLS - 2) * cost("MID", 4000, 8192);

const rows: Array<[string, number]> = [
  ["typical, proxy = parse call, thinking OFF (2.8k in / 2.2k out), 41 calls", typical(41, 2800, 2200)],
  ["typical, proxy = parse call, thinking ON (2.3k in / 6.6k out), 41 calls", typical(41, 2300, 6600)],
  ["warm cache, thinking OFF proxy, 34 calls", typical(34, 2800, 2200)],
  ["hard upper bound under the 80-call cap (all retried, all at max_tokens)", worst],
];
for (const [n, c] of rows) console.log(`${n}: $${c.toFixed(3)} per run; × ${DAILY_RUNS} runs/day = $${(c * DAILY_RUNS).toFixed(2)}/day`);
console.log("Runs per $10 of credit: " + rows.map(([, c]) => Math.floor(10 / c)).join(" / ") + " (same order as above)");
