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
| MID | json_schema | 50/50 (100%) | 50/50 (100%) | 3549 | 6306 | 47397 | 28173 | 0 | 0 | 0 | 0 | PASS |
| DEEP | json_schema | 46/50 (92%) | 49/50 (98%) | 3729 | 9412 | 54025 | 44025 | 0 | 0 | 4 | 0 | PASS |


Per-tier notes:
  - FAST wall time for 50 calls at concurrency 6: 90183 ms
  - MID wall time for 50 calls at concurrency 6: 33867 ms
  - DEEP failure kinds: ZOD_INVALID_AFTER_RETRY×1
  - DEEP wall time for 50 calls at concurrency 6: 42002 ms
- Total HTTP calls used (incl. probes, retries, 429 retries): 164/600.

## 2026-10-05T14:54:21.973Z — 04-coverage

- Parser: MID `nvidia/nemotron-3-super-120b-a12b`, prompt `spike-0`, json_schema mode, 34 batched calls (≤25 criteria each); first-attempt batch validity 32/34; batches failing after retry 0; criteria missing from output 20.
- Judge: DEEP `nvidia/Nemotron-3-Ultra-550b-a55b` (independent of parser), run only on criteria passing the code check; judge batches failed 0. VERIFY: LLM judge is not clinician review; spot-check below.
- 30 trials, 435 bullet-level criteria (regex split), 371 flagged scoring by the parser, 44 non-scoring (consent/logistics).
- Definitions: **A** fact_key populated · **B** A + operator/value/unit valid and convertible for that vocabulary type (code check) · **C (typed, headline)** B + judge says "full" (entire logic captured).

| Stratum (scoring only) | n | A: fact_key set | B: code-evaluable | C: typed (headline) |
|---|---|---|---|---|
| all scoring | 371 | 59/371 (15.9%) | 54/371 (14.6%) | 21/371 (5.7%) |
| inclusion | 183 | 42/183 (23%) | 38/183 (20.8%) | 19/183 (10.4%) |
| exclusion | 188 | 17/188 (9%) | 16/188 (8.5%) | 2/188 (1.1%) |
| simple wording (heuristic) | 222 | 51/222 (23%) | 46/222 (20.7%) | 17/222 (7.7%) |
| compound wording (heuristic) | 149 | 8/149 (5.4%) | 8/149 (5.4%) | 4/149 (2.7%) |

**Gate result (C over all scoring criteria): 21/371 (5.7%) → STOP AND REASSESS (<40%).** (Schedule gate, not a safety or accuracy claim.)

- Code-evaluable candidates judged: 54 → full 21, partial 30, wrong 3, unjudged 0. Judge rejection of code-valid typed criteria = how often fact_key+operator+value looked fine but lost logic.
- Code-check failures among fact_key-populated criteria: unit_missing_or_unconvertible×2, bad_operator_for_enum×3, enum_value_not_in_vocab×3.
- fact_keys used by typed (C) criteria: ecog×8, age×6, stage×1, lvef_percent×1, anc×1, platelets×1, prior_radiation×1, measurable_disease×1, brca_germline×1.
- Vocabulary keys never typed in this sample (26/35): sex, disease_setting, pregnant, lactating, hemoglobin, creatinine_clearance, bilirubin_x_uln, ast_alt_x_uln, cardiac_disease, prior_other_malignancy, neuropathy_grade, cns_mets, her2_status, er_status, pr_status, pik3ca_mutation, menopausal_status, metastatic_line, prior_anthracycline, prior_taxane, prior_trastuzumab, prior_adc, prior_cdk46i, prior_endocrine, prior_chemo_any, days_since_last_systemic_therapy.

**Untyped scoring criteria by keyword theme (first match; heuristic, counts only; n=350):**

| Theme | Count |
|---|---|
| labs / organ function | 97 |
| prior therapy / washout timing | 58 |
| biomarker / genomic detail | 24 |
| infection (HIV/hepatitis/active) | 18 |
| life expectancy / age / sex | 14 |
| brain/CNS metastases | 11 |
| cardiac (QTc/MI/heart failure) | 10 |
| concomitant meds / hypersensitivity | 10 |
| surgery / radiation | 9 |
| measurable / imaging / RECIST | 7 |
| performance status | 6 |
| consent / compliance | 5 |
| pregnancy / contraception | 3 |
| other malignancy | 2 |
| (no keyword match) | 76 |

- Manual spot-check list (typed-C ids; read text/structure in `eval/spike/fixtures/coverage-parsed.json`): NCT05812807:exclusion:0, NCT06627712:inclusion:2, NCT06235931:inclusion:3, NCT05304962:inclusion:1, NCT00353483:inclusion:2, NCT05812807:inclusion:0, NCT05812807:inclusion:1, NCT05812807:inclusion:21, NCT05812807:inclusion:22, NCT06236373:inclusion:0, NCT05059379:exclusion:7, NCT07169994:inclusion:3.
- Total HTTP calls: 58/400; parse wall 133525 ms at concurrency 6.

## 2026-10-05T14:55:05.360Z — 04b-coverage-analysis (no LLM calls; reads `fixtures/coverage-parsed.json`)

- Typed (C, strict headline): 21/371 (5.7%).
- **Touches the vocabulary** (fact_key set OR depends_on non-empty), any representation: 176/371 (47.4%). Upper-bound proxy for coverage if every touching criterion were decomposed into independently typed clauses with logic preserved. NOT a typed rate and not validated.
- Untyped criteria that touch the vocabulary: 155/350 (44.3%); of those, bundle ≥2 distinct vocabulary keys in one bullet: 65/155 (41.9%).
- Untyped criteria that do not touch the vocabulary at all: 195/350 (55.7%) (genuine vocabulary gap, free-text path).
- Criteria possibly merged by the regex splitter (numbered items or ';'-joined labs in one bullet; heuristic): 5/371 (1.3%).
- Criteria missing from parser batch output (index not returned; count not enforced by the Zod batch schema): 20/435. Phase 2 must enforce exact index coverage.
- Judge on code-valid typed candidates: partial 30, wrong 3, full 21.
- Reading: (1) The strict typed rate (5.7%) is far below the 40% line, so per TASKS.md this is a **STOP: reassess the adaptive-demo scope with the founder** before Phase 2. (2) Representation is the largest recoverable loss: single fact_key/operator/value per criterion drops compound and bundled bullets, and the judge rejected most code-valid typed rows as partial. (3) Even a perfect decomposition would, by the 'touches vocabulary' proxy, reach only about the 40–60% band, because roughly half of scoring criteria do not touch the 35 keys at all (large free-text, comorbidity, washout and drug-specific blocks). (4) Splitter noise is minor by this heuristic. (5) Parse prompt `spike-0` is untuned and deliberately conservative (rule 2); tuning may lift 'full' typed counts modestly but cannot recover bundled bullets without clause decomposition.

## 2026-10-05T14:57:08.716Z — 05-sse (localhost:3055)

- 15 events over 70111 ms (requested 70s); first event at 70 ms; max inter-event gap 5007 ms; `done` event received: true.
- Verdict: STREAMS INCREMENTALLY for the full duration.

## 2026-10-05T14:57:42.713Z — 06-call-budget (arithmetic over the real fixture; no LLM calls)

Criteria per trial in fixture: min 3, median 11, max 49; parse batches of ≤25.

| Stage | Calls (no retry) | Calls (every call retries once) |
|---|---|---|
| Profile extraction (FAST), 1 call | 1 | 2 |
| Criteria parse (MID), 34 chunk calls, UNCACHED | 34 | 68 |
| Free-text evaluation (MID), 1 per trial × 30 | 30 | 60 |
| Verifier (MID/DEEP), STRONG/POSSIBLE only; worst case all 30 | 30 | 60 |
| DEEP escalation, capped at 10 (assumed) | 10 | 20 |
| Plain-language + coordinator prep, 10 shortlisted (assumed) | 10 | 20 |
| **Total, uncached** | **115** | **230** |
| Total, parse cache warm | 81 | 162 |

- `MAX_LLM_CALLS_PER_RUN` default = 80. Uncached worst case 115 (no retries) exceeds it: **YES**; warm-cache no-retry total 81: exceeds.
- Measured retry rates (02/04): first-attempt invalid ≈ 0–8% single-criterion, 2/34 parse batches; real retries ≈ 5%, not 100%.
- Consequence for design (decision for founder, not made here): either raise the cap for uncached runs, pre-warm the parse cache for demo trials, or define what is dropped when the cap bites (suggested order: plain-language prep for non-shortlisted → DEEP escalation → verifier on POSSIBLE → verifier on STRONG; never drop typed evaluation or the abstention guard).
- Measured wall time: 34 parse batches took 133 s at concurrency 6 (≈23 s per batch call, large JSON outputs), so an UNCACHED 30-trial run is ≥ 2 min of parsing alone. Warm-cache runs skip it. Implication: pre-parse and cache all demo-candidate trials offline; VERIFY Vercel `maxDuration` for the uncached path.

## 2026-10-05T14:58Z — Baseline checks (run locally by the agent in this session, working tree on top of `b2f4a89`)

Node v22.22.0, pnpm 10.28.0, run from repo root. Status labels: **confirmed locally in this session**; no CI exists yet, so nothing is CI-confirmed. The Phase 0 report's earlier passes were agent-reported (same environment); the table below is a fresh run.

| Command | Exit |
|---|---|
| `pnpm lint` | 0 |
| `pnpm typecheck` | 0 |
| `pnpm test` (Vitest, 61 tests) | 0 |
| `pnpm build` (only NEBIUS_* set; no Supabase/Upstash) | 0 |

## 2026-10-05T14:58Z — Phase 1 summary, open items and what was NOT tested

**Results**
- Token Factory: `https://api.tokenfactory.nebius.com/v1/` works with the `openai` npm SDK (models.list + chat completions). 25 models, 4 Nemotron. Used Nano 30B-A3B (FAST), Super 120B-A12B (MID), Ultra 550B-A55B (DEEP). **VERIFY**: this FAST/MID/DEEP mapping and what `Nemotron-3_5-Lightning` is. Model IDs were passed as shell env vars, not committed.
- Structured output: json_schema (strict), json_object and prompt-only all accepted on all 3 tiers. 50-criteria gate (≥95% after one retry): FAST 100%, MID 100%, DEEP 98%: PASS. Caveats: single-criterion calls; first-attempt FAST 98%, MID 100%, DEEP 92%; reasoning-token truncation (`finish_reason=length`) hit FAST×1, DEEP×4 at max_tokens 2048; FAST is slow (p50 ~9 s) vs MID (~3.5 s).
- 429 behaviour: **0** 429s at concurrency 6 in ~160 + 58 calls. Not stress-tested above 6; limits not discovered.
- CT.gov v2: works without a key; fields available incl. eligibility text, ages, sex, last-update date, site status and geo (99.5% of sites have a geoPoint; 27/30 trials fully geocoded). No rate-limit headers returned.
- Vocabulary coverage: **FAILED the gate**: strict typed 5.7% (<40%) → **STOP and reassess the adaptive-demo scope with the founder** (TASKS.md). See 04 and 04b for why.
- SSE: streams incrementally for 70 s **locally** (`next start`). Vercel not tested.

**Not done / needs the founder**
- Token Factory data-retention/logging terms: **not verified** (governs README privacy wording; keep "does not store your information" off until verified).
- Vercel SSE ≥ 60 s on your plan: deploy with `SPIKE_SSE_ENABLED=true` on a Preview env only, then run `SSE_BASE_URL=https://<preview> pnpm spike:sse` (add Vercel deployment-protection bypass if the preview is protected; do not make it public). Remove the route after.
- Tool calling: **not tested** (not used by the current design).
- Cost per run: **not computed** (no Token Factory pricing in hand; tokens per call recorded in 02 only). Latency p50/p95 recorded for single-criterion calls; end-to-end run latency not measured.
- Public eval datasets (TrialGPT cohorts): **not done**.
- LLM judge in 04 is not clinician review; 04 batch outputs missed 20/435 criteria (count not enforced).
- Spike route `src/app/api/spike/sse` and `eval/spike/*` are throwaway; env var `SPIKE_SSE_ENABLED` added to `.env.example` (commented).
