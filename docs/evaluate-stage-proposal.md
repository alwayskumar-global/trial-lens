# Evaluate-stage proposal (NO-CALL; for review; nothing changed)
2026-10-07. The free-text evaluate stage (`free_text_evaluation`, one MID call per trial with open partial criteria) is KEPT for this change. Under the fail-closed rule its PASS/FAIL output is always downgraded (0 accepted in the offline projection), so what remains of its value is its UNKNOWN/AMBIGUOUS output. No paid or model call was made to write this; all figures are from stored fictional replays and recorded spike measurements.

## Inventory of every consumer of the stage's UNKNOWN/AMBIGUOUS output
1. **Criterion row status and glyph** (`statusOf`, `CriterionRow`): UNKNOWN shows "unknown"; AMBIGUOUS shows "judgment" (needs a closer read). The two differ only for AMBIGUOUS; **the three stored replays contain no AMBIGUOUS finding** (model rows: UNKNOWN 291 / 320 / 357 before the change).
2. **"Automated note"**: shown only for `source: "llm_mid"` rows, with the model's rationale. Stage removal would drop these notes on every model-evaluated UNKNOWN row (291 / 320 / 357 rows in the stored replays, plus the 44 / 28 / 38 downgraded rows that now show the fixed sentence).
3. **Tier** (`retier` after the stage): UNKNOWN/AMBIGUOUS count against the unknown threshold and, on core criteria, force UNCERTAIN. A model UNKNOWN and a code UNKNOWN count the same, so the tier does not change when the stage is removed, only if the stage produced AMBIGUOUS (none stored) or PASS/FAIL (now always downgraded).
4. **Verification stage selection** and order: depends on the tier after evaluation and on the number of non-PASS rows per trial; unchanged by removal given the same statuses.
5. **Fail checks (Rule D)**: only FAIL findings; model FAILs are now downgraded before this stage, so it sees code FAILs only (stored trials with a code FAIL: 1 / 1 / 0, with a model FAIL: 8 / 8 / 10).
6. **Study-team panel** (`studyTeamQuestions`): scoring criteria that are UNKNOWN or AMBIGUOUS; identical for model and code UNKNOWN.
7. **`top_unknown`** (first open scoring criterion) and the card model's unknown counts: same equivalence.
8. **Budget and accounting**: `RunBudget` evaluate slots (shared pool, after parse; unused reserve released forward), `done.stats.usage` rows (`evaluate`), `docs/cost-per-run.md` call-shape text, `eval/cost-per-run.ts` constants, the live stage list label "Comparing wording that needs a closer read" (`copy.ts`, a UI string).
9. **Offline/eval consumers**: the harness's UNKNOWN-detection precision/recall and unsupported-assumption counters read statuses and `guard_downgraded`; replay generation (`precompute-replay.ts`) would store whatever the stage returns.

## What is NOT known (no saving is estimated)
Kumar's instruction (2026-10-07): the evaluate-stage calls stay unchanged, and because their latency and token cost have not been measured, **no saving from removing them is estimated here** (an earlier draft of this file quoted call-share percentages and a latency inference; they are withdrawn). What exists is only counts of what the stored fictional replays hold: trials with model-evaluated rows 26 / 26 / 28 of 30 (a count of rows, not of calls), model-evaluated UNKNOWN rows 291 / 320 / 357 before the change, and trials with a model FAIL 8 / 8 / 10 against a code FAIL in 1 / 1 / 0. Per-stage latency and evaluate token counts require a live run that Kumar authorizes (`done.stats.usage` and per-stage wall time would then be recorded). Until then the call-budget and wall-time effects of keeping, shrinking or removing the stage are unknown.
- **One qualitative point that needs no measurement:** model FAILs no longer reach Rule D (the guard runs first), so the fail-check stage sees code FAILs only whichever option is chosen.
- **What removal would change for a visitor (not a saving):** the model's notes on UNKNOWN rows and the AMBIGUOUS "judgment" state (unused in the stored replays) would disappear.

## Options (none chosen)
A. Keep the stage unchanged (this change, as instructed); revisit with measured usage from an authorized live run.
B. Keep the call but request only UNKNOWN/AMBIGUOUS-with-note (smaller output, same consumers); needs a prompt change and a prompt-version bump.
C. Remove the stage; update `copy.ts`, `run-plan.ts` allocation, cost docs and stage tests; accept the loss of notes and of the AMBIGUOUS state.
D. Keep it, but only for criteria whose parse could be AMBIGUOUS in a useful way (needs a definition not yet written).
Acceptance for any change: replay and live consumers above re-traced, stored-replay before/after repeated, and measured per-stage usage from a live run before the budget is touched.
