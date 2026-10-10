# Cost per run (2026-10-07; arithmetic only, no model call)

TASKS item advanced: Phase 1 "Latency/cost". Script: `eval/cost-per-run.ts` (pure arithmetic from constants).

**Prices** (Token Factory account API `/models?verbose=true`, per token, read 2026-10-07): FAST `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` $0.00000006 / $0.00000024; MID `nvidia/nemotron-3-super-120b-a12b` $0.0000003 / $0.0000009; DEEP `nvidia/Nemotron-3-Ultra-550b-a55b` $0.000001 / $0.000003. The shipped pipeline calls only FAST (extraction) and MID (parse, free-text evaluation, verification, fail-checks); DEEP escalation is not built.

**Call shape.** `MAX_LLM_CALLS_PER_RUN` = 80 and every slot reserves two calls (call + retry), so at most 40 slots: 1 FAST (extraction) and 39 MID. Measured: 34 HTTP calls (spike e2e, cold and warm), 41 on the real Preview run (93.2 s).

| Case | Per run | At `DAILY_RUN_BUDGET` = 150 |
|---|---|---|
| typical, 41 calls, parse-call proxy with parser thinking OFF (2.8k in / 2.2k out) | $0.114 | $17/day |
| typical, 41 calls, proxy with thinking ON (2.3k in / 6.6k out) | $0.266 | $40/day |
| warm parse cache, 34 calls, thinking-OFF proxy | $0.094 | $14/day |
| **projected worst case** under the 80-call cap (every call retried, each at max_tokens, 4,000-token prompts): a forecast, not a limit | $0.673 | $101/day |

**What is measured and what is not.** Parse-call tokens are measured (`docs/spike-results.md`). Token counts of free-text evaluation, verification and fail-check calls were not recorded when the figures in this section were derived, so "typical" uses the parse call as a proxy and the upper bound uses each stage's `max_tokens`. Since then two approved live runs recorded real per-stage usage for extraction, parse, evaluate and verify (see "Measured usage" at the end); fail-check calls did not run in either (no FAIL finding), so their tokens are still unmeasured. Which of the thinking-OFF/ON figures matches the shipped `reasoning_effort: low` setting is not measured; treat the real typical cost as inside the $0.09-$0.27 range, not at a point. The daily figures assume all 150 runs are live; replay runs cost nothing.

**Not decided here.** `MAX_LLM_CALLS_PER_RUN` (80) and `DAILY_RUN_BUDGET` (150) are unchanged. Choosing them needs Kumar's credit budget for the demo window below.

## Projected worst-case cost is not an enforced dollar limit
- **Projected worst case** is arithmetic: call cap x `max_tokens` x account prices (`worstCasePerRun` in `eval/cost-per-run.ts`; it follows `MAX_LLM_CALLS_PER_RUN` through `SLOT_COST`). It forecasts the most one run could cost *if the cap is the only thing that stops it* and prices and prompt sizes are as assumed.
- **What is actually enforced** is call counts only: `MAX_LLM_CALLS_PER_RUN` per run (`RunBudget` slots plus the hard `CallCap`) and `DAILY_RUN_BUDGET` runs per day (run guard). **There is no dollar-denominated limit anywhere in the code.** If prices rise, prompts grow, or token use per call changes, the real cost per run moves while the enforced limits do not, so the projected figures must be re-derived.
- A dollar guard (for example a daily token or dollar counter checked before each run) would be a separate change and a decision for Kumar; it is not built.

## Checking a proposed daily budget before changing the run limit
Nothing is changed until Kumar sets a budget. When he does, run this first (pure arithmetic, no network):

`pnpm exec tsx eval/cost-per-run.ts <proposed daily dollars>`

It reports, for the current 80-call cap and 150 runs/day: projected worst-case daily cost = `DAILY_RUN_BUDGET x worst case per run`, the typical range, whether the worst case fits the dollar figure, and the largest runs/day that fit. Procedure:
1. Choose the dollar figure D for a day.
2. Require `DAILY_RUN_BUDGET x worstCasePerRun(MAX_LLM_CALLS_PER_RUN) <= D` (the worst case fits), or choose to accept the risk knowingly and require the upper typical figure to fit.
3. If it does not fit, the output gives the largest `DAILY_RUN_BUDGET` that does (or lower `MAX_LLM_CALLS_PER_RUN`; `checkDailyBudget({maxCalls})` shows the effect).
4. Only then change `DAILY_RUN_BUDGET` and/or `MAX_LLM_CALLS_PER_RUN`, re-run the offline tests, and re-run the check after any price change.
Example with a PLACEHOLDER of $200/day (not a decision): worst case $100.90/day fits (up to 297 worst-case runs/day); typical $17-$40/day fits.
A pass is a projection: it does not cap spending, it only shows the cap and the budget agree.

## Recording actual usage (built, offline-tested; collected on two approved live runs, see "Measured usage" below)
Run stats now carry per-stage, per-model token counts: `done.stats.usage` (version `u-1`): rows of `stage` (extraction, parse, evaluate, verify, mismatch), `tier`, `model`, `calls`, `calls_with_usage`, `calls_without_usage`, `prompt_tokens`, `completion_tokens`, plus a `total`. Rules: counts and labels only (no prompts, profile text, responses, criterion text or secrets, in events or in the server log line); **a missing provider `usage` is unavailable, never zero**: token fields are `null` when no call in the group reported complete usage, and a group with `calls_without_usage > 0` is a **lower bound**; a call that sent no request is not counted. The server log line for a live run carries the totals as integers and omits the token fields when unavailable. `/api/extract` has its own handler and is not included. Actual numbers were collected on two separately approved live runs (see "Measured usage" below). Fail-check tokens remain unmeasured; the proxy figures in the table above are kept for a fuller run.

## Demo window to budget for
**Dates (official Devpost rules for the Nebius x NVIDIA Global AI Hackathon, https://nebiusglobalaihackathon.devpost.com/rules, checked directly by Kumar; the page is not reachable from this environment, so Kumar is the source for this check):**
- Submission deadline: **Oct 30, 2026 10:00 am PDT** (= 17:00 UTC = 22:30 IST).
- Judging Period: **Dec 1, 2026 to Dec 15, 2026** (a web-search excerpt of the rules gives Dec 1 9:00 am PT to Dec 15 12:00 pm PT).
- Winners announced: **approximately Jan 11, 2027**.
- Availability duty (rules wording as seen in the excerpt): entrants "must make their projects available free of charge and without any restriction, for testing, evaluation and use by the Sponsor, Administrator and Judges until the Judging Period ends."

**Planning window.** From our actual submission date through the end of judging (Dec 15). The target submission is the evening of Oct 29 IST (TASKS.md); the actual submission date is **undated until it happens**, and the window starts then, not before. Judging (Dec 1-15) is treated as the likely higher-use period inside that window; the earlier part (submission to Dec 1) also needs the demo live, free and open. The budget decision therefore needs both a daily figure for the pre-judging stretch and one for judging, or one figure that covers the heavier period. Winners-announcement day is outside the window.

**Open question for the organizers (not assumed, not resolved here).** The rules require testing access "free of charge and without any restriction". We do not assume that falling back to the saved fictional replay when a limit is hit (per-IP rate limit, `DAILY_RUN_BUDGET`, model or guard unavailable) satisfies that language for live testing. Question to send (wording for Kumar to approve): "Our demo analyzes a fictional profile live on Nebius Token Factory. To protect the credits and the service we use a per-IP rate limit and a daily cap on live runs; when a limit is reached the demo shows a clearly labelled saved result of a fictional profile instead. Does that satisfy the requirement that the project be available free of charge and without restriction to Judges and Sponsor for testing during the Judging Period, or must live runs stay available to judges beyond those limits (for example via an exemption or separate judge instructions)?" Until answered, rate limiting and the security controls stay exactly as they are; nothing is relaxed.


## Measured usage (two approved live Preview runs, fictional sample, cache writes OFF; 2026-10-07 and 2026-10-08)
Source: `done.stats.usage` (`u-1`). Counts only. Cost is ESTIMATED from reported tokens x the account prices above; it is not an invoice. Both runs used the same prepared sample against a cache of 33 then 39 stored parses; only parse slots (14) were spent on cold trials, so 21-23 of 30 trials stayed `analysis_pending` (cold-cache capacity, not failures).

| Stage / tier | Run 1 calls | tokens in / out | Run 2 calls | tokens in / out |
|---|---|---|---|---|
| extraction / FAST | 1 | 639 / 4,660 | 1 | 647 / 2,210 |
| parse / MID | 14 | 28,456 / 23,112 | 14 | 26,406 / 22,822 |
| evaluate / MID | 7 | 10,389 / 7,305 | 9 | 6,763 / 6,000 |
| verify / MID | 2 | 1,937 / 431 | 1 | 439 / 197 |
| fail checks | 0 | | 0 | |
| **Total** | **24 logical, 25 HTTP attempts** | **41,421 / 35,508** | **25 logical, 25 HTTP attempts** | **34,255 / 31,229** |
| Estimated cost | | **about $0.041** | | **about $0.037** |

- `llm_calls` (what the 80 cap counts) is HTTP request ATTEMPTS including 429 and validation retries; usage `calls` counts LOGICAL model calls. Run 1 had one extra attempt (a retry), run 2 none. All logical calls reported complete usage in both runs; attempts that return no response (429, errors) carry no tokens.
- `worst_case_calls` reported 48 (run 1) and 50 (run 2): the run plan's structural bound for those runs, below the 80 cap. Not proven as a general bound.
- These two runs are far below the earlier $0.09-$0.27 proxy range because only 7-9 trials got an evaluate slot and fail checks never ran (no FAIL finding). A run with more trials assessed (warmer cache) would cost more; the proxy range and the $0.67 forecast stand until such a run is measured. Still no dollar-denominated limit in code.
- Duration: 58.2 s and 58.3 s at the client (application wall time 57.5 s on run 1 and 41.1 s on run 2). On run 2 the client duration exceeds the application wall time by about 17 s; that is an unexplained gap between application wall time and client duration, and its location has not been established. All `trial_result` events are emitted after the final stage, so the client sees results at the end.


## Measured usage: one-time cache warm-up (2026-10-10; 55 parse chunks, MID, strictly sequential, fictional-free public trial text only)
- 63 attempts (55 first attempts + 8 validation retries); every one returned a reply with reported usage (0 unavailable, 0 rate-limited, 0 timeouts or errors).
- Tokens: 128,554 prompt and 107,880 completion, about 2,040 in and 1,710 out per attempt, in line with the live-run parse averages (1.9-2.0k in, 1.6-1.65k out).
- **Estimated cost $0.1357** from reported usage (expected from the measured average: $0.1155 for 55 first attempts; the 8 retries account for the difference). The conditional reservation (budget $0.75, ceiling 110) never halted; no assumption (prompt tokens <= body bytes + 64; completion <= max_tokens; usage reported) was violated in 63 attempts. This is an estimate from reported usage, not an invoice; the Token Factory Usage tab is the check.
- 26 of 31 planned trials were written; 5 chunks failed validation twice and were skipped.
