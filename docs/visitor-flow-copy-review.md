# Visitor-flow copy packet (APPROVED by Kumar 2026-10-10, subject to the accuracy fixes below, which are applied)

Status: **approved with fixes, applied in the release-candidate commit.** Kumar approved the screenshots and this copy on condition that: (1) the Processing sentence describes only filters actually applied; (2) Describe and Results say the demo reviews breast-cancer studies, and "selected for review" and POSSIBLE do not imply confirmed eligibility; (3) the disclosure names Nebius Token Factory; (4) storage claims appear only where the code audit supports them. Nebius ZDR confirmation is **owner-attested** (Kumar states he holds written organisation-level confirmation; the document was not shared and the UI makes no claim about provider retention).

## 0. Final copy changes (release candidate)
- **Processing / coverage sentence** (`discoveryFitText`): built from the filters the server actually applied (age and sex only when each is a KNOWN fact): "N fit the age and sex you entered" / "... the age you entered" / "... the sex you entered" / "no age or sex filter applied" (neither). Saved examples and the prepared profile use "of this profile" / "of the prepared fictional profile". Unknown filter state names no filter ("N after filtering"). Tested for all four cases plus uncertain facts.
- **Describe (open and gated):** adds "This demo searches recruiting breast-cancer studies only."
- **Results note (all live modes, one line under the coverage row):** "These are recruiting breast-cancer studies this demo selected to read. Selection is not a match. Possible match means no conflict was found with the details you entered, not confirmed eligibility. Only a study team can confirm." (fictional-profile and saved-example variants for those modes.)
- **Disclosure and footer (open mode):** "...is sent to Nebius Token Factory, an AI model provider, to be read. TrialLens does not store it." / footer "TrialLens does not store what you enter. Your text is sent to Nebius Token Factory, an AI model provider, to be read." No statement about the provider's retention anywhere in the UI.
- **Storage claim audit:** "TrialLens does not store" is supported by the code: no table holds visitor text; function logs carry counts, timings and fixed codes (a text search of the Preview logs found no match); Redis holds a hashed IP and counters; the signed extraction token carries structured facts and is held in browser memory only; the page uses no localStorage. The samples-mode footer keeps the approved wording.

(Sections 1 and 2 below are the original proposal text, kept for the record; where they differ, section 0 and the table in section 3 win.)

Original status line: for Kumar's review. All strings live in `src/lib/visitor/copy.ts` and are used **only** when the server reports `VISITOR_INPUT_MODE=open`. In `samples` mode (current Preview and Production) the approved fictional-profile copy in `src/lib/live/copy.ts` and the approved footer are unchanged.

## 1. Audits you asked for

**Footer "TrialLens does not store your information."** TrialLens itself keeps no visitor text: no table holds it, logs carry counts and fixed codes only, Redis holds a hashed IP and a counter, and the extraction token carries structured facts, not text. That is true. In `open` mode the sentence is incomplete, though, because the text is sent to the model provider (Nebius Token Factory), whose retention terms are not confirmed for our organisation (`docs/token-factory-data-terms.md`, ZDR gate BLOCKED). Proposal when typing is on: *"TrialLens does not store what you enter. Your text is sent to an AI model provider to be read."* It does not strengthen the claim; it adds the disclosure. **Decision needed.** Until then the old footer stays wherever typing is off.

**Privacy notice above the textbox (open mode).** Proposed: *D_PRIVACY* below. It tells people to use a made-up situation and not to type identifying details or records, and discloses the model provider. Missing today: a link to a fuller privacy page (none exists).

**Unknown-fact wording.** Fixed demo says "Unknown: Not mentioned. These become questions, not problems." For typed input I keep "Not mentioned" and add the ability to add a missed detail. Chip subtext "We don't know yet" is kept in the read-only state. Policy R2 holds: no screen says the details were verified; the review lead says TrialLens can't check them and the results banner says it hasn't checked them.

**Results claims.** Tiers stay capped at POSSIBLE and UNCERTAIN. "Questions worth asking the study team" is unchanged except two sentences that said "the prepared fictional profile" now say "the details you entered" (open mode only). The banner, cards, criterion rows, processing stage names and the coverage row use the same substitution. The second-comparison line becomes "Your details were not independently verified." No location, travel or distance control is shown; no answer chips exist.

**Copy-rule exceptions to approve.** `docs/copy-rules.md` says live screens never say "your information" because visitors provided none. That rule applies to the fixed flow; this flow does address the visitor, so the copy audit test now covers `src/lib/visitor` for the banned words but not the "refers to the prepared profile" rule.

**Added after the Preview run (see `docs/judge-flow-preview-evidence.md`):** the Processing line `V_DISCOVERY_FIT` ("fit the age and sex you entered") is wrong when no sex was entered; proposed replacement: "fit the age you entered" (the filter uses age, and sex only when given). Not changed yet; awaiting your decision.

## 2. Structural choices to confirm
- h1 stays "Find clinical trials worth asking about." (approved hero); "Your situation" is the textarea label, and "Here is what we understood" is the Confirm h1. If the original design had "Your situation" as the page title, say so.
- The three fictional examples appear as picker buttons under the textarea. They fill the box (editable in `open`, display-only in the gated state).
- Confirm rows: value control, "I'm sure / Not sure", Remove; unknown details are under "Add a detail we missed (N)".
- Results gets two extra buttons (open mode and gated): "Edit details and search again" (not on saved examples) and "Describe a different situation".
- Error screens offer "View a saved fictional example" (a labelled replay, not an analysis of the visitor's details).
- Header tag in `open` mode: "Demo · fictional situations only".
- The text box limit now comes from the server (`max_input_chars`), not a hard-coded 2000.

## 3. Every proposed string
| Key | Text |
|---|---|
| `C_ADD` | Add |
| `C_BACK` | Back |
| `C_BAD_NUMBER` | Enter a number. |
| `C_CHOOSE` | Choose… |
| `C_ERR_FIX` | Fix the highlighted details to continue. |
| `C_KNOWN` | Details we'll use to compare |
| `C_KNOWN_NOTE` | Used to compare with each study. |
| `C_LEAD` | Check each detail and correct anything we got wrong. TrialLens can't check these details, so the results depend on them being right. |
| `C_LEAD_READONLY` | These details come from the fictional example. They can't be edited in this environment. |
| `C_NEED_VALUE` | Enter a value, or remove this detail. |
| `C_NONE_KNOWN` | We didn't find any details we could use. Add some below, or go back and add more to your description. |
| `C_OUT_OF_RANGE` | That number is outside the usual range. |
| `C_REMOVE` | Remove |
| `C_RUN` | Search for studies |
| `C_SURE` | I'm sure |
| `C_SURE_LABEL` | How sure |
| `C_TITLE` | Here is what we understood |
| `C_UNKNOWN` | Not mentioned |
| `C_UNKNOWN_NOTE` | These become questions to ask, not problems. |
| `C_UNSURE` | Not sure |
| `C_YOUR_TEXT` | What you wrote |
| `D_CTA` | Review what we understood |
| `D_CTA_BUSY` | Reading your situation… |
| `D_EMPTY` | Describe a situation to continue. |
| `D_HELPER` | For example: age, type and stage of cancer, treatments so far. Use a made-up situation. |
| `D_LABEL` | Your situation |
| `D_LEAD` | Describe a situation in your own words. We'll show what we understood before anything is searched. This demo searches recruiting breast-cancer studies only. |
| `D_PLACEHOLDER` | I'm 58 and was diagnosed with stage II breast cancer that is hormone receptor positive… |
| `D_PRIVACY` | Please don't type your name, contact details or real medical records. This is a demo: use a made-up or fictional situation. What you type is sent to Nebius Token Factory, an AI model provider, to be read. TrialLens does not store it. |
| `D_SAMPLES_HEADING` | Or start from a fictional example |
| `D_TAG` | Demo · fictional situations only |
| `D_TITLE` | Find clinical trials worth asking about. |
| `EXAMPLE_BUTTON` | View a saved fictional example |
| `FOOTER_CURRENT` | TrialLens does not store your information. |
| `FOOTER_OPEN` | TrialLens does not store what you enter. Your text is sent to Nebius Token Factory, an AI model provider, to be read. |
| `G_LOADING` | Checking what this demo allows… |
| `G_NOTICE_BODY` | You can still try the whole flow with a fictional example below. This demo searches recruiting breast-cancer studies only. |
| `G_NOTICE_TITLE` | Typing a new situation is switched off in this demo environment |
| `G_PLACEHOLDER` | Choose a fictional example below. |
| `REPLAY_REASON_FOR_EXAMPLE` | requested |
| `RETRY_BUTTON` | Try again |
| `V_BANNER` | TrialLens compares public trial criteria with the details you entered. It can't confirm eligibility, and it hasn't checked your details. Only a study team can confirm. |
| `V_EDIT` | Edit details and search again |
| `V_EXTRACTION_STAGE` | Reading the details you entered |
| `V_PANEL_NOTE` | These questions relate to the details you entered. They do not change the results shown. |
| `V_PANEL_SUB` | Some criteria in these studies can't be checked from the details you entered. The study team can confirm the detail. |
| `V_PROCESSING_LEAD` | We're reading public trial criteria against the details you entered. Nothing here is a decision. It's a map to bring to your care team. |
| `V_RESTART` | Describe a different situation |
| `V_RESULTS_NOTE` | These are recruiting breast-cancer studies this demo selected to read. Selection is not a match. Possible match means no conflict was found with the details you entered, not confirmed eligibility. Only a study team can confirm. |
| `V_SUBJECT` | your details |
| `extractError(413, input_too_long)` | **That's longer than this demo can read** Shorten the description and try again. |
| `extractError(400, bad_request)` | **We couldn't use that text** Check that it isn't empty, then try again. |
| `extractError(403, visitor_input_disabled)` | **Typing a new situation is switched off in this demo environment** You can still try the whole flow with a fictional example below. This demo searches recruiting breast-cancer studies only. |
| `extractError(429, rate_limited)` | **You've reached the hourly limit** Reading a new situation is limited each hour. Try a fictional example, or come back later. |
| `extractError(403, forbidden)` | **This request was blocked** Reload the page and try again. |
| `extractError(0, network)` | **We couldn't reach the server** Check your connection and try again. |
| `extractError(503, model_unavailable)` | **Reading your situation isn't available right now** Please try again later, or try a fictional example. |
| `runError(401, invalid_token)` | **Your details need to be read again** The review session expired or couldn't be confirmed. Nothing was searched. Go back and read your situation again. |
| `runError(403, visitor_input_disabled)` | **Typing a new situation is switched off in this demo environment** You can still try the whole flow with a fictional example below. This demo searches recruiting breast-cancer studies only. |
| `runError(429, rate_limited)` | **You've reached the hourly limit for live analysis** Nothing was searched. You can view a saved fictional example instead, which is not an analysis of your details. |
| `runError(400, bad_request)` | **We couldn't use those details** Go back, check each detail, and try again. |
| `runError(503, guard_unavailable)` | **Live analysis isn't available right now** No results are available from this run. You can view a saved fictional example instead, which is not an analysis of your details. |
