# Cache warming: inventory and PROPOSAL (2026-10-08; NOT approved, NOT run)

Goal: demo coverage. Both approved live runs left 21-23 of 30 selected trials `analysis_pending` because their criteria were not in `trial_criteria_cache` and a live run has only 14 parse slots. Preview now runs with `CRITERIA_CACHE_WRITES=false`, so a live run never fills the cache. This document inventories the gap (read-only) and proposes a bounded one-time fill. **Nothing here has been run. No model call and no Supabase write until Kumar approves.**

## Inventory (read-only; `eval/cache-inventory.ts`; one public CT.gov GET sequence + Supabase SELECTs; 2026-10-08)
- Parser version `spike-4+cov-1`. CT.gov discovery returns 120 recruiting breast-cancer studies (2 pages x 60), identical in content and order across two calls 5 s apart.
- The three prepared profiles (ages 52 / 61 / 68, from the stored replay `profile` events) pre-filter to 118 / 117 / 117 trials; the first 30 are **the same 30 trials** for all three (union = 30).
- Cache state for those 30 keys (`nct_id | last_update | parser_version`): **0 hit, 30 missing** (none stale: no row exists for any of them).
- Work to fill: **54 parse chunks** (CHUNK = 15 criteria): 16 trials need 1 chunk, 9 need 2, 1 needs 3, 3 need 4, 1 needs 5; 616 criteria in total (4 to 73 per trial).
- Existing cache: 39 rows. Only **3** of those 39 trials are in today's 120 (discovery positions 34, 69, 73, none inside the selected 30); 36 are absent from today's discovery. So the recruiting set and its order drift between days (inferred from the cache against today's discovery, not measured directly), and the earlier warm rows no longer help the demo.
- Selected trial ids with versions and chunk counts: run `node --env-file=.env --import tsx eval/cache-inventory.ts` (prints public NCT ids, versions and counts only).

## Proposed one-time warm-up (for approval)
**What:** parse the 54 chunks of the 30 selected trials with the production parse path (same prompt, schema, `reconcileBatch`, MID model, `reasoning_effort: low`, `max_tokens` 8192) and store each fully parsed trial. No extraction, no evaluate, no verify, no fail-check, no FAST call.
**How:** a new local script `eval/warm-cache.ts`, `--dry-run` by default (prints the plan and ceilings, makes no call), `--execute` additionally requiring `WARM_CONFIRM=parse-30-nocache-profile`. It would be written and offline-tested with fakes first; nothing runs before approval.

### Model-call ceiling and cost
- Expected calls: **54** (one per chunk). Hard ceiling: **120 HTTP attempts** enforced by `CallCap` (a refused attempt sends nothing); this covers one validation retry per chunk (108) plus 12 for 429 backoff. Concurrency 6.
- Measured parse cost per call on the two live runs: about **$0.0020-0.0021** (1.9-2.0k tokens in, 1.6-1.65k out at MID $0.30 / $0.90 per 1M). **Expected total about $0.11-0.30** (the 54 chunks include fuller 15-criterion chunks than the smallest-first live runs, so the average may be higher).
- Worst case under the 120-attempt ceiling: about **$1.03** (4,000 tokens in and 8,192 out per attempt). That is a forecast, not a limit. A script-level dollar guard is proposed: **stop issuing calls once estimated spend from reported tokens passes $0.50** (overshoot bounded by the 6 in-flight calls, about $0.05).
- No retry of a failed chunk beyond the in-call validation retry; a trial with any unresolved chunk is not stored and is reported.

### Supabase write scope
- **Table `trial_criteria_cache` only. Insert-only** (`ON CONFLICT DO NOTHING`), at most **30 new rows**, keys `(nct_id, last_update, spike-4+cov-1)` from the planned list. Only fully parsed trials (`isCacheable`) are written. The script re-checks the exact key just before writing and never updates or overwrites an existing row.
- The 39 existing rows (including the six kept from the failed first live run) are not touched. `replay_cases`, Upstash and every other table are not touched. The service role has no DELETE grant; none is used.

### Checks
- **Before:** `eval/cache-inventory.ts` (30 missing, 54 chunks); `eval/cache-snapshot.ts` (39 rows `3a445b18…12e0f6`, `replay_cases` `d359b6ca…631a3a6`); `--dry-run` output shows the plan and ceilings.
- **During:** the script prints calls/attempts, tokens (unavailable = null, never 0) and running estimated cost; it stops at the attempt ceiling or the dollar guard.
- **After:** (1) re-hash the 39 pre-existing rows (by `created_at`): must equal `3a445b18…12e0f6`; (2) row count = 39 + N written (N <= 30); (3) every new key is in the planned list; (4) inventory shows N hits and lists any unwritten trial with its reason; (5) `replay_cases` hash unchanged; (6) a free replay still passes 38/38. The snapshot hashes corroborate the insert-only code path and its tests; they cannot by themselves prove an identical rewrite was impossible.

### What it will and will not change in the demo
- A later live run would hit the cache for those trials: no parse calls (the 14 parse calls of a cold run disappear) and the parse budget no longer limits coverage. It does not remove evaluate-stage capacity: earlier measurements (`docs/run-plan.md`) found about 6 of 30 trials stay UNCERTAIN (`no_capacity`) when every trial has a parse. A follow-up live run is a separate approval.
- **Drift:** discovery order changes across days and a trial's `last_update` invalidates its key, so the fill is valid only while today's top 30 hold. Options: (A) warm now, accept drift; (B) re-run the free inventory daily and re-warm (about $0.1-0.3 each, each needing approval) shortly before submission and during judging; (C) pin the demo trial ids in code (a product decision: it changes which trials are shown and recruiting status can go stale). Recommended: A then B; decide C separately.

## Decisions requested
1. Approve (or change) the 120-attempt ceiling, the $0.50 script guard and the insert-only write scope; 2. choose A / B / C for drift. Until then: no model call, no Supabase write.
