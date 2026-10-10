# Demo video script: "Where do I stand?" (target 2:45, hard limit 3:00)

Owner: Kumar records and uploads (public YouTube). Everything on screen is a **made-up situation**; never type real health information. Record on the Production URL once Vercel Authentication is off for Production (or on the protected Preview). Status of the flow: approved and verified by one fictional end-to-end run (`docs/judge-flow-preview-evidence.md`).

## The pitch in one line
**TrialLens refuses to say "you're eligible". It shows where you stand, what's unknown, and exactly what to ask the study team, using Nemotron on Nebius Token Factory.**

## Why this wins (what the judges should feel)
1. **A real, human problem** in the first 10 seconds (a wall of medical text, no way to tell where you stand).
2. **Nemotron + Token Factory visibly doing the work**, not decoration: Nano reads the person, Super reads 30 studies, a second pass double-checks.
3. **Trust as the feature**: the model's mistakes are shown and corrected on screen, the strongest label is "Possible", and the limits are said out loud. Most teams demo confidence; this one demos restraint.
4. **A live, streaming pipeline** with real numbers, not a mock.

## Before you press record (15 minutes)
- [ ] `curl -s https://<PROD>/api/input-mode` shows `open` and `extract_ready:true` (free).
- [ ] Do one dry run with a different made-up case to confirm it is up (about $0.04). **Do not rehearse more than twice**: each run spends model credits.
- [ ] Clean browser profile, no bookmarks bar, 1920x1080 window, browser zoom 110%, notifications off, light theme or dark: pick one and keep it.
- [ ] Prepared case text in a scratch file (paste it; do not type live):
  > I'm 58, a made-up person with stage II breast cancer that is hormone receptor positive and HER2 negative. I finished radiation last month and just started an aromatase inhibitor. My heart ultrasound showed an LVEF of 60%.
- [ ] Record the screen without voice; record the voice-over separately, then edit. Add burned-in captions (judges often watch muted).
- [ ] The live run takes about 50 s: **speed-ramp it to about 8 s** and say "sped up" on screen. Never fake a result.

## Shot list and voice-over (about 400 words, about 2:45)

| Time | On screen (action) | Voice-over |
|---|---|---|
| **0:00-0:12** Hook | A real ClinicalTrials.gov study page, scrolling its dense eligibility text. Cut to the TrialLens Describe screen. | "A woman with breast cancer opens ClinicalTrials.gov. Hundreds of recruiting studies, each hiding its rules in a wall of medical text. She can't tell where she stands, or what to ask. TrialLens fixes that." |
| **0:12-0:22** Frame it | Describe screen: "Find clinical trials worth asking about." Point at the banner "A map, not a verdict." | "TrialLens is an eligibility reasoning engine, not a search box. It's built on Nvidia Nemotron, served by Nebius Token Factory. And it never says you're eligible." |
| **0:22-0:50** Read + correct | Paste the case. Click "Review what we understood". On "Here is what we understood": show extracted facts (age, stage, LVEF, HER2). **Add** "Estrogen receptor (ER) status: Positive" and "Had hormone therapy: Yes" (the model usually misses them). Mark LVEF "Not sure". | "I describe a made-up situation in plain words. Nemotron Nano turns it into facts, and shows me what it understood before anything is searched. It missed that my cancer is hormone-receptor positive, so I add it. I'm not sure about one number, so I mark it not sure. The model can be wrong. You stay in control." |
| **0:50-1:25** Live run | Click "Search for studies". Processing screen: stages appear, counts narrow (found, fit, selected). **Speed-ramp** the wait. | "Now it works, live. It pulls recruiting studies from ClinicalTrials.gov, filters them, and Nemotron Super reads each study's criteria, compares them with my details, then a second pass double-checks. In my test run that was thirty-nine model calls through Token Factory, about four cents. Steps and numbers appear only when they actually happen." |
| **1:25-1:55** Results | Results: coverage row (assessed / not analyzed / couldn't be read), tier chips, the Fit Line. Hover the legend. | "Look at what's missing: there's no 'strong match' and no 'eligible'. Because everything here is self-reported and unverified, the strongest label TrialLens will give is 'Possible'. 'Uncertain' isn't a no. And when a study couldn't be read, it says so instead of guessing." |
| **1:55-2:25** Detail | Open a Possible study: matrix with original wording on the left and "From your details" on the right; unknown rows; the NCT link. | "Open any study. Every row keeps the study's own words next to what it knows about me. Question marks are things only a test result can settle. And the official record is one click away." |
| **2:25-2:45** Panel | Scroll to "Questions worth asking the study team" (e.g. Hemoglobin, open in N studies). Expand one: studies and original wording. | "Across all the studies, here are the unresolved topics that come up most. That isn't a verdict. It's the list to bring to the study team." |
| **2:45-3:00** Close | Architecture strip over the results: ClinicalTrials.gov → Token Factory → Nemotron Nano + Super. End card: URL, repo. | "ClinicalTrials.gov, Nebius Token Factory, Nemotron. We publish our limits instead of an accuracy score: no clinician validation, fictional situations only. TrialLens: know where you stand, and what to ask." |

Word-count check: about 330 spoken words at a calm 130 wpm is about 2:30, leaving room for pauses.

## If something goes wrong on camera
- **Live run slow or fails:** stop, re-take. If a rate limit or outage appears, the app offers "View a saved fictional example": it is clearly labelled as saved, not an analysis of the typed details. Use it only as a deliberate insert and say so.
- **Extraction already got ER right:** change the "missed" line to "It got most of it; I correct one detail and mark one not sure".
- **Different numbers on screen:** read the numbers on screen; do not use the ones in this script.

## 60-second cut (for the Devpost thumbnail or social)
Hook (0:00-0:08) → paste and correct (0:08-0:22) → sped-up run (0:22-0:34) → results with "Possible, never eligible" (0:34-0:48) → panel + end card (0:48-1:00).

## Judge Q&A cheat sheet (keep answers short and honest)
- **Why Nemotron / Token Factory?** Open models with strict JSON-schema output (first-attempt valid: Nano 98%, Super 100% on 50 criteria in our spike), cheap enough for about 40 calls per search (about $0.04 measured on one run).
- **Is it accurate?** We don't claim accuracy. There's no clinician review; the deterministic vocabulary covers about 3-6% of criteria, so most are model-judged; that's why tiers are capped at Possible/Uncertain.
- **What if the model misreads me?** That's the review screen; edits are signed server-side so a run can't be forged.
- **Privacy?** Made-up situations only. Text goes to Nebius Token Factory; TrialLens stores none of it. Zero data retention at Nebius is owner-attested.
- **Cost control?** Call-count caps (80 attempts per run, daily run budget, per-IP limits). There is no enforced dollar cap.
- **What's next?** Better extraction recall, more criteria types, clinician review, distance filtering.

## Do not say or show
Accuracy numbers; "match", "eligible", "qualify"; that Rule D (fail checks) has run live; that anything is clinically validated; that a dollar spend limit is enforced; anything beyond "owner-attested" about provider retention; real patient information; the share link or any secret.
