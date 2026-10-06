# SPEC.md — TrialLens

Scope: **breast cancer only** (generic core vocabulary + pluggable breast-oncology pack; see SCHEMA.md).
Anything marked `VERIFY:` must be confirmed in the Phase 1 spike before depending on it.

## 1. Positioning
"An eligibility reasoning engine for patients, not a trial search: it tells you where you stand, what's unknown, and exactly what to ask."

Differentiators vs prior art (state in README, never claim "first"):
1. Patient-side **gap analysis**: unknown → what record/test would settle it → question for the coordinator.
2. **Adaptive questioning** computed deterministically (instant re-ranking, no extra LLM calls for typed facts).
3. **Open-model** evaluation with published numbers, including failure modes.

Non-goals: EHR/FHIR, real patient records, diagnosis, treatment advice, enrollment, other diseases (stretch only), document OCR, accounts.

## 2. User flow (5 screens)
1. **Describe** — large free-text input + sample fictional profiles. Optional structured fields.
2. **Confirm** — shows extracted profile as Known / Unknown / Uncertain chips; user can edit before search.
3. **Processing** — live stage stream: `Searching recruiting studies ✓ N` → `Basic eligibility ✓ M remain` → `Reading criteria` → `Comparing history` → `Verifying`.
4. **Results** — counts per tier; cards show trial title, site + distance, phase, tier, top 3 reasons, top unknown. Adaptive panel: "Answering these 3 questions could sharpen your matches".
5. **Trial detail (hero)** — left: plain-language overview; center: **eligibility matrix** (criterion original text | plain language | patient fact | status | what to ask); right: why it surfaced, coordinator questions, site/contact, source NCT link.

Design principles: calm, dense-but-readable, no chat-first UI, never alarming colors for UNKNOWN, always original text visible.

## 3. Pipeline
Each stage emits SSE events (`stage`, `counts`, `trial_result`, `question`, `done`, `error`).

| # | Stage | Model | Notes |
|---|---|---|---|
| 1 | Profile extraction | FAST | free text → `PatientProfile` facts (known/unknown/uncertain). Never invent. Zod-validated |
| 2 | CT.gov discovery | none | v2 API, deterministic filters: condition, `RECRUITING` status, age, sex, distance. Cap `MAX_CANDIDATE_TRIALS` |
| 3 | Criteria parse | MID | per trial, **cached**. Output `ParsedCriterion[]` with `fact_key/operator/value` where possible, else free text + `depends_on` |
| 4 | Evaluate | code + MID | typed criteria in code; free-text criteria in **one batched LLM call per trial** returning findings with `evidence` fact paths |
| 5 | Abstention guard | code | PASS/FAIL without valid known evidence → UNKNOWN (+ metric) |
| 6 | Tier | code | rules in §4 |
| 7 | Verify | MID or DEEP | independent pass on STRONG/POSSIBLE trials only; sees criteria + profile, NOT the first evaluator's reasoning; tries to produce a FAIL. Disagreement → downgrade tier + flag |
| 8 | Escalate | DEEP | only for core-category AMBIGUOUS findings, capped per run |
| 9 | Adaptive questions | code | §5 |
| 10 | Plain-language + coordinator prep | FAST/MID | per shortlisted trial, preserves original criterion text |

Model routing table is provisional; finalize from spike results (accuracy/latency/cost per tier). Model IDs from env only.

### Statuses (per criterion)
Normalised to effect on the patient, for both inclusion and exclusion criteria:
- `PASS` — patient is not blocked by this criterion (inclusion met, or exclusion does not apply)
- `FAIL` — patient appears blocked (inclusion not met, or exclusion applies)
- `UNKNOWN` — required information not in profile
- `AMBIGUOUS` — needs clinical interpretation

UI labels: ✓ Meets · ⚠ Possible conflict · ? Unknown (ask) · ◐ Needs clinical judgment.

Criteria in category `consent_logistics` (willing to comply, able to consent, etc.) are **non-scoring**: shown collapsed, excluded from tiering.

## 4. Tier rules (pure function, all thresholds from config)
Core categories: `diagnosis`, `stage`, `biomarker`, `prior_therapy`, `disease_setting`.
Let N = `TIER_UNKNOWN_THRESHOLD` (default 3). Over scoring criteria only (non-scoring = category `consent_logistics`, derived in code).
Each criterion also has a **parse completeness**: `full` (every leaf an executable atom) · `partial` (any text/timing leaf or non-executable atom) · `unresolved` (no valid parse; kept as an UNKNOWN scoring criterion).

Evaluation order (conservative; implemented in `src/lib/engine/tier.ts`):
1. **LIKELY_MISMATCH** — any scoring `FAIL` that is **verified** (rule D below).
2. **UNCERTAIN** — any other scoring `FAIL` (not run, no verification capacity, rejected, or unsubstantiated), analysis failed, nothing scorable, scoring criteria missing (fewer than expected), or any scoring criterion `unresolved`.
3. **UNCERTAIN** — any core-category criterion `UNKNOWN`, `AMBIGUOUS`, or only `partial`.
4. **POSSIBLE** — any non-core criterion only `partial`, or total `UNKNOWN`+`AMBIGUOUS` > N.
5. **STRONG** — otherwise.
A trial can never be `STRONG` while a scoring criterion is missing, partially parsed or unresolved. (Changed from the original rules on the founder's instruction after the Phase 1 coverage gate; no percentage scores anywhere. Tune N and category list on the eval set, not by feel.)

**Rule D — FAIL verification (approved).** An unverified FAIL stays UNCERTAIN; only an independently checked, evidence-backed FAIL can make a trial LIKELY_MISMATCH. A FAIL is `verified` only when an independent verifier (sees the criterion text and the confirmed facts only, never the first evaluator's reasoning, clause or claimed evidence) returns `confirmed` **and** code confirms the citation: its `source_quote` is a verbatim fragment of the criterion text, it cites at least one patient fact, and every cited fact is `known` in the profile with the cited value. A verifier that has no capacity, returns `cannot_substantiate`, or whose citation fails the code checks yields `no_capacity` / `unsubstantiated` ⇒ the trial is UNCERTAIN. A verifier `not_confirmed` yields `rejected` ⇒ UNCERTAIN (a disagreement between evaluator and verifier is uncertainty, not reassurance). One verified FAIL is enough; unverified FAILs never reduce it.

**Run budget.** 80 calls = 40 slots (call + its single retry). Reserved: extraction 1, STRONG/POSSIBLE verification 8, FAIL checks 3 (reassigned from the unbuilt escalation stage); parse ≤ 14; unused verification reserve flows to FAIL checks. See `docs/run-plan.md`.

## 5. Adaptive question engine (pure function, no LLM)
Input: candidate trials (tier ≠ LIKELY_MISMATCH), current profile.

1. `U` = fact_keys that are `UNKNOWN` in the profile AND referenced by at least one **typed** `UNKNOWN` criterion in a candidate trial AND flagged `askable` in the vocabulary.
2. For each `u ∈ U`, build the answer set `A(u)`:
   - boolean / enum → all values (+ "I don't know")
   - numeric → buckets cut at the distinct threshold values appearing in candidate trials' criteria for `u` (e.g. LVEF thresholds {40, 50} → <40, 40–49, ≥50)
3. For each `a ∈ A(u)`, re-run **typed evaluation + tiering** over all candidates with `u = a` (pure, instant).
4. `gain(u)` = mean over `a` (uniform prior unless overridden) of the number of trials whose tier becomes decisive (→ STRONG or → LIKELY_MISMATCH) minus current decisive count.
5. `score(u) = gain(u) / ask_cost(u)` where `ask_cost` ∈ {1 easy, 2 needs a record, 3 needs a recent lab/test}.
6. Return top 3 with rationale: "Affects N trials".
7. On user answer: update profile, re-tier typed criteria in code; re-run LLM only for free-text criteria whose `depends_on` includes the answered fact (one small batched call per affected trial).

Free-text criteria with no `fact_key` never enter this loop; they surface as "Ask the study team".
Unit tests required: bucket construction, no-op when nothing askable, monotonicity (answering never reduces known facts), determinism.

## 6. Replay mode and abuse protection
Requirement: demo must remain usable, free and unrestricted through Dec 15.
- **Replay mode:** `replay_cases` holds precomputed full outputs for 3 fictional profiles (generated by `pnpm precompute:replay`). UI clearly labels "Replay of a saved run" — never pose as live.
- Automatic fallback to replay when: global daily budget exhausted, Upstash/Nebius errors, or rate limit hit. User sees a friendly explanation + the replay, never a blank error.
- Guards: per-IP rate limit (`@upstash/ratelimit`), global daily run counter (`DAILY_RUN_BUDGET`), `MAX_LLM_CALLS_PER_RUN`, input length cap (`MAX_INPUT_CHARS`).
- No CAPTCHA (Rules require unrestricted testing access). Revisit only if abuse appears.
- Keep Nebius credits reserved for Dec 1–15 judging; monitor spend weekly.

## 7. Evaluation plan
Goal: honest numbers, failure modes included, no claim of beating published systems.
- **Data:** public labeled patient-trial cohorts used in the TrialGPT paper (`VERIFY:` exact datasets, availability, license, whether criterion-level annotations are downloadable). Use mixed-condition cohorts for general numbers and the breast-cancer slice for the headline.
- **Hand-built abstention test set:** ~30 criteria × profiles with deliberately missing facts, to measure abstention behavior directly (label as author-created, non-clinician).
- **Metrics:** criterion-level accuracy; **unsupported-assumption rate** (target ≈ 0); **false-PASS rate on exclusion-sensitive criteria**; UNKNOWN detection accuracy; tier-level agreement; latency and cost per run.
- **Ablations:** FAST vs MID vs DEEP on criterion evaluation; routing vs single model; verifier on/off; hybrid vs pure-LLM evaluator (the cost/accuracy case for our design).
- **Output:** `eval/reports/*.md` + JSON, committed. README links the headline table.
- **Limits stated in README:** synthetic patients, no clinician review, not validated for clinical use.
- Optional: run the harness as a Nebius Serverless Job (adds an AI Cloud usage story; only if time allows).

## 8. Acceptance criteria for the 3-minute demo
1. Paste fictional breast-cancer profile → confirm screen shows Known/Unknown chips.
2. Live stream shows counts narrowing (e.g. 100+ → ~30 → tiered).
3. Open a top trial → eligibility matrix with ✓, ? and ⚠ rows, original text visible.
4. Adaptive panel asks one question; user answers; **tiers visibly update instantly**.
5. Coordinator question list generated; site + NCT source link shown.
6. Closing shot: eval table (accuracy, unsupported-assumption rate) + architecture strip (CT.gov → Token Factory → Nemotron tiers).
Replay mode works end-to-end with all external services disabled.
