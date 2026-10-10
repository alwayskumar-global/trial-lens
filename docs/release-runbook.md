# Release runbook: Production (NOT executed; Kumar-only actions)

Baseline: `phase1/spike` head, live-mode build, `VISITOR_INPUT_MODE=samples`. Production today = `main` (docs-only).

## Production environment (Vercel → Project → Settings → Environment Variables → Production)

| Variable | Value | Type |
|---|---|---|
| `NEXT_PUBLIC_UI_MODE` | `live` (inlined at build; set BEFORE building) | Plain |
| `VISITOR_INPUT_MODE` | `samples` | Plain |
| `NEBIUS_API_KEY` | key | Sensitive |
| `NEBIUS_BASE_URL`, `NEMOTRON_MODEL_FAST`, `NEMOTRON_MODEL_MID` | as in Preview | Plain |
| `SUPABASE_URL` | as in Preview | Plain |
| `SUPABASE_SERVICE_ROLE_KEY` | key | Sensitive |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | as in Preview | Plain / Sensitive |
| `PROFILE_SIGNING_SECRET` | 32+ chars (`openssl rand -base64 48`) | Sensitive |
| `CTGOV_SELECTION_MODE` | `relevance-v1-interventional` only if you accept stored replays being from the older selection (see decisions); else leave unset | Plain |
| `CRITERIA_CACHE_WRITES` | `false` keeps the cache read-only (Preview setting); `true` lets live runs add rows (default) | Plain |
| `DAILY_RUN_BUDGET`, `MAX_LLM_CALLS_PER_RUN` | decide (P1); defaults 150 / 80 | Plain |
| `RATE_LIMIT_IP_SALT` | not needed in samples mode | n/a |

Do not set `EXECUTE_ENABLED` (warm-up tooling stays disabled).

## Order

1. Decide the public-access model: Production with Vercel Authentication **on** blocks judges. Judges need an unauthenticated URL (rules: free and unrestricted). Turn it off for Production deliberately, or ask organizers (P2).
2. Set Production env vars above (Sensitive where marked).
3. Merge `phase1/spike` → `main` via PR (Preview must be READY and the 39-check preflight green first).
4. Production build runs automatically on merge. Confirm the deployment is READY and uses the env set in step 2 (env changes need a new deployment).
5. Verify: `PREVIEW_URL=https://<production-host> pnpm exec tsx eval/preview-sse-check.ts` (free preflight; no `RUN_LIVE`) and open the site on desktop and phone; confirm response headers (nosniff, DENY, referrer, permissions, COOP, CSP frame-ancestors); check runtime log line fields (`visitor_input_mode: samples`, `cache_writes`, `selection_mode`, `max_calls`).
6. Optionally one paid live sample run (Kumar approves; ~$0.04-0.11).
7. Record video; submit Devpost by Oct 29 evening IST (deadline Oct 30 10:00 PDT = 22:30 IST).

## Rollback
Vercel → Deployments → previous deployment → Promote (or `request_rollback`). Setting `REPLAY_FALLBACK_ENABLED=true` (default) keeps the app answering with labelled replays if models fail. To stop spend immediately, blank `NEBIUS_API_KEY` and redeploy: runs fall back to replay.

## Activating judge-entered input (NOT done; gated)
Judge-entered input is now a release requirement, but the server stays in `samples` until Kumar (a) provides written Nebius organisation-level ZDR confirmation and (b) approves the visitor-facing privacy and results copy (`docs/visitor-flow-copy-review.md`). The UI is already in the build: with `samples` it shows a disabled text box and a read-only review; with `open` it is fully editable. `NEXT_PUBLIC_UI_MODE=live` is build-time.

Required server-side variables (never `NEXT_PUBLIC_`, never in `.env.example` values, logs or commits):

| Variable | Rule |
|---|---|
| `PROFILE_SIGNING_SECRET` | 32+ chars, Sensitive. Needed by `/api/extract` in every mode now; without it the UI falls back to the old fixed flow. |
| `RATE_LIMIT_IP_SALT` | 16+ chars, Sensitive. Without it `open` silently degrades to `samples`. |
| `NEBIUS_API_KEY`, `NEBIUS_BASE_URL`, `NEMOTRON_MODEL_FAST`, `NEMOTRON_MODEL_MID` | as today |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | as today |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | as today (extraction and run guards need Redis) |
| `VISITOR_INPUT_MODE` | `open` on **Preview only** for the test, then back to `samples` until approval |

Check the effective configuration for free, before any model call: `GET <preview>/api/input-mode` returns `{visitor_input, extract_ready, max_input_chars}`. `extract_ready:false` = signing secret missing or invalid; `visitor_input:"samples"` after you set `open` = the salt or secret is missing/too short. Function logs show `visitor_input_mode` on each run line.

Sequence:
1. Preview env: set `PROFILE_SIGNING_SECRET` and `RATE_LIMIT_IP_SALT` (Sensitive, Preview only); keep `CRITERIA_CACHE_WRITES=false`.
2. Redeploy Preview; `GET /api/input-mode` must say `samples` + `extract_ready:true`. Verify the gated UI (disabled box, read-only review, sample flow).
3. Set `VISITOR_INPUT_MODE=open` on Preview only; redeploy; `GET /api/input-mode` must say `open`.
4. Test with fictional text only, within a stated ceiling: one extraction (1 FAST call) per case; one full run is about $0.04-0.11 (`docs/cost-per-run.md`). Verify edits change the submitted profile, a stale token is refused, a rate-limit state, errors.
5. Set `VISITOR_INPUT_MODE` back to `samples` (or leave open on Preview only while testing) and redeploy. Production stays `samples` until the ZDR confirmation and the copy approval are both in hand; then set `open` on Production, redeploy, and re-run step 4's checks.

## Not part of this release until the gate opens
Real visitor input on Production.
