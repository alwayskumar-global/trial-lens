# Hand-built abstention test set (TASKS Phase 3; AUTHOR-CREATED, FICTIONAL, NOT clinician reviewed)

Status 2026-10-07: 30 cases authored, run offline once, **30 of 30 match their pre-written expectations. The TASKS item stays OPEN until Kumar reviews the cases and results.** This is a development check of the deterministic engine layers. It is **not** product validation, it is not an accuracy figure, and no model, network or visitor input is involved.

**Files.** `eval/abstention/cases.ts` (cases, expected outcomes, rationales; committed in `84cef6b` BEFORE any case was run), `eval/abstention/run-case.ts` (runs one case through the real engine), `eval/abstention/run.ts` (`pnpm exec tsx eval/abstention/run.ts`, expected vs actual table), `eval/abstention/abstention.test.ts` (35 vitest tests), `eval/abstention/inspect-internals.ts` (diagnostic: how each typed case was decided). `toLoaderSet()` exports the cases in the harness loader format (AMBIGUOUS exported as gold UNKNOWN because the loader's gold has no AMBIGUOUS).

**Layers and what an expected outcome means.** Each case has one expected criterion status, one expected tier and, for pregnancy cases, one expected panel result; they belong to different layers and are never alternatives. `typed` = hand-written parser output -> `reconcileBatch` (coverage/scope vetting) -> `assessCriterion` (clause evaluation) -> `applyAbstentionGuard`. `model_finding` = a fixture free-text finding -> `applyAbstentionGuard`. Tier = a one-criterion trial after `tierTrialCeiled` (TIER_UNKNOWN_THRESHOLD 3, R2 ceiling). Panel = `studyTeamQuestions` for a one-study trial. Pregnancy cases follow the current engine and panel (the answer path was removed): `pregnant=false` does not satisfy a negative pregnancy test or its timing; contraception requirements stay unresolved without their own evidence; childbearing potential is never inferred from age, sex or menopause. Conditional cases allow a vacuous PASS only when non-applicability is proven by a known fact (ab-25); unrepresented or unproven conditions stay UNKNOWN (ab-26, ab-27, ab-30).

**Groups (30):** fact known 6 (ab-01..06), fact absent 6 (07..12), uncertain 4 (13..16), clinical judgment 4 (17..20), unsupported evidence 4 (21..24), conditional 3 (25..27), pregnancy 3 (28..30). Expected statuses: PASS 5, FAIL 2, UNKNOWN 22, AMBIGUOUS 1.

**Result (run once, after the cases were committed):** 30 of 30 match. Mechanisms confirmed from the internals diagnostic: ab-17, 18, 19, 28 and 30 were decided by vetting (`atoms_downgraded`), ab-25 PASS cites `age` with applicability `not_applicable`, ab-26 and ab-27 show applicability `unknown`.

**Limits, stated plainly.**
1. The author knew the engine's rules when writing expectations, so agreement shows the code follows its documented rules on these inputs; it does not show the rules are clinically right.
2. Parser output is hand-written, so this does not test the parsing model.
3. ab-28 and ab-30 were stopped at vetting (a negated `false` assertion; unaccounted words), not by the dedicated semantic guards (`pregnancy_test_is_not_pregnancy_status`, source-must-mention-fact). Those guards are not isolated by this set; a case that passes vetting but trips only the semantic guard is a candidate addition, not written.
4. The abstention guard checks that cited keys are known, not that they are relevant: a PASS citing an irrelevant known key would survive. Not tested here (no expected outcome was written for it); it is a known property of the guard.
5. One criterion per trial: multi-criterion tier interactions and the unknown-count threshold are not exercised.
6. Not clinician reviewed; fictional wording and values; no real patient or dataset text.

No model call, visitor input, replay backfill or Production change.
