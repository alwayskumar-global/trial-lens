# Selection rule, spend guard and warm-up plan (2026-10-08; UNDER REVIEW; NOT approved, NOT run)

Status: read-only checks and offline tests only. The selector is now implemented behind `CTGOV_SELECTION_MODE` (default = current behavior, not activated; see `docs/selection-mode.md`); the planner uses the route's own selection code, and the real provider/Supabase bindings exist but execution is disabled (`EXECUTE_ENABLED=false`). **No model call and no Supabase write.** `eval/warm-cache.ts` is dry-run only (`--execute` is refused and not implemented). **Nothing here is approval to spend**: the $0.75 figure is a proposal. Kumar has NOT approved warming, daily re-warming, hash ranking (rejected), any budget, or any change to the live route. Approved as design constraints only: insert-only writes to `trial_criteria_cache`, the plan-fingerprint gate, interventional-only scope. The byte-based reservation is conditional (section 4), not a guaranteed dollar cap. Rule D is still **not exercised live** (offline integration test only). Vocabulary coverage gate open. `VISITOR_INPUT_MODE=samples`. Production untouched.

## 1. Selection evidence (unchanged)
Query unchanged since 2026-10-06; pool of recruiting "breast cancer" studies is about 2.4k (2,446 today; 1,861 interventional); the route reads the first 120. All 39 cached trials are still RECRUITING with unchanged `last_update`, but only 3 are in today's 120. Across the 2026-10-07 09:00 -> 2026-10-08 09:00 CT.gov refresh the API-order selection kept **2 of 30** (one pair of observations around one refresh; the pre-refresh list was reconstructed and hash-verified). The default order is undocumented and is not `@relevance`, `LastUpdatePostDate` or `StudyFirstPostDate` order. **`@relevance` stability across a refresh is NOT yet measured**; the 60% retention figure is a provisional gate, not proof of lasting stability. `sort=@relevance` stays an offline candidate. The live route is unchanged.

## 2. Interventional scope (Kumar's preference)
- **Official filter, verified 2026-10-08:** `filter.advanced=AREA[StudyType]INTERVENTIONAL` (Essie expression). `aggFilters=studyType:int` returns the identical list in the identical order. Effect: 2,446 recruiting studies -> 1,861 interventional; of the unfiltered first 120, 92 are interventional and 28 observational.
- The fetch also **fails closed on scope**: every returned study must have `studyType == INTERVENTIONAL`, otherwise the fetch throws.
- Recomputed at data version `2026-10-08T09:00:05` (`eval/selection-snapshot.ts`, interventional, three prepared profiles, first 30 after the age/sex prefilter, union):

| | API order | `sort=@relevance` |
|---|---|---|
| Window (120): breast-specific / breast + other MeSH / no breast signal | 69 / 46 / 5 | 88 / 32 / 0 |
| Filtered by age/sex (her2pos / hrpos / tnbc) | 115 / 115 / 110 | 113 / 110 / 108 |
| Selected union (all interventional) | 33 | 32 |
| Selected: breast-specific / with other / no signal | 14 / 18 / 1 | 28 / 4 / 0 |
| Cache hits (exact key) | 1 | 1 |
| Parse chunks needed | 75 | 55 |

Window overlap between the two policies 12 of 120; selected overlap 1. The refresh comparison under this scope has its baseline saved locally (`eval/data/selection-snapshots/2026-10-08T13-25-01-057Z.json`, `scope_filter: interventional`); snapshots with different scopes are never compared.

## 3. Proposed rule `relevance-v1` (interventional; for review; live route NOT changed)
1. `query.cond=breast cancer`, `filter.overallStatus=RECRUITING`, `filter.advanced=AREA[StudyType]INTERVENTIONAL`, **explicit `sort=@relevance`**, two pages of 60 (no extra requests).
2. Drop studies with no breast signal (MeSH or condition text); today 0 of 120.
3. Same age/sex prefilter and `MAX_CANDIDATE_TRIALS` = 30; cheapest-first inside the run unchanged.
4. **Fail closed, no silent fallback.** If the request fails (HTTP error, network error or timeout, malformed page) or returns an out-of-scope study, discovery throws; the existing handler turns that into `ctgov_unavailable`: for a normal run with `REPLAY_FALLBACK_ENABLED` it emits an `error` event (`fallback_to_replay: true`) and then a **labelled replay** (`mode: replay`, `reason: ctgov_unavailable`, saved fictional profile); for a visitor-profile run, or when replay fallback is disabled, it emits the existing `error` event with `fallback_to_replay: false` and no replay (the stream has already started, so this is an event, not an HTTP 503). At no point is the API-default order used. Limit: the API rejects a bad `sort` with HTTP 400 (observed for unknown fields), so that case is caught; a hypothetical silent change in what `@relevance` means is not detectable by this check.
5. Adoption condition, provisional: after the next refresh, retain a clear majority of the selected union (proposal: >= 60%, about 19 of 32). It is a gate for review, not evidence of lasting stability. If it fails, no ordering of this query is stable enough to warm.

**Manual refresh check (no background job):**
`node --env-file=.env --import tsx eval/selection-snapshot.ts --due` prints whether CT.gov's `dataTimestamp` has changed since the latest saved snapshot (currently `2026-10-08T09:00:05`, not changed). When it has: take a snapshot (same command without flags), then `... eval/selection-snapshot.ts --compare <older.json> <newer.json>`.

## 3b. Refresh result (2026-10-09; dataTimestamp 2026-10-08T09:00:05 -> 2026-10-09T09:00:05; interventional scope; saved baselines in gitignored `eval/data/selection-snapshots/`)
| Policy | Selected before -> after | Kept | Retention (kept / before) | Window of 120: kept / same position |
|---|---|---|---|---|
| `sort=@relevance` | 32 -> 32 | **32** | **100%** (32/32) | 120 / 118 |
| API order | 33 -> 30 | 1 | 3% (1/33) | 18 / 0 |

- **The provisional 60% gate passes for `@relevance`** (needs about 19 of 32) and fails badly for API order. This is one pair of observations around one refresh, not proof of lasting stability; it should be re-measured at each refresh while the plan is live.
- New `@relevance` plan (data 2026-10-09T09:00:05): 32 selected, 1 cache hit, **31 trials to warm, 55 parse chunks, 576 criteria, attempt ceiling 110, maximum cache writes 31**. Budget simulation, exposure table and price check unchanged (MID still $0.0000003 / $0.0000009). Planned keys (NCT id | source version | parser version) are saved in `eval/data/warm-plans/2026-10-09T14-47-30-344Z-17ed3158.json`.
- Cache and replay snapshot unchanged: 39 rows `3a445b18…12e0f6`, `replay_cases` `d359b6ca…631a3a6`.

## 4. Spending: what is enforced, what is assumed, what is verified
**The byte-based reservation is CONDITIONAL. It is not a guaranteed dollar cap.** It holds only while the assumptions below hold; $0.75 is a proposed budget, not a spending ceiling and not an approval.

- **Implemented and offline-tested (no provider needed):** `eval/lib/warm-guard.ts` (`SpendGuard`), `eval/lib/warm-dispatch.ts` (per-attempt reservations), `eval/lib/warm-executor.ts` + `warm-store.ts` (executor wired to the dispatcher and an insert-only writer, with a FAKE provider and a FAKE Supabase client in the tests). 15 dispatcher, 11 executor, 10 guard tests; mutation checks (zero reservation, no assumption checks, free timeouts, no fingerprint gate, no price gate, no write cap) each fail the suite.
  - **Every HTTP attempt is reserved first**: first try, validation retry (sized from the real retry body), each 429 backoff retry, each timeout/network retry. Worst case = `(UTF-8 bytes of the exact request body + 64) x input price + max_tokens x output price`. Sent only if `actual_spent + in-flight worst cases + this worst case <= budget` and the attempt ceiling is not reached; if only other in-flight reservations block it, the job waits for a settlement.
  - **Reconciliation:** a reply is charged its REPORTED usage x price. **An attempt that returns no reply (429, timeout, network error, HTTP error) is charged its WORST case.** In particular a 429 is no longer charged $0: Nebius documents neither that rejected requests are free nor that they are billed (rate-limits and billing pages, checked 2026-10-08). Missing usage is charged the worst case.
  - **Stop when an assumption fails (fail closed):** missing/invalid usage, prompt tokens above the byte bound, completion tokens above `max_tokens`, or any attempt costing more than its reservation halts all further dispatch; attempts already in flight settle.
  - **Calibration gate:** the first 3 jobs run strictly one at a time; a violation there stops everything before concurrency (6) opens.
- **Assumptions and their status (checked 2026-10-08, offline and by documentation; no inference call):**

| # | Assumption | Status |
|---|---|---|
| A1 | billed prompt tokens <= request-body bytes + 64 | **Consistent with measurement, not provider-guaranteed.** Two live runs billed about 1.9-2.0k prompt tokens per parse call on average; today's request bodies are 13-17 KB, so the bound is about 7x loose. Only run-level totals were recorded, not per-call maxima. |
| A2 | billed completion tokens <= `max_tokens`, reasoning tokens included | **Not documented by Nebius** (the billing page is silent on reasoning tokens and `max_tokens`). Supported by earlier extraction runs whose two attempts ended at exactly the 4,096-token cap (`docs/hardened-1-dev-check.md`); no exceedance seen in 50 logical calls, but totals only. The calibration gate and the per-reply check test it on the real provider. |
| A3 | prices unchanged | **Verified 2026-10-08** from the provider's model metadata: `nvidia/nemotron-3-super-120b-a12b` prompt $0.0000003, completion $0.0000009 per token, request fee 0, no cache-read price. The executor refuses if this differs. |
| A4 | no hidden retries | The production client uses `maxRetries: 0`; the future real provider port MUST do the same and set an explicit timeout (a timeout is charged worst case). Not yet built, so not yet verifiable. |
| A5 | reported usage is accurate | Not verifiable offline. Post-run check: compare the script's total with the Token Factory console Usage tab (a human step). |
| 429 billing | rejected requests are free | **No evidence either way; treated as billable at worst case.** |

- **Provider-side spending limit: none found, none changed.** The Token Factory billing page (`docs.tokenfactory.nebius.com/other-capabilities/billing-new`) documents no spend limit, budget cap, hard stop or alert (it describes a real-time balance, card auto-charge at a billing threshold and a read-only Usage tab). Nebius AI Cloud "budgets" are alert-only; their applicability to Token Factory is unconfirmed. Kumar is handling the inquiry to Nebius support about a hard spending limit. **No external guard is assumed**: the account balance is not treated as a safeguard, billing settings are not changed, and the plan's only dollar control is the conditional reservation above.
- **Residual spend risk:** if A1, A2, A4 or A5 is false, spend can exceed the budget by the excess of the attempts in flight when the first violation is reported: 1 during calibration (about $0.018 x the error factor), up to 6 afterwards; a billing rule that charges for 429s is covered (worst case), but a rule that charges more than `max_tokens` or more than the body bytes is not. Beyond that it is not bounded a priori.

## 5. Warm-up plan for the proposed rule (final numbers for review; dry run 2026-10-08 13:28 UTC)
Policy label `relevance-v1:interventional`, parser `spike-4+cov-1`, data `2026-10-08T09:00:05`, three prepared profiles.
- Selected 32 distinct trials; 1 cached; **31 trials to warm**, **55 parse chunks** (request bodies 13,071-16,814 bytes).
- **Plan fingerprint:** `17ed315827fecf3b6854ecd810f1ad38128a2d2b612be2cb7a3683f56a74978b` (recomputed 2026-10-09 after the refresh; the 2026-10-08 plan's fingerprint was `a9d8d9d5…383253` and would now be REFUSED by the gate, correctly: NCT06749210 was updated on 2026-10-09 and NCT07195344 on 2026-10-08, changing their source versions; valid only for this exact plan and CT.gov state; it changes if any trial, `last_update`, criteria count, chunk count, policy label or parser version changes).
- **Exact attempt ceiling: 110** (2 x 55: one validation retry per chunk; 429 and timeout retries count against it).
- **Maximum cache writes: 31** (one insert-only row per planned trial that parses fully; at most 31).
- **Maximum forecast exposure at the ceiling (110 attempts):**

| Assumption | First attempts (55) | Retries (55) | All 110 |
|---|---|---|---|
| prompt = chars/2.5 + 200 (estimate, not a bound) | $0.501 | $0.530 | $1.031 |
| prompt <= body bytes + 64 (the guard's bound) | $0.647 | $0.931 | **$1.578** |
| same, if real prompts were 2x that bound | | | $2.325 |
| expected at the measured $0.0021 per parse call | | | **$0.116** |

- **Budget for the guard: $0.75 proposed.** Simulation at $0.75: even if every first attempt hit its worst case, all 55 are admitted ($0.647 spent) and a retry is admitted only when actual spend leaves room; at the measured average all 55 plus retries fit with about $0.12 spent. $0.50 would stop at 42 of 55 chunks in the worst case. The $1.578 all-attempts figure is what the ceiling alone could reach; the budget, not the ceiling, limits dollars.
- **Residual spend risk (for Kumar to accept or reduce):** the bound holds only while A1-A5 hold. If one is false, spend can exceed the budget by the excess of the attempts in flight when the first violation is *reported*: 1 attempt during calibration (<= about $0.018 x the error factor), up to 6 in flight afterwards. Not bounded a priori beyond that. Options: accept; or set a provider-side spend limit on the Nebius account (cannot be done from here).
- **Writes (approved design constraint):** `trial_criteria_cache` only, insert-only (`ON CONFLICT DO NOTHING`), exact key re-checked just before each write, fully parsed trials only, no updates or deletes; the 39 existing rows (including the six kept from the failed first live run) are never touched. Fake-client tests for the writer exist (`warm-executor.test.ts`: only exact-key selects and insert-ignore upserts on the production conflict target).
- **Plan-fingerprint gate (approved design constraint):** `--execute` would require `WARM_PLAN=<fingerprint>`, recompute the plan from live CT.gov first, and on ANY difference exit before any model call or write, printing counts and ids of added / removed / changed trials. A changed plan needs a new dry run and a new approval.
- **Checks (when and if approved):** before: dry run, `eval/cache-snapshot.ts` (39 rows `3a445b18…12e0f6`, `replay_cases` `d359b6ca…631a3a6`), price check. After: the 39 old rows re-hash identically; row count = 39 + rows written (<= 31); every new key planned; inventory shows the new hits; `replay_cases` unchanged; free replay 38/38. Hashes corroborate the insert-only code path and tests; they cannot alone prove an identical rewrite was impossible.
- **Executor status:** `executeWarm` (approval sanity, price gate, fingerprint gate, exact-key re-check, dispatch, insert-only write with plan and count limits) is built and tested against fakes. **Not built, deliberately:** the real provider port (OpenAI-compatible client with `maxRetries: 0` and an explicit timeout), the binding of a real Supabase client, and any CLI path to them. `eval/warm-cache.ts --execute` stays refused until a separate approval.

## 6. Decisions requested (nothing runs before these)
1. Review `relevance-v1` (interventional, fail-closed) and decide whether to wait for the next-refresh comparison before any warming (recommended: wait; warming a selection that may rotate wastes the point of warming).
2. Decide the budget and whether to accept the residual risk above or add a provider-side limit.
3. Only then request execution approval; it would need the plan to be re-run and the fingerprint re-confirmed on that day.
