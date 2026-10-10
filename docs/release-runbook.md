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

## Not part of this release
Real visitor input (`VISITOR_INPUT_MODE=open`) and the Stage 3 UI: gated on written organisation-level ZDR confirmation and a separate decision.
