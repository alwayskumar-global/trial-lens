# Selection rule, spend guard and warm-up plan (2026-10-08; UNDER REVIEW; NOT approved, NOT run)

Status: read-only checks and offline tests only. **No model call and no Supabase write.** `eval/warm-cache.ts` is dry-run only (`--execute` is refused and not implemented). **Nothing here is approval to spend**: the $0.75 figure is a proposal. Kumar has NOT approved warming, daily re-warming, hash ranking (rejected), any budget, or any change to the live route. Approved as design constraints only: insert-only writes to `trial_criteria_cache`, the plan-fingerprint gate, interventional-only scope. Rule D is still **not exercised live** (offline integration test only). Vocabulary coverage gate open. `VISITOR_INPUT_MODE=samples`. Production untouched.

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

## 4. Spending: what is enforced, what is assumed
- **Corrected claim:** a guard built on `chars / 2.5` would be conditional; one attempt can exceed that reservation. The guard now implemented reserves from a bound that needs no tokenizer ratio, and it still rests on stated assumptions (below). It is not a guarantee against a provider billing surprise.
- **Implemented and offline-tested (no provider needed):** `eval/lib/warm-guard.ts` (`SpendGuard`) and `eval/lib/warm-dispatch.ts` (`dispatchJob`, `runJobs`, injected chat port). 14 dispatcher tests + 10 guard tests, three mutation checks (zero reservation, no assumption checks, free timeouts: each fails the suite).
  - **Every HTTP attempt is reserved first**, including the validation retry (sized from the real retry body with the echoed output), each 429 backoff retry, and each timeout/network retry. Worst case = `(UTF-8 bytes of the exact request body + 64) x input price + max_tokens x output price`. Sent only if `actual_spent + in-flight worst cases + this worst case <= budget` and the attempt ceiling is not reached; if only other in-flight reservations block it, the job waits for a settlement and retries the reservation.
  - **Concurrent in-flight reservations count against the budget** (test: the committed bound never exceeded the budget at any call across 60 random seeds with random failures and concurrency 1-6).
  - **Reconciliation:** after each reply the reservation is replaced by the reported usage x price. A 429 is charged 0 (no tokens) but consumes an attempt slot. A timeout, network or HTTP error is charged the worst case. Missing usage is charged the worst case.
  - **Stop when an assumption fails (fail closed):** missing/invalid usage, prompt tokens above the byte bound, completion tokens above `max_tokens`, or any attempt costing more than its reservation halts all further dispatch; in-flight attempts finish and settle.
  - **Calibration gate:** the first 3 jobs run strictly one at a time; a violation there stops everything before concurrency (6) opens.
- **Stated assumptions:** (A1) billed prompt tokens <= request-body bytes + 64 (a token covers at least one byte); (A2) billed completion tokens <= `max_tokens` including any reasoning tokens (supported by earlier extraction runs that stopped exactly at their 4,096-token cap, `docs/hardened-1-dev-check.md`; not proven for this model's reasoning billing); (A3) prices as confirmed below; (A4) no hidden SDK retries (`maxRetries: 0`; a timed-out request is charged at its worst case); (A5) the provider's reported usage is accurate.
- **MID price reconfirmed 2026-10-08** from the provider's model-metadata endpoint (a GET, not an inference call): `nvidia/nemotron-3-super-120b-a12b` prompt $0.0000003, completion $0.0000009 per token, request fee 0 (same as before). `eval/warm-cache.ts --check-price` repeats the check and an execution run would stop on any difference.

## 5. Warm-up plan for the proposed rule (final numbers for review; dry run 2026-10-08 13:28 UTC)
Policy label `relevance-v1:interventional`, parser `spike-4+cov-1`, data `2026-10-08T09:00:05`, three prepared profiles.
- Selected 32 distinct trials; 1 cached; **31 trials to warm**, **55 parse chunks** (request bodies 13,071-16,814 bytes).
- **Plan fingerprint:** `a9d8d9d582591a3805dbe41666d1b328c46b306d3021f4f5f051761b2a383253` (valid only for this exact plan and CT.gov state; it changes if any trial, `last_update`, criteria count, chunk count, policy label or parser version changes).
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
- **Writes (approved design constraint):** `trial_criteria_cache` only, insert-only (`ON CONFLICT DO NOTHING`), exact key re-checked just before each write, fully parsed trials only, no updates or deletes; the 39 existing rows (including the six kept from the failed first live run) are never touched. A fake-client write test is still to be written with the executor.
- **Plan-fingerprint gate (approved design constraint):** `--execute` would require `WARM_PLAN=<fingerprint>`, recompute the plan from live CT.gov first, and on ANY difference exit before any model call or write, printing counts and ids of added / removed / changed trials. A changed plan needs a new dry run and a new approval.
- **Checks (when and if approved):** before: dry run, `eval/cache-snapshot.ts` (39 rows `3a445b18…12e0f6`, `replay_cases` `d359b6ca…631a3a6`), price check. After: the 39 old rows re-hash identically; row count = 39 + rows written (<= 31); every new key planned; inventory shows the new hits; `replay_cases` unchanged; free replay 38/38. Hashes corroborate the insert-only code path and tests; they cannot alone prove an identical rewrite was impossible.
- **Not built yet:** the executor that wires `runJobs` to the real provider and to the insert-only writer. It will be written and tested offline only after Kumar decides the questions below.

## 6. Decisions requested (nothing runs before these)
1. Review `relevance-v1` (interventional, fail-closed) and decide whether to wait for the next-refresh comparison before any warming (recommended: wait; warming a selection that may rotate wastes the point of warming).
2. Decide the budget and whether to accept the residual risk above or add a provider-side limit.
3. Only then request execution approval; it would need the plan to be re-run and the fingerprint re-confirmed on that day.
