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
