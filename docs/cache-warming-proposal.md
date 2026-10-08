# Cache warming: selection-stability evidence and REVISED PROPOSAL (2026-10-08; NOT approved, NOT run)

Status: nothing here has been run beyond read-only checks. **No model call and no Supabase write until Kumar approves.** Not approved: option A (warm now), daily re-warming (B), the earlier 120-attempt ceiling and the earlier $0.50 "soft" guard. Kumar's instruction: understand selection stability before paying to parse. Static ID pinning is NOT proposed yet. Rule D is still **not exercised live** (offline integration test only); the vocabulary coverage gate stays open; progressive result streaming stays deferred.

## 1. Why were 36 of 39 cached trials missing from today's discovery?
Read-only evidence (`eval/selection-stability.ts`, `eval/cache-inventory.ts`, `eval/warm-cache.ts`; public CT.gov GETs + Supabase SELECTs; counts and public ids only).

**Established**
- **The query did not change.** `src/lib/ctgov/client.ts` has one commit (516d137, 2026-10-06); the parameters (`query.cond=breast cancer`, `filter.overallStatus=RECRUITING`, `pageSize=60`, 2 pages, no `sort`) are the same for the 2026-10-06 precompute, the 2026-10-07 live run and today.
- **The cached trials did not go away or change.** All 39 are still RECRUITING at CT.gov today, 38 of 39 list a breast condition, and **all 39 have the same `LastUpdatePostDate` as their cached `source_version`** (no cache key is stale).
- **They fell out of the first 120 of the API's order.** The recruiting breast-cancer pool is **2,443** studies (`totalCount`); the live route reads only the first 120 (4.9%). Of the 34 trials in the three stored replays (computed 2026-10-06 07:00 UTC), **2** are in today's 120; of the 6 rows written on 2026-10-07, **1** is. All 33 rows from 2026-10-06 are replay trials (33 of the 34).
- **The default order is not one of the documented sorts.** Compared with `sort=@relevance`, `LastUpdatePostDate:desc/asc` and `StudyFirstPostDate:desc`, the default order shares 0 positions with each and only 6-11 of its 120 members. It is not sorted by last update or first-post date. `NCTId` is not an accepted sort field (HTTP 400).
- **Within seconds the order is identical** (two calls 5 s apart, and three repeats in other checks). CT.gov reports `apiVersion 2.0.5`, `dataTimestamp 2026-10-07T09:00:06`.

**Not established**
- *Why* the default order changes between days (it is undocumented; it may follow index/rank changes after each data refresh), and *how fast* it changes: we have two points (10/06, 10/07) inferred from stored data, not a time series, and the 10/07 live run's own selected list was not recorded.
- Whether the order is stable within a day beyond seconds. `eval/warm-cache.ts` now prints order fingerprints so this can be measured for free. Baseline (2026-10-08 08:47 UTC): API-order first 30 `29db94b6cf253471`, first 120 `ad51cf5a3f3f9b8c`, hash-ranked top 30 `7c0c30efe432f311`.

**Consequence.** Warming "today's first 30" would pay to parse trials that may leave the window within a day or two, while the trials the cache already holds stay valid but are unreachable. The selection, not the cache, is the unstable part.

## 2. Proposed stable selection policy: `hash-ranked-v1` (a rule, not a pinned list)
- **Pool:** every study that is RECRUITING for `query.cond=breast cancer` *at fetch time* (ids only; measured: 2,443 ids in 3 requests, 2.3 s).
- **Order:** ascending `SHA-256("triallens-demo-candidates-v1|" + NCT id)`. This does not depend on the API's default order and does not rotate when new studies register; membership changes only when a trial enters or leaves the recruiting pool.
- **Candidates:** fetch details for the first 90 ranked ids (`filter.ids`, verified to work; status re-filtered to RECRUITING), run the existing age/sex prefilter in rank order, take the first 30 (the same `MAX_CANDIDATE_TRIALS`). The existing "cheapest first" ordering inside the run is unchanged.
- **Currently recruiting:** guaranteed by `filter.overallStatus=RECRUITING` on both the id pool and the detail fetch. A closed trial drops out and the next ranked trial takes its place.
- **Dry-run result today:** the three prepared profiles select 32 distinct trials (51 chunks) under this policy versus 30 (54 chunks) under the API order; 0 of either are cached. Offline tests show the top 30 survives pool churn (survivors always stay selected).
- **Cost to the live route:** about 3 extra id-only requests and 1-2 detail requests per run (~2-3 s, no model call). The production route does not use this yet; adopting it is a code change that needs Kumar's approval (the discovery function is shared by the live route and any warm-up).
- **Limits and open questions:** a hash sample is arbitrary, not "most relevant"; one of the 39 cached trials lacks a breast condition, so a breast-condition check may be wanted; a trial edit changes `last_update` and invalidates its cache key (an eligibility-text hash as the key would survive unrelated edits: not proposed now, because all 39 cached keys are still unchanged, which suggests edits are not frequent over 1-2 days, but that is also not a measured rate). The cheaper alternative `sort=StudyFirstPostDate:asc` (stable, oldest registrations first) skews to very old studies and is not recommended.

## 3. Revised warm-up plan (applies only AFTER Kumar chooses a selection policy)
**Scope:** parse the uncached chunks of the selected trials with the production parse path (same prompt, schema, `reconcileBatch`, MID model, `reasoning_effort: low`, `max_tokens` 8192). No extraction/evaluate/verify/fail-check, no FAST call. Script: `eval/warm-cache.ts` (today **dry-run only**; `--execute` is refused and not implemented).

**Enforceable cost bound (before dispatch).** `SpendGuard` (`eval/lib/warm-guard.ts`, property-tested) sends an attempt only if
`actual_spent + worst_case(in-flight attempts) + worst_case(this attempt) <= budget`.
Worst case per attempt = estimated prompt tokens x MID input price + 8,192 x MID output price. The estimate is deliberately conservative (characters / 2.5 + 200, from the real system prompt, user prompt and response-schema JSON): **5.2k-7.1k tokens per chunk, about 2.8x the measured live average (1.9-2.0k)**. If any attempt ever reports more than its worst case, all further dispatch halts ("estimate_violated"). An attempt with unavailable usage is charged at its worst case. Therefore final spend cannot exceed the budget unless a single attempt breaks its own worst case, and then only by that attempt's excess.
- **Worst-case dollars today (api-default plan, 54 chunks):** first attempts $0.4945; retries $0.5224; all 108 attempts $1.017; largest single attempt $0.01. (hash-ranked-v1, 51 chunks: $0.4654 / $0.4917 / $0.957.)
- **Proposed budget: $0.50 as a hard pre-dispatch bound** (not a soft stop). Simulation: at the measured average ($0.0021/call, total about $0.11) all chunks dispatch with room for retries; if every attempt hit its worst case, all first attempts still fit ($0.49) but no retry would be admitted, so those chunks are reported unparsed instead of overspending.
- **Attempt ceiling consistent with the bound:** 108 attempts = one validation retry per chunk (2 x 54), enforced by the guard and a `CallCap`; 429 backoff attempts count against it. The dollar bound, not the ceiling, is what limits spend (108 worst-case attempts would be $1.02); the ceiling stops loops. If the plan has a different chunk count the ceiling is 2 x chunks.

**Supabase writes: `trial_criteria_cache` only, insert-only.** `ON CONFLICT DO NOTHING` (`ignoreDuplicates`), plus a re-check of the exact key just before writing; at most one row per planned trial (<= 32); only fully parsed trials (`isCacheable`). No updates, no deletes (the service role has none), no other table, no Upstash. The 39 existing rows (including the six kept from the failed first live run) are never touched. A test with a fake client will assert that only insert-ignore calls on planned keys occur.

**Response when selection changes.** The approval records the plan fingerprint (`SHA-256` of parser version, policy id and the ordered list of trial, source version, criteria count, chunks). `--execute` must be given that fingerprint (`WARM_PLAN=...`); the script recomputes the plan from live CT.gov first and, if it differs in any way (trials added/removed, a `last_update` changed, a criteria count changed, policy or parser version changed), **exits before any model call or write**, printing only counts and ids of added / removed / version-changed trials. A changed plan needs a new dry run and a new approval. No automatic re-plan.

**Checks.** *Before:* `eval/cache-inventory.ts` / `eval/warm-cache.ts` (dry run: plan, fingerprint, bound simulation); `eval/cache-snapshot.ts` (39 rows `3a445b18…12e0f6`, `replay_cases` `d359b6ca…631a3a6`). *During:* attempts, tokens (null = unavailable, never 0), running worst-case and actual spend. *After:* the 39 pre-existing rows re-hash to `3a445b18…12e0f6`; row count = 39 + rows written; every new key is in the plan; inventory shows the new hits and lists any unwritten trial with its reason; `replay_cases` hash unchanged; free replay 38/38. Hashes corroborate the insert-only code path and its tests; they cannot by themselves prove an identical rewrite was impossible.

**Expected effect (unchanged).** A later live run would skip the 14 cold-run parse calls; earlier measurements (`docs/run-plan.md`) suggest about 6 of 30 trials still stay UNCERTAIN for lack of evaluate capacity. A follow-up live run is a separate approval.

## 4. Decisions requested (nothing runs before these)
1. Selection policy: adopt `hash-ranked-v1` for discovery (a production code change, to be offline-tested first), keep the API order, or another rule? Warming before this is decided is not recommended.
2. Budget and ceiling: confirm or change the $0.50 hard pre-dispatch bound and the 2 x chunks attempt ceiling.
3. Approval of the insert-only write scope and the fingerprint gate.
