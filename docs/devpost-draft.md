# Devpost submission draft (Kumar owns and submits; edit freely)

**Name:** TrialLens
**Tagline:** An eligibility reasoning engine for patients, not a trial search.
**Track:** (Kumar to select)  **Marked "new":** confirm.
**Links to fill:** repo URL · demo URL (must be free and unrestricted for judges through Dec 15) · video URL (public YouTube).

## Inspiration
Trial listings are written for researchers. A patient can't tell which criteria they meet, which are unknown, or what to ask.

## What it does
Takes a fictional patient description (today: one of three prepared fictional examples; typed input is built but switched off until a data-handling review is complete, and **must not be claimed until it passes Preview testing**), reads it into known/unknown facts that the user can review and correct, pulls recruiting breast-cancer studies live from ClinicalTrials.gov, parses each study's eligibility criteria, and shows a conservative per-study tier with a criterion-by-criterion matrix that keeps the original wording. Unknowns become questions for the study team. Everything is labelled demo, fictional, not medical advice. If services fail, a labelled replay streams instead.

## How we built it
Next.js 16 on Vercel; SSE pipeline: extraction (Nemotron Nano) → CT.gov discovery → criteria parse (Nemotron Super, cached in Supabase) → evaluation → verification → failure checks → tier ceilings → study-team question panel. Nemotron models run on Nebius Token Factory (OpenAI-compatible, strict JSON schema output). Upstash Redis handles per-IP rate limits and a daily run budget. Hard caps: 80 model HTTP attempts per run.

## How Nemotron and Nebius are used
Nemotron 3 Nano (FAST) for extraction; Nemotron 3 Super (MID) for parsing, evaluating, verifying. All through Token Factory. Ultra escalation was evaluated and cut.

## Challenges
- Reasoning models spend most of their budget thinking; we had to control it per call.
- Only about 3-6% of criteria could be typed deterministically, so most are judged as free text; we responded with conservative tier ceilings rather than claiming precision.
- Keeping the pipeline inside serverless limits and a spend ceiling.

## Honest limits
No accuracy headline. Vocabulary-coverage gate not met. Fail checks never run live. 300 s function limit unproven (longest live run 102 s). No clinician review. Fictional profiles only; real input stays off until zero data retention is confirmed in writing. Dataset annotations parked, not validated.

## Feedback for Nebius Token Factory / AI Cloud / NVIDIA (from our spike notes; edit for tone and accuracy)
- Strict `json_schema` worked on all three Nemotron tiers (first-attempt valid: Nano 98%, Super 100%, Ultra 92% on 50 criteria). Document per-model limits and truncation behaviour.
- Default reasoning on Super consumed ~9k completion tokens and produced an invalid batch on a 15-criterion call (n=1); `reasoning_effort=low` fixed it (2.3k tokens, valid). A first-class, documented switch for reasoning effort per model would save a lot of discovery. A system-prompt `/no_think` did not help.
- Retention: zero-data-retention appears to be an organisation-level setting; we could not verify our org/key state from the console. A visible per-org data-retention status page would make privacy-sensitive builds much easier.
- Spend: we found no hard per-key spend limit; we rely on our own call caps. A hard limit or budget alert would help.
- Billing: per-request usage reconciliation against the Usage tab needed manual checking.
(Verify each point against current docs before submitting; items marked n=1 are directional.)

## What's next
Parser vocabulary expansion, clinician review, ZDR-confirmed visitor input.
