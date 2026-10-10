# Release runbook: Production

## Current state (verified 2026-10-10)

PR #1 was merged to `main`; PR #2 added sanitized extraction-failure diagnostics. The public Production URL is https://trial-lens-xi.vercel.app/. Vercel shows deployment `dpl_9gPfzBYyeSUUsg2RCDEqVhH5PN9B` (merge SHA `4dd8324`) READY. `GET /api/input-mode` reported `open` and `extract_ready:true`. A single fictional typed flow completed through extraction, a live 30-study run, Results and Detail. Request logs showed `POST /api/extract` 200, `POST /api/run` 200, `visitor_input_mode:"open"`, `selection_mode:"relevance-v1-interventional"`, `cache_writes:true`, and `max_calls:80`. No visitor text or secrets appeared in those structured log lines. Production is public; Preview remains protected. Nebius ZDR is **owner-attested** by Kumar (see `TASKS.md`).

The configuration and rollout instructions below describe the setup already performed. Remaining release work is the demo video, final Devpost form, and periodic availability checks through judging.

**Historical setup note:** the original connector returned 403 for environment-variable changes. Production credentials were entered and rotated through the dashboard, and the merged deployment was verified on 2026-10-10.

## 1. Recommended Production configuration (Vercel → trial-lens → Settings → Environment Variables)

Scope for every row: **Production only** (no Git branch). Mark Sensitive where stated; Sensitive values cannot be read back, so keep your own copy. Use **new** random values for the two secrets; do not reuse Preview's and never paste them in chat.

| Variable | Value | Type | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_UI_MODE` | `live` | Plain (public) | **Build-time**: inlined at build. Must exist before the build that ships. |
| `VISITOR_INPUT_MODE` | `open` | Plain | Needs both secrets below, otherwise it silently degrades to `samples`. |
| `PROFILE_SIGNING_SECRET` | 32+ chars, e.g. `openssl rand -base64 48 \| tr -d '\n='` | **Sensitive** | Signs extraction tokens. |
| `RATE_LIMIT_IP_SALT` | 16+ chars, e.g. `openssl rand -base64 24 \| tr -d '\n='` | **Sensitive** | Salts the hashed IP rate-limit bucket. |
| `NEBIUS_API_KEY` | key | **Sensitive** | Nebius Token Factory. |
| `NEBIUS_BASE_URL` | as in Preview | Plain | |
| `NEMOTRON_MODEL_FAST` | as in Preview (Nano) | Plain | Extraction. |
| `NEMOTRON_MODEL_MID` | as in Preview (Super) | Plain | Parse, evaluate, verify. |
| `SUPABASE_URL` | as in Preview | Plain | |
| `SUPABASE_SERVICE_ROLE_KEY` | key | **Sensitive** | Server only; bypasses RLS. |
| `UPSTASH_REDIS_REST_URL` | as in Preview | Plain | |
| `UPSTASH_REDIS_REST_TOKEN` | token | **Sensitive** | |
| `CTGOV_SELECTION_MODE` | `relevance-v1-interventional` | Plain | Same selection as the Preview evidence. Stored replays predate it (loosely on-topic studies possible in replays). |
| `CRITERIA_CACHE_WRITES` | `true` (recommended) | Plain | Writes only parsed public trial criteria (insert-only, keyed by NCT id + version), never visitor text. With `false`, studies not already cached stay "Not analyzed this run" more often for judge-typed cases. |
| `MAX_LLM_CALLS_PER_RUN` | `80` | Plain | Hard cap on model HTTP attempts per run (a call count, not dollars). |
| `DAILY_RUN_BUDGET` | `150` (decide) | Plain | Runs per day. Worst case about $0.67 per run if every call retries at max tokens (forecast, not a cap): about $100/day at 150; typical measured about $0.04-0.11 per run, i.e. $6-17/day. |
| `RATE_LIMIT_RUNS_PER_IP_PER_HOUR` | `8` | Plain | |
| `DAILY_EXTRACT_BUDGET` | `300` | Plain | One FAST call each, well under $0.002 per extraction. |
| `RATE_LIMIT_EXTRACT_PER_IP_PER_HOUR` | `12` | Plain | |
| `MAX_CONCURRENT_RUNS` | `3` | Plain | |
| `MAX_INPUT_CHARS` | `2000` | Plain | The textbox limit follows this value (the Preview currently reports 4000). |
| `REPLAY_FALLBACK_ENABLED` | `true` | Plain | Text/replay requests fall back to a labelled replay; profile runs return 429/503 with an offer to view a saved example. |

Do not set: `EXECUTE_ENABLED` (warm-up tooling stays disabled), any secret with `NEXT_PUBLIC_`. Unused: `PARSER_VERSION`, `LOG_LEVEL`, `NEMOTRON_MODEL_DEEP`, `TAVILY_API_KEY`.

## 2. Public access for judges
Production is public; Preview remains protected. Keep that separation while the demo is available for judging. Typed input spends model credits under the call-count and daily-run limits above; there is no enforced dollar cap.

## 3. Original deployment order (completed)
1. Set the Production variables above (Production scope). `NEXT_PUBLIC_UI_MODE=live` must be in place before the build.
2. Review and merge the PR `phase1/spike` → `main`. The merge triggers the Production build, which reads the Production variables. **Do not use "Redeploy" on an old Production deployment instead**: that rebuilds the old commit.
3. Wait for the Production deployment to be READY; confirm its SHA equals the PR head.
4. Run the free checks (section 4) against the deployment URL while protection is still on (use a protection-bypass share link for the preflight, or run them directly after step 5).
5. Disable Vercel Authentication for Production (section 2).
6. Re-run the free checks from a clean browser (desktop and phone); no paid run is required. An optional single fictional run is about $0.04.
7. Record the video and submit Devpost by the evening of Oct 29 IST (deadline Oct 30 10:00 PDT = 22:30 IST).

## 4. Free post-deploy checks (no model calls)
- `curl -s https://<production-host>/api/input-mode` → `{"visitor_input":"open","extract_ready":true,...}`. If it says `samples`, a secret or the salt is missing or too short. If `extract_ready:false`, `PROFILE_SIGNING_SECRET` is missing.
- `PREVIEW_URL=https://<production-host> CTGOV_SELECTION_MODE_EXPECTED=relevance-v1-interventional EXPECT_VISITOR_INPUT=open pnpm exec tsx eval/preview-sse-check.ts` (add `PREVIEW_SHARE_URL` only while protection is on). Expect 43 PASS, 0 FAIL. In open mode it never sends typed text.
- `PREVIEW_URL=https://<production-host> pnpm exec tsx eval/judge-flow-check.ts` (free mode): input-mode, forged and missing tokens refused. Paid mode needs `RUN_JUDGE=1 CONFIRM_JUDGE_FLOW=one-extract-one-run`; do not run it without a decision.
- `curl -sI https://<production-host>/` → `x-content-type-options: nosniff`, `x-frame-options: DENY`, `referrer-policy`, `permissions-policy`, `cross-origin-opener-policy`, `content-security-policy` (frame-ancestors).
- Function logs show `visitor_input_mode:"open"`, `cache_writes`, `selection_mode`, `max_calls` on each run line, and no visitor text.

## 5. Rollback (fastest first)
1. Close typed input without a code change: set `VISITOR_INPUT_MODE=samples` (Production) and redeploy: the UI shows the disabled text box and fictional examples only.
2. Stop spend: blank `NEBIUS_API_KEY` and redeploy: live runs fail, saved examples still work.
3. Re-enable protection: Deployment Protection → Vercel Authentication on for Production.
4. Revert the deployment: Deployments → the previous Production deployment → Promote to Production.

## 6. Verification history
See `docs/judge-flow-preview-evidence.md` for the protected Preview test. Production was subsequently verified with fictional typed extraction and a live search on 2026-10-10, as recorded in Current state above.

## 7. What is not claimed
No clinical validation or accuracy figure; the vocabulary-coverage gate is not met; Rule D has no live evidence; the 300 s function limit is unproven; extraction can miss facts; sparse profiles surface loosely related studies; ZDR is owner-attested, not independently verified.
