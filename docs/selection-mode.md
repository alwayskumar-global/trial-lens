# Candidate-selection mode for live discovery (2026-10-09; implemented, NOT activated)

The live route and the offline warm-up planner now share ONE selection code path (`src/lib/ctgov/selection.ts`). The new rule `relevance-v1:interventional` is behind a server-side setting whose default is today's behavior. Nothing in Preview or Production sets it yet.

*Revision 2026-10-10: the post-fetch drop of studies with no breast signal was removed from the route and the planner (it made `discovered` stop meaning "returned by the query"); the contract is pinned by a test with a no-signal study in the window.*

## The setting (exact key and values)
| | |
|---|---|
| **Key** | `CTGOV_SELECTION_MODE` (server-side only; never a `NEXT_PUBLIC_` variable; plain, not a secret) |
| **Default** | unset, blank, or `api-default`: the original query, no sort, all study types (today's behavior, byte-for-byte; tested) |
| **Activating value** | `relevance-v1-interventional` |
| **Anything else** | an `EnvError`: live discovery fails closed (existing labelled replay or error); replays and `/api/extract` are unaffected |
| **Where to set it** | Vercel project `trial-lens`, environment **Preview**, Git branch **`phase1/spike`** only (the same scoping used for `CRITERIA_CACHE_WRITES`). Not Production. Needs a redeploy to take effect. |
| **Rollback** | set it to `api-default` (or remove it) and redeploy |

`/api/run` log lines now carry `"selection_mode":"api-default" | "relevance-v1-interventional" | "env_invalid"` (next to `cache_writes`), so the effective value is verifiable from a free replay request's runtime log.

## What the mode changes (only in `relevance-v1-interventional`)
- Request: `query.cond=breast cancer`, `filter.overallStatus=RECRUITING`, **`sort=@relevance`**, **`filter.advanced=AREA[StudyType]INTERVENTIONAL`**, two pages of 60 (same number of requests as today).
- **Nothing is dropped after the fetch.** Studies with no breast signal (MeSH or condition text) stay in the window (0 of 120 on 2026-10-08/09); the scope class is a diagnostic only (offline snapshots and tests), not a filter.
- Then the same prefilter and the same 30-candidate cap as today.
- **Counts contract** (SSE `counts`, discovery stage): `discovered` = the studies the CT.gov query returned (in relevance mode: after the API-side interventional filter, nothing dropped afterwards); `filtered` = of those, passing the age/sex prefilter; `selected` = first 30 of the filtered, in window order. Later `selected = assessed + pending + failed`. Both modes use the same `selectFromDiscovered`.
- **Fail closed:** an HTTP error (including a rejected `sort`, HTTP 400), network error/timeout, malformed page or any study that is not INTERVENTIONAL (a scope check on the response) throws `CtgovError` after exactly one request; the pipeline reports `ctgov_unavailable`; the handler then streams a labelled replay (`mode: replay`, `reason: ctgov_unavailable`) when replay fallback is on, or the existing error event with `fallback_to_replay: false` when it is off. No path falls back to the API order. Limit: a silent change in what `@relevance` means is not detectable.

## Code diff (summary)
- `src/lib/ctgov/modes.ts` (new): mode names and default. `src/lib/ctgov/scope.ts` (new, moved from `eval/`): breast-signal classifier.
- `src/lib/ctgov/selection.ts` (new): `fetchSelectionWindow`, `discoverBySelectionMode`, `selectFromDiscovered`, `INTERVENTIONAL_FILTER`.
- `src/lib/ctgov/client.ts`: exports `StudySchema`/`FIELDS`; new `CTGOV_SCOPE` error code. `discoverRecruitingBreastTrials` unchanged.
- `src/lib/env.ts`: new lazy group `getSelectionEnv()` (own group, so a bad value cannot break replays).
- `src/lib/pipeline/deps.ts`: `discover` calls `discoverBySelectionMode(mode, ...)`. `src/lib/pipeline/run.ts`: the discovery stage uses `selectFromDiscovered` (same logic as before). `src/app/api/run/route.ts`: `selection_mode` in the log line.
- `eval/lib/warm-plan.ts` (new): the planner and the (disabled) executor compute the plan with the same functions as the route. `eval/lib/ctgov-window.ts` is now a thin wrapper over the `src` code.
- Real bindings, tested against fakes, NOT enabled: `eval/warm-bindings.ts` (provider port: `maxRetries: 0`, 120 s timeout; insert-only Supabase store; fail-closed price check), `eval/lib/warm-run.ts` (`EXECUTE_ENABLED = false`, pinned by a test), `eval/warm-execute.ts` (exits 2 immediately). `eval/warm-cache.ts --execute` also refuses.

## Tests
`src/lib/ctgov/selection.test.ts`: default mode issues today's exact request and returns what `discoverRecruitingBreastTrials` returns; relevance mode sends the sort and the filter on both pages and keeps window order; the pipeline's `counts` and `trial_result`s equal what the warm-up planner selects for the same profile; each failure type throws after one relevance request; route level: labelled replay with replay on, error with replay off; `createPipelineDeps` honours `CTGOV_SELECTION_MODE` (unset/blank/`api-default` = original query; `relevance-v1-interventional` = sorted and scoped; invalid = EnvError). Mutation checks: a silent fallback to API order fails 7 tests; a route that ignores the setting fails the wiring test.

## Verification order (nothing below is done yet; every paid step needs its own approval)
1. **Deploy the code with the setting unset** (already the case after the push). Free replay request; its runtime log must show `"selection_mode":"api-default"` and `"cache_writes":false`. Replay preflight 38/38.
2. **Set `CTGOV_SELECTION_MODE=relevance-v1-interventional` for Preview / `phase1/spike`** (Kumar or Codex; I cannot edit project env), redeploy, confirm the alias SHA is READY.
3. **Free replay request again:** its log must now show `"selection_mode":"relevance-v1-interventional"` (and `cache_writes:false`). If it shows `api-default`, `env_invalid` or cannot be read, stop.
4. **Re-run the warm-up plan against current CT.gov data** (`eval/warm-cache.ts --policy=relevance`, plus `eval/selection-snapshot.ts --due`/`--compare` if a new refresh has happened). Bring back the new fingerprint, planned keys, maximum writes, attempt ceiling and conditional budget. **Separate approval** of that fingerprint, those writes and the budget is required before any model call or Supabase write; enabling execution is a reviewed code change (`EXECUTE_ENABLED`).
5. After an approved warm-up: cache snapshot checks (old 39 rows unchanged, new rows only for planned keys), then, only with a further approval, **one live run** with the relevance mode to measure coverage (`analysis_pending` should fall from about 21-23 of 30).
