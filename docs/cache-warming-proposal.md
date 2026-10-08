# Selection stability, selection-rule proposal and warm-up plan (2026-10-08; UNDER REVIEW; NOT approved, NOT run)

Status: read-only checks only. **No model call and no Supabase write.** `eval/warm-cache.ts` is dry-run only (`--execute` refused). Kumar has NOT approved warming, daily re-warming, hash-ranked-v1 (rejected: stable but arbitrary), a guard value, or any change to the live route. Approved as design constraints: **insert-only writes to `trial_criteria_cache`** and the **plan-fingerprint gate**. Rule D is still **not exercised live** (offline integration test only). Vocabulary coverage gate open. `VISITOR_INPUT_MODE=samples`. Production untouched.

## 1. What the evidence establishes about the current selection (API order, no `sort`)
- The query has not changed since 2026-10-06 (one commit). The recruiting breast-cancer pool is 2,443 studies; the route reads the first 120 (4.9%).
- All 39 cached trials are still RECRUITING with unchanged `LastUpdatePostDate`; they simply fell out of the first 120. The default order is not `@relevance`, `LastUpdatePostDate` or `StudyFirstPostDate` order (0 shared positions with each).
- **Across the 2026-10-07 09:00 -> 2026-10-08 09:00 CT.gov data refresh, the API-order selection kept 2 of its 30 trials** (Jaccard 0.033). The "before" list was reconstructed from the printed inventory and verified by hash against the 08:47 dry run; it is one pair of observations around one refresh, not a time series. The replay trials computed on 2026-10-06 retain 2 of 34 today.
- Why the default order changes is not established (undocumented).

## 2. Policy comparison at one data version (dataTimestamp 2026-10-08T09:00:05; `eval/selection-snapshot.ts`)
Three prepared profiles (ages 52 / 61 / 68, one female-only), first 30 after the age/sex prefilter, union across profiles. Scope: *breast signal* = breast MeSH term/ancestor **or** a breast term in the free-text conditions (new studies often have no MeSH yet).

| | API order (today) | `sort=@relevance` |
|---|---|---|
| Window (first 120): breast-specific / breast + other MeSH / no breast signal | 62 / 51 / 7 | 99 / 21 / 0 |
| Filtered by age/sex (her2pos / hrpos / tnbc) | 115 / 114 / 109 | 113 / 109 / 109 |
| Selected union | 33 | 32 |
| Selected: breast-specific / with other / no signal | 13 / 19 / 1 | 26 / 6 / 0 |
| Study type of selected (interventional / observational) | 27 / 6 | 25 / 7 |
| Cache hit potential (exact key) | 1 of 33 | 1 of 32 |
| Parse chunks needed | 69 | 48 |

- Window overlap between the two policies: 9 of 120. **Selected-set overlap: 0.** They show different studies.
- "Breast + other" includes studies whose other MeSH term is e.g. Neoplasm Metastasis or Obesity, so it is not all out of scope; the one API-order study without any breast signal lists menopause/obesity conditions only. Observational studies (6-7 of ~32 under either policy) are not trials in the interventional sense; this is flagged for decision, not changed.
- **Not yet measured: how stable `@relevance` is across a data refresh.** That needs two snapshots on either side of the next refresh (see 4).

## 3. Proposed selection rule for review: `relevance-v1` (live route NOT changed)
1. Same query (`query.cond=breast cancer`, `filter.overallStatus=RECRUITING`) with an **explicit `sort=@relevance`**, same two pages of 60: no extra requests, no extra latency, a documented parameter instead of the undocumented default order.
2. Drop studies with **no breast signal** (0 of 120 today, so it is a guard, not a filter).
3. Same age/sex prefilter and `MAX_CANDIDATE_TRIALS` = 30 as today. Cheapest-first ordering inside the run unchanged. Observational studies kept (open decision).
4. If the `sort` request fails, fall back to the current order and log it.
- Adoption condition (proposed, for Kumar to set): after the next refresh, `relevance-v1` should retain a clear majority of its selected union (proposal: >= 60%, about 19 of 32), far above the API order's 2 of 30. If it does not, no ordering of this query is stable enough to warm, and the alternatives are re-warming per refresh (about $0.10 expected, each needing approval) or a carried-over selection (previous approved selection that is still recruiting and unchanged, topped up in relevance order; needs stored state, not recommended yet). Hash ranking stays rejected.

## 4. How the refresh test runs (free, read-only)
`dataTimestamp` today is 2026-10-08T09:00:05. A snapshot taken after the next change of `dataTimestamp` is compared with the 2026-10-08T13:17Z snapshot:
`node --env-file=.env --import tsx eval/selection-snapshot.ts` (takes a snapshot into gitignored `eval/data/selection-snapshots/`), then `... eval/selection-snapshot.ts --compare <older.json> <newer.json>`. It reports, per policy: selected kept/before/after, Jaccard, window kept and same-position counts. Result to be recorded in TASKS.md before any decision.

## 5. Spending claim, corrected
- `chars / 2.5` is a **prompt-token estimate**, not a bound. A guard built on it is **conditional**: one attempt can exceed its reservation (if the real tokenizer is denser than assumed, or the provider bills tokens we did not model). `SpendGuard` halts dispatch after the first attempt whose reported cost exceeds its reservation, but up to 7 attempts (6 in flight + the detector) can already be over; the excess is not bounded a priori. The earlier "hard $0.50 cap" wording is withdrawn.
- **Maximum forecast exposure under the attempt ceiling (2 x chunks; `relevance-v1` plan: 31 trials, 48 chunks, ceiling 96 attempts):**

| Assumption | First attempts | Retries | All 96 attempts |
|---|---|---|---|
| prompt tokens = chars / 2.5 + 200 (estimate) | $0.436 | $0.461 | **$0.897** |
| prompt tokens <= request-body bytes + 64 (no tokenizer ratio) | $0.562 | $0.809 | **$1.371** |
| same, if real prompts were 2x that bound | | | $2.017 |
| expected, measured $0.0021 per parse call | | | $0.101 |

  (API-order plan: 69 chunks, ceiling 138 attempts: $1.30 / **$1.99** / $2.95 / $0.145.) All use MID prices read 2026-10-07 ($0.30 / $0.90 per 1M) and `max_tokens` 8,192 per attempt; the largest single attempt is $0.018.
- **Defensible pre-dispatch bound (proposed):** reserve, per attempt, `(UTF-8 bytes of the serialized request body + 64) x input price + 8,192 x output price`. A token covers at least one byte of the body (true for byte-level BPE tokenizers), so this needs no assumption about the tokenizer ratio; it is about 7x the measured input average (13-17 KB bodies against ~2k billed tokens), so it is loose and safe. Remaining assumptions, stated: (A1) billed prompt tokens <= body bytes + 64; (A2) billed completion tokens <= `max_tokens` including any reasoning tokens (supported by earlier extraction runs that stopped exactly at their 4,096-token cap, `docs/hardened-1-dev-check.md`, but not proven for this model's reasoning billing); (A3) prices unchanged; (A4) no hidden retries (`maxRetries: 0` in the client; a timed-out request is charged at its worst case).
- **Calibration gate (proposed):** the first 3 chunks run one at a time; if any reported prompt tokens exceed the byte bound or completion tokens exceed 8,192, the run stops before concurrency opens. This limits exposure from a wrong assumption to about 3 attempts (<= ~$0.05).
- **Budget choice under the byte bound** (guard simulation, 48 chunks): $0.50 admits only 42 of 48 first attempts if every attempt hit its worst case (it would stop early, spending $0.49); **$0.75 admits all 48 first attempts even at worst case ($0.56) and admits retries only when actual costs fall below worst case**; $1.371 would admit every attempt at worst case. Proposed: **$0.75, byte-based**. At the measured average the whole warm-up costs about $0.10 either way.
- **Residual risk Kumar is asked to accept or reduce:** if A1 or A2 is false for this provider, spend could exceed the budget by the excess of the (at most 3, after calibration) attempts before the halt. Options: accept; or set a provider-side spend limit on the Nebius account (not controllable from here).

## 6. Warm-up plan (applies only after a selection rule is approved; nothing runs before)
- **Scope:** parse only the uncached chunks of the selected trials with the production parse path (same prompt, schema, `reconcileBatch`, MID model, `reasoning_effort: low`, `max_tokens` 8192). No extraction/evaluate/verify/fail-check, no FAST call. A trial is stored only if every chunk parsed (`isCacheable`).
- **Attempt ceiling:** 2 x chunks (one validation retry per chunk; 429 backoff attempts count). The dollar bound (section 5), not the ceiling, limits spend.
- **Writes (approved design constraint):** `trial_criteria_cache` only, **insert-only** (`ON CONFLICT DO NOTHING`), exact key re-checked just before writing, at most one row per planned trial. No updates or deletes; the existing 39 rows (including the six kept from the failed first live run) are never touched. A fake-client test will assert only insert-ignore calls on planned keys.
- **Plan-fingerprint gate (approved design constraint):** the approval records `SHA-256(parser version, policy id, ordered trial / source version / criteria / chunks)`. `--execute` must be given it (`WARM_PLAN=...`); the script recomputes the plan from live CT.gov first and, on **any** difference (trials added/removed, a `last_update` or criteria count changed, policy or parser version changed), exits before any model call or write, printing only counts and ids. A changed plan needs a new dry run and a new approval; no automatic re-plan.
- **Checks:** before: `eval/warm-cache.ts` dry run, `eval/cache-snapshot.ts` (39 rows `3a445b18…12e0f6`, `replay_cases` `d359b6ca…631a3a6`). After: the 39 old rows re-hash identically; count = 39 + rows written; every new key is planned; inventory shows the hits and any unwritten trial with its reason; `replay_cases` unchanged; free replay 38/38. Hashes corroborate the insert-only code path and tests; they cannot alone prove an identical rewrite was impossible.
- **Expected effect:** a later live run skips the cold parse stage; about 6 of 30 trials may still stay UNCERTAIN for lack of evaluate capacity (`docs/run-plan.md`). A follow-up live run is a separate approval.

## 7. Decisions requested
1. Review `relevance-v1` (section 3) and the adoption condition (>= 60% retained after the next refresh); decide the observational-study question.
2. Spend: accept the byte-based bound at $0.75 with the calibration gate and the stated residual risk, or choose a different budget / provider-side limit.
3. Nothing is warmed and the live route is unchanged until both are decided and the refresh result is in.
