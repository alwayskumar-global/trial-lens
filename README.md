# TrialLens

An eligibility reasoning engine for patients, not a trial search: it shows where a person stands against recruiting breast-cancer trials, what is still unknown, and what to ask the study team.

Built for the Nebius / NVIDIA Nemotron hackathon. **Demo only. Not medical advice. Fictional profiles only.** TrialLens does not diagnose, recommend treatment, or tell anyone they qualify or do not qualify for a study.

## What it does

1. A prepared **fictional** patient description is read into known and unknown facts (Nemotron Nano via Nebius Token Factory).
2. Recruiting interventional breast-cancer studies are pulled live from the ClinicalTrials.gov API v2.
3. Each study's eligibility text is parsed into criteria (Nemotron Super, cached in Supabase by study version and parser version).
4. Criteria are evaluated against the stated facts, verified, and checked for failures. Results stream to the browser over SSE.
5. Every study lands in a conservative tier. **Policy R2:** every fact is the visitor's own statement and none is verified, so the strongest tier shown is POSSIBLE and the weakest negative tier is UNCERTAIN. TrialLens never shows STRONG or LIKELY_MISMATCH.
6. A detail view shows the criterion-by-criterion matrix with the original study wording, plus questions for the study team and a link to the NCT record.
7. A panel, "Questions worth asking the study team", lists up to 3 topics that remain unresolved across distinct studies. There is no answer step and no tier change (approved deviation from the original adaptive-questioning plan; see `TASKS.md`).

If a guard trips or a model call fails, the app streams a clearly labelled **replay** of a stored fictional case instead of failing silently.

## Prior art and how this differs

[TrialGPT](https://arxiv.org/abs/2307.15051) (NIH) and Antidote's matching tools address trial matching for patients and clinicians. TrialLens does not claim to be first. Its emphasis is patient-side gap analysis: unknown facts become "what would settle this" and a question for the coordinator, with the original study wording always visible, and an open-model pipeline whose failure modes are documented below.

## Architecture

```
profile text ─► /api/run (SSE) ─► extraction (Nemotron Nano, FAST)
                                   ├► ClinicalTrials.gov API v2 (discovery, ≤30 studies)
                                   ├► criteria parse (Nemotron Super, MID; Supabase cache)
                                   ├► evaluation → verify → fail checks (Nemotron Super)
                                   ├► Policy R2 tier ceilings
                                   └► study-team question panel
guards: Upstash rate limit + daily run budget → labelled replay (Supabase `replay_cases`)
```

- Stack: Next.js 16 (App Router, Turbopack), TypeScript, Vitest, Supabase (service role, server only), Upstash Redis.
- Models: `NEMOTRON_MODEL_FAST` (`nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`) for extraction; `NEMOTRON_MODEL_MID` (`nvidia/nemotron-3-super-120b-a12b`) for parsing, evaluation, verification and fail checks. A DEEP (Ultra) escalation was cut and is not built.
- Calls go through the OpenAI-compatible Nebius Token Factory endpoint. Per-run limits: `MAX_LLM_CALLS_PER_RUN` = 80 HTTP attempts (hard cap), a 40-slot run budget, and a parse cap of 14 uncached studies.

## Setup

Prerequisites: Node 22+, pnpm. Accounts: Nebius Token Factory, Supabase, Upstash.

```bash
pnpm install --frozen-lockfile
cp .env.example .env.local   # fill in the secrets below; never commit .env*
pnpm dev
```

Schema: apply `supabase/` migrations (see `SCHEMA.md`). Tables used: `trial_criteria_cache`, `replay_cases`.

Gates: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.

### Environment variables

All variables are server-side except the one marked public. Never prefix a secret with `NEXT_PUBLIC_`. On Vercel, mark secrets Sensitive.

| Variable | Required | Default | Notes |
|---|---|---|---|
| `NEBIUS_API_KEY` | live run | none | Secret. |
| `NEBIUS_BASE_URL` | live run | none | OpenAI-compatible Token Factory URL. |
| `NEMOTRON_MODEL_FAST` | live run | none | Extraction model id. |
| `NEMOTRON_MODEL_MID` | live run | none | Parse / evaluate / verify model id. |
| `SUPABASE_URL` | live run | none | |
| `SUPABASE_SERVICE_ROLE_KEY` | live run | none | Secret; bypasses RLS. |
| `UPSTASH_REDIS_REST_URL` | live run | none | |
| `UPSTASH_REDIS_REST_TOKEN` | live run | none | Secret. |
| `PROFILE_SIGNING_SECRET` | `/api/extract` | none | Secret, 32+ chars. Signs extraction tokens. |
| `RATE_LIMIT_IP_SALT` | only if `VISITOR_INPUT_MODE=open` | none | Secret, 16+ chars. |
| `VISITOR_INPUT_MODE` | no | `samples` | `samples` accepts only the prepared fictional texts. `open` is gated, see Privacy. |
| `CTGOV_API_BASE` | no | `https://clinicaltrials.gov/api/v2` | |
| `CTGOV_SELECTION_MODE` | no | `api-default` | Or `relevance-v1-interventional` (fail-closed). See `docs/selection-mode.md`. |
| `CRITERIA_CACHE_WRITES` | no | `true` | `false` makes the criteria cache read-only. Exact strings only. |
| `MAX_CANDIDATE_TRIALS` | no | `30` | |
| `MAX_LLM_CALLS_PER_RUN` | no | `80` | |
| `LLM_CONCURRENCY` | no | `6` | |
| `TIER_UNKNOWN_THRESHOLD` | no | `3` | |
| `MAX_INPUT_CHARS` | no | `2000` | |
| `RATE_LIMIT_RUNS_PER_IP_PER_HOUR` | no | `8` | |
| `DAILY_RUN_BUDGET` | no | `150` | Runs per day. A call count, not a dollar cap. |
| `REPLAY_FALLBACK_ENABLED` | no | `true` | |
| `RATE_LIMIT_EXTRACT_PER_IP_PER_HOUR` | no | `12` | |
| `DAILY_EXTRACT_BUDGET` | no | `300` | |
| `MAX_CONCURRENT_RUNS` | no | `3` | |
| `NEXT_PUBLIC_UI_MODE` | build time | `fixed` | **Public, non-secret.** `live` builds the live pipeline UI; unset builds the fixed demo. |

Unused or vestigial in the shipped code: `PARSER_VERSION` (the parser version is a code constant), `LOG_LEVEL`, `NEMOTRON_MODEL_DEEP`, `TAVILY_API_KEY`.

Deployment order and Production configuration: `docs/release-runbook.md`.

## Evaluation and limits (read before quoting anything)

There is **no accuracy headline**. What exists are development checks, and none is a validation of clinical correctness.

- **Vocabulary coverage gate: NOT MET.** The planned gate was at least 60% of criteria typed by the deterministic vocabulary (stop and reassess below 40%). Measured strict typed coverage is about 3 to 6% (5.7% at the gate; 3.3%, 16 of 488, on the 34 prepared-profile studies). Most criteria are therefore judged by the model as free text. The gate is not marked passed; the demo design (conservative tiers, no answer step) follows from it.
- **Rule D (fail checks) has never been exercised live.** It is covered by unit tests and replay logic only.
- **The 300-second function limit is unproven.** The longest observed live run was 102 s, which shows the function ran beyond the 60 s default and does not show the 300 s limit.
- **Datasets.** The SIGIR annotation set is trial-level only and was inspected for counts; the TrialGPT-style annotations are parked and not validated for this use. The author-written extraction and abstention cases are development checks, not measured clinical accuracy. Only fictional profiles are used anywhere.
- **Hardening.** The extraction hedging and forged-fact criteria stay open (`docs/hardened-1-dev-check.md`).
- **Stored replay cases** come from an earlier candidate-selection mode and may include studies that are only loosely on-topic.
- A live run's cost was about $0.044 on the last measured run (`docs/cost-per-run.md`); the dollar worst case is a forecast, not an enforced limit.
- No clinician has reviewed the output. LLM judgments can be wrong.

## Privacy

The shipped demo runs `VISITOR_INPUT_MODE=samples`: only the prepared fictional texts are accepted, so visitor-typed text never reaches the model provider. The UI states: "TrialLens does not store your information." Free-text input from real visitors stays disabled until zero data retention is confirmed in writing for our Token Factory organisation and the privacy copy is re-approved (`docs/token-factory-data-terms.md`). Logs carry counts and configuration, not profile text. Redis holds a hashed IP and a counter.

## Safety statement

TrialLens is a demonstration of eligibility reasoning on fictional data. It is not a medical device, gives no diagnosis or treatment advice, and never states that someone qualifies or does not qualify. Always confirm eligibility with the study team and a clinician.

## Repository map

- `src/` app, API routes (`/api/run`, `/api/extract`), pipeline, guards, UI
- `eval/` spike scripts, preflight (`eval/preview-sse-check.ts`), cache-warming tooling (execution disabled)
- `docs/` decisions, proposals, measurements; `SPEC.md`, `TASKS.md`, `SCHEMA.md`

## License

Apache-2.0 (see `LICENSE`).
