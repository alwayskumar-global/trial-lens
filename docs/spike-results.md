# Spike results

Append-only log written by `eval/spike/*` scripts. No secrets, no response bodies.

## 2026-10-05T14:05:01.827Z — 01-smoke (Token Factory)

- Node v22.22.0; base URL: `https://api.tokenfactory.nebius.com/v1/`

### a. Network (unauthenticated GET)

| Host | Result | Detail |
|---|---|---|
| api.tokenfactory.nebius.com | reachable | HTTP 404 |
| clinicaltrials.gov | reachable | HTTP 200 |

### b. Models list

- OpenAI SDK `models.list()`: OK, 25 models total
- Nemotron IDs (4):
  - `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`
  - `nvidia/Nemotron-3-Ultra-550b-a55b`
  - `nvidia/Nemotron-3_5-Lightning`
  - `nvidia/nemotron-3-super-120b-a12b`

### c. Chat completion ("Reply with the single word: ok", temperature 0, max_tokens 32)

Skipped: `NEMOTRON_MODEL_FAST|MID|DEEP` not set. Candidates listed in (b).

## 2026-10-05T14:45:10.967Z — 01-smoke (Token Factory)

- Node v22.22.0; base URL: `https://api.tokenfactory.nebius.com/v1/`

### a. Network (unauthenticated GET)

| Host | Result | Detail |
|---|---|---|
| api.tokenfactory.nebius.com | reachable | HTTP 404 |
| clinicaltrials.gov | reachable | HTTP 200 |

### b. Models list

- OpenAI SDK `models.list()`: OK, 25 models total
- Nemotron IDs (4):
  - `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`
  - `nvidia/Nemotron-3-Ultra-550b-a55b`
  - `nvidia/Nemotron-3_5-Lightning`
  - `nvidia/nemotron-3-super-120b-a12b`

### c. Chat completion ("Reply with the single word: ok", temperature 0, max_tokens 512)

| Tier | Model | OK | Latency ms | Non-empty | finish_reason | completion tokens | Error |
|---|---|---|---|---|---|---|---|
| FAST | `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` | yes | 978 | true | stop | 58 |  |
| MID | `nvidia/nemotron-3-super-120b-a12b` | yes | 466 | true | stop | 38 |  |
| DEEP | `nvidia/Nemotron-3-Ultra-550b-a55b` | yes | 357 | true | stop | 14 |  |

## 2026-10-05T14:45:45.777Z — 03-ctgov

- Endpoint: `GET https://clinicaltrials.gov/api/v2/studies` with `query.cond=breast cancer`, `filter.overallStatus=RECRUITING`, `pageSize=60`, `fields=...`. HTTP 200, no key.
- Page returned 60 studies (nextPageToken present); 60 had eligibility text; sample = 30 (every 2th).
- Rate-limit headers observed: none (VERIFY documented limit: ~50 req/min/IP per CT.gov docs)
- Zod validation of response: passed (fields tolerated as optional).
- Field presence over sample: eligibility text 30/30 (100%); minimumAge 28/30 (93%); maximumAge 7/30 (23%); sex 30/30 (100%); lastUpdatePostDate 30/30 (100%)
- Sites: 1093 total across sample; with geoPoint 1088/1093 (100%); trials where every site has geo 27/30 (90%); site-level status field present on 30/30 (100%) trials (≥1 RECRUITING site).
- Heuristic criterion split: 435 bullet-level criteria (214 inclusion / 221 exclusion); median length 93 chars. The splitter is a regex heuristic, not a parser; mis-splits are not measured here.
- Raw fixture is gitignored (`eval/spike/fixtures/`), regenerate with `pnpm spike:ctgov`. VERIFY: CT.gov terms of use on redistributing submitter text before ever committing it.

## 2026-10-05T14:47:21.676Z — 02-structured

- Prompt version `spike-0`; temperature 0; max_tokens 2048; one Zod retry with the validation error fed back; client maxRetries 0 with own 429 backoff (1s,2s,4s).
- Sample (ids in `eval/spike/sample-50.json`): 50 distinct criteria from 28 trials (max 2 per trial); strata {"inclusion/simple":13,"inclusion/compound":12,"exclusion/simple":12,"exclusion/compound":13}. "compound" is a regex heuristic (multi-conjunction, ';', 'unless/except', >220 chars).
- Concurrency: 6 (LLM_CONCURRENCY). Hard call cap: 600.
- Zod validity includes semantic refine (fact_key set ⇒ operator+value set; null ⇒ both null).

### Response-format support (one criterion per cell; 'ok' = accepted by API and Zod-valid on first attempt)

| Tier | json_schema | json_object | prompt_only |
|---|---|---|---|
| FAST | ok | ok | ok |
| MID | ok | ok | ok |
| DEEP | ok | ok | ok |

### 50-criteria parse (per tier, best supported mode)

| Tier | Mode | First-attempt valid | Valid after 1 retry | p50 ms | p95 ms | prompt tok | completion tok | 429s | other API errs | truncated | fenced | Gate ≥95% |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FAST | json_schema | 49/50 (98%) | 50/50 (100%) | 9018 | 21483 | 48532 | 43910 | 0 | 0 | 1 | 0 | PASS |
  - FAST wall time for 50 calls at concurrency 6: 90183 ms
| MID | json_schema | 50/50 (100%) | 50/50 (100%) | 3549 | 6306 | 47397 | 28173 | 0 | 0 | 0 | 0 | PASS |
  - MID wall time for 50 calls at concurrency 6: 33867 ms
| DEEP | json_schema | 46/50 (92%) | 49/50 (98%) | 3729 | 9412 | 54025 | 44025 | 0 | 0 | 4 | 0 | PASS |
  - DEEP failure kinds: ZOD_INVALID_AFTER_RETRY×1
  - DEEP wall time for 50 calls at concurrency 6: 42002 ms

- Total HTTP calls used (incl. probes, retries, 429 retries): 164/600.
