# Live / replay / pending UI: PROPOSAL for Kumar's approval (nothing built)

Status: **awaiting approval**. The app still ships the fixed fictional demo. Mockups were rendered from the real components and real stored replay data (CT.gov text; kept out of the repo). Three trials were marked pending and one failed in the mockups only, because the stored replay has none.

## Principles
1. A number appears only after its event arrives. No percentages, no durations, no "usually under a minute", no waiting rows for steps that have not started.
2. Replay never imitates live processing: no Processing screen, no stage list. It goes straight to results and is labelled in the header, in a notice, and in the safety banner.
3. If a live stream falls back after partial events, the client **discards everything received before the `mode: replay` event**, then renders the replay. No mixed state.
4. `assessed`, `pending`, `failed` are always shown separately. Pending and failed trials are UNCERTAIN with different explanations, and are never presented as matches or mismatches.
5. Detail shows the verbatim criterion and the official ClinicalTrials.gov link. The plain-language column is removed until rewrites exist.

## Copy
| Where | Copy |
|---|---|
| Header tag (live) | `Live run` |
| Header tag (replay) | `Saved fictional example` (persistent on every replay screen) |
| Live banner (Results/Detail) | The existing approved wording: "TrialLens compares public trial criteria with what you told us. It can't confirm eligibility. Only a study team can." |
| Replay banner | "This example compares public trial criteria with a fictional profile. It can't confirm eligibility. Only a study team can." |
| Processing title / lead | "Analyzing live" / "We're reading public trial criteria against what you told us. Nothing here is a decision. It's a map to bring to your care team." |
| Processing footnote | "Steps and numbers appear as they happen. Results show when the analysis finishes." |
| Stage: extraction | "Reading your description" + `{n} details found` (from the `profile` event) |
| Stage: discovery | "Finding recruiting studies" + `{discovered} found · {filtered} fit your age and sex · {selected} selected` |
| Stage: parse | "Reading each study's criteria" (+ `assessed / not analyzed / couldn't be read` only once received) |
| Stage: typed_evaluation | "Comparing what we can check directly" |
| Stage: free_text_evaluation | "Comparing wording that needs a closer read" |
| Stage: verification | "Double-checking possible matches" |
| Stage: fail_checks | "Double-checking possible mismatches" |
| Stage: questions | "Choosing a helpful question" |
| Results title | "{selected} studies selected for review" |
| Coverage row | `{n} assessed` · `{n} not analyzed this run` · `{n} couldn't be read` (all three always shown, zero included) |
| Coverage footnote | "From ClinicalTrials.gov: {discovered} recruiting studies found, {filtered} fit your age and sex, {selected} selected for review." (replay: "this profile's age and sex") |
| Pending group | "Not analyzed or couldn't be read ({n})" + "These stay Uncertain. They are not matches or mismatches." |
| Pending card | Tag "Not analyzed this run": "This run didn't have capacity to read this study's criteria, so we can't say how it fits. It stays Uncertain. Read the original criteria on ClinicalTrials.gov or ask the study team." |
| Failed card | Tag "Couldn't be read": "We couldn't read this study's criteria automatically, so we can't say how it fits. It stays Uncertain. Read the original criteria on ClinicalTrials.gov or ask the study team." |
| Card button | "See criteria" (assessed) / "See original criteria" (pending, failed) |
| Replay notice, `requested` | "This is a saved example about a fictional person: {label}. It is not a live analysis." |
| Replay notice, `rate_limited` | "You've reached the hourly limit for live analysis, so this is a saved example about a fictional person. It does not use your description." |
| Replay notice, `budget_exhausted` | "Live analysis has reached its daily limit, so this is a saved example about a fictional person. It does not use your description." |
| Replay notice, other reasons | "Live analysis isn't available right now, so this is a saved example about a fictional person. It does not use your description." |
| Detail subtitle (assessed) | "Original wording from ClinicalTrials.gov, with what we compared it to. Open any row to read it." |
| Detail subtitle (pending) | "Original wording from ClinicalTrials.gov. Nothing has been compared with your information." |
| Detail right rail | "Why it surfaced" (counts only: criteria look fine / not in your information / need clinical judgment / second automated check found no conflict) and "Official study page" with "Open on ClinicalTrials.gov" |

## Decisions I need from Kumar
1. **Stage list copy and counts above**, including removing the "Skip to results" button and the duration estimate.
2. **Counts under the stage label** (a two-line stage row). Needs a small CSS change in `.tl-stage` (counts wrap badly beside the label).
3. **Verbatim criterion snippets** in "Why it surfaced" and "Biggest unknown" on cards (the parser produces no short criterion names, so the honest label is the original text, truncated). Snippet quality follows the splitter (e.g. a merged "1. Age: ≥65 years old; 2. …" line).
4. **Fit Line / Fit Bar**: pending and failed trials currently sit in the Uncertain zone with the same dots. Option: dashed-outline dots for them. Recommend: keep the dots, rely on the separate Coverage row.
5. **CTA conflict**: the project rule says the final CTA is "Contact study team", but no contact data is fetched. Proposal: "Open on ClinicalTrials.gov" (locations and contacts are listed there). Alternative: keep the old label with a link to the same page.
6. **Hide the "Questions for the study team" panel** and replace the "Ask the team" button with the passive line "Worth asking the study team." until coordinator questions exist.
7. **Detail criterion rows** become two columns (Original wording | From your info, plus an "Automated note" where a model gave a short reason). Small CSS change to `.tl-strip__body`.
8. **Live-to-replay switch**: no interstitial; results are cleared and the replay renders with the notice above. No "try live again" button (the reasons are rate limit, budget or outage).
9. **Optional backend change**: emit `assessed/pending/failed` right after the parse stage so Processing can show them before results (today they arrive at the end).

## Not changing
Tier labels, the Strong zone (stays empty and unlabelled when empty), Rule D wording, privacy footer, theme tokens.
