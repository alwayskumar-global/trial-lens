# Demo script (DRAFT, under 3:00; Kumar records and owns the video)

> **Judge-entered input is part of the release** (approved by Kumar 2026-10-10; verified by one fictional end-to-end run on the protected Preview, `docs/judge-flow-preview-evidence.md`). Record it on whichever deployment has `VISITOR_INPUT_MODE=open` and passes the free checks in `docs/release-runbook.md`. Type only a made-up situation on camera. Nebius ZDR is owner-attested; do not say more about provider retention than the on-screen disclosure.

Source: SPEC §8 with the approved deviation (study-team panel, no answer step). Record against the Production URL (or the protected Preview) in **live mode with typed input open**. Use a made-up situation. Do not type real health information on camera.

Before recording: run one live sample run to confirm the pipeline is up (it spends model credits: Kumar decides). To show replay without spending, use the replay path (external services unreachable or rate-limited); the screen is labelled "replay" and you should say so.

| Time | On screen | Say (suggested) |
|---|---|---|
| 0:00-0:15 | Describe screen, demo notice visible | "TrialLens is a demo that shows where a fictional breast-cancer patient stands against recruiting trials, what's unknown, and what to ask the study team. It's not medical advice." |
| 0:15-0:45 | Type a made-up situation → "Here is what we understood": correct one detail, mark one "Not sure", remove one, add one | "A Nemotron model reads the description into details. TrialLens can't check them, so you correct anything it got wrong before anything is searched. The text goes to Nebius Token Factory and TrialLens doesn't store it." |
| 0:35-1:15 | Run: live stream, counts narrowing (discovered → filtered → selected → assessed) | "It pulls recruiting studies live from ClinicalTrials.gov, parses each study's eligibility text with Nemotron Super through Nebius Token Factory, then evaluates, verifies and checks for failures." |
| 1:15-1:50 | Results list: tiers and fit lines | "Tiers are deliberately conservative. The strongest we ever show is Possible. We never say someone qualifies or doesn't." |
| 1:50-2:20 | Open one study: criteria matrix with ✓ ? ⚠ rows, original wording, coordinator questions, NCT link | "Every row keeps the study's original wording. Unknowns turn into questions for the coordinator, with a link to the official record." |
| 2:20-2:40 | "Questions worth asking the study team" panel | "Across studies, these are the unresolved topics worth raising. There's no answer step, so no tier changes." |
| 2:40-3:00 | Closing: architecture strip + limits | "CT.gov → Token Factory → Nemotron. We publish the limits, not an accuracy headline: vocabulary coverage gate not met, free-text judgments unvalidated by clinicians, fictional profiles only." |

If time: the fallback when a limit is hit shows "View a saved fictional example", clearly labelled, not an analysis of the typed details. Replay mode with external services disabled, labelled "replay".

Do not claim: accuracy numbers, that selected studies are matches, that POSSIBLE means eligible, that Rule D has run live, that anything is clinically validated, that TrialLens enforces a dollar spend limit, or that provider retention is anything more than owner-attested.
