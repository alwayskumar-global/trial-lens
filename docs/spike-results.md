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

## 2026-10-05T15:18:58.919Z — 04c-coverage-clauses (same fixed cohort as 04; clause representation)

- Command: `pnpm spike:coverage2` (COVERAGE_CHUNK=15). Parser MID `nvidia/nemotron-3-super-120b-a12b`, prompt `spike-1`, json_schema mode, 46 batch calls; judge DEEP `nvidia/Nemotron-3-Ultra-550b-a55b` on code-evaluable criteria only.
- Batch validation (index set exact + every leaf source is a verbatim fragment): first-attempt valid 19/46; valid after the one retry 12; **rejected after retry 15** (all their criteria → UNRESOLVED → UNKNOWN); truncated outputs 12; judge batches failed 0.
- Tokens (parse): prompt 132013, completion 385558; parse wall 365652 ms at concurrency 6; total HTTP calls 90/400.
- Denominator: 435 bullet-level criteria in the fixed cohort (30 trials; regex split). Parsed 278, **unresolved 157** (kept as UNKNOWN scoring criteria). Parser flagged 22 as non-scoring (consent/logistics); scoring denominator = 413 (parser-scoring + all unresolved).
- Definitions: **code-evaluable** = every leaf is an atom whose operator/value/unit are valid and convertible in code (no text/timing leaves) · **reviewed full-logic (headline)** = code-evaluable AND the independent DEEP judge says the clause captures the entire criterion · **partial-typed** = ≥1 atom leaf but not fully executable (text/timing remain on the free-text path).

| Stratum (scoring, unresolved included) | n | unresolved | code-evaluable | reviewed full-logic (headline) | ≥1 atom (partial-typed) |
|---|---|---|---|---|---|
| all scoring (incl. unresolved) | 413 | 157/413 (38%) | 40/413 (9.7%) | 23/413 (5.6%) | 60/413 (14.5%) |
| inclusion | 202 | 89/202 (44.1%) | 32/202 (15.8%) | 19/202 (9.4%) | 44/202 (21.8%) |
| exclusion | 211 | 68/211 (32.2%) | 8/211 (3.8%) | 4/211 (1.9%) | 16/211 (7.6%) |
| simple wording (heuristic) | 243 | 92/243 (37.9%) | 32/243 (13.2%) | 20/243 (8.2%) | 37/243 (15.2%) |
| compound wording (heuristic) | 170 | 65/170 (38.2%) | 8/170 (4.7%) | 3/170 (1.8%) | 23/170 (13.5%) |

**Gate (reviewed full-logic over all scoring incl. unresolved): 23/413 (5.6%) → STOP AND REASSESS (<40%).** Schedule gate only; not an accuracy or safety claim. The earlier 5.7% used a different denominator (parser-scoring only, 20 missing excluded) and a single-fact representation, so it is not directly comparable.
- Judge on 40 code-evaluable criteria: full 23, partial 13, wrong 4, unjudged 0.
- Vocabulary-touch proxy (any leaf touches a vocabulary key, parsed criteria): 61/413 (14.8%). **Unvalidated proxy, not a typed rate.**
- Leaf kinds across parsed criteria: text×304, atom×88, timing×11.

## 2026-10-05T15:24:34.025Z — 08-reasoning-probe (MID, 15 fixed criteria, json_schema strict, max_tokens 16384; single run each, so directional only)

| Variant | completion tokens | finish_reason | content chars | reasoning chars | valid (batch schema) | ms |
|---|---|---|---|---|---|---|
| default (thinking on) | 8993 | stop | 9266 | 28096 | false | 39394 |
| chat_template_kwargs.enable_thinking=false | 2681 | stop | 9704 | 0 | true | 9744 |
| reasoning_effort=low | 2304 | stop | 8191 | 254 | true | 8432 |
| system '/no_think' | 11424 | stop | 8353 | 40104 | false | 53905 |

## 2026-10-05T15:26:44.118Z — 04c-coverage-clauses (same fixed cohort as 04; clause representation)

- Command: `pnpm spike:coverage2` (COVERAGE_CHUNK=15, parser thinking OFF via chat_template_kwargs.enable_thinking=false; judge thinking ON). Parser MID `nvidia/nemotron-3-super-120b-a12b`, prompt `spike-1`, json_schema mode, 46 batch calls; judge DEEP `nvidia/Nemotron-3-Ultra-550b-a55b` on code-evaluable criteria only.
- Batch validation (index set exact + every leaf source is a verbatim fragment): first-attempt valid 24/46; valid after the one retry 8; **rejected after retry 14** (all their criteria → UNRESOLVED → UNKNOWN); truncated outputs 0; judge batches failed 0.
- Tokens (parse): prompt 128314, completion 102381; parse wall 90226 ms at concurrency 6; total HTTP calls 87/400.
- Denominator: 435 bullet-level criteria in the fixed cohort (30 trials; regex split). Parsed 268, **unresolved 167** (kept as UNKNOWN scoring criteria). Parser flagged 236 as non-scoring (consent/logistics); scoring denominator = 199 (parser-scoring + all unresolved).
- Definitions: **code-evaluable** = every leaf is an atom whose operator/value/unit are valid and convertible in code (no text/timing leaves) · **reviewed full-logic (headline)** = code-evaluable AND the independent DEEP judge says the clause captures the entire criterion · **partial-typed** = ≥1 atom leaf but not fully executable (text/timing remain on the free-text path).

| Stratum (scoring, unresolved included) | n | unresolved | code-evaluable | reviewed full-logic (headline) | ≥1 atom (partial-typed) |
|---|---|---|---|---|---|
| all scoring (incl. unresolved) | 199 | 167/199 (83.9%) | 12/199 (6%) | 5/199 (2.5%) | 13/199 (6.5%) |
| inclusion | 120 | 110/120 (91.7%) | 6/120 (5%) | 2/120 (1.7%) | 7/120 (5.8%) |
| exclusion | 79 | 57/79 (72.2%) | 6/79 (7.6%) | 3/79 (3.8%) | 6/79 (7.6%) |
| simple wording (heuristic) | 115 | 94/115 (81.7%) | 8/115 (7%) | 4/115 (3.5%) | 8/115 (7%) |
| compound wording (heuristic) | 84 | 73/84 (86.9%) | 4/84 (4.8%) | 1/84 (1.2%) | 5/84 (6%) |

**Gate (reviewed full-logic over all scoring incl. unresolved): 5/199 (2.5%) → STOP AND REASSESS (<40%).** Schedule gate only; not an accuracy or safety claim. The earlier 5.7% used a different denominator (parser-scoring only, 20 missing excluded) and a single-fact representation, so it is not directly comparable.
- Judge on 76 code-evaluable criteria: full 22, partial 15, wrong 38, unjudged 1.
- Vocabulary-touch proxy (any leaf touches a vocabulary key, parsed criteria): 13/199 (6.5%). **Unvalidated proxy, not a typed rate.**
- Leaf kinds across parsed criteria: text×201, atom×164, timing×12.

## 2026-10-05T15:29:24.625Z — 04c-coverage-clauses (same fixed cohort as 04; clause representation)

- Command: `pnpm spike:coverage2` (COVERAGE_CHUNK=15, COVERAGE_REASONING=low, max_tokens 8192; judge reasoning default ON). Parser MID `nvidia/nemotron-3-super-120b-a12b`, prompt `spike-2`, json_schema mode, 46 batch calls; judge DEEP `nvidia/Nemotron-3-Ultra-550b-a55b` on code-evaluable criteria only.
- Batch validation (index set exact + every leaf source is a verbatim fragment): first-attempt valid 27/46; valid after the one retry 5; **rejected after retry 14** (all their criteria → UNRESOLVED → UNKNOWN; last-attempt reasons: leaf source not verbatim×11, missing indices×1, not valid JSON (often truncation)×1, atom/timing leaf missing required fields×1); truncated outputs 0; judge batches failed 0.
- Tokens (parse): prompt 118964, completion 102357; parse wall 91887 ms at concurrency 6; total HTTP calls 86/400.
- Denominator: 435 bullet-level criteria in the fixed cohort (30 trials; regex split). Parsed 285, **unresolved 150** (kept as UNKNOWN scoring criteria). Non-scoring (category consent_logistics, derived in code): 35; scoring denominator = 400 (non-consent parsed + all unresolved).
- Definitions: **code-evaluable** = every leaf is an atom whose operator/value/unit are valid and convertible in code (no text/timing leaves) · **reviewed full-logic (headline)** = code-evaluable AND the independent DEEP judge says the clause captures the entire criterion · **partial-typed** = ≥1 atom leaf but not fully executable (text/timing remain on the free-text path).

| Stratum (scoring, unresolved included) | n | unresolved | code-evaluable | reviewed full-logic (headline) | ≥1 atom (partial-typed) |
|---|---|---|---|---|---|
| all scoring (incl. unresolved) | 400 | 150/400 (37.5%) | 49/400 (12.3%) | 14/400 (3.5%) | 73/400 (18.3%) |
| inclusion | 196 | 79/196 (40.3%) | 28/196 (14.3%) | 12/196 (6.1%) | 43/196 (21.9%) |
| exclusion | 204 | 71/204 (34.8%) | 21/204 (10.3%) | 2/204 (1%) | 30/204 (14.7%) |
| simple wording (heuristic) | 237 | 92/237 (38.8%) | 37/237 (15.6%) | 12/237 (5.1%) | 46/237 (19.4%) |
| compound wording (heuristic) | 163 | 58/163 (35.6%) | 12/163 (7.4%) | 2/163 (1.2%) | 27/163 (16.6%) |

**Gate (reviewed full-logic over all scoring incl. unresolved): 14/400 (3.5%) → STOP AND REASSESS (<40%).** Schedule gate only; not an accuracy or safety claim. The earlier 5.7% used a different denominator (parser-scoring only, 20 missing excluded) and a single-fact representation, so it is not directly comparable.
- Judge on 50 code-evaluable criteria: full 14, partial 21, wrong 15, unjudged 0.
- Vocabulary-touch proxy (any leaf touches a vocabulary key, parsed criteria): 79/400 (19.8%). **Unvalidated proxy, not a typed rate.**
- Leaf kinds across parsed criteria: text×248, atom×103, timing×9.

## 2026-10-05T15:32:43.087Z — 04c-coverage-clauses (same fixed cohort as 04; clause representation)

- Command: `pnpm spike:coverage2` (COVERAGE_CHUNK=15, COVERAGE_REASONING=low, max_tokens 8192; judge reasoning default ON). Parser MID `nvidia/nemotron-3-super-120b-a12b`, prompt `spike-3`, json_schema mode, 46 batch calls; judge DEEP `nvidia/Nemotron-3-Ultra-550b-a55b` on code-evaluable criteria only.
- Batch validation (index set exact + every leaf source is a verbatim fragment): first-attempt valid 33/46; valid after the one retry 8; **rejected after retry 5** (all their criteria → UNRESOLVED → UNKNOWN; last-attempt reasons: atom/timing leaf missing required fields×4, leaf source not verbatim×1); truncated outputs 0; judge batches failed 0.
- Tokens (parse): prompt 109222, completion 95143; parse wall 84422 ms at concurrency 6; total HTTP calls 81/400.
- Denominator: 435 bullet-level criteria in the fixed cohort (30 trials; regex split). Parsed 375, **unresolved 60** (kept as UNKNOWN scoring criteria). Non-scoring (category consent_logistics, derived in code): 42; scoring denominator = 393 (non-consent parsed + all unresolved).
- Definitions: **code-evaluable** = every leaf is an atom whose operator/value/unit are valid and convertible in code (no text/timing leaves) · **reviewed full-logic (headline)** = code-evaluable AND the independent DEEP judge says the clause captures the entire criterion · **partial-typed** = ≥1 atom leaf but not fully executable (text/timing remain on the free-text path).

| Stratum (scoring, unresolved included) | n | unresolved | code-evaluable | reviewed full-logic (headline) | ≥1 atom (partial-typed) |
|---|---|---|---|---|---|
| all scoring (incl. unresolved) | 393 | 60/393 (15.3%) | 59/393 (15%) | 28/393 (7.1%) | 73/393 (18.6%) |
| inclusion | 191 | 43/191 (22.5%) | 39/191 (20.4%) | 24/191 (12.6%) | 48/191 (25.1%) |
| exclusion | 202 | 17/202 (8.4%) | 20/202 (9.9%) | 4/202 (2%) | 25/202 (12.4%) |
| simple wording (heuristic) | 232 | 35/232 (15.1%) | 49/232 (21.1%) | 23/232 (9.9%) | 55/232 (23.7%) |
| compound wording (heuristic) | 161 | 25/161 (15.5%) | 10/161 (6.2%) | 5/161 (3.1%) | 18/161 (11.2%) |

**Gate (reviewed full-logic over all scoring incl. unresolved): 28/393 (7.1%) → STOP AND REASSESS (<40%).** Schedule gate only; not an accuracy or safety claim. The earlier 5.7% used a different denominator (parser-scoring only, 20 missing excluded) and a single-fact representation, so it is not directly comparable.
- Judge on 60 code-evaluable criteria: full 28, partial 19, wrong 13, unjudged 0.
- Vocabulary-touch proxy (any leaf touches a vocabulary key, parsed criteria): 73/393 (18.6%). **Unvalidated proxy, not a typed rate.**
- Leaf kinds across parsed criteria: text×316, atom×107, timing×16.

## 2026-10-05T15:34:50.857Z — 04c-coverage-clauses (same fixed cohort as 04; clause representation)

- Command: `pnpm spike:coverage2` (COVERAGE_CHUNK=15, COVERAGE_REASONING=low, max_tokens 8192; judge reasoning default ON). Parser MID `nvidia/nemotron-3-super-120b-a12b`, prompt `spike-3`, json_schema mode, 46 batch calls; judge DEEP `nvidia/Nemotron-3-Ultra-550b-a55b` on code-evaluable criteria only.
- Batch validation (index set exact + every leaf source is a verbatim fragment): first-attempt valid 42/46; valid after the one retry 3; **rejected after retry 1** (all their criteria → UNRESOLVED → UNKNOWN; last-attempt reasons: leaf source not verbatim×1); truncated outputs 0; judge batches failed 0.
- Tokens (parse): prompt 83496, completion 81812; parse wall 73662 ms at concurrency 6; total HTTP calls 74/400.
- Denominator: 435 bullet-level criteria in the fixed cohort (30 trials; regex split). Parsed 428, **unresolved 7** (kept as UNKNOWN scoring criteria). Non-scoring (category consent_logistics, derived in code): 48; scoring denominator = 387 (non-consent parsed + all unresolved).
- Definitions: **code-evaluable** = every leaf is an atom whose operator/value/unit are valid and convertible in code (no text/timing leaves) · **reviewed full-logic (headline)** = code-evaluable AND the independent DEEP judge says the clause captures the entire criterion · **partial-typed** = ≥1 atom leaf but not fully executable (text/timing remain on the free-text path).

| Stratum (scoring, unresolved included) | n | unresolved | code-evaluable | reviewed full-logic (headline) | ≥1 atom (partial-typed) |
|---|---|---|---|---|---|
| all scoring (incl. unresolved) | 387 | 7/387 (1.8%) | 69/387 (17.8%) | 29/387 (7.5%) | 87/387 (22.5%) |
| inclusion | 185 | 0/185 (0%) | 49/185 (26.5%) | 25/185 (13.5%) | 62/185 (33.5%) |
| exclusion | 202 | 7/202 (3.5%) | 20/202 (9.9%) | 4/202 (2%) | 25/202 (12.4%) |
| simple wording (heuristic) | 228 | 5/228 (2.2%) | 51/228 (22.4%) | 24/228 (10.5%) | 60/228 (26.3%) |
| compound wording (heuristic) | 159 | 2/159 (1.3%) | 18/159 (11.3%) | 5/159 (3.1%) | 27/159 (17%) |

**Gate (reviewed full-logic over all scoring incl. unresolved): 29/387 (7.5%) → STOP AND REASSESS (<40%).** Schedule gate only; not an accuracy or safety claim. The earlier 5.7% used a different denominator (parser-scoring only, 20 missing excluded) and a single-fact representation, so it is not directly comparable.
- Judge on 71 code-evaluable criteria: full 29, partial 25, wrong 17, unjudged 0.
- Vocabulary-touch proxy (any leaf touches a vocabulary key, parsed criteria): 88/387 (22.7%). **Unvalidated proxy, not a typed rate.**
- Leaf kinds across parsed criteria: atom×118, text×367, timing×9.

## 2026-10-05T15:39:57.865Z — 04c-coverage-clauses (same fixed cohort as 04; clause representation)

- Command: `pnpm spike:coverage2` (COVERAGE_CHUNK=10, COVERAGE_REASONING=on, max_tokens 24576; judge reasoning default ON). Parser MID `nvidia/nemotron-3-super-120b-a12b`, prompt `spike-3`, json_schema mode, 56 batch calls; judge DEEP `nvidia/Nemotron-3-Ultra-550b-a55b` on code-evaluable criteria only.
- Batch validation (index set exact + every leaf source is a verbatim fragment): first-attempt valid 49/56; valid after the one retry 4; **rejected after retry 3** (all their criteria → UNRESOLVED → UNKNOWN; last-attempt reasons: leaf source not verbatim×3); truncated outputs 0; judge batches failed 0.
- Tokens (parse): prompt 103907, completion 305346; parse wall 278712 ms at concurrency 6; total HTTP calls 88/400.
- Denominator: 435 bullet-level criteria in the fixed cohort (30 trials; regex split). Parsed 410, **unresolved 25** (kept as UNKNOWN scoring criteria). Non-scoring (category consent_logistics, derived in code): 45; scoring denominator = 390 (non-consent parsed + all unresolved).
- Definitions: **code-evaluable** = every leaf is an atom whose operator/value/unit are valid and convertible in code (no text/timing leaves) · **reviewed full-logic (headline)** = code-evaluable AND the independent DEEP judge says the clause captures the entire criterion · **partial-typed** = ≥1 atom leaf but not fully executable (text/timing remain on the free-text path).

| Stratum (scoring, unresolved included) | n | unresolved | code-evaluable | reviewed full-logic (headline) | ≥1 atom (partial-typed) |
|---|---|---|---|---|---|
| all scoring (incl. unresolved) | 390 | 25/390 (6.4%) | 61/390 (15.6%) | 30/390 (7.7%) | 91/390 (23.3%) |
| inclusion | 188 | 12/188 (6.4%) | 48/188 (25.5%) | 25/188 (13.3%) | 70/188 (37.2%) |
| exclusion | 202 | 13/202 (6.4%) | 13/202 (6.4%) | 5/202 (2.5%) | 21/202 (10.4%) |
| simple wording (heuristic) | 232 | 19/232 (8.2%) | 47/232 (20.3%) | 25/232 (10.8%) | 58/232 (25%) |
| compound wording (heuristic) | 158 | 6/158 (3.8%) | 14/158 (8.9%) | 5/158 (3.2%) | 33/158 (20.9%) |

**Gate (reviewed full-logic over all scoring incl. unresolved): 30/390 (7.7%) → STOP AND REASSESS (<40%).** Schedule gate only; not an accuracy or safety claim. The earlier 5.7% used a different denominator (parser-scoring only, 20 missing excluded) and a single-fact representation, so it is not directly comparable.
- Judge on 61 code-evaluable criteria: full 30, partial 25, wrong 6, unjudged 0.
- Vocabulary-touch proxy (any leaf touches a vocabulary key, parsed criteria): 94/390 (24.1%). **Unvalidated proxy, not a typed rate.**
- Leaf kinds across parsed criteria: text×418, atom×129, timing×14.

## 2026-10-05T15:48:05.811Z — 07-e2e (fictional profile; fixed cohort; prompt `spike-3`; reasoning_effort=low; command `pnpm spike:e2e`)

- Plan: `RunBudget(80)`: each LLM slot reserves 2 calls (call + its one retry) ⇒ 40 slots; reserved: extraction 1, verify 8, escalate 3 (escalation NOT built here; its reserve is released to verification); parse capped at 14 slots; evaluate takes the rest. Hard `CallCap(80)` additionally throws if exceeded (it did not).
- Profile: fictional; extractor produced 13 known facts (cold) / 11 (warm). Prefilter by age/sex over the 30-trial fixture ⇒ 29 candidates.

| Run | candidates | parse cache hit/miss | HTTP calls used | slots | calls extraction/parse/evaluate/verify | wall ms |
|---|---|---|---|---|---|---|
| cold (empty parse cache) | 29 | 0/29 | 34 (≤80) | 33 slots → worst case 66 | 1/15/12/6 | 62131 |
| warm (parse cache filled) | 29 | 28/1 | 34 (≤80) | 33 slots → worst case 66 | 1/3/22/8 | 64879 |

| Run | extraction | parse | free-text evaluate | verify |
|---|---|---|---|---|
| cold | 28624 ms (1 slots, 0 retries, 0×429, 0 failed) | 23597 ms (14 slots, 1 retries, 0×429, 1 failed) | 7459 ms (12 slots, 0 retries, 0×429, 0 failed) | 2445 ms (6 slots, 0 retries, 0×429, 0 failed) |
| warm | 22869 ms (1 slots, 0 retries, 0×429, 0 failed) | 21876 ms (2 slots, 1 retries, 0×429, 0 failed) | 15851 ms (22 slots, 0 retries, 0×429, 0 failed) | 4278 ms (8 slots, 0 retries, 0×429, 0 failed) |

| Run | tiers after typed-only (code) | after free-text eval | final (after verify) | trials with unresolved criteria | guard downgrades | verification | eval slot overflow (trials left UNKNOWN) |
|---|---|---|---|---|---|---|---|
| cold | {"STRONG":0,"POSSIBLE":8,"UNCERTAIN":20,"LIKELY_MISMATCH":1} | {"STRONG":0,"POSSIBLE":6,"UNCERTAIN":19,"LIKELY_MISMATCH":4} | {"STRONG":0,"POSSIBLE":6,"UNCERTAIN":19,"LIKELY_MISMATCH":4} | 16 | 1 | 6 verified, 0 disagreements, 0 unverified→UNCERTAIN | 0 |
| warm | {"STRONG":0,"POSSIBLE":10,"UNCERTAIN":12,"LIKELY_MISMATCH":7} | {"STRONG":0,"POSSIBLE":8,"UNCERTAIN":9,"LIKELY_MISMATCH":12} | {"STRONG":0,"POSSIBLE":8,"UNCERTAIN":9,"LIKELY_MISMATCH":12} | 0 | 26 | 8 verified, 0 disagreements, 0 unverified→UNCERTAIN | 0 |

- Criteria in the 29 candidates (warm): 430; parse completeness full 67 / partial 363 / unresolved 0; findings decided PASS/FAIL after eval+guard: 74.
- Offline pre-parse of the cohort (what `pnpm precompute` must do before judging): 36 HTTP calls (chunks of 15 + retries), 62704 ms at concurrency 6; cache entries written 29/29. Cache is in-memory in this spike (VERIFY: Supabase `trial_criteria_cache` persistence in Phase 2).

## 2026-10-05T15:48:57.160Z — 09-adaptive-reach (no LLM calls; final reasoning=low coverage run; 30 trials)

- Trials with ≥1 typed ATOM on an askable fact: 22/30; with a reviewed-full typed criterion on an askable fact: 12/30.

| fact_key | askable | trials with atom (any parse) | trials with reviewed-full typed criterion |
|---|---|---|---|
| age | no | 17 | 11 |
| ecog | yes | 13 | 6 |
| disease_setting | yes | 5 | 0 |
| prior_other_malignancy | yes | 5 | 0 |
| sex | no | 5 | 3 |
| pregnant | yes | 5 | 1 |
| measurable_disease | yes | 5 | 3 |
| her2_status | yes | 4 | 0 |
| cns_mets | yes | 4 | 0 |
| anc | yes | 3 | 2 |
| platelets | yes | 3 | 2 |
| lvef_percent | yes | 3 | 1 |
| cardiac_disease | yes | 3 | 0 |
| lactating | yes | 3 | 1 |

- Reading: a single typed answer reaches at most the trials listed per key. Keys not in this table were never typed in this cohort. Counts are over the SAME fixed cohort the parser was iterated on (in-sample).

## 2026-10-05T15:49Z — Phase 1 gate repairs: summary (read this section first; the sections above are the raw runs)

**Scope.** Repairs requested after the 5.7% strict-typed STOP result: (1) parser-batch index validation, no silent loss; (2) `known` facts require a value; (3) clause representation for compound criteria; (4) conservative tiering; (5) run plan inside `MAX_LLM_CALLS_PER_RUN=80` + measured end-to-end run. Phase 2 not started.

**Commands** (model IDs passed as shell env vars only; `NEBIUS_API_KEY`/`NEBIUS_BASE_URL` from the session environment):
`pnpm lint` · `pnpm typecheck` · `pnpm test` (118 tests) · `pnpm build` · `pnpm spike:reasoning` · `COVERAGE_REASONING=low pnpm spike:coverage2` · `COVERAGE_REASONING=on COVERAGE_CHUNK=10 COVERAGE_MAX_TOKENS=24576 pnpm spike:coverage2` · `pnpm spike:e2e` · `pnpm spike:reach`.

**What changed in code (all unit-tested, pure, no LLM):** `src/lib/engine/{checks,clause,reconcile,guard,tier,run-plan}.ts`, `src/schema/clause.ts`, `src/schema/profile.ts` (known ⇒ vocabulary-valid value; unknown ⇒ no value), `src/prompts/clause-parse.ts` (`spike-3`). Designs: `docs/clause-representation.md`, `docs/run-plan.md`.

### Coverage on the same fixed cohort (30 recruiting breast-cancer trials, 435 bullet-level criteria, regex split)
Denominator includes unresolved parses: a criterion the parser did not validly return stays in the denominator as an UNRESOLVED scoring criterion (→ UNKNOWN). Non-scoring = category `consent_logistics`, derived in code.

| Run (appended section order) | Config | Batches first-valid / valid-after-retry / rejected | Unresolved | Scoring n | Code-evaluable | Reviewed full-logic | Status |
|---|---|---|---|---|---|---|---|
| Baseline 04 (single fact, `spike-0`) | thinking on | n/a (20 criteria silently missing) | not counted | 371 (parser-scoring only) | 14.6% | 5.7% | superseded: denominator excluded missing parses |
| 04c run 1 | `spike-1`, reasoning on, 8k max tokens | 19 / 12 / 15 (12 truncated at the token cap) | 157 (38%) | 413 | 9.7% | 5.6% | harness-limited: reasoning exhausted the output budget |
| 04c run 2 | `spike-1`, thinking off | 24 / 8 / 14 | 167 | 199 | 6% | 2.5% | **invalid**: model flagged 236/268 parsed criteria `scoring:false` |
| 04c run 3 | `spike-2`, effort low, scoring derived in code | 27 / 5 / 14 | 150 | 400 | 12.3% | 3.5% | **invalid**: prompt format bug, model copied the "(inclusion)" list tag into leaf `source` |
| 04c run 4 | `spike-3` (JSON-lines input, NFKC compare) | 33 / 8 / 5 | 60 (15.3%) | 393 | 15% | 7.1% | superseded: malformed atom leaves still rejected whole batches |
| **04c final A** | `spike-3`, effort low, chunk 15, malformed atoms → text | 42 / 3 / 1 | **7 (1.8%)** | **387** | **69 (17.8%)** | **29 (7.5%)** | **primary result** |
| 04c final B | `spike-3`, reasoning on, chunk 10, 24k tokens | 49 / 4 / 3 | 25 (6.4%) | 390 | 61 (15.6%) | 30 (7.7%) | accuracy comparison (≈4× slower, ≈3× tokens) |

**Primary result (final A), strata over scoring criteria incl. unresolved:**

| Stratum | n | unresolved | code-evaluable | reviewed full-logic | ≥1 atom (partial-typed) |
|---|---|---|---|---|---|
| all scoring | 387 | 7 (1.8%) | 69 (17.8%) | **29 (7.5%)** | 87 (22.5%) |
| inclusion | 185 | 0 | 49 (26.5%) | 25 (13.5%) | 62 (33.5%) |
| exclusion | 202 | 7 (3.5%) | 20 (9.9%) | 4 (2.0%) | 25 (12.4%) |
| simple wording (heuristic) | 228 | 5 | 51 (22.4%) | 24 (10.5%) | 60 (26.3%) |
| compound wording (heuristic) | 159 | 2 | 18 (11.3%) | 5 (3.1%) | 27 (17.0%) |

**Gate: 7.5% reviewed full-logic (7.7% in B) → still STOP (<40%).** The representation repair did not move the headline: ~7–8% in both configurations. What changed is reliability and honesty: unresolved fell from 38% to 1.8% once harness bugs were fixed, nothing is silently lost, and 22.5% of criteria now have at least one executable atom even when the whole criterion is not executable (those atoms can still decide through three-valued short-circuit, but are never counted as "typed").

**Why coverage stays low (evidence, not speculation):** leaf kinds in final A: text×367, atom×118, timing×9: the parser puts ~75% of leaves on the free-text path because the 35-key vocabulary does not cover most real criteria (comorbidity, washout/timing, drug-specific, biomarker detail). Representation was necessary (compound/bundled bullets) but not sufficient.

**Independent review (limits stated).** Reviewer = DEEP judge (different model than parser; reasoning on) over every code-evaluable criterion, plus a manual read by the agent of a sample: of the 29 judge-"full" items I agreed with 28 (one false-full: "evaluable disease" mapped to `measurable_disease`); of 21 sampled judge-non-full code-evaluable items I judged ~3 wrongly rejected (two identical texts got different verdicts: judge noise; one correct mapping marked wrong). Judge also correctly caught clearly wrong mappings (e.g. HIV → `prior_other_malignancy`, surgery → `days_since_last_systemic_therapy`). Rough corrected range: **~7–9%**. Not clinician review; the agent and judge are both LLMs; sample sizes small.

**Vocabulary-touch proxy.** 22.7% of scoring criteria (final A) have a leaf touching a vocabulary key. The earlier 47% figure came from the old single-fact prompt's generous `depends_on` and is **an unvalidated proxy, not comparable, not a typed rate**; do not use it for planning.

### Adaptive reach (09; in-sample, no LLM)
22/30 trials have ≥1 typed atom on an askable fact; only 12/30 have a reviewed-full typed criterion on one. Reach is concentrated in `ecog` (13 trials any parse / 6 reviewed), then `disease_setting`, `prior_other_malignancy`, `pregnant`, `measurable_disease` (5 each), labs/LVEF/CNS (3–4). See section 09 above.

### Batch validation / no silent loss (repair 1)
`makeClauseBatchSchema(originals)` rejects a batch with missing, duplicate or unexpected indices, or any leaf whose `source` is not a verbatim fragment of its criterion (NFKC/whitespace/markdown-insensitive); the caller retries once with index-only feedback. `reconcileBatch` always returns exactly one outcome per original criterion; a batch still invalid after the retry makes its criteria `unresolved` → UNKNOWN scoring findings. In final A: 45/46 batches valid (42 first-attempt, 3 after retry), 1 rejected → 7 criteria unresolved (the batch had 7 criteria). An atom/timing leaf missing required fields is downgraded to a text leaf in code (source kept) instead of rejecting the batch.

### End-to-end run (07), fictional profile, fixed cohort, hard cap 80
Plan: `RunBudget(80)`; every LLM slot reserves call + one retry (⇒ 40 slots); reserved extraction 1, verify 8, escalate 3 (escalation not built; its reserve is released to verification); parse capped at 14 slots; evaluate takes the rest. Abstention guard and typed evaluation are code (0 calls). Measured (one run each; wall time includes the FAST extraction call):

| | Cold (empty parse cache) | Warm (cache filled by offline pre-parse) |
|---|---|---|
| HTTP calls used / cap | 34 / 80 | 34 / 80 |
| Slots granted → worst case if every call retried | 33 → 66 | 33 → 66 |
| Calls extraction / parse / evaluate / verify | 1 / 15 / 12 / 6 | 1 / 3 / 22 / 8 |
| Wall time | 62 s | 65 s |
| Trials with unresolved criteria (UNCERTAIN) | 16 of 29 | 0 of 29 |
| Final tiers STRONG / POSSIBLE / UNCERTAIN / LIKELY_MISMATCH | 0 / 6 / 19 / 4 | 0 / 8 / 9 / 12 |
| Guard downgrades (unsupported LLM PASS/FAIL → UNKNOWN) | 1 | 26 |
| Verification | 6 verified, 0 disagreements, 0 overflow | 8 verified, 0 disagreements, 0 overflow |

Offline pre-parse of the whole cohort: 36 HTTP calls, 63 s at concurrency 6 (29/29 trials cached; cache is in-memory in the spike, so Supabase persistence is unverified). FAST extraction dominated wall time (23–29 s even at `reasoning_effort=low`); cold is not slower end-to-end only because it analyses fewer trials (16 stay UNCERTAIN, queued for warm-up).

**Observations that need a founder decision:** (a) STRONG never occurs (363/430 criteria are partial parses), so with this vocabulary the product cannot honestly show a "strong" tier; (b) 12/29 warm trials are LIKELY_MISMATCH, decided partly by the free-text LLM path, and SPEC verifies only STRONG/POSSIBLE, so a false FAIL would hide a trial unreviewed; (c) escalation was not exercised.

### Reasoning control (08): Nemotron Super spends most of its output budget on reasoning
Single run per variant on 15 fixed criteria, json_schema strict, max_tokens 16384: default reasoning 8,993 completion tokens / 39 s / invalid batch; `chat_template_kwargs.enable_thinking=false` 2,681 / 9.7 s / valid; `reasoning_effort=low` 2,304 / 8.4 s / valid; system `/no_think` 11,424 / 54 s / invalid. VERIFY: parameters are accepted by Token Factory today; behaviour may change. Directional only (n=1 each).

### Limitations and VERIFY
- **In-sample.** The harness (not the criteria content) was iterated on the same cohort that is scored; prompt wording changed only for format/scope bugs, but the numbers are not held-out. A fresh cohort is needed before quoting a coverage figure publicly.
- Regex criterion splitter is unvalidated; inclusion/exclusion type comes from it (one judged-full "exclusion" criterion read like an inclusion bullet).
- Simple/compound strata use a regex heuristic.
- Judge and reviewer are LLMs; no clinician review. Typed ≠ clinically correct.
- Single runs; no variance estimates. Cost per run not computed (no pricing in hand). 
- Unit factors marked VERIFY in code (`mmol/L→g/dL` 1.61, month≈30 d).
- Free-text evaluator, verifier and extraction prompts in `07-e2e.ts` are spike-grade and unevaluated for accuracy; only cost/latency/budget behaviour was measured.

## 2026-10-05T15:50Z — Checks after the gate repairs (run locally by the agent; no CI exists)

| Command | Exit |
|---|---|
| `pnpm lint` | 0 |
| `pnpm typecheck` | 0 |
| `pnpm test` (118 tests, 7 files) | 0 |
| `pnpm build` (only NEBIUS_* set) | 0 |

## 2026-10-06T02:23:26.180Z — 07-e2e (fictional profile; fixed cohort; prompt `spike-3`; reasoning_effort=low; command `pnpm spike:e2e`)

- Plan: `RunBudget(80)`: each LLM slot reserves 2 calls (call + its one retry) ⇒ 40 slots; reserved: extraction 1, verify 8, escalate 3 (escalation NOT built here; its reserve is released to verification); parse capped at 14 slots; evaluate takes the rest. Hard `CallCap(80)` additionally throws if exceeded (it did not).
- Profile: fictional; extractor produced 14 known facts (cold) / 14 (warm). Prefilter by age/sex over the 30-trial fixture ⇒ 29 candidates.

| Run | candidates | parse cache hit/miss | HTTP calls used | slots | calls extraction/parse/evaluate/verify | wall ms |
|---|---|---|---|---|---|---|
| cold (empty parse cache) | 29 | 0/29 | 35 (≤80) | 33 slots → worst case 66 | 1/16/12/6 | 63924 |
| warm (parse cache filled) | 29 | 29/0 | 30 (≤80) | 30 slots → worst case 60 | 1/0/21/8 | 56361 |

| Run | extraction | parse | free-text evaluate | verify |
|---|---|---|---|---|
| cold | 30130 ms (1 slots, 0 retries, 0×429, 0 failed) | 24785 ms (14 slots, 2 retries, 0×429, 0 failed) | 6363 ms (12 slots, 0 retries, 0×429, 0 failed) | 2634 ms (6 slots, 0 retries, 0×429, 0 failed) |
| warm | 37054 ms (1 slots, 0 retries, 0×429, 0 failed) | 0 ms (0 slots, 0 retries, 0×429, 0 failed) | 15152 ms (21 slots, 0 retries, 0×429, 0 failed) | 4150 ms (8 slots, 0 retries, 0×429, 0 failed) |

| Run | tiers after typed-only (code) | after free-text eval | final (after verify) | trials with unresolved criteria | guard downgrades | verification | eval slot overflow (trials left UNKNOWN) |
|---|---|---|---|---|---|---|---|
| cold | {"STRONG":0,"POSSIBLE":8,"UNCERTAIN":19,"LIKELY_MISMATCH":2} | {"STRONG":0,"POSSIBLE":6,"UNCERTAIN":19,"LIKELY_MISMATCH":4} | {"STRONG":0,"POSSIBLE":4,"UNCERTAIN":21,"LIKELY_MISMATCH":4} | 15 | 4 | 6 verified, 2 disagreements, 0 unverified→UNCERTAIN | 0 |
| warm | {"STRONG":0,"POSSIBLE":9,"UNCERTAIN":12,"LIKELY_MISMATCH":8} | {"STRONG":0,"POSSIBLE":8,"UNCERTAIN":9,"LIKELY_MISMATCH":12} | {"STRONG":0,"POSSIBLE":8,"UNCERTAIN":9,"LIKELY_MISMATCH":12} | 0 | 1 | 8 verified, 0 disagreements, 0 unverified→UNCERTAIN | 0 |

- Criteria in the 29 candidates (warm): 430; parse completeness full 71 / partial 359 / unresolved 0; findings decided PASS/FAIL after eval+guard: 79.
- Offline pre-parse of the cohort (what `pnpm precompute` must do before judging): 32 HTTP calls (chunks of 15 + retries), 56228 ms at concurrency 6; cache entries written 29/29. Cache is in-memory in this spike (VERIFY: Supabase `trial_criteria_cache` persistence in Phase 2).

## 2026-10-06T02:25Z — LIKELY_MISMATCH audit (warm e2e run 2; fictional profile; `pnpm spike:e2e` then `pnpm exec tsx eval/spike/10-mismatch-audit.ts`)

**Scope and method.** The first e2e run did not persist per-trial state, so `07-e2e.ts` now saves gitignored snapshots (`eval/spike/fixtures/e2e-{cold,warm}.json`) and was re-run. Run 2 (warm: 30 HTTP calls, 21 evaluate + 8 verify slots, 56 s) again produced **12 LIKELY_MISMATCH of 29** (8 decided by the code stage, 4 added by free-text evaluation), same count as run 1 but not necessarily the same trials. Every FAIL was read by the agent against the original criterion text, the parsed clause and the fictional profile. Labels are the agent's judgment: **not a measured verifier, not clinician review, n=20 findings, in-sample.**

**Fictional profile facts used (known):** age 52, female, stage IV, metastatic, ECOG 1, ER+, PR+, HER2-negative, postmenopausal, not pregnant, no CNS mets, prior CDK4/6i, prior endocrine, prior chemotherapy. (Percent ER/PR expression, HER2 IHC/ISH detail, PD-L1 not stated.)

### Findings (20 FAIL findings in 12 trials)
| # | Trial | FAILs (origin) | What the FAIL rests on | Agent label | Trial-level |
|---|---|---|---|---|---|
| 1 | NCT06856343 | 1 code | trial wants HER2-negative early BC; patient metastatic | confirmed | confirmed |
| 2 | NCT06722612 | 1 code | excludes metastatic disease; patient metastatic | confirmed | confirmed |
| 3 | NCT07081555 | 1 LLM | requires HER2 overexpression (IHC 3+, or 2+/ISH+); patient HER2-negative | confirmed | confirmed |
| 4 | NCT07776951 | 2 LLM | "first diagnosis of primary BC" and "candidate for neoadjuvant therapy" both inferred from stage IV alone | cannot be confirmed (inference / clinical judgment; de novo stage IV can be a first diagnosis) | **not confirmable** |
| 5 | NCT06518837 | 1 code | stage IV is listed under the real Exclusion header | confirmed | confirmed |
| 6 | NCT05059379 | 2 LLM | M0 staging requirement; "distant metastasis" exclusion | confirmed ×2 | confirmed |
| 7 | NCT05909332 | 3 LLM | TNBC required (patient ER+/PR+); non-metastatic stage required; metastatic excluded | confirmed ×3 | confirmed |
| 8 | NCT06627712 | 2 code | (a) M0 stage requirement: right outcome, approximate stage mapping; (b) a *conditional* ("women of childbearing potential aged 15–49 must test negative…") encoded as an unconditional AND, so age 52 fails | (a) confirmed; (b) **wrong** | confirmed via (a) |
| 9 | NCT06732323 | 3 code | TNBC required (confirmed); no prior systemic therapy for metastatic disease (confirmed); a PD-L1 criterion mapped to `prior_endocrine eq false` | 2 confirmed, 1 **wrong mapping** | confirmed via the first two |
| 10 | NCT07694986 | 1 code | pregnancy-test requirement from the INCLUSION section typed as exclusion by the splitter, and conditional on childbearing potential | **wrong** (false FAIL) | **false mismatch** |
| 11 | NCT05812807 | 2 code | (a) ER/PR ≤10% and HER2-negative encoded as ER negative: patient "ER positive" with unknown percent could be ER-low, so the FAIL cannot be confirmed; (b) "No stage IV" | (a) cannot be confirmed; (b) confirmed | confirmed via (b) |
| 12 | NCT05582538 | 1 code | "negative ER/PgR (defined as <10%)" vs patient "positive" with unknown percent | cannot be confirmed | **not confirmable** |

**Totals.** FAIL findings: 13 confirmed, 3 wrong, 4 cannot-be-confirmed. By origin: **code 12 → 7 confirmed, 3 wrong, 2 unconfirmable; LLM 8 → 6 confirmed, 0 wrong, 2 unconfirmable.** Trial level: **9 of 12 confirmed, 3 of 12 would not survive verification** (#4, #10, #12; one of them a false mismatch). Code FAILs were not more reliable than LLM FAILs: 5 of 12 code FAILs were unsound.

**Root causes of the unsound FAILs (all upstream of verification):**
1. **Conditional criteria are not representable** ("if X then must Y"). The clause schema has all/any/except but no implication, so conditionals were encoded as plain AND (#8b, #10). Needs a representation decision.
2. **Criterion-splitter defect:** the first "exclusion criteria" match is taken even when it is an inline cross-reference. 4 of 27 trials with an exclusion header are affected (NCT05768139, NCT06732323, NCT07623369, NCT07694986); in NCT07694986, 22 of 34 criteria were typed exclusion. This also inflates exclusion-stratum figures in the earlier coverage runs.
3. **Wrong fact mapping** that the code check cannot detect (#9 PD-L1 → `prior_endocrine`).
4. **Threshold semantics** (≤10% / <10% receptor expression treated as plain "negative"; the vocabulary has no percentage fact).
5. **Over-inference** by the free-text LLM from stage alone (#4).

### Projected verification calls (rule: unverified FAIL stays UNCERTAIN; only a verified FAIL becomes LIKELY_MISMATCH)
Verifier design assumed: one call per mismatch candidate trial, input = the trial's FAIL criteria (original text) + the known facts only (no first-pass reasoning), tri-state output per criterion; the trial is LIKELY_MISMATCH only if ≥1 FAIL is confirmed. One slot = call + its retry. Not built and not measured.

| Run | Mismatch candidates | New verification calls (no retry) | Worst case (every call retries) | Total slots / worst-case calls with existing stages |
|---|---|---|---|---|
| Warm run 2 | 12 | 12 | 24 | 30 + 12 = 42 slots → **84 calls: exceeds 80 by 4 if every call retried**; expected actual calls ≈ 42 (retries observed ≈ 0–3 per run) |
| Cold run 1 (earlier) | 4 | 4 | 8 | 1+14+12+6+4 = 37 slots → 74: fits |

To fit 80 in the worst case, the warm path needs ≥2 slots back: for example cap free-text evaluation at 19 slots (2 trials stay UNKNOWN ⇒ UNCERTAIN), or share the unused escalation reserve (3 slots, escalation unbuilt) with mismatch verification. Overflow rule: a candidate without a verification slot stays UNCERTAIN, never LIKELY_MISMATCH. Mismatch candidates are bounded by the candidate count (≤30), so a cap of 12 verification slots still leaves FAILs unverified when more than 12 occur: they remain UNCERTAIN.

**Projected effect on warm run 2 if the verifier agreed with the agent labels (a proxy, not measured):** POSSIBLE 8, UNCERTAIN 9 + 3 = 12, LIKELY_MISMATCH 9 (from 12). If no slots were available for mismatch verification: LIKELY_MISMATCH 0, UNCERTAIN 21.

**Not changed:** tier logic (STRONG rule untouched; no engine change for verified-FAIL yet), UI, Phase 2.

## 2026-10-06T02:52:11.977Z — 03-ctgov (fresh cohort)

- Endpoint: `GET https://clinicaltrials.gov/api/v2/studies` with `query.cond=breast cancer`, `filter.overallStatus=RECRUITING`, `pageSize=60`, `fields=...`. HTTP 200, no key.
- Page returned 180 studies (nextPageToken present); 180 had eligibility text; sample = 30 (every 6th).
- Rate-limit headers observed: none (VERIFY documented limit: ~50 req/min/IP per CT.gov docs)
- Zod validation of response: passed (fields tolerated as optional).
- Field presence over sample: eligibility text 30/30 (100%); minimumAge 29/30 (97%); maximumAge 15/30 (50%); sex 30/30 (100%); lastUpdatePostDate 30/30 (100%)
- Sites: 240 total across sample; with geoPoint 238/240 (99%); trials where every site has geo 28/30 (93%); site-level status field present on 30/30 (100%) trials (≥1 RECRUITING site).
- Heuristic criterion split: 487 bullet-level criteria (250 inclusion / 237 exclusion); median length 85 chars. The splitter is a regex heuristic, not a parser; mis-splits are not measured here.
- Raw fixture is gitignored (`eval/spike/fixtures/`), regenerate with `pnpm spike:ctgov`. VERIFY: CT.gov terms of use on redistributing submitter text before ever committing it.

## 2026-10-06T02:54:12.228Z — 04c-coverage-clauses (original cohort; clause representation; splitter + atom-semantics guards active)

- Command: `pnpm spike:coverage2` (COVERAGE_CHUNK=15, COVERAGE_REASONING=low, max_tokens 8192; judge reasoning default ON). Parser MID `nvidia/nemotron-3-super-120b-a12b`, prompt `spike-3`, json_schema mode, 46 batch calls; judge DEEP `nvidia/Nemotron-3-Ultra-550b-a55b` on code-evaluable criteria only.
- Batch validation (index set exact + every leaf source is a verbatim fragment): first-attempt valid 43/46; valid after the one retry 2; **rejected after retry 1** (all their criteria → UNRESOLVED → UNKNOWN; last-attempt reasons: leaf source not verbatim×1); truncated outputs 0; judge batches failed 0.
- Tokens (parse): prompt 82138, completion 79324; parse wall 76037 ms at concurrency 6; total HTTP calls 70/400.
- Denominator: 431 bullet-level criteria in the fixed cohort (30 trials; regex split). Parsed 416, **unresolved 15** (kept as UNKNOWN scoring criteria). Non-scoring (category consent_logistics, derived in code): 46; scoring denominator = 385 (non-consent parsed + all unresolved).
- Definitions: **code-evaluable** = every leaf is an atom whose operator/value/unit are valid and convertible in code (no text/timing leaves) · **reviewed full-logic (headline)** = code-evaluable AND the independent DEEP judge says the clause captures the entire criterion · **partial-typed** = ≥1 atom leaf but not fully executable (text/timing remain on the free-text path).

| Stratum (scoring, unresolved included) | n | unresolved | code-evaluable | reviewed full-logic (headline) | ≥1 atom (partial-typed) |
|---|---|---|---|---|---|
| all scoring (incl. unresolved) | 385 | 15/385 (3.9%) | 51/385 (13.2%) | 25/385 (6.5%) | 79/385 (20.5%) |
| inclusion | 188 | 12/188 (6.4%) | 39/188 (20.7%) | 22/188 (11.7%) | 56/188 (29.8%) |
| exclusion | 197 | 3/197 (1.5%) | 12/197 (6.1%) | 3/197 (1.5%) | 23/197 (11.7%) |
| simple wording (heuristic) | 226 | 11/226 (4.9%) | 41/226 (18.1%) | 21/226 (9.3%) | 55/226 (24.3%) |
| compound wording (heuristic) | 159 | 4/159 (2.5%) | 10/159 (6.3%) | 4/159 (2.5%) | 24/159 (15.1%) |

**Gate (reviewed full-logic over all scoring incl. unresolved): 25/385 (6.5%) → STOP AND REASSESS (<40%).** Schedule gate only; not an accuracy or safety claim. The earlier 5.7% used a different denominator (parser-scoring only, 20 missing excluded) and a single-fact representation, so it is not directly comparable.
- Judge on 54 code-evaluable criteria: full 25, partial 23, wrong 6, unjudged 0.
- Vocabulary-touch proxy (any leaf touches a vocabulary key, parsed criteria): 82/385 (21.3%). **Unvalidated proxy, not a typed rate.**
- Leaf kinds across parsed criteria: text×363, atom×114, timing×6.

## 2026-10-06T02:56:01.912Z — 04c-coverage-clauses (fresh cohort; clause representation; splitter + atom-semantics guards active)

- Command: `pnpm spike:coverage2` (COVERAGE_CHUNK=15, COVERAGE_REASONING=low, max_tokens 8192; judge reasoning default ON). Parser MID `nvidia/nemotron-3-super-120b-a12b`, prompt `spike-3`, json_schema mode, 46 batch calls; judge DEEP `nvidia/Nemotron-3-Ultra-550b-a55b` on code-evaluable criteria only.
- Batch validation (index set exact + every leaf source is a verbatim fragment): first-attempt valid 36/46; valid after the one retry 7; **rejected after retry 3** (all their criteria → UNRESOLVED → UNKNOWN; last-attempt reasons: leaf source not verbatim×3); truncated outputs 0; judge batches failed 0.
- Tokens (parse): prompt 103621, completion 103743; parse wall 93225 ms at concurrency 6; total HTTP calls 76/400.
- Denominator: 487 bullet-level criteria in the fixed cohort (30 trials; regex split). Parsed 450, **unresolved 37** (kept as UNKNOWN scoring criteria). Non-scoring (category consent_logistics, derived in code): 51; scoring denominator = 436 (non-consent parsed + all unresolved).
- Definitions: **code-evaluable** = every leaf is an atom whose operator/value/unit are valid and convertible in code (no text/timing leaves) · **reviewed full-logic (headline)** = code-evaluable AND the independent DEEP judge says the clause captures the entire criterion · **partial-typed** = ≥1 atom leaf but not fully executable (text/timing remain on the free-text path).

| Stratum (scoring, unresolved included) | n | unresolved | code-evaluable | reviewed full-logic (headline) | ≥1 atom (partial-typed) |
|---|---|---|---|---|---|
| all scoring (incl. unresolved) | 436 | 37/436 (8.5%) | 55/436 (12.6%) | 38/436 (8.7%) | 94/436 (21.6%) |
| inclusion | 217 | 2/217 (0.9%) | 43/217 (19.8%) | 32/217 (14.7%) | 75/217 (34.6%) |
| exclusion | 219 | 35/219 (16%) | 12/219 (5.5%) | 6/219 (2.7%) | 19/219 (8.7%) |
| simple wording (heuristic) | 265 | 17/265 (6.4%) | 45/265 (17%) | 33/265 (12.5%) | 73/265 (27.5%) |
| compound wording (heuristic) | 171 | 20/171 (11.7%) | 10/171 (5.8%) | 5/171 (2.9%) | 21/171 (12.3%) |

**Gate (reviewed full-logic over all scoring incl. unresolved): 38/436 (8.7%) → STOP AND REASSESS (<40%).** Schedule gate only; not an accuracy or safety claim. The earlier 5.7% used a different denominator (parser-scoring only, 20 missing excluded) and a single-fact representation, so it is not directly comparable.
- Judge on 57 code-evaluable criteria: full 39, partial 15, wrong 3, unjudged 0.
- Vocabulary-touch proxy (any leaf touches a vocabulary key, parsed criteria): 94/436 (21.6%). **Unvalidated proxy, not a typed rate.**
- Leaf kinds across parsed criteria: text×384, atom×129, timing×17.

## 2026-10-06T02:56:14.344Z — 09-adaptive-reach (no LLM calls; final reasoning=low coverage run, original cohort, splitter+guards active; 30 trials)

- Trials with ≥1 typed ATOM on an askable fact: 20/30; with a reviewed-full typed criterion on an askable fact: 8/30.

| fact_key | askable | trials with atom (any parse) | trials with reviewed-full typed criterion |
|---|---|---|---|
| age | no | 19 | 12 |
| ecog | yes | 12 | 6 |
| prior_other_malignancy | yes | 6 | 1 |
| pregnant | yes | 6 | 1 |
| sex | no | 5 | 3 |
| measurable_disease | yes | 5 | 0 |
| her2_status | yes | 4 | 0 |
| stage | yes | 4 | 1 |
| lactating | yes | 4 | 1 |
| disease_setting | yes | 4 | 0 |
| cns_mets | yes | 3 | 0 |
| er_status | yes | 3 | 0 |
| pr_status | yes | 3 | 0 |
| anc | yes | 2 | 1 |

- Reading: a single typed answer reaches at most the trials listed per key. Keys not in this table were never typed in this cohort. Counts are over the SAME fixed cohort the parser was iterated on (in-sample).

## 2026-10-06T02:56:15.035Z — 09-adaptive-reach (no LLM calls; final reasoning=low coverage run, fresh cohort, splitter+guards active; 30 trials)

- Trials with ≥1 typed ATOM on an askable fact: 19/30; with a reviewed-full typed criterion on an askable fact: 14/30.

| fact_key | askable | trials with atom (any parse) | trials with reviewed-full typed criterion |
|---|---|---|---|
| age | no | 14 | 8 |
| ecog | yes | 10 | 8 |
| pregnant | yes | 10 | 5 |
| creatinine_clearance | yes | 8 | 1 |
| anc | yes | 6 | 3 |
| platelets | yes | 6 | 3 |
| bilirubin_x_uln | yes | 6 | 2 |
| lactating | yes | 6 | 2 |
| ast_alt_x_uln | yes | 5 | 1 |
| hemoglobin | yes | 5 | 2 |
| disease_setting | yes | 5 | 1 |
| stage | yes | 4 | 0 |
| measurable_disease | yes | 3 | 0 |
| sex | no | 3 | 2 |

- Reading: a single typed answer reaches at most the trials listed per key. Keys not in this table were never typed in this cohort. Counts are over the SAME fixed cohort the parser was iterated on (in-sample).

## 2026-10-06T03:00:36.169Z — 07-e2e (original cohort; fictional profile; clause prompt `spike-3`, fail-verify `fail-verify-0`; reasoning_effort=low; rule D active; command `COHORT=original pnpm spike:e2e`) **[PRE-FIX: before the `metastatic_line` unit bug fix; superseded by the re-run below]**

- Plan: `RunBudget(80)`: each LLM slot reserves 2 calls (call + its one retry) ⇒ 40 slots; reserved: extraction 1, verify 8, **mismatch checks 3 (reassigned from the unbuilt escalation stage)**; parse capped at 14 slots; evaluate takes shared slots; unused verify reserve flows to mismatch checks. Hard `CallCap(80)` throws if exceeded (it did not).
- Profile: fictional; extractor produced 14 known facts (cold) / 14 (warm). Prefilter by age/sex over the 30-trial original fixture ⇒ 29 candidates.

| Run | candidates | parse cache hit/miss | HTTP calls used | slots | calls extraction/parse/evaluate/verify/mismatch | wall ms |
|---|---|---|---|---|---|---|
| cold (empty parse cache) | 29 | 0/29 | 38 (≤80) | 37 slots → worst case 74 | 1/15/14/5/3 | 70603 |
| warm (parse cache filled) | 29 | 27/2 | 41 (≤80) | 40 slots → worst case 80 | 1/5/24/5/6 | 73321 |

| Run | extraction | parse | free-text evaluate | verify (STRONG/POSSIBLE) | FAIL checks |
|---|---|---|---|---|---|
| cold | 33098 ms (1 slots, 0 retries, 0×429, 0 failed) | 22433 ms (14 slots, 1 retries, 0×429, 0 failed) | 10121 ms (14 slots, 0 retries, 0×429, 0 failed) | 2714 ms (5 slots, 0 retries, 0×429, 0 failed) | 2223 ms (3 slots, 0 retries, 0×429, 0 failed) |
| warm | 27569 ms (1 slots, 0 retries, 0×429, 0 failed) | 22234 ms (4 slots, 1 retries, 0×429, 1 failed) | 18044 ms (24 slots, 0 retries, 0×429, 0 failed) | 2829 ms (5 slots, 0 retries, 0×429, 0 failed) | 2639 ms (6 slots, 0 retries, 0×429, 0 failed) |

| Run | tiers after typed-only (code; unchecked FAIL ⇒ UNCERTAIN) | after free-text eval | final | trials with unresolved criteria | guard downgrades | verification | eval slot overflow |
|---|---|---|---|---|---|---|---|
| cold | {"STRONG":0,"POSSIBLE":5,"UNCERTAIN":24,"LIKELY_MISMATCH":0} | {"STRONG":0,"POSSIBLE":5,"UNCERTAIN":24,"LIKELY_MISMATCH":0} | {"STRONG":0,"POSSIBLE":5,"UNCERTAIN":22,"LIKELY_MISMATCH":2} | 15 | 1 | 5 verified, 0 disagreements, 0 unverified→UNCERTAIN | 0 |
| warm | {"STRONG":0,"POSSIBLE":9,"UNCERTAIN":20,"LIKELY_MISMATCH":0} | {"STRONG":0,"POSSIBLE":5,"UNCERTAIN":24,"LIKELY_MISMATCH":0} | {"STRONG":0,"POSSIBLE":5,"UNCERTAIN":21,"LIKELY_MISMATCH":3} | 1 | 13 | 5 verified, 0 disagreements, 0 unverified→UNCERTAIN | 5 |

| Run | trials with ≥1 FAIL (candidates) | FAILs verified | rejected | unsubstantiated | no capacity | not run | final LIKELY_MISMATCH |
|---|---|---|---|---|---|---|---|
| cold | 3 trials / 4 FAIL findings | 3 | 1 | 0 | 0 | 0 | 2 |
| warm | 10 trials / 18 FAIL findings | 5 | 2 | 1 | 10 | 0 | 3 |

- Criteria in the 29 candidates (warm): 426; parse completeness full 46 / partial 365 / unresolved 15; findings decided PASS/FAIL after eval+guard+checks: 66.
- Offline pre-parse of the cohort: 34 HTTP calls (chunks of 15 + retries), 57100 ms at concurrency 6; cache entries written 28/29. Cache is in-memory in this spike (VERIFY: Supabase `trial_criteria_cache` persistence in Phase 2).

## 2026-10-06 — 07-e2e original cohort, first rule-D run: INVALID (infrastructure), re-run below
The first rule-D warm run had 12 free-text-evaluation and 9 verification calls fail with a 727 s wall time (Token Factory latency/timeouts; failure kinds were not yet recorded). Its tier counts are not reported. The cold half of that run completed normally (38 calls). Per-stage failure kinds are now recorded.

## 2026-10-06T03:22:20.069Z — 07-e2e (original cohort; fictional profile; clause prompt `spike-3`, fail-verify `fail-verify-0`; reasoning_effort=low; rule D active; command `COHORT=original pnpm spike:e2e`) **[PRE-FIX: before the `metastatic_line` unit bug fix; superseded by the re-run below]**

- Plan: `RunBudget(80)`: each LLM slot reserves 2 calls (call + its one retry) ⇒ 40 slots; reserved: extraction 1, verify 8, **mismatch checks 3 (reassigned from the unbuilt escalation stage)**; parse capped at 14 slots; evaluate takes shared slots; unused verify reserve flows to mismatch checks. Hard `CallCap(80)` throws if exceeded (it did not).
- Profile: fictional; extractor produced 15 known facts (cold) / 12 (warm). Prefilter by age/sex over the 30-trial original fixture ⇒ 29 candidates.

| Run | candidates | parse cache hit/miss | HTTP calls used | slots | calls extraction/parse/evaluate/verify/mismatch | wall ms |
|---|---|---|---|---|---|---|
| cold (empty parse cache) | 29 | 0/29 | 38 (≤80) | 36 slots → worst case 72 | 1/16/12/6/3 | 115394 |
| warm (parse cache filled) | 29 | 29/0 | 40 (≤80) | 40 slots → worst case 80 | 1/0/26/7/6 | 75439 |

| Run | extraction | parse | free-text evaluate | verify (STRONG/POSSIBLE) | FAIL checks |
|---|---|---|---|---|---|
| cold | 31729 ms (1 slots, 0 retries, 0×429, 0 failed) | 66971 ms (14 slots, 2 retries, 0×429, 1 failed [ZOD_INVALID_AFTER_RETRY×1]) | 8889 ms (12 slots, 0 retries, 0×429, 0 failed) | 3956 ms (6 slots, 0 retries, 0×429, 0 failed) | 3837 ms (3 slots, 0 retries, 0×429, 0 failed) |
| warm | 33369 ms (1 slots, 0 retries, 0×429, 0 failed) | 0 ms (0 slots, 0 retries, 0×429, 0 failed) | 30324 ms (26 slots, 0 retries, 0×429, 0 failed) | 8026 ms (7 slots, 0 retries, 0×429, 0 failed) | 3713 ms (6 slots, 0 retries, 0×429, 0 failed) |

| Run | tiers after typed-only (code; unchecked FAIL ⇒ UNCERTAIN) | after free-text eval | final | trials with unresolved criteria | guard downgrades | verification | eval slot overflow |
|---|---|---|---|---|---|---|---|
| cold | {"STRONG":0,"POSSIBLE":6,"UNCERTAIN":23,"LIKELY_MISMATCH":0} | {"STRONG":0,"POSSIBLE":6,"UNCERTAIN":23,"LIKELY_MISMATCH":0} | {"STRONG":0,"POSSIBLE":5,"UNCERTAIN":22,"LIKELY_MISMATCH":2} | 16 | 3 | 6 verified, 1 disagreements, 0 unverified→UNCERTAIN | 0 |
| warm | {"STRONG":0,"POSSIBLE":8,"UNCERTAIN":21,"LIKELY_MISMATCH":0} | {"STRONG":0,"POSSIBLE":7,"UNCERTAIN":22,"LIKELY_MISMATCH":0} | {"STRONG":0,"POSSIBLE":7,"UNCERTAIN":18,"LIKELY_MISMATCH":4} | 0 | 10 | 7 verified, 0 disagreements, 0 unverified→UNCERTAIN | 0 |

| Run | trials with ≥1 FAIL (candidates) | FAILs verified | rejected | unsubstantiated | no capacity | not run | final LIKELY_MISMATCH |
|---|---|---|---|---|---|---|---|
| cold | 3 trials / 4 FAIL findings | 3 | 1 | 0 | 0 | 0 | 2 |
| warm | 11 trials / 17 FAIL findings | 4 | 1 | 1 | 11 | 0 | 4 |

- Criteria in the 29 candidates (warm): 426; parse completeness full 61 / partial 365 / unresolved 0; findings decided PASS/FAIL after eval+guard+checks: 88.
- Offline pre-parse of the cohort: 35 HTTP calls (chunks of 15 + retries), 80474 ms at concurrency 6; cache entries written 29/29. Cache is in-memory in this spike (VERIFY: Supabase `trial_criteria_cache` persistence in Phase 2).

## 2026-10-06T03:27:40.592Z — 07-e2e (fresh cohort; fictional profile; clause prompt `spike-3`, fail-verify `fail-verify-0`; reasoning_effort=low; rule D active; command `COHORT=fresh pnpm spike:e2e`) **[PRE-FIX: before the `metastatic_line` unit bug fix; superseded by the re-run below]**

- Plan: `RunBudget(80)`: each LLM slot reserves 2 calls (call + its one retry) ⇒ 40 slots; reserved: extraction 1, verify 8, **mismatch checks 3 (reassigned from the unbuilt escalation stage)**; parse capped at 14 slots; evaluate takes shared slots; unused verify reserve flows to mismatch checks. Hard `CallCap(80)` throws if exceeded (it did not).
- Profile: fictional; extractor produced 14 known facts (cold) / 15 (warm). Prefilter by age/sex over the 30-trial fresh fixture ⇒ 30 candidates.

| Run | candidates | parse cache hit/miss | HTTP calls used | slots | calls extraction/parse/evaluate/verify/mismatch | wall ms |
|---|---|---|---|---|---|---|
| cold (empty parse cache) | 30 | 0/30 | 37 (≤80) | 36 slots → worst case 72 | 1/15/13/4/4 | 81781 |
| warm (parse cache filled) | 30 | 27/3 | 45 (≤80) | 40 slots → worst case 80 | 1/12/21/5/6 | 87708 |

| Run | extraction | parse | free-text evaluate | verify (STRONG/POSSIBLE) | FAIL checks |
|---|---|---|---|---|---|
| cold | 31023 ms (1 slots, 0 retries, 0×429, 0 failed) | 31087 ms (14 slots, 1 retries, 0×429, 1 failed [ZOD_INVALID_AFTER_RETRY×1]) | 12092 ms (13 slots, 0 retries, 0×429, 0 failed) | 3486 ms (4 slots, 0 retries, 0×429, 0 failed) | 4078 ms (4 slots, 0 retries, 0×429, 0 failed) |
| warm | 31781 ms (1 slots, 0 retries, 0×429, 0 failed) | 28818 ms (7 slots, 5 retries, 0×429, 3 failed [ZOD_INVALID_AFTER_RETRY×3]) | 21689 ms (21 slots, 0 retries, 0×429, 0 failed) | 2924 ms (5 slots, 0 retries, 0×429, 0 failed) | 2487 ms (6 slots, 0 retries, 0×429, 0 failed) |

| Run | tiers after typed-only (code; unchecked FAIL ⇒ UNCERTAIN) | after free-text eval | final | trials with unresolved criteria | guard downgrades | verification | eval slot overflow |
|---|---|---|---|---|---|---|---|
| cold | {"STRONG":0,"POSSIBLE":5,"UNCERTAIN":25,"LIKELY_MISMATCH":0} | {"STRONG":0,"POSSIBLE":4,"UNCERTAIN":26,"LIKELY_MISMATCH":0} | {"STRONG":0,"POSSIBLE":4,"UNCERTAIN":22,"LIKELY_MISMATCH":4} | 17 | 0 | 4 verified, 0 disagreements, 0 unverified→UNCERTAIN | 0 |
| warm | {"STRONG":0,"POSSIBLE":7,"UNCERTAIN":23,"LIKELY_MISMATCH":0} | {"STRONG":0,"POSSIBLE":5,"UNCERTAIN":25,"LIKELY_MISMATCH":0} | {"STRONG":0,"POSSIBLE":5,"UNCERTAIN":19,"LIKELY_MISMATCH":6} | 2 | 16 | 5 verified, 0 disagreements, 0 unverified→UNCERTAIN | 2 |

| Run | trials with ≥1 FAIL (candidates) | FAILs verified | rejected | unsubstantiated | no capacity | not run | final LIKELY_MISMATCH |
|---|---|---|---|---|---|---|---|
| cold | 4 trials / 7 FAIL findings | 6 | 0 | 1 | 0 | 0 | 4 |
| warm | 14 trials / 21 FAIL findings | 6 | 0 | 0 | 15 | 0 | 6 |

- Criteria in the 30 candidates (warm): 487; parse completeness full 55 / partial 395 / unresolved 37; findings decided PASS/FAIL after eval+guard+checks: 68.
- Offline pre-parse of the cohort: 41 HTTP calls (chunks of 15 + retries), 97151 ms at concurrency 6; cache entries written 28/30. Cache is in-memory in this spike (VERIFY: Supabase `trial_criteria_cache` persistence in Phase 2).

## 2026-10-06T03:33:43.562Z — 07-e2e (original cohort; fictional profile; clause prompt `spike-3`, fail-verify `fail-verify-0`; reasoning_effort=low; rule D active; command `COHORT=original pnpm spike:e2e`)

- Plan: `RunBudget(80)`: each LLM slot reserves 2 calls (call + its one retry) ⇒ 40 slots; reserved: extraction 1, verify 8, **mismatch checks 3 (reassigned from the unbuilt escalation stage)**; parse capped at 14 slots; evaluate takes shared slots; unused verify reserve flows to mismatch checks. Hard `CallCap(80)` throws if exceeded (it did not).
- Profile: fictional; extractor produced 15 known facts (cold) / 14 (warm). Prefilter by age/sex over the 30-trial original fixture ⇒ 29 candidates.

| Run | candidates | parse cache hit/miss | HTTP calls used | slots | calls extraction/parse/evaluate/verify/mismatch | wall ms |
|---|---|---|---|---|---|---|
| cold (empty parse cache) | 29 | 0/29 | 38 (≤80) | 37 slots → worst case 74 | 1/15/13/6/3 | 69570 |
| warm (parse cache filled) | 29 | 29/0 | 40 (≤80) | 40 slots → worst case 80 | 1/0/26/9/4 | 63721 |

| Run | extraction | parse | free-text evaluate | verify (STRONG/POSSIBLE) | FAIL checks |
|---|---|---|---|---|---|
| cold | 29238 ms (1 slots, 0 retries, 0×429, 0 failed) | 26944 ms (14 slots, 1 retries, 0×429, 0 failed) | 8643 ms (13 slots, 0 retries, 0×429, 0 failed) | 2245 ms (6 slots, 0 retries, 0×429, 0 failed) | 2489 ms (3 slots, 0 retries, 0×429, 0 failed) |
| warm | 33162 ms (1 slots, 0 retries, 0×429, 0 failed) | 0 ms (0 slots, 0 retries, 0×429, 0 failed) | 24208 ms (26 slots, 0 retries, 0×429, 0 failed) | 3980 ms (9 slots, 0 retries, 0×429, 0 failed) | 2365 ms (4 slots, 0 retries, 0×429, 0 failed) |

| Run | tiers after typed-only (code; unchecked FAIL ⇒ UNCERTAIN) | after free-text eval | final | trials with unresolved criteria | guard downgrades | verification | eval slot overflow |
|---|---|---|---|---|---|---|---|
| cold | {"STRONG":0,"POSSIBLE":7,"UNCERTAIN":22,"LIKELY_MISMATCH":0} | {"STRONG":0,"POSSIBLE":6,"UNCERTAIN":23,"LIKELY_MISMATCH":0} | {"STRONG":0,"POSSIBLE":5,"UNCERTAIN":23,"LIKELY_MISMATCH":1} | 15 | 0 | 6 verified, 1 disagreements, 0 unverified→UNCERTAIN | 0 |
| warm | {"STRONG":0,"POSSIBLE":10,"UNCERTAIN":19,"LIKELY_MISMATCH":0} | {"STRONG":0,"POSSIBLE":9,"UNCERTAIN":20,"LIKELY_MISMATCH":0} | {"STRONG":0,"POSSIBLE":7,"UNCERTAIN":19,"LIKELY_MISMATCH":3} | 0 | 16 | 9 verified, 2 disagreements, 0 unverified→UNCERTAIN | 0 |

| Run | trials with ≥1 FAIL (candidates) | FAILs verified | rejected | unsubstantiated | no capacity | not run | final LIKELY_MISMATCH |
|---|---|---|---|---|---|---|---|
| cold | 3 trials / 10 FAIL findings | 2 | 8 | 0 | 0 | 0 | 1 |
| warm | 10 trials / 17 FAIL findings | 3 | 1 | 0 | 13 | 0 | 3 |

- Criteria in the 29 candidates (warm): 426; parse completeness full 52 / partial 374 / unresolved 0; findings decided PASS/FAIL after eval+guard+checks: 83.
- Offline pre-parse of the cohort: 34 HTTP calls (chunks of 15 + retries), 68208 ms at concurrency 6; cache entries written 29/29. Cache is in-memory in this spike (VERIFY: Supabase `trial_criteria_cache` persistence in Phase 2).

## 2026-10-06T03:38:53.522Z — 07-e2e (fresh cohort; fictional profile; clause prompt `spike-3`, fail-verify `fail-verify-0`; reasoning_effort=low; rule D active; command `COHORT=fresh pnpm spike:e2e`)

- Plan: `RunBudget(80)`: each LLM slot reserves 2 calls (call + its one retry) ⇒ 40 slots; reserved: extraction 1, verify 8, **mismatch checks 3 (reassigned from the unbuilt escalation stage)**; parse capped at 14 slots; evaluate takes shared slots; unused verify reserve flows to mismatch checks. Hard `CallCap(80)` throws if exceeded (it did not).
- Profile: fictional; extractor produced 13 known facts (cold) / 15 (warm). Prefilter by age/sex over the 30-trial fresh fixture ⇒ 30 candidates.

| Run | candidates | parse cache hit/miss | HTTP calls used | slots | calls extraction/parse/evaluate/verify/mismatch | wall ms |
|---|---|---|---|---|---|---|
| cold (empty parse cache) | 30 | 0/30 | 33 (≤80) | 30 slots → worst case 60 | 1/17/10/2/3 | 60188 |
| warm (parse cache filled) | 30 | 27/3 | 42 (≤80) | 40 slots → worst case 80 | 1/8/22/3/8 | 82690 |

| Run | extraction | parse | free-text evaluate | verify (STRONG/POSSIBLE) | FAIL checks |
|---|---|---|---|---|---|
| cold | 21514 ms (1 slots, 0 retries, 0×429, 0 failed) | 26533 ms (14 slots, 3 retries, 0×429, 3 failed [ZOD_INVALID_AFTER_RETRY×3]) | 6391 ms (10 slots, 0 retries, 0×429, 0 failed) | 2809 ms (2 slots, 0 retries, 0×429, 0 failed) | 2925 ms (3 slots, 0 retries, 0×429, 0 failed) |
| warm | 24436 ms (1 slots, 0 retries, 0×429, 0 failed) | 24909 ms (6 slots, 2 retries, 0×429, 2 failed [ZOD_INVALID_AFTER_RETRY×2]) | 25768 ms (22 slots, 0 retries, 0×429, 0 failed) | 2718 ms (3 slots, 0 retries, 0×429, 0 failed) | 4852 ms (8 slots, 0 retries, 0×429, 0 failed) |

| Run | tiers after typed-only (code; unchecked FAIL ⇒ UNCERTAIN) | after free-text eval | final | trials with unresolved criteria | guard downgrades | verification | eval slot overflow |
|---|---|---|---|---|---|---|---|
| cold | {"STRONG":0,"POSSIBLE":2,"UNCERTAIN":28,"LIKELY_MISMATCH":0} | {"STRONG":0,"POSSIBLE":2,"UNCERTAIN":28,"LIKELY_MISMATCH":0} | {"STRONG":0,"POSSIBLE":2,"UNCERTAIN":26,"LIKELY_MISMATCH":2} | 19 | 0 | 2 verified, 0 disagreements, 0 unverified→UNCERTAIN | 0 |
| warm | {"STRONG":0,"POSSIBLE":5,"UNCERTAIN":25,"LIKELY_MISMATCH":0} | {"STRONG":0,"POSSIBLE":3,"UNCERTAIN":27,"LIKELY_MISMATCH":0} | {"STRONG":0,"POSSIBLE":3,"UNCERTAIN":20,"LIKELY_MISMATCH":7} | 2 | 14 | 3 verified, 0 disagreements, 0 unverified→UNCERTAIN | 1 |

| Run | trials with ≥1 FAIL (candidates) | FAILs verified | rejected | unsubstantiated | no capacity | not run | final LIKELY_MISMATCH |
|---|---|---|---|---|---|---|---|
| cold | 3 trials / 5 FAIL findings | 4 | 0 | 1 | 0 | 0 | 2 |
| warm | 14 trials / 24 FAIL findings | 8 | 1 | 0 | 15 | 0 | 7 |

- Criteria in the 30 candidates (warm): 487; parse completeness full 56 / partial 409 / unresolved 22; findings decided PASS/FAIL after eval+guard+checks: 71.
- Offline pre-parse of the cohort: 46 HTTP calls (chunks of 15 + retries), 101765 ms at concurrency 6; cache entries written 28/30. Cache is in-memory in this spike (VERIFY: Supabase `trial_criteria_cache` persistence in Phase 2).

## 2026-10-06T03:40Z — Rule D, splitter fix, atom-semantics guards, fresh cohort: results (authoritative section for this round)

**Which e2e sections count.** Earlier `07-e2e` sections are superseded. Authoritative: the last two (`original cohort` and `fresh cohort`), run after the `metastatic_line` fix. Superseded or invalid: the first rule-D original-cohort run (evaluation filter regression: trials with a code-stage FAIL were free-text evaluated, raising evaluate demand 21→29), the contaminated run (12 evaluate + 9 verify calls failed, 727 s; infrastructure), and the three runs labelled PRE-FIX. Each e2e figure is **one run**; the verifier and extractor vary run to run (e.g. NCT06856343's FAIL was `verified` in one run and `rejected` in the next; the extracted profile had 12–14 known facts).

### What changed in code (167 tests, lint, typecheck, build pass)
- **Rule D** (`tier.ts`, `fail-check.ts`, `schema/fail-check.ts`, `prompts/fail-verify.ts` `fail-verify-0`): only a verified FAIL makes LIKELY_MISMATCH; any other FAIL ⇒ UNCERTAIN. Verified = verifier `confirmed` AND code confirms a verbatim `source_quote`, ≥1 cited fact, every cited fact known in the profile with the cited value. No capacity / `cannot_substantiate` / failed citation ⇒ UNCERTAIN. STRONG logic untouched.
- **Splitter** (`src/lib/ctgov/split.ts`): a section header must be its own line; headers apply in order. On the original cohort it changed 4/30 trials (435→431 criteria; NCT07694986 12/22→17/16 inclusion/exclusion). Regression tests use synthetic text shaped like the defect.
- **Atom-semantics guards** (`atom-checks.ts`): an atom's `source` must lexically mention its fact; ER/PR percentage-threshold and HER2 IHC/ISH language and "evaluable ≠ measurable" make an atom non-executable (⇒ text leaf ⇒ `partial`). Regression tests: PD-L1→`prior_endocrine`, HIV→`prior_other_malignancy`, ER/PR "≤10%"/"<10%", HER2 IHC scoring. On the original cohort's previous parse, the guard downgraded 4 of 17 judge-"wrong" atoms and 1 of 29 judge-"full" (a correct downgrade: "evaluable"). Cue lists were frozen before the fresh cohort was fetched.
- **Bug found in the fresh-cohort audit and fixed:** `unitFactor` returned `null` for a missing unit even on unitless keys (`metastatic_line`), so "≥1 and ≤2 lines" evaluated to FALSE for a patient with 1 line (false code FAIL). Fixed with a regression test; both cohorts re-run.

### Budget ledger (reassigning the 3 escalation slots to FAIL checks)
Reservation is now extraction 1, STRONG/POSSIBLE verify 8, FAIL checks 3, escalate 0 ⇒ 12 reserved, 28 shared, **40 slots = 80 calls** (the ledger gives 40, not 39; I applied the reassignment because it keeps the worst case at 80 and evaluation is never cut for mismatch checks: evaluation draws only from the shared pool, mismatch only from its reserve plus leftovers). `planLedger` (tested) with the measured warm demands:

| Run (warm) | demand: extraction / parse / evaluate / verify / FAIL-check candidates | granted | uncovered | worst-case calls |
|---|---|---|---|---|
| original, post-fix | 1 / 0 / 26 / 9 / 10 | 1 / 0 / 26 / 9 / 4 | **6 candidate trials unchecked ⇒ UNCERTAIN** | 80 |
| fresh, post-fix | 1 / 6 / 22 / 3 / 14 | 1 / 6 / 22 / 3 / 8 | **6 candidate trials unchecked ⇒ UNCERTAIN** | 80 |

**Projected cost to check every candidate (one call per trial, as built):** original 1+26+9+10 = 46 slots ⇒ 92 worst-case calls (expected ≈ 46); fresh 1+6+22+3+14 = 46 ⇒ 92. **Both exceed 80 by 12 in the worst case** and need ≥ 6 more slots than the plan has. If FAIL checks were batched ≤ 4 trials per verifier call (not built, not approved: it relaxes "one call per trial" for verification calls): original 1+26+9+3 = **39 slots / 78 calls**, fresh 1+6+22+3+4 = 36 slots / 72 calls; both fit.

### Coverage on the fresh cohort (frozen config: `spike-3` prompt, effort low, chunk 15, splitter + guards active)
Fresh cohort: 30 recruiting breast-cancer trials, pages 2–4 of the same CT.gov query (every 6th of 180), **0 overlap** with the original 30, last-update dates 2022-03 to 2026-09, fetched 2026-10-06 before any parsing. NCT ids: NCT06150898, NCT04373564, NCT05208762, NCT07525869, NCT05491083, NCT06545331, NCT05730608, NCT06817525, NCT05346510, NCT06461650, NCT06247449, NCT06639178, NCT04501523, NCT07579650, NCT02610413, NCT06115486, NCT04478851, NCT02732171, NCT07310758, NCT07111728, NCT05072314, NCT06623396, NCT05856383, NCT05292742, NCT07741968, NCT04703244, NCT06966141, NCT07256769, NCT04722692, NCT04495244.

| Cohort | Criteria | Scoring n | Unresolved | Code-evaluable | **Reviewed full-logic** | ≥1 atom |
|---|---|---|---|---|---|---|
| Original (in-sample; re-run after repairs) | 431 | 385 | 15 (3.9%) | 51 (13.2%) | **25 (6.5%)** | 79 (20.5%) |
| **Fresh (DEVELOPMENT data from the `metastatic_line` fix onward; see correction)** | 487 | 436 | 37 (8.5%) | 55 (12.6%) | **38 (8.7%)** | 94 (21.6%) |

Fresh strata (scoring incl. unresolved): inclusion 217: reviewed full-logic 32 (14.7%), unresolved 2; exclusion 219: 6 (2.7%), unresolved 35 (16%; 3 rejected batches); simple 265: 33 (12.5%); compound 171: 5 (2.9%). Judge on code-evaluable: original full 25 / partial 23 / wrong 6; fresh full 39 / partial 15 / wrong 3. Parse batches: original 43 first-valid + 2 after retry + 1 rejected of 46; fresh 36 + 7 + 3 of 46. **Gate unchanged: still < 40%.** (Coverage was measured on the fresh cohort before the audit exposed the `metastatic_line` bug, but the cohort has since informed a fix, so treat it as development data; see correction below.) Judge-only review (no agent read of the fresh judge verdicts). Adaptive reach (09): trials with ≥1 typed atom on an askable fact 20/30 original, 19/30 fresh; with a reviewed-full typed criterion 8/30 original, 14/30 fresh.

### FAIL audit and rule D on the cohorts (agent-labelled; not clinician review; n small)
Warm e2e, post-fix. "True" = the trial is a real mismatch for the fictional profile in the agent's reading; verifier quality judged separately.

| | Original | Fresh |
|---|---|---|
| FAIL-candidate trials / FAIL findings | 10 / 17 (4 code, 13 LLM) | 14 / 24 (7 code, 17 LLM) |
| Findings: verified / rejected / no capacity | 3 / 1 / 13 | 8 / 1 / 15 |
| Final LIKELY_MISMATCH (verified) | 3 | 7 |
| Final tiers STRONG / POSSIBLE / UNCERTAIN / LIKELY_MISMATCH | 0 / 7 / 19 / 3 | 0 / 3 / 20 / 7 |
| Candidates the agent judged true mismatches | 9 of 10 (1 not confirmable) | 13 of 14 (1 false: a conditional) |
| Verified mismatches that are sound | 2 of 3 (1 verified on an unestablished time window) | 7 of 7 in substance (2 on weak evidence: inference from "metastatic" to a surgery/initial-diagnosis wording; 1 depends on an ambiguous line count) |
| True mismatches left UNCERTAIN only for lack of a check slot | 6 | 6 |
| False candidate stopped by the verifier | 0 | 1 (conditional "if HER2+ then …", NCT06623396) |

**Reading.** (1) Rule D did its job: no unreviewed false mismatch reached LIKELY_MISMATCH on the fresh cohort and the one false candidate (a conditional misparsed as an unconditional FAIL) was rejected. (2) The verifier is not infallible: it confirmed a FAIL whose time window ("within the past three years") the facts could not establish (original NCT07776951), twice leaned on inference (fresh NCT07111728), and flipped a verdict between runs (NCT06856343). Code-side substantiation caught no failure in these runs because the quotes and facts were literally present: **substantiation proves citation, not reasoning**. (3) Capacity is the main cost: with 40 slots, 6 of 10 (original) and 6 of 14 (fresh) candidate trials stay UNCERTAIN, and every one of those I judged a true mismatch, so LIKELY_MISMATCH recall is about 22% (2/9 sound on original) and 54% (7/13 on fresh). (4) Code FAILs fell from 12 to 4 (original) after the splitter, guards and bug fix; on the fresh cohort 7 code FAILs: 5 sound, 1 conditional false FAIL (rejected), 1 weaker (timing "at diagnosis").

### Limitations
Single runs; extractor/verifier variance; one fictional profile (so verified mismatches are mostly "metastatic vs early-stage trial"); agent labels not clinician review; the fresh cohort is the same query/time frame and was not re-fetched; no verifier accuracy measured against labelled data; the judge verdicts on the fresh cohort were not hand-reviewed; UI not started.

## 2026-10-06T03:41Z — Checks after rule D / splitter / guards (run locally by the agent; no CI exists)

| Command | Exit |
|---|---|
| `pnpm lint` | 0 |
| `pnpm typecheck` | 0 |
| `pnpm test` (167 tests, 10 files) | 0 |
| `pnpm build` (only NEBIUS_* set) | 0 |

### Correction (Kumar's review, 2026-10-06): status of the "fresh" cohort and of the "7/7 true" statement
- The fresh cohort exposed an engine bug (`metastatic_line`) and was audited and re-run, so it is **development data from now on**. No accuracy figure may be quoted from it. Any accuracy claim needs **another untouched cohort**.
- **Protocol for the untouched cohort (pre-registered, not yet fetched):** same CT.gov query and filter, pages 5–8 of the result list, excluding every NCT id in the original and fresh fixtures, every k-th trial to 30, fetched only when the configuration is frozen; run once with the frozen config (no prompt, cue, splitter or engine edits in between); report coverage and mismatch counts with the same definitions; labels must be by a reviewer who did not tune the system.
- The statement "7 of 7 verified mismatches are true" is a **manual assessment by the agent** against one fictional profile, **not measured verifier accuracy**. Likewise the "9/10, 13/14 true mismatches" and recall figures are agent labels on development data.
- **Not pursued (Kumar's decision):** four-trial verifier batching and raising `MAX_LLM_CALLS_PER_RUN` on the strength of the capacity projections. Rule D and the 80-call cap stay; capacity overflow remains UNCERTAIN. The projections above are retained as measurements only.

## 2026-10-06T04:12:45.674Z — 04c-coverage-clauses (original cohort; clause representation; splitter + atom-semantics guards active)

- Command: `pnpm spike:coverage2` (COVERAGE_CHUNK=15, COVERAGE_REASONING=low, max_tokens 8192; judge reasoning default ON). Parser MID `nvidia/nemotron-3-super-120b-a12b`, prompt `spike-4`, json_schema mode, 46 batch calls; judge DEEP `nvidia/Nemotron-3-Ultra-550b-a55b` on code-evaluable criteria only.
- Batch validation (index set exact + every leaf source is a verbatim fragment): first-attempt valid 38/46; valid after the one retry 6; **rejected after retry 2** (all their criteria → UNRESOLVED → UNKNOWN; last-attempt reasons: missing indices×1, leaf source not verbatim×1); truncated outputs 0; judge batches failed 0.
- Tokens (parse): prompt 112005, completion 83103; parse wall 87919 ms at concurrency 6; total HTTP calls 67/400.
- Denominator: 431 bullet-level criteria in the fixed cohort (30 trials; regex split). Parsed 407, **unresolved 24** (kept as UNKNOWN scoring criteria). Non-scoring (category consent_logistics, derived in code): 53; scoring denominator = 378 (non-consent parsed + all unresolved).
- Definitions: **code-evaluable** = every leaf is an atom whose operator/value/unit are valid and convertible in code (no text/timing leaves) · **reviewed full-logic (headline)** = code-evaluable AND the independent DEEP judge says the clause captures the entire criterion · **partial-typed** = ≥1 atom leaf but not fully executable (text/timing remain on the free-text path).

| Stratum (scoring, unresolved included) | n | unresolved | code-evaluable | reviewed full-logic (headline) | ≥1 atom (partial-typed) |
|---|---|---|---|---|---|
| all scoring (incl. unresolved) | 378 | 24/378 (6.3%) | 21/378 (5.6%) | 17/378 (4.5%) | 24/378 (6.3%) |
| inclusion | 187 | 12/187 (6.4%) | 19/187 (10.2%) | 16/187 (8.6%) | 22/187 (11.8%) |
| exclusion | 191 | 12/191 (6.3%) | 2/191 (1%) | 1/191 (0.5%) | 2/191 (1%) |
| simple wording (heuristic) | 220 | 13/220 (5.9%) | 19/220 (8.6%) | 16/220 (7.3%) | 21/220 (9.5%) |
| compound wording (heuristic) | 158 | 11/158 (7%) | 2/158 (1.3%) | 1/158 (0.6%) | 3/158 (1.9%) |

**Gate (reviewed full-logic over all scoring incl. unresolved): 17/378 (4.5%) → STOP AND REASSESS (<40%).** Schedule gate only; not an accuracy or safety claim. The earlier 5.7% used a different denominator (parser-scoring only, 20 missing excluded) and a single-fact representation, so it is not directly comparable.
- Judge on 21 code-evaluable criteria: full 17, partial 2, wrong 2, unjudged 0.
- Vocabulary-touch proxy (any leaf touches a vocabulary key, parsed criteria): 40/378 (10.6%). **Unvalidated proxy, not a typed rate.**
- Coverage/scope vetting of parsed criteria (no tuned percentage; any omitted substantive logic fails): ok×353, coverage_failed×43, atoms_downgraded×11. coverage_failed ⇒ whole criterion became one text leaf (UNKNOWN).
- Leaf kinds across parsed criteria: text×400, atom×32, timing×3.

## 2026-10-06T04:14:34.324Z — 04c-coverage-clauses (fresh cohort; clause representation; splitter + atom-semantics guards active)

- Command: `pnpm spike:coverage2` (COVERAGE_CHUNK=15, COVERAGE_REASONING=low, max_tokens 8192; judge reasoning default ON). Parser MID `nvidia/nemotron-3-super-120b-a12b`, prompt `spike-4`, json_schema mode, 46 batch calls; judge DEEP `nvidia/Nemotron-3-Ultra-550b-a55b` on code-evaluable criteria only.
- Batch validation (index set exact + every leaf source is a verbatim fragment): first-attempt valid 37/46; valid after the one retry 7; **rejected after retry 2** (all their criteria → UNRESOLVED → UNKNOWN; last-attempt reasons: leaf source not verbatim×2); truncated outputs 0; judge batches failed 0.
- Tokens (parse): prompt 116701, completion 95753; parse wall 97234 ms at concurrency 6; total HTTP calls 64/400.
- Denominator: 487 bullet-level criteria in the fixed cohort (30 trials; regex split). Parsed 465, **unresolved 22** (kept as UNKNOWN scoring criteria). Non-scoring (category consent_logistics, derived in code): 56; scoring denominator = 431 (non-consent parsed + all unresolved).
- Definitions: **code-evaluable** = every leaf is an atom whose operator/value/unit are valid and convertible in code (no text/timing leaves) · **reviewed full-logic (headline)** = code-evaluable AND the independent DEEP judge says the clause captures the entire criterion · **partial-typed** = ≥1 atom leaf but not fully executable (text/timing remain on the free-text path).

| Stratum (scoring, unresolved included) | n | unresolved | code-evaluable | reviewed full-logic (headline) | ≥1 atom (partial-typed) |
|---|---|---|---|---|---|
| all scoring (incl. unresolved) | 431 | 22/431 (5.1%) | 25/431 (5.8%) | 16/431 (3.7%) | 43/431 (10%) |
| inclusion | 213 | 2/213 (0.9%) | 20/213 (9.4%) | 14/213 (6.6%) | 37/213 (17.4%) |
| exclusion | 218 | 20/218 (9.2%) | 5/218 (2.3%) | 2/218 (0.9%) | 6/218 (2.8%) |
| simple wording (heuristic) | 263 | 9/263 (3.4%) | 21/263 (8%) | 13/263 (4.9%) | 36/263 (13.7%) |
| compound wording (heuristic) | 168 | 13/168 (7.7%) | 4/168 (2.4%) | 3/168 (1.8%) | 7/168 (4.2%) |

**Gate (reviewed full-logic over all scoring incl. unresolved): 16/431 (3.7%) → STOP AND REASSESS (<40%).** Schedule gate only; not an accuracy or safety claim. The earlier 5.7% used a different denominator (parser-scoring only, 20 missing excluded) and a single-fact representation, so it is not directly comparable.
- Judge on 25 code-evaluable criteria: full 16, partial 4, wrong 5, unjudged 0.
- Vocabulary-touch proxy (any leaf touches a vocabulary key, parsed criteria): 54/431 (12.5%). **Unvalidated proxy, not a typed rate.**
- Coverage/scope vetting of parsed criteria (no tuned percentage; any omitted substantive logic fails): ok×418, coverage_failed×35, atoms_downgraded×12. coverage_failed ⇒ whole criterion became one text leaf (UNKNOWN).
- Leaf kinds across parsed criteria: text×446, atom×50, timing×4.

## 2026-10-06T04:17:27.518Z — 04c-coverage-clauses (original cohort; clause representation; splitter + atom-semantics guards active)

- Command: `pnpm spike:coverage2` (COVERAGE_CHUNK=15, COVERAGE_REASONING=low, max_tokens 8192; judge reasoning default ON). Parser MID `nvidia/nemotron-3-super-120b-a12b`, prompt `spike-4`, json_schema mode, 46 batch calls; judge DEEP `nvidia/Nemotron-3-Ultra-550b-a55b` on code-evaluable criteria only.
- Batch validation (index set exact + every leaf source is a verbatim fragment): first-attempt valid 40/46; valid after the one retry 6; **rejected after retry 0** (all their criteria → UNRESOLVED → UNKNOWN; last-attempt reasons: n/a); truncated outputs 0; judge batches failed 0.
- Tokens (parse): prompt 104992, completion 81630; parse wall 89255 ms at concurrency 6; total HTTP calls 64/400.
- Denominator: 431 bullet-level criteria in the fixed cohort (30 trials; regex split). Parsed 431, **unresolved 0** (kept as UNKNOWN scoring criteria). Non-scoring (category consent_logistics, derived in code): 55; scoring denominator = 376 (non-consent parsed + all unresolved).
- Definitions: **code-evaluable** = every leaf is an atom whose operator/value/unit are valid and convertible in code (no text/timing leaves) · **reviewed full-logic (headline)** = code-evaluable AND the independent DEEP judge says the clause captures the entire criterion · **partial-typed** = ≥1 atom leaf but not fully executable (text/timing remain on the free-text path).

| Stratum (scoring, unresolved included) | n | unresolved | code-evaluable | reviewed full-logic (headline) | ≥1 atom (partial-typed) |
|---|---|---|---|---|---|
| all scoring (incl. unresolved) | 376 | 0/376 (0%) | 16/376 (4.3%) | 14/376 (3.7%) | 24/376 (6.4%) |
| inclusion | 186 | 0/186 (0%) | 16/186 (8.6%) | 14/186 (7.5%) | 23/186 (12.4%) |
| exclusion | 190 | 0/190 (0%) | 0/190 (0%) | 0/190 (0%) | 1/190 (0.5%) |
| simple wording (heuristic) | 220 | 0/220 (0%) | 12/220 (5.5%) | 12/220 (5.5%) | 19/220 (8.6%) |
| compound wording (heuristic) | 156 | 0/156 (0%) | 4/156 (2.6%) | 2/156 (1.3%) | 5/156 (3.2%) |

**Gate (reviewed full-logic over all scoring incl. unresolved): 14/376 (3.7%) → STOP AND REASSESS (<40%).** Schedule gate only; not an accuracy or safety claim. The earlier 5.7% used a different denominator (parser-scoring only, 20 missing excluded) and a single-fact representation, so it is not directly comparable.
- Judge on 17 code-evaluable criteria: full 15, partial 1, wrong 1, unjudged 0.
- Vocabulary-touch proxy (any leaf touches a vocabulary key, parsed criteria): 44/376 (11.7%). **Unvalidated proxy, not a typed rate.**
- Coverage/scope vetting of parsed criteria (no tuned percentage; any omitted substantive logic fails): ok×368, coverage_failed×51, atoms_downgraded×12. coverage_failed ⇒ whole criterion became one text leaf (UNKNOWN).
- Leaf kinds across parsed criteria: text×426, atom×40, timing×2.

## 2026-10-06T04:19:16.716Z — 04c-coverage-clauses (fresh cohort; clause representation; splitter + atom-semantics guards active)

- Command: `pnpm spike:coverage2` (COVERAGE_CHUNK=15, COVERAGE_REASONING=low, max_tokens 8192; judge reasoning default ON). Parser MID `nvidia/nemotron-3-super-120b-a12b`, prompt `spike-4`, json_schema mode, 46 batch calls; judge DEEP `nvidia/Nemotron-3-Ultra-550b-a55b` on code-evaluable criteria only.
- Batch validation (index set exact + every leaf source is a verbatim fragment): first-attempt valid 33/46; valid after the one retry 11; **rejected after retry 2** (all their criteria → UNRESOLVED → UNKNOWN; last-attempt reasons: leaf source not verbatim×2); truncated outputs 0; judge batches failed 0.
- Tokens (parse): prompt 129033, completion 100645; parse wall 103143 ms at concurrency 6; total HTTP calls 69/400.
- Denominator: 487 bullet-level criteria in the fixed cohort (30 trials; regex split). Parsed 465, **unresolved 22** (kept as UNKNOWN scoring criteria). Non-scoring (category consent_logistics, derived in code): 49; scoring denominator = 438 (non-consent parsed + all unresolved).
- Definitions: **code-evaluable** = every leaf is an atom whose operator/value/unit are valid and convertible in code (no text/timing leaves) · **reviewed full-logic (headline)** = code-evaluable AND the independent DEEP judge says the clause captures the entire criterion · **partial-typed** = ≥1 atom leaf but not fully executable (text/timing remain on the free-text path).

| Stratum (scoring, unresolved included) | n | unresolved | code-evaluable | reviewed full-logic (headline) | ≥1 atom (partial-typed) |
|---|---|---|---|---|---|
| all scoring (incl. unresolved) | 438 | 22/438 (5%) | 15/438 (3.4%) | 13/438 (3%) | 25/438 (5.7%) |
| inclusion | 216 | 2/216 (0.9%) | 14/216 (6.5%) | 13/216 (6%) | 23/216 (10.6%) |
| exclusion | 222 | 20/222 (9%) | 1/222 (0.5%) | 0/222 (0%) | 2/222 (0.9%) |
| simple wording (heuristic) | 269 | 9/269 (3.3%) | 14/269 (5.2%) | 12/269 (4.5%) | 22/269 (8.2%) |
| compound wording (heuristic) | 169 | 13/169 (7.7%) | 1/169 (0.6%) | 1/169 (0.6%) | 3/169 (1.8%) |

**Gate (reviewed full-logic over all scoring incl. unresolved): 13/438 (3%) → STOP AND REASSESS (<40%).** Schedule gate only; not an accuracy or safety claim. The earlier 5.7% used a different denominator (parser-scoring only, 20 missing excluded) and a single-fact representation, so it is not directly comparable.
- Judge on 15 code-evaluable criteria: full 13, partial 2, wrong 0, unjudged 0.
- Vocabulary-touch proxy (any leaf touches a vocabulary key, parsed criteria): 45/438 (10.3%). **Unvalidated proxy, not a typed rate.**
- Coverage/scope vetting of parsed criteria (no tuned percentage; any omitted substantive logic fails): ok×408, coverage_failed×36, atoms_downgraded×21. coverage_failed ⇒ whole criterion became one text leaf (UNKNOWN).
- Leaf kinds across parsed criteria: text×459, atom×26, timing×6.

## 2026-10-06T04:22:32.094Z — 04c-coverage-clauses (original cohort; clause representation; splitter + atom-semantics guards + coverage checks cov-1 active)

- Command: `pnpm spike:coverage2` (COVERAGE_CHUNK=15, COVERAGE_REASONING=low, max_tokens 8192; judge reasoning default ON). Parser MID `nvidia/nemotron-3-super-120b-a12b`, prompt `spike-4`, json_schema mode, 46 batch calls; judge DEEP `nvidia/Nemotron-3-Ultra-550b-a55b` on code-evaluable criteria only.
- Batch validation (index set exact + every leaf source is a verbatim fragment): first-attempt valid 41/46; valid after the one retry 4; **rejected after retry 1** (all their criteria → UNRESOLVED → UNKNOWN; last-attempt reasons: leaf source not verbatim×1); truncated outputs 0; judge batches failed 0.
- Tokens (parse): prompt 102562, completion 81566; parse wall 82528 ms at concurrency 6; total HTTP calls 55/400.
- Denominator: 431 bullet-level criteria in the fixed cohort (30 trials; regex split). Parsed 416, **unresolved 15** (kept as UNKNOWN scoring criteria). Non-scoring (category consent_logistics, derived in code): 47; scoring denominator = 384 (non-consent parsed + all unresolved).
- Definitions: **code-evaluable** = every leaf is an atom whose operator/value/unit are valid and convertible in code (no text/timing leaves) · **reviewed full-logic (headline)** = code-evaluable AND the independent DEEP judge says the clause captures the entire criterion · **partial-typed** = ≥1 atom leaf but not fully executable (text/timing remain on the free-text path).

| Stratum (scoring, unresolved included) | n | unresolved | code-evaluable | reviewed full-logic (headline) | ≥1 atom (partial-typed) |
|---|---|---|---|---|---|
| all scoring (incl. unresolved) | 384 | 15/384 (3.9%) | 4/384 (1%) | 4/384 (1%) | 9/384 (2.3%) |
| inclusion | 189 | 15/189 (7.9%) | 4/189 (2.1%) | 4/189 (2.1%) | 9/189 (4.8%) |
| exclusion | 195 | 0/195 (0%) | 0/195 (0%) | 0/195 (0%) | 0/195 (0%) |
| simple wording (heuristic) | 222 | 11/222 (5%) | 3/222 (1.4%) | 3/222 (1.4%) | 8/222 (3.6%) |
| compound wording (heuristic) | 162 | 4/162 (2.5%) | 1/162 (0.6%) | 1/162 (0.6%) | 1/162 (0.6%) |

**Gate (reviewed full-logic over all scoring incl. unresolved): 4/384 (1%) → STOP AND REASSESS (<40%).** Schedule gate only; not an accuracy or safety claim. The earlier 5.7% used a different denominator (parser-scoring only, 20 missing excluded) and a single-fact representation, so it is not directly comparable.
- Judge on 4 code-evaluable criteria: full 4, partial 0, wrong 0, unjudged 0.
- Vocabulary-touch proxy (any leaf touches a vocabulary key, parsed criteria): 24/384 (6.3%). **Unvalidated proxy, not a typed rate.**
- Coverage/scope vetting of parsed criteria (no tuned percentage; any omitted substantive logic fails): ok×350, coverage_failed×47, atoms_downgraded×19. coverage_failed ⇒ whole criterion became one text leaf (UNKNOWN).
- Leaf kinds across parsed criteria: text×440, timing×1, atom×12.

## 2026-10-06T04:24:15.380Z — 04c-coverage-clauses (fresh cohort; clause representation; splitter + atom-semantics guards + coverage checks cov-1 active)

- Command: `pnpm spike:coverage2` (COVERAGE_CHUNK=15, COVERAGE_REASONING=low, max_tokens 8192; judge reasoning default ON). Parser MID `nvidia/nemotron-3-super-120b-a12b`, prompt `spike-4`, json_schema mode, 46 batch calls; judge DEEP `nvidia/Nemotron-3-Ultra-550b-a55b` on code-evaluable criteria only.
- Batch validation (index set exact + every leaf source is a verbatim fragment): first-attempt valid 34/46; valid after the one retry 10; **rejected after retry 2** (all their criteria → UNRESOLVED → UNKNOWN; last-attempt reasons: leaf source not verbatim×2); truncated outputs 0; judge batches failed 0.
- Tokens (parse): prompt 126015, completion 102183; parse wall 99428 ms at concurrency 6; total HTTP calls 63/400.
- Denominator: 487 bullet-level criteria in the fixed cohort (30 trials; regex split). Parsed 457, **unresolved 30** (kept as UNKNOWN scoring criteria). Non-scoring (category consent_logistics, derived in code): 52; scoring denominator = 435 (non-consent parsed + all unresolved).
- Definitions: **code-evaluable** = every leaf is an atom whose operator/value/unit are valid and convertible in code (no text/timing leaves) · **reviewed full-logic (headline)** = code-evaluable AND the independent DEEP judge says the clause captures the entire criterion · **partial-typed** = ≥1 atom leaf but not fully executable (text/timing remain on the free-text path).

| Stratum (scoring, unresolved included) | n | unresolved | code-evaluable | reviewed full-logic (headline) | ≥1 atom (partial-typed) |
|---|---|---|---|---|---|
| all scoring (incl. unresolved) | 435 | 30/435 (6.9%) | 7/435 (1.6%) | 7/435 (1.6%) | 13/435 (3%) |
| inclusion | 217 | 14/217 (6.5%) | 6/217 (2.8%) | 6/217 (2.8%) | 12/217 (5.5%) |
| exclusion | 218 | 16/218 (7.3%) | 1/218 (0.5%) | 1/218 (0.5%) | 1/218 (0.5%) |
| simple wording (heuristic) | 266 | 19/266 (7.1%) | 6/266 (2.3%) | 6/266 (2.3%) | 12/266 (4.5%) |
| compound wording (heuristic) | 169 | 11/169 (6.5%) | 1/169 (0.6%) | 1/169 (0.6%) | 1/169 (0.6%) |

**Gate (reviewed full-logic over all scoring incl. unresolved): 7/435 (1.6%) → STOP AND REASSESS (<40%).** Schedule gate only; not an accuracy or safety claim. The earlier 5.7% used a different denominator (parser-scoring only, 20 missing excluded) and a single-fact representation, so it is not directly comparable.
- Judge on 7 code-evaluable criteria: full 7, partial 0, wrong 0, unjudged 0.
- Vocabulary-touch proxy (any leaf touches a vocabulary key, parsed criteria): 54/435 (12.4%). **Unvalidated proxy, not a typed rate.**
- Coverage/scope vetting of parsed criteria (no tuned percentage; any omitted substantive logic fails): ok×399, coverage_failed×24, atoms_downgraded×34. coverage_failed ⇒ whole criterion became one text leaf (UNKNOWN).
- Leaf kinds across parsed criteria: text×469, timing×6, atom×18.

## 2026-10-06T04:25Z — Conditional blocks, coverage/scope vetting, adversarial cases: results and FREEZE

**Process.** Per Kumar's review: adversarial regression cases were written BEFORE the implementation (`coverage.test.ts`, `blocks.test.ts`), then the schema, engine, guard, prompt (`spike-4`) and checks (`cov-1`) were implemented. Rule D and the 80-call cap are unchanged; tier logic is unchanged.

**Exploits found by deliberately attacking the first design (each is now a test):** negation isolated in its own text leaf ("No" + an atom) tiles the sentence but yields a false FAIL for a patient with no chemotherapy; negation split from what it governs; a leaf made only of logic words; receptor polarity inverted; a `false`/`neq` assertion that only negation could justify; a qualifier hidden inside an atom's source ("of childbearing potential" inside `sex = female`). From the development cohorts' judge-"wrong" parses: no relational marker for the operator (`eq 100` from "Platelets - 100 …"), a hallucinated unit (`g/dL` for a 10⁹/L source), "over 18" parsed as ≥, "within 28 days" parsed as ≥ 28, an unmodelled relative clause. All closed deterministically.

**Development-cohort coverage (both cohorts are DEVELOPMENT data; same CT.gov cohorts as before; reasoning=low, chunk 15; denominators include unresolved parses):**

| Configuration | Original: reviewed full-logic | Fresh: reviewed full-logic | Judge "wrong" (orig / fresh) | coverage_failed (orig / fresh) |
|---|---|---|---|---|
| Before this round (`spike-3`, no vetting) | 6.5% (25/385) | 8.7% (38/436) | 6 / 3 | n/a |
| `spike-4` blocks + coverage vetting | 4.5% (17/378) | 3.7% (16/431) | 2 / 5 | 43 / 35 |
| + operator, unit, modal/relative checks | 3.7% (14/376) | 3.0% (13/438) | 1 / 0 | 51 / 36 |
| **FROZEN: + atom purity (`cov-1`)** | **1.0% (4/384)** | **1.6% (7/435)** | 0 / 0 (judge full 4/4, 7/7) | 47 / 24 |

Frozen run detail: original: unresolved 15 (3.9%), code-evaluable 4, ≥1 atom 9 (2.3%), vet ok 350 / coverage_failed 47 / atoms_downgraded 19, leaf kinds text 440 / atom 12 / timing 1, criteria with a conditional block 6. Fresh: unresolved 30 (6.9%; 2 rejected batches), code-evaluable 7, ≥1 atom 13 (3%), vet ok 399 / coverage_failed 24 / atoms_downgraded 34, text 469 / atom 18 / timing 6, conditional blocks 4. Exclusion criteria are ~0% typed (they are negation-heavy, and an asserted negation is never provable). The unresolved count varies run to run (batch rejections).

**Reading.** Soundness-first checking removed essentially every executable parse that the judge or my reading found unsound, at the price of nearly all typed coverage: with a 35-key vocabulary, almost every real criterion carries a qualifier, negation, threshold or timing the vocabulary cannot represent, so it correctly falls to the free-text path. **Typed code evaluation is now ~1–2% of criteria**; the product's value rests on the free-text path (LLM evaluation + rule-D verification), not on typed facts. This bears directly on the adaptive-question demo scope (only a handful of criteria reference askable typed facts). Real parses now produce the audited conditional shapes as blocks: the pregnancy-test bullet becomes two blocks with the 7-day timing and the contraception requirement preserved (52 F, `pregnant=false` ⇒ block 1 `not_applicable` via the stated age band, block 2 unknown ⇒ **UNKNOWN**), and the anti-HER2 bullet is no longer a false FAIL (UNKNOWN here because its `when` was parsed as text; a HER2-negative patient would only be PASS if the `when` were an atom).

**FROZEN (before any untouched-cohort measurement):** parser prompt `spike-4`; coverage/scope checks `cov-1`; section splitter; atom-semantics guards; rule D; tier logic; 80-call cap. No further change without bumping the version and treating the result as development data. The untouched-cohort protocol above applies (pages 5–8, excluding all used ids, run once).

**Not re-measured this round:** the end-to-end run and mismatch audit (they were last run with `spike-3`); the untouched cohort (not fetched); verifier accuracy; UI (design export not yet attached).

## 2026-10-06T05:05:05.574Z — 07-e2e (original cohort; fictional profile; clause prompt `spike-4`, fail-verify `fail-verify-0`; reasoning_effort=low; rule D active; command `COHORT=original pnpm spike:e2e`)

- Plan: `RunBudget(80)`: each LLM slot reserves 2 calls (call + its one retry) ⇒ 40 slots; reserved: extraction 1, verify 8, **mismatch checks 3 (reassigned from the unbuilt escalation stage)**; parse capped at 14 slots; evaluate takes shared slots; unused verify reserve flows to mismatch checks. Hard `CallCap(80)` throws if exceeded (it did not).
- Profile: fictional; extractor produced 14 known facts (cold) / 14 (warm). Prefilter by age/sex over the 30-trial original fixture ⇒ 29 candidates.

| Run | candidates | parse cache hit/miss | HTTP calls used | slots | calls extraction/parse/evaluate/verify/mismatch | wall ms |
|---|---|---|---|---|---|---|
| cold (empty parse cache) | 29 | 0/29 | 35 (≤80) | 35 slots → worst case 70 | 1/14/14/4/2 | 71936 |
| warm (parse cache filled) | 29 | 28/1 | 41 (≤80) | 40 slots → worst case 80 | 1/4/25/5/6 | 62467 |

| Run | extraction | parse | free-text evaluate | verify (STRONG/POSSIBLE) | FAIL checks |
|---|---|---|---|---|---|
| cold | 36399 ms (1 slots, 0 retries, 0×429, 0 failed) | 20908 ms (14 slots, 0 retries, 0×429, 0 failed) | 9236 ms (14 slots, 0 retries, 0×429, 0 failed) | 2460 ms (4 slots, 0 retries, 0×429, 0 failed) | 2920 ms (2 slots, 0 retries, 0×429, 0 failed) |
| warm | 24815 ms (1 slots, 0 retries, 0×429, 0 failed) | 16067 ms (3 slots, 1 retries, 0×429, 1 failed [ZOD_INVALID_AFTER_RETRY×1]) | 16789 ms (25 slots, 0 retries, 0×429, 0 failed) | 2372 ms (5 slots, 0 retries, 0×429, 0 failed) | 2420 ms (6 slots, 0 retries, 0×429, 0 failed) |

| Run | tiers after typed-only (code; unchecked FAIL ⇒ UNCERTAIN) | after free-text eval | final | trials with unresolved criteria | guard downgrades | verification | eval slot overflow |
|---|---|---|---|---|---|---|---|
| cold | {"STRONG":0,"POSSIBLE":4,"UNCERTAIN":25,"LIKELY_MISMATCH":0} | {"STRONG":0,"POSSIBLE":4,"UNCERTAIN":25,"LIKELY_MISMATCH":0} | {"STRONG":0,"POSSIBLE":4,"UNCERTAIN":23,"LIKELY_MISMATCH":2} | 15 | 1 | 4 verified, 0 disagreements, 0 unverified→UNCERTAIN | 0 |
| warm | {"STRONG":0,"POSSIBLE":5,"UNCERTAIN":24,"LIKELY_MISMATCH":0} | {"STRONG":0,"POSSIBLE":5,"UNCERTAIN":24,"LIKELY_MISMATCH":0} | {"STRONG":0,"POSSIBLE":4,"UNCERTAIN":19,"LIKELY_MISMATCH":6} | 1 | 2 | 5 verified, 1 disagreements, 0 unverified→UNCERTAIN | 4 |

| Run | trials with ≥1 FAIL (candidates) | FAILs verified | rejected | unsubstantiated | no capacity | not run | final LIKELY_MISMATCH |
|---|---|---|---|---|---|---|---|
| cold | 2 trials / 3 FAIL findings | 3 | 0 | 0 | 0 | 0 | 2 |
| warm | 8 trials / 14 FAIL findings | 9 | 0 | 0 | 5 | 0 | 6 |

- Criteria in the 29 candidates (warm): 426; parse completeness full 5 / partial 406 / unresolved 15; findings decided PASS/FAIL after eval+guard+checks: 66.
- Offline pre-parse of the cohort: 34 HTTP calls (chunks of 15 + retries), 52889 ms at concurrency 6; cache entries written 28/29. Cache is in-memory in this spike (VERIFY: Supabase `trial_criteria_cache` persistence in Phase 2).

## 2026-10-06T05:09:39.222Z — 07-e2e (fresh cohort; fictional profile; clause prompt `spike-4`, fail-verify `fail-verify-0`; reasoning_effort=low; rule D active; command `COHORT=fresh pnpm spike:e2e`)

- Plan: `RunBudget(80)`: each LLM slot reserves 2 calls (call + its one retry) ⇒ 40 slots; reserved: extraction 1, verify 8, **mismatch checks 3 (reassigned from the unbuilt escalation stage)**; parse capped at 14 slots; evaluate takes shared slots; unused verify reserve flows to mismatch checks. Hard `CallCap(80)` throws if exceeded (it did not).
- Profile: fictional; extractor produced 14 known facts (cold) / 14 (warm). Prefilter by age/sex over the 30-trial fresh fixture ⇒ 30 candidates.

| Run | candidates | parse cache hit/miss | HTTP calls used | slots | calls extraction/parse/evaluate/verify/mismatch | wall ms |
|---|---|---|---|---|---|---|
| cold (empty parse cache) | 30 | 0/30 | 36 (≤80) | 33 slots → worst case 66 | 1/17/12/3/3 | 63521 |
| warm (parse cache filled) | 30 | 25/5 | 46 (≤80) | 40 slots → worst case 80 | 1/19/15/6/5 | 77260 |

| Run | extraction | parse | free-text evaluate | verify (STRONG/POSSIBLE) | FAIL checks |
|---|---|---|---|---|---|
| cold | 29741 ms (1 slots, 0 retries, 0×429, 0 failed) | 22754 ms (14 slots, 3 retries, 0×429, 2 failed [ZOD_INVALID_AFTER_RETRY×2]) | 7061 ms (12 slots, 0 retries, 0×429, 0 failed) | 2023 ms (3 slots, 0 retries, 0×429, 0 failed) | 1931 ms (3 slots, 0 retries, 0×429, 0 failed) |
| warm | 20610 ms (1 slots, 0 retries, 0×429, 0 failed) | 41270 ms (13 slots, 6 retries, 0×429, 4 failed [ZOD_INVALID_AFTER_RETRY×4]) | 9679 ms (15 slots, 0 retries, 0×429, 0 failed) | 2243 ms (6 slots, 0 retries, 0×429, 0 failed) | 3452 ms (5 slots, 0 retries, 0×429, 0 failed) |

| Run | tiers after typed-only (code; unchecked FAIL ⇒ UNCERTAIN) | after free-text eval | final | trials with unresolved criteria | guard downgrades | verification | eval slot overflow |
|---|---|---|---|---|---|---|---|
| cold | {"STRONG":0,"POSSIBLE":3,"UNCERTAIN":27,"LIKELY_MISMATCH":0} | {"STRONG":0,"POSSIBLE":3,"UNCERTAIN":27,"LIKELY_MISMATCH":0} | {"STRONG":0,"POSSIBLE":3,"UNCERTAIN":24,"LIKELY_MISMATCH":3} | 18 | 1 | 3 verified, 0 disagreements, 0 unverified→UNCERTAIN | 0 |
| warm | {"STRONG":0,"POSSIBLE":6,"UNCERTAIN":24,"LIKELY_MISMATCH":0} | {"STRONG":0,"POSSIBLE":6,"UNCERTAIN":24,"LIKELY_MISMATCH":0} | {"STRONG":0,"POSSIBLE":3,"UNCERTAIN":23,"LIKELY_MISMATCH":4} | 3 | 5 | 6 verified, 3 disagreements, 0 unverified→UNCERTAIN | 15 |

| Run | trials with ≥1 FAIL (candidates) | FAILs verified | rejected | unsubstantiated | no capacity | not run | final LIKELY_MISMATCH |
|---|---|---|---|---|---|---|---|
| cold | 3 trials / 5 FAIL findings | 5 | 0 | 0 | 0 | 0 | 3 |
| warm | 6 trials / 12 FAIL findings | 6 | 0 | 2 | 4 | 0 | 4 |

- Criteria in the 30 candidates (warm): 487; parse completeness full 8 / partial 419 / unresolved 60; findings decided PASS/FAIL after eval+guard+checks: 40.
- Offline pre-parse of the cohort: 47 HTTP calls (chunks of 15 + retries), 71981 ms at concurrency 6; cache entries written 27/30. Cache is in-memory in this spike (VERIFY: Supabase `trial_criteria_cache` persistence in Phase 2).

## 2026-10-06T05:10:17.729Z — 03-ctgov (untouched cohort)

- Endpoint: `GET https://clinicaltrials.gov/api/v2/studies` with `query.cond=breast cancer`, `filter.overallStatus=RECRUITING`, `pageSize=60`, `fields=...`. HTTP 200, no key.
- Page returned 240 studies (nextPageToken present); 240 had eligibility text; sample = 30 (every 8th).
- Rate-limit headers observed: none (VERIFY documented limit: ~50 req/min/IP per CT.gov docs)
- Zod validation of response: passed (fields tolerated as optional).
- Field presence over sample: eligibility text 30/30 (100%); minimumAge 29/30 (97%); maximumAge 9/30 (30%); sex 30/30 (100%); lastUpdatePostDate 30/30 (100%)
- Sites: 384 total across sample; with geoPoint 376/384 (98%); trials where every site has geo 25/30 (83%); site-level status field present on 30/30 (100%) trials (≥1 RECRUITING site).
- Heuristic criterion split: 662 bullet-level criteria (363 inclusion / 299 exclusion); median length 101 chars. The splitter is a regex heuristic, not a parser; mis-splits are not measured here.
- Raw fixture is gitignored (`eval/spike/fixtures/`), regenerate with `pnpm spike:ctgov`. VERIFY: CT.gov terms of use on redistributing submitter text before ever committing it.


> **VOID: not a measurement.** Every LLM call failed with HTTP 422 (1 extraction + 14 parse, cold and warm); 0 known facts, 0 criteria parsed. Cause: `NEMOTRON_MODEL_FAST|MID|DEEP` were unset in the shell (model IDs come only from env), not a defect in the frozen config (`spike-4`/`cov-1`). No model output was produced or inspected, so the untouched cohort (30 ids, fixed by the pre-registered rule) is not yet exposed to any result. The untouched measurement is still to be run once, after the env is restored.

## 2026-10-06T05:10:26.298Z — 07-e2e (untouched cohort; fictional profile; clause prompt `spike-4`, fail-verify `fail-verify-0`; reasoning_effort=low; rule D active; command `COHORT=untouched pnpm spike:e2e`)

- Plan: `RunBudget(80)`: each LLM slot reserves 2 calls (call + its one retry) ⇒ 40 slots; reserved: extraction 1, verify 8, **mismatch checks 3 (reassigned from the unbuilt escalation stage)**; parse capped at 14 slots; evaluate takes shared slots; unused verify reserve flows to mismatch checks. Hard `CallCap(80)` throws if exceeded (it did not).
- Profile: fictional; extractor produced 0 known facts (cold) / 0 (warm). Prefilter by age/sex over the 30-trial untouched fixture ⇒ 30 candidates.

| Run | candidates | parse cache hit/miss | HTTP calls used | slots | calls extraction/parse/evaluate/verify/mismatch | wall ms |
|---|---|---|---|---|---|---|
| cold (empty parse cache) | 30 | 0/30 | 15 (≤80) | 15 slots → worst case 30 | 1/14/0/0/0 | 1706 |
| warm (parse cache filled) | 30 | 0/30 | 15 (≤80) | 15 slots → worst case 30 | 1/14/0/0/0 | 594 |

| Run | extraction | parse | free-text evaluate | verify (STRONG/POSSIBLE) | FAIL checks |
|---|---|---|---|---|---|
| cold | 643 ms (1 slots, 0 retries, 0×429, 1 failed [HTTP_422×1]) | 1052 ms (14 slots, 0 retries, 0×429, 14 failed [HTTP_422×14]) | 0 ms (0 slots, 0 retries, 0×429, 0 failed) | 0 ms (0 slots, 0 retries, 0×429, 0 failed) | 0 ms (0 slots, 0 retries, 0×429, 0 failed) |
| warm | 122 ms (1 slots, 0 retries, 0×429, 1 failed [HTTP_422×1]) | 469 ms (14 slots, 0 retries, 0×429, 14 failed [HTTP_422×14]) | 0 ms (0 slots, 0 retries, 0×429, 0 failed) | 0 ms (0 slots, 0 retries, 0×429, 0 failed) | 0 ms (0 slots, 0 retries, 0×429, 0 failed) |

| Run | tiers after typed-only (code; unchecked FAIL ⇒ UNCERTAIN) | after free-text eval | final | trials with unresolved criteria | guard downgrades | verification | eval slot overflow |
|---|---|---|---|---|---|---|---|
| cold | {"STRONG":0,"POSSIBLE":0,"UNCERTAIN":30,"LIKELY_MISMATCH":0} | {"STRONG":0,"POSSIBLE":0,"UNCERTAIN":30,"LIKELY_MISMATCH":0} | {"STRONG":0,"POSSIBLE":0,"UNCERTAIN":30,"LIKELY_MISMATCH":0} | 30 | 0 | 0 verified, 0 disagreements, 0 unverified→UNCERTAIN | 0 |
| warm | {"STRONG":0,"POSSIBLE":0,"UNCERTAIN":30,"LIKELY_MISMATCH":0} | {"STRONG":0,"POSSIBLE":0,"UNCERTAIN":30,"LIKELY_MISMATCH":0} | {"STRONG":0,"POSSIBLE":0,"UNCERTAIN":30,"LIKELY_MISMATCH":0} | 30 | 0 | 0 verified, 0 disagreements, 0 unverified→UNCERTAIN | 0 |

| Run | trials with ≥1 FAIL (candidates) | FAILs verified | rejected | unsubstantiated | no capacity | not run | final LIKELY_MISMATCH |
|---|---|---|---|---|---|---|---|
| cold | 0 trials / 0 FAIL findings | 0 | 0 | 0 | 0 | 0 | 0 |
| warm | 0 trials / 0 FAIL findings | 0 | 0 | 0 | 0 | 0 | 0 |

- Criteria in the 30 candidates (warm): 662; parse completeness full 0 / partial 0 / unresolved 662; findings decided PASS/FAIL after eval+guard+checks: 0.
- Offline pre-parse of the cohort: 58 HTTP calls (chunks of 15 + retries), 1730 ms at concurrency 6; cache entries written 0/30. Cache is in-memory in this spike (VERIFY: Supabase `trial_criteria_cache` persistence in Phase 2).
