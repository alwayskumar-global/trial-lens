# Copy rules (versioned)

Version 2 (2026-10-06). Replaces the copy-rule block in the local-only CLAUDE.md as the versioned source of truth; the local file may lag. Enforced by `src/lib/ui/copy-audit.test.ts` (banned words) and review.

## Always
- Never write "eligible", "you qualify", "you will be accepted", "enroll" (the concept noun "eligibility" is allowed). Use Potential match / Possible match / Uncertain / Likely mismatch.
- Never advise starting, stopping, delaying or changing treatment to fit a trial. For timing criteria: "Timing of previous treatment may affect eligibility. Ask the study team."
- Always show the original criterion text. A shortened quote is labelled "Criterion excerpt", is never cut off or merged to explain a tier, and the full wording is one tap away.
- A persistent banner on Results and Detail: it screens public criteria against information provided, does not determine eligibility, and only a study team can.
- Demo uses fictional profiles only. Replay is always labelled "Saved fictional example".
- Say "TrialLens does not store your information". Do not strengthen it until Token Factory retention terms are verified.
- Pending ("Not analyzed this run") and failed ("Couldn't be read") trials stay Uncertain with their own explanation; they are never shown as matches or mismatches.

## Reported facts are never presented as verified (Policy R2)
Every fact is the visitor's own statement; TrialLens verifies none of them. No screen may say or imply that facts, information, a diagnosis or records were verified or confirmed. The internal flags `reported_only` and `reported_conflict` and the value `fail_check: "verified"` are machine fields and are never mapped to visitor text. `verified: true` may only be shown as "a second automated check found no conflict" with the existing approved wording, and it is false for a reported conflict. Enforced by `src/lib/ui/copy-audit.test.ts` and `src/components/live/live.test.tsx`.

## Live mode refers to the profile, not the visitor
Live mode sends a prepared fictional profile to `/api/run`; visitors provide no information. Live Processing, counts, cards, Detail and the banner say "the prepared fictional profile" (replay: "the fictional profile"), never "what you told us", "your information", "your info", "your age and sex" or "your description" (enforced by `copy-audit.test.ts`). Replay notices keep their fallback reason and state "This page shows saved results for a fictional profile. No new analysis is running." When real visitor input exists, the original wording returns.

## Final call to action (approved exception, Kumar, 2026-10-06)
The previous rule was: "Final CTA is Contact study team, never Enroll."

**Until the product has study contact data, the final CTA is "Open on ClinicalTrials.gov"** (the official study page lists locations and contacts). It never says "Enroll". When contact data exists (fetched and verified), return to "Contact study team" and update this file.

## Adaptive questions: a counterfactual lift is a prediction, not a promise (Kumar, undated; recorded 2026-10-07)
A question exists only if at least one answer has a measured counterfactual lift (zero-gain questions are filtered, `computeQuestions`). That lift is computed on stored findings and is a PREDICTION until the full answer re-evaluation has run. Copy for any question card must say an answer **may clarify results** (for example "Answering may clarify some of these results"). It must not say or imply that a tier will change, that a trial will move to Possible, or how many trials will move. After a re-evaluation the screen shows what actually changed. The "no question" state keeps the approved wording that no single answer would change these results right now. Add the matching phrases to `copy-audit.test.ts` when the question card is built (Stage 3, paused).
