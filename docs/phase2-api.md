# Phase 2: `/api/run` (live pipeline, replay, guards)

Status: implemented, unit-tested offline, and live-verified against Nebius Token Factory, ClinicalTrials.gov, Upstash and Supabase (project `triallensdb`). The UI is still the fixed fictional demo and does not call this endpoint.

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

## Live verification (fictional profiles only, 2026-10-06)
- Supabase: migrations 0001 (tables, RLS on, no policies), 0002 (grant `service_role` only: new projects do not auto-grant, REST returned 42501 without it), 0003 (revoke default `anon`/`authenticated` privileges) applied to `triallensdb`; advisor shows only the intended INFO "RLS enabled, no policy".
- `precompute:replay --write`: 3 cases stored. The first pass was cold (21 trials `analysis_pending`); re-run with the warm parse cache ⇒ 0 pending in all three. 33 trials cached.
- Live run through `/api/run`, warm cache (cache read from Supabase by a fresh server): 43 calls (worst case 80), 75 s, 1 trial pending. Cold run earlier: 29 calls, 72 s, 22 pending.
- Fallbacks to a labelled replay, each checked end to end: explicit `replay_id`; per-IP rate limit (real Upstash); Nebius env missing; Token Factory rejecting the key (real HTTP 401: `error` event, then replay). Oversized input 413, malformed body 400. The key value never appeared in a response or log.
- Not exercised live: exhausted daily budget and Upstash outage (unit-tested only), Vercel streaming/`maxDuration`.

## Open
1. Vercel: `maxDuration` plan limit (measured runs 60-105 s); mark `NEBIUS_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `UPSTASH_REDIS_REST_TOKEN` Sensitive. Not deployed.
2. Replay cases hold CT.gov text in Supabase only (VERIFY CT.gov terms before ever bundling it in the repo), so replay needs Supabase.
3. Cold runs leave most trials `analysis_pending` (parse cap 14 slots): warm the cache (`pnpm precompute:replay --write`) before any demo or after a CT.gov update changes `source_version`.
