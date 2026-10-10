# Devpost submission draft (Kumar owns and submits; edit freely)

**Name:** TrialLens
**Tagline:** An eligibility reasoning engine for patients, not a trial search.
**Track:** Best Apps & Agents (select on Devpost). **Marked "new":** confirm on the form.
**Repository:** https://github.com/alwayskumar-global/trial-lens (public; Apache-2.0 license and setup README visible).
**Working demo:** https://trial-lens-xi.vercel.app/ (public Production; fictional typed input verified end to end on 2026-10-10).
**Video URL:** add the public YouTube link after upload. Keep the demo free and accessible to judges through the end of judging on Dec 15.

## Inspiration
Trial listings are written for researchers. A patient can't tell which criteria they meet, which are unknown, or what to ask.

## What it does
Takes a made-up (fictional) patient description typed by the judge or picked from three examples, reads it into known/unknown facts that the user reviews and corrects (change, mark "not sure", remove, add), signs the reviewed profile server-side, pulls recruiting breast-cancer studies live from ClinicalTrials.gov, parses each study's eligibility criteria, and shows a conservative per-study tier with a criterion-by-criterion matrix that keeps the original wording. Unknowns become questions for the study team. Everything is labelled demo, fictional, not medical advice. If services fail, a labelled replay streams instead.

## How we built it
Next.js 16 on Vercel; SSE pipeline: extraction (Nemotron Nano) → CT.gov discovery → criteria parse (Nemotron Super, cached in Supabase) → evaluation → verification → failure checks → tier ceilings → study-team question panel. Nemotron models run on Nebius Token Factory (OpenAI-compatible, strict JSON schema output). Upstash Redis handles per-IP rate limits and a daily run budget. Hard caps: 80 model HTTP attempts per run.

## How Nemotron and Nebius are used
Nemotron 3 Nano (FAST) for extraction; Nemotron 3 Super (MID) for parsing, evaluating, verifying. All through Token Factory. Ultra escalation was evaluated and cut.

## Challenges
- Reasoning models spend most of their budget thinking; we had to control it per call.
- Only about 3-6% of criteria could be typed deterministically, so most are judged as free text; we responded with conservative tier ceilings rather than claiming precision.
- Keeping the pipeline inside serverless limits and bounding cost. Only call counts are enforced (80 model HTTP attempts per run, a daily run budget, per-IP limits); **no dollar spend ceiling is enforced**, and the dollar worst case is a forecast.

## Honest limits
No accuracy headline. Typed input is for made-up situations only; the text is sent to Nebius Token Factory (zero data retention is owner-attested, not independently verified) and TrialLens stores none of it. Extraction is conservative and can miss stated facts; sparse profiles surface loosely related studies. Vocabulary-coverage gate not met. Fail checks never run live. 300 s function limit unproven (longest live run 102 s). No clinician review. Judge-entered input is part of this release and is for made-up (fictional) situations only; please do not type real health information. Nebius zero data retention is owner-attested (the project owner states he holds written organisation-level confirmation), not independently verified here. Dataset annotations parked, not validated.

## Feedback for Nebius Token Factory / AI Cloud / NVIDIA (from our spike notes; edit for tone and accuracy)
- Strict `json_schema` worked on all three Nemotron tiers (first-attempt valid: Nano 98%, Super 100%, Ultra 92% on 50 criteria). Document per-model limits and truncation behaviour.
- Default reasoning on Super consumed ~9k completion tokens and produced an invalid batch on a 15-criterion call (n=1); `reasoning_effort=low` fixed it (2.3k tokens, valid). A first-class, documented switch for reasoning effort per model would save a lot of discovery. A system-prompt `/no_think` did not help.
- Retention: zero-data-retention is an organisation-level setting, and we could not see our organisation's state in the console; confirmation came in writing from Nebius (owner-attested). A visible per-org data-retention status page would make privacy-sensitive builds much easier.
- Spend: we found no hard per-key spend limit; we rely on our own call caps. A hard limit or budget alert would help.
- Billing: per-request usage reconciliation against the Usage tab needed manual checking.
(Verify each point against current docs before submitting; items marked n=1 are directional.)

## What's next
Parser vocabulary expansion, clinician review, better extraction recall, and distance filtering.
