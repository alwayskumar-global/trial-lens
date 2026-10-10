# Judge-entered flow: Preview evidence (2026-10-10; one fictional end-to-end run)

Status: **evidence for Kumar's review. The judge-entered flow is NOT approved or release-ready.** The visitor copy is still PROPOSED and unapproved (`docs/visitor-flow-copy-review.md`). Production is unchanged.

## Deployment and effective configuration
- Deployment `dpl_C1wBu39APgQt7t1SBzbDqidvLDiz`, SHA `f01fc7c04013dd71cedbb24e74e96cf9ed646643`, branch `phase1/spike`, Preview (target none), region of functions `bom1`, Node 24. The branch alias pointed at it (checked with the alias API).
- `/api/input-mode`: `{"visitor_input":"open","extract_ready":true,"max_input_chars":4000}`.
- Effective values read from the run log line, not the dashboard: `cache_writes:false`, `selection_mode:"relevance-v1-interventional"`, `max_calls:80`, `visitor_input_mode:"open"`. The UI was the live-mode build (it showed the typed flow and the live Processing/Results screens).
- Vercel Authentication stayed on. The browser reached the Preview through a local pass-through that injected the share cookie server-side; the share link and cookie were never printed or sent to the browser.

## Request and usage counts (one paid extraction, one paid run, no retry)
- A local pass-through enforced the budget: **1 `POST /api/extract`, 1 `POST /api/run` with a profile, 0 blocked, 0 typed-text runs.** The page's own fetch log matched (2 requests).
- Free requests also made on this deployment: the 43-check preflight (3 explicit replays, 401 refusals, input-mode).
- Logs (structured lines only):
  - extract: `ok, facts:5, calls:1, ms:8661` (the extract line does not record token usage).
  - run: `mode:live, input:profile, ok:true, calls:39, calls_without_usage:0, prompt_tokens:39457, completion_tokens:31075, ms:47292, edited:4`.
- Estimated spend: run about $0.040 (39,457 x $0.0000003 + 31,075 x $0.0000009 at the recorded MID prices) plus one FAST extraction call, well under $0.001; **about $0.04 in total, far below the $1 planning budget.** Not reconciled against the Usage tab.

## What was exercised in the deployed browser UI
1. Typed a fictional case (made up; 221 characters) on Describe. Footer and tag showed the proposed open-mode copy.
2. Extraction (10.0 s in the browser) returned 5 facts: age 58, stage II, LVEF 60, HER2 negative, prior radiation yes.
3. Edits: corrected age 58 → 59; marked HER2 "Not sure"; removed "Had radiation"; added ECOG 1 (focus moved to the new control).
4. Run (48.7 s): Processing showed only started stages and received counts. The log shows `edited:4`, consistent with the four edits.
5. Results: 30 studies selected for review; coverage 29 assessed, 0 not analyzed, 1 couldn't be read; 8 Possible, 22 Uncertain, 0 Strong, 0 Likely mismatch (R2 ceiling held). Study-team panel present with the proposed visitor wording ("Hemoglobin", open in 3 studies, with the studies and original wording). Banner and Detail used the "your details" wording; the Detail had original wording, a link to the official study page and the second-comparison line ("Your details were not independently verified.").
6. Mobile (390 px) from the same results: no horizontal overflow on Detail and Results; the panel is a disclosure. axe-core: 0 violations on Results (desktop and mobile).
7. Browser storage: no localStorage; the 3 sessionStorage keys belong to the Vercel preview toolbar; none contained the text. No text in the function logs (searched for two phrases from the case; no matches).

## Not exercised on the deployed UI (offline or free only)
Stale/forged token (server 401 verified free; UI path in unit and local-browser tests), rate limit UI, replay fallback UI (server replay labelling verified by the preflight; UI verified locally), error screens.

## Findings
1. **Processing line says "112 fit the age and sex you entered"** although no sex was extracted or entered. The filter only applies age and sex when present. Proposed copy needs a fix (for example "fit the age you entered").
2. **Extraction is conservative**: it did not extract sex (text said "person"), hormone-receptor-positive, or the aromatase inhibitor. The review screen exists to catch this, but a judge will see sparse results.
3. **Selection quality**: with an age-only profile, results include loosely related studies (for example a biopsy-marker study opened in Detail). This is the known limitation of the discovery filter, not new.
4. **1 of 30 studies "couldn't be read"** (stays Uncertain); Rule D (fail checks) still has no live evidence in this run.
5. The extraction log line has no token usage, so extraction cost is an estimate.
6. **Production**: a deployment from `main` (`dpl_5jUkJEQKTH1FyQZR8tpcoHfipJaf`, SHA `cbfc1a1`, the docs-only commit) was created at the time of the Preview redeploy, so a Production redeploy appears to have been triggered along with the Preview. Same commit, no code or environment change by us; flagged for awareness.
