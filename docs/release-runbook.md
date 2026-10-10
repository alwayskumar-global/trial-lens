# Release runbook: Production (NOT executed; Kumar-only actions)

Release candidate: `phase1/spike` (PR to `main` for review; **not merged**). Judge-entered input is part of the release (`VISITOR_INPUT_MODE=open`), with ZDR **owner-attested** by Kumar (see `TASKS.md`). Production today = `main` at the docs-only commit; nothing here has been applied to Production.

**Why only Kumar can do these steps:** the agent's Vercel token returns 403 for environment variables (list and create), so Production variables, deployment protection and the merge are Kumar's. The agent can read deployments and logs.

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
Production currently sits behind Vercel Authentication, which blocks judges (rules: free and unrestricted testing). Only Kumar can change it: Settings → Deployment Protection → Vercel Authentication → disable for **Production** only. **Leave Preview protected.** Do this only after the free checks below pass on the deployment, because the site is then public and typed input spends model credits (bounded by the budgets above). If you prefer certainty about organiser expectations, send the drafted organiser question in `docs/cost-per-run.md` first.

## 3. Order
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

## 6. Preview verification already done
See `docs/judge-flow-preview-evidence.md` (one fictional end-to-end run, about $0.04, 39 model calls) and the release packet. The agent made no further model calls.

## 7. What is not claimed
No clinical validation or accuracy figure; the vocabulary-coverage gate is not met; Rule D has no live evidence; the 300 s function limit is unproven; extraction can miss facts; sparse profiles surface loosely related studies; ZDR is owner-attested, not independently verified.
