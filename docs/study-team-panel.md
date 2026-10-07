# "Questions worth asking the study team" panel (Option B; scope and mockups approved with revisions, Kumar 2026-10-10; built, layout screenshots awaiting review)

Engine (built, tested): `src/lib/engine/study-questions.ts` (`studyTeamQuestions`), 9 tests. Offline output for the three prepared fictional profiles: `eval/reports/study-questions-offline.json` (`eval/study-questions-offline.ts`, read-only, no model calls).

## Rules (as specified by Kumar)
- Title: **Questions worth asking the study team**. Never "most decisive", "blocks the most trials", "answering will", or anything about a tier moving. No answer buttons.
- Rank: number of **distinct studies** with a traceable unresolved scoring criterion for the topic; several criteria in one study count once. Ties: topic key ascending. Up to 3 topics.
- Each topic lists its studies, each linked to ClinicalTrials.gov by NCT id, with the **original criterion wording** (verbatim) and whether it is an inclusion or exclusion criterion.
- Unsupported dependencies are **omitted**: a (criterion, topic) pair needs a scoring criterion with finding UNKNOWN/AMBIGUOUS, a parsed reference to the fact, a cue for the fact in the original wording (strict cues for `prior_other_malignancy` and `days_since_last_systemic_therapy`, so "cancer" or "treatment" alone do not support them), and the fact not already known in the profile. Pregnancy-related and non-askable facts (age, sex) are never offered.
- Copy says the study team can confirm the detail. R2 and the fictional-profile wording rules in `docs/copy-rules.md` apply (no "verified", no "your results" for a fictional profile).

## Offline result on the prepared profiles (cached parses; counts are distinct studies)
her2pos-stage3 and hrpos-stage2: ECOG 10, measurable disease 3, disease setting 2. tnbc-caregiver: ECOG 9, measurable disease 3, disease setting 2. (`prior_other_malignancy` and `days_since_last_systemic_therapy` produce no supported item.)

## Mockups (shown to Kumar as images, not committed)
Desktop: the panel sits in the right rail where the old question card was, same card style; items numbered; each shows "Open in N studies" and a "Show studies and criterion wording" disclosure; closing line says the list does not change the results shown. Mobile: a collapsed disclosure ("Questions worth asking the study team (3)") at the top, as the old card's position; expanded shows the same items. Differences from the old card: no answer chips; no "sharpen N of M trials" line. Open points for Kumar: drop the duplicate heading inside the mobile disclosure; wording of the closing line (use "the results shown", not "your results"); whether to show a "Copy" action (not included); empty state (proposal: hide the panel).

## Built (2026-10-10)
- Event `study_questions` (`sq-1`, `src/schema/sse.ts`), emitted by the pipeline at stage `questions` instead of the legacy answer-oriented `question` event; nothing is emitted if the computation fails. Reducer state `studyQuestions` (null = not reported, [] = ran and found none).
- Component `src/components/results/StudyTeamPanel.tsx`: desktop card in the right rail; mobile collapsed disclosure with the title once (no repeated inner heading); closing note "These questions relate to the prepared fictional profile. They do not change the results shown."; no Copy; small neutral empty state "No question could be identified from the criteria assessed in this run." (never hidden; not shown when the event never arrived).
- Fixed bundled demo: question card and rail removed, Results is one column; the dead answer wiring (answer state, tier moves, `MOVES`, `ADAPTIVE_QUESTION`, `QuestionCard`) is removed. Its sample cards and labels are unchanged; no fictional questions, no ClinicalTrials.gov links there.
- Live Processing stage label for `questions` is now "Listing questions worth asking the study team" (pending Kumar's review of the live Processing screen).

## Replay data: NOT written (validation stopped)
`eval/replay-study-questions.ts` dry-run (read-only): `tnbc-caregiver` validates (30 assessed trials, 9 + 3 + 2 distinct studies, every NCT id and criterion matches its stored `trial_result`). `her2pos-stage3` and `hrpos-stage2` stop with `missing_parse:NCT05693766`: that trial's stored result is neither pending nor failed (23 criteria, completeness mixed partial/unresolved) but `trial_criteria_cache` holds no row for it under any parser version. Per the agreed rule nothing was stored, for any case (all-or-nothing). No Supabase write has happened.
