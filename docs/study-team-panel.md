# "Questions worth asking the study team" panel (Option B; Kumar approved the scope 2026-10-10; UI mockups awaiting approval)

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
