# Cost per run (2026-10-10; arithmetic only, no model call)

TASKS item advanced: Phase 1 "Latency/cost". Script: `eval/cost-per-run.ts` (pure arithmetic from constants).

**Prices** (Token Factory account API `/models?verbose=true`, per token, read 2026-10-10): FAST `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` $0.00000006 / $0.00000024; MID `nvidia/nemotron-3-super-120b-a12b` $0.0000003 / $0.0000009; DEEP `nvidia/Nemotron-3-Ultra-550b-a55b` $0.000001 / $0.000003. The shipped pipeline calls only FAST (extraction) and MID (parse, free-text evaluation, verification, fail-checks); DEEP escalation is not built.

**Call shape.** `MAX_LLM_CALLS_PER_RUN` = 80 and every slot reserves two calls (call + retry), so at most 40 slots: 1 FAST (extraction) and 39 MID. Measured: 34 HTTP calls (spike e2e, cold and warm), 41 on the real Preview run (93.2 s).

| Case | Per run | At `DAILY_RUN_BUDGET` = 150 |
|---|---|---|
| typical, 41 calls, parse-call proxy with parser thinking OFF (2.8k in / 2.2k out) | $0.114 | $17/day |
| typical, 41 calls, proxy with thinking ON (2.3k in / 6.6k out) | $0.266 | $40/day |
| warm parse cache, 34 calls, thinking-OFF proxy | $0.094 | $14/day |
| hard upper bound under the 80-call cap (every call retried, each at max_tokens, 4,000-token prompts) | $0.673 | $101/day |

**What is measured and what is not.** Parse-call tokens are measured (`docs/spike-results.md`). Token counts of free-text evaluation, verification and fail-check calls were never recorded, so "typical" uses the parse call as a proxy and the upper bound uses each stage's `max_tokens`. Which of the thinking-OFF/ON figures matches the shipped `reasoning_effort: low` setting is not measured; treat the real typical cost as inside the $0.09-$0.27 range, not at a point. The daily figures assume all 150 runs are live; replay runs cost nothing.

**Not decided here.** `MAX_LLM_CALLS_PER_RUN` (80) and `DAILY_RUN_BUDGET` (150) are unchanged. Choosing them needs Kumar's credit budget for the judging period (Dec 1-15, demo live and unrestricted): daily runs = floor(daily dollars / typical cost), and the worst-case figure bounds the downside. A cheap way to learn the real typical cost is to record `usage` tokens per stage on the next live run (counts only), which needs no extra model call.
