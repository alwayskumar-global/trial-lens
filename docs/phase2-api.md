# Phase 2: `/api/run` (live pipeline, replay, guards)

Status: implemented and unit-tested offline; live-verified against Nebius, ClinicalTrials.gov and Upstash. **Supabase tables not yet applied** (see "Open"), so cache persistence and stored replay are unverified live. The UI is still the fixed fictional demo and does not call this endpoint.

## Contract
`POST /api/run` (Node runtime, `maxDuration = 300`; VERIFY the Vercel plan limit). JSON body, exactly one of:
- `{ "text": string }` live run. `text` must be non-empty and ≤ `MAX_INPUT_CHARS` (413 `input_too_long`, 400 `bad_request`).
- `{ "replay_id": string }` stored replay of a fictional profile (`/^[a-z0-9][a-z0-9-]{0,63}$/`). Does not consume rate-limit or daily budget.

Response: `text/event-stream`, `cache-control: no-store`. Events (`src/schema/sse.ts`, every event Zod-validated before it is sent):
`mode` (live | replay + reason) → `stage` start/done (extraction, discovery, parse, typed_evaluation, free_text_evaluation, verification, fail_checks, questions) → `profile` (facts extracted from the visitor's own text, returned only to them) → `counts` → `question` → `trial_result` × N (tier order; official `https://clinicaltrials.gov/study/<NCT>` link, original criterion text, per-criterion findings with `fail_check`) → `counts{analyzed}` → `done` (`replay`, `stats{llm_calls, worst_case_calls, wall_ms}`). An `error` event carries a fixed code only.

Replay is always labelled: a `mode:"replay"` event with `reason` ∈ requested | rate_limited | budget_exhausted | guard_unavailable | model_unavailable | ctgov_unavailable. With `REPLAY_FALLBACK_ENABLED=false` a refusal is HTTP 429/503 instead.

## Behaviour preserved from the frozen config
Prompts `spike-4` (parse) / `fail-verify-0`, coverage checks `cov-1`, abstention guard, Rule D (only a code-verified, independently confirmed FAIL gives LIKELY_MISMATCH; no capacity / rejected / unsubstantiated / not run ⇒ UNCERTAIN), 80-call cap (`RunBudget`: 40 slots; parse ≤ 14; verify 8; FAIL checks 3). A trial that did not get a parse slot is `analysis_pending` (flag), a failed/rejected parse is `analysis_failed`; both are UNCERTAIN. The spike extraction/evaluate/verify prompts moved verbatim to `src/prompts/{extract,evaluate,verify}.ts` (`spike-0`).

## Cache and replay
- `trial_criteria_cache` key `(nct_id, source_version = CT.gov last-update date, parser_version = "<CLAUSE_PARSE_PROMPT_VERSION>+<COVERAGE_CHECK_VERSION>")`; only fully parsed trials are cached; reads are Zod-validated and fail soft (miss). Memory layer in front of Supabase. The env `PARSER_VERSION` is no longer used for keys (the derived value cannot go stale).
- `replay_cases` is filled by `pnpm precompute:replay --write` from the three fictional profiles in `src/lib/sample/replay-profiles.ts` (dry run without `--write`). No CT.gov text is committed to the repo; replay therefore lives in Supabase only (VERIFY CT.gov terms before ever bundling it).

## Guards (`src/lib/guards/run-guard.ts`)
Per-IP sliding window (`RATE_LIMIT_RUNS_PER_IP_PER_HOUR`, hashed IP bucket, prefix `tl:rl`) checked first, then the global per-UTC-day counter `tl:runs:<date>` (`DAILY_RUN_BUDGET`). Any Redis error ⇒ `guard_unavailable` ⇒ replay. Redis holds no patient text and no raw IPs.

## Adaptive questions
`src/lib/engine/questions.ts` (SPEC §5, pure, no LLM). "Decisive" means STRONG only: a counterfactual FAIL has no independent check, so it stays UNCERTAIN. Patient-facing prompt wording is a code map (`LABELS`): VERIFY copy with Kumar before any UI uses it. LLM re-evaluation of free-text criteria on an answer is not built.

## Not built
Stage 10 (plain-language rewrite and coordinator questions: `coordinator_questions` and `sites` are empty arrays), escalation (DEEP), distance filtering (no location input), re-run on answer.

## Open (needs the project owner)
1. `supabase/migrations/0001_init.sql` is NOT applied to the project behind `SUPABASE_URL` (all three tables return PostgREST `PGRST205`). The Supabase connector in the Claude session only sees other projects (`loomtale-works-prod`, `trubiz`), so it was deliberately not used. Apply it in the correct project's SQL editor (or `supabase db push` with that project linked), then run `pnpm precompute:replay --write`.
2. Persist `NEMOTRON_MODEL_*` in the Cloud environment (they were absent from the session shell).
3. Vercel: `maxDuration` plan limit; mark `NEBIUS_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `UPSTASH_REDIS_REST_TOKEN` Sensitive.
