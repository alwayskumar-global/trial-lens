# TASKS.md — TrialLens

Deadline: **Oct 30, 2026 10:00 PDT = 22:30 IST**. Target submit: **Oct 29 evening IST**.
Judging Period Dec 1–15: demo must stay live, free, unrestricted. Winners announced ~Jan 11, 2027.
Tick boxes as you go. Order matters in Phase 0.

## How to read this file (execution checklist from 2026-10-07)
- `[x]` = done **and verified**, with the evidence cited under the item. `[ ]` = not done, or not verifiable by the agent. An item with any unmet clause is not ticked.
- Tags on unchecked items: **PARTIAL** (what is done and what remains), **BLOCKED** (needs a decision), **DEFERRED** (explicitly paused or cut), **KUMAR-OWNED** (the agent cannot verify it).
- The original wording of every line, the phase order, the deadline, the cut order and the Stretch list are unchanged. Where an item's wording conflicts with the currently approved scope it is not edited; a `Scope note` sits under it and it is listed in **Wording conflicts**.
- Status snapshot: **2026-10-08**, branch `phase1/spike`. Code: Policy R2 `60fda87`, copy `c3afcbb`, measurement harness `929f559`, then the question-engine pregnancy exclusion and the offline lift script (`eval/adaptive-lift.ts`). `pnpm lint`, `pnpm typecheck` and `pnpm test` (546 tests, 34 files) pass; `pnpm build` last passed at `c3afcbb`. Production (`main`) is untouched. No merge, no Production deploy.
- Work that is paused: **Stage 3 UI** (editable Describe/Confirm, location, Results question) and **`VISITOR_INPUT_MODE=open`**. They stay paused until Kumar says otherwise.

## Phase 0 — Prerequisites (Oct 6, do before any code) 
Order of operations:
- [ ] Join **Nebius Builder Program** (dev.nebius.com/builders) → request Token Factory (+ Tavily) credits
  - **KUMAR-OWNED, unverified.** No evidence available to the agent.
- [ ] Register on the hackathon Devpost page; **create a draft submission now** (track: Best Apps & Agents)
  - **KUMAR-OWNED, unverified.**
- [x] Create Token Factory API key → store in password manager (not in chat, not in repo)
  - Evidence: `NEBIUS_API_KEY` exists in the Claude Cloud environment and authenticated calls succeed (`docs/spike-results.md` 01-smoke; Preview run 2026-10-06). Password-manager storage cannot be verified by the agent (Kumar to confirm).
- [ ] Create GitHub repo, **public**, first commit contains: `LICENSE` (Apache-2.0), `.gitignore` with `.env*`, `.env.example`, `CLAUDE.md`, `SPEC.md`, `SCHEMA.md`, `TASKS.md`
  - **PARTIAL.** First commit `cbfc1a1` contains `LICENSE` (Apache-2.0), `.gitignore` (`.env*`), `.env.example`, `SPEC.md`, `SCHEMA.md`. `CLAUDE.md` was deliberately kept local-only (`5090d25`); `TASKS.md` is tracked from the commit that restored it (Kumar reversed the earlier removal).
  - Scope note: wording lists CLAUDE.md and TASKS.md in the first commit; see Wording conflicts.
- [ ] Confirm license shows in repo **About** sidebar
  - Unverified: `LICENSE` is Apache-2.0 text; the GitHub About sidebar was not checked (**KUMAR-OWNED**).
- [x] Create Supabase project; **one US region**; keep service-role key private
  - Evidence: project `triallensdb`, service-role key server-only (`docs/phase2-api.md`, live verification).
  - Scope note: wording says one US region; the existing project is in **ap-south-1 (Mumbai)**. Decision: keep the existing region (see Current decisions).
- [ ] Create Upstash Redis DB in the **same region family**
  - **PARTIAL.** The DB exists and is exercised (per-IP window, daily counter; Preview run 2026-10-06). Its region is not recorded and the agent cannot verify it, so the "same region family" clause is unverified.
- [ ] Create Vercel project linked to the repo; set function region to match Supabase/Upstash (VERIFY plan limits for `maxDuration` and streaming)
  - **PARTIAL.** Project `trial-lens` (`prj_iMwOx4APVWYmUpIPDAWe95rjTmUX`) is linked; Preview builds from `phase1/spike`; `vercel.json` sets `framework: nextjs`. Functions run in `iad1`, which does **not** match Supabase (Mumbai): accepted cross-region cost.
  - `maxDuration`/streaming VERIFY: a live run of 93.2 s completed on a Preview (see Phase 1, Vercel streaming). The full 300 s setting is not proven beyond that run.
- [ ] Add all env vars from `.env.example` to Vercel (Sensitive for secrets) and to local `.env.local`
  - **PARTIAL.** Preview variables were set by Kumar and are proven by a successful Preview run (Nebius, Supabase, Upstash). Production variables are not set (Production untouched by instruction). **`.env.local` is deliberately NOT used** (decision; see Current decisions).
  - Scope note: wording asks for a local `.env.local`.
- [x] Run `supabase/migrations/0001_init.sql`; confirm RLS enabled on all 3 tables with no policies
  - Evidence: migrations 0001-0005 applied to `triallensdb`; advisor shows only the intended INFO "RLS enabled, no policy" (`docs/phase2-api.md`).
- [ ] Pick a final project name and sanity-check it isn't an existing product/trademark (videos may not include third-party trademarks)
  - **KUMAR-OWNED, unverified.** "TrialLens" is in use; no trademark check recorded.
- [ ] YouTube channel ready for the demo video upload (public)
  - **KUMAR-OWNED, unverified.**

## Phase 1 — Spike with go/no-go gates (Oct 6–7)
Write throwaway scripts in `/eval/spike`. Record results in `/docs/spike-results.md`.
- [x] **Token Factory:** confirm base URL, OpenAI-SDK compatibility, model IDs for Nano/Super/Ultra
  - Evidence: `docs/spike-results.md` 01-smoke: `https://api.tokenfactory.nebius.com/v1/` works with the `openai` SDK; FAST/MID/DEEP mapped to Nemotron 3 Nano / Super / Ultra (mapping flagged VERIFY there).
- [x] **Structured output:** JSON-schema/JSON mode supported per model? Run 50 criteria-parse calls; gate: **≥ 95% Zod-valid** (after one retry)
  - Evidence: gate PASS: FAST 100%, MID 100%, DEEP 98% valid after one retry (`docs/spike-results.md` 02-structured). Single-criterion calls; first-attempt FAST 98%, MID 100%, DEEP 92%.
- [x] **Tool calling** support per model (only needed if used; note result)
  - Result noted: not tested and not used by the design (`docs/spike-results.md`).
- [ ] **Latency/cost:** per call p50/p95 per tier; estimate cost per full run (30 trials) → set `MAX_LLM_CALLS_PER_RUN` and `DAILY_RUN_BUDGET` from real numbers
  - **PARTIAL.** p50/p95 recorded for single-criterion calls; end-to-end Preview run 93.2 s / 41 calls. **FAST price now confirmed from the Token Factory account API** (2026-10-07): `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`, $0.06 / $0.24 per 1M input / output tokens. Measured in the hardened-1 development check (`docs/hardened-1-dev-check.md`): 33 calls, 100,183 tokens, actual spend about $0.021 (roughly $0.0006 per extraction call, 2.5-3k completion tokens each); extraction latency p50 8.8 s (spike-0) / 10.0 s (hardened-1), p95 14.6 / 16.9 s. **Cost per full run (MID and DEEP prices, ~41 calls) is still not computed**, and `MAX_LLM_CALLS_PER_RUN`=80 and `DAILY_RUN_BUDGET`=150 were NOT derived from real prices.
- [x] **Rate limits / 429 behavior** at `LLM_CONCURRENCY=6`
  - Evidence: 0 HTTP 429 in ~220 calls at concurrency 6 (`docs/spike-results.md`). Limits above 6 not discovered.
- [ ] **Data retention / logging terms** for Token Factory read and summarized in `/docs/spike-results.md` (governs README privacy wording)
  - **BLOCKED: ZDR gate.** Not verified first-party. Only secondary sources were seen (default retention for speculative decoding, zero data retention opt-in). Needs written confirmation for our organisation/key. Until then: no real visitor text to the provider and no "does not store your information" privacy claim.
- [x] **CT.gov v2:** fetch ~30 recruiting breast-cancer trials; confirm eligibility text, age/sex fields, last-update field, **site geo coordinates present?**; note rate limits
  - Evidence: `docs/spike-results.md` 03-ctgov: eligibility text, ages, sex, last-update, site status; 99.5% of sites have a geoPoint, 27/30 trials fully geocoded; no rate-limit headers.
- [ ] **Vocabulary coverage:** run the parser over those 30 trials; gate: **≥ 60% of scoring criteria typed**. If 40–60%, expand vocabulary; if < 40%, STOP and reassess the adaptive demo scope with me
  - **GATE NOT MET: scope reassessment pending an explicit decision.** Strict typed coverage was 5.7% at the gate (<40% = STOP); after the repairs the frozen design shows 1.0-1.6% reviewed-full-logic on the development cohorts (`docs/spike-results.md`). Work continued under the soundness-first design following Kumar's reviews, but no written decision on the adaptive-demo scope is recorded. **The gate stays OPEN and is not marked passed.** Offline measurement of Option 1 on the three prepared fictional profiles (2026-10-08, `eval/adaptive-lift.ts`, `eval/reports/adaptive-lift-offline.json`, no model calls): **0** UNCERTAIN→POSSIBLE lifts (typed-only counterfactual, pregnancy keys excluded); only `ecog` (blocks 2-3 trials) and `disease_setting` (1 trial) are ever offered, and each blocked trial still has 8-40 other open scoring criteria (1-12 core). Returned to Kumar for a scope decision; no option is chosen automatically. See Open decisions.
- [x] **Vercel streaming:** deploy a hello-world SSE route; confirm it streams through the platform for ≥ 60 s on your plan
  - Evidence (Preview, 2026-10-06): real `/api/run` on `dpl_ANYL58THqRQHqVwPjC1QjUFk4Eow` (SHA 7b5b9df) streamed for 93.2 s in 34 network chunks and ended `done(replay:false)`; 11/11 checks of `eval/preview-sse-check.ts`; function log `{"evt":"run","mode":"live","ok":true,"calls":41,"ms":93033}`. A hello-world route was not used (the real route was tested instead).
- [ ] **Public eval datasets:** locate cohorts used in the TrialGPT paper; confirm availability, license, annotation granularity (VERIFY)
  - Not done.

## Phase 2 — Core engine (Oct 8–12)
- [x] Zod schemas from SCHEMA.md
  - Evidence: `src/schema/*`, `src/schema/schema.test.ts`.
- [x] CT.gov client + mappers + Zod validation + deterministic filters
  - Evidence: `src/lib/ctgov/client.ts`, `split.ts` and tests.
- [x] Profile extraction (FAST) + Known/Unknown/Uncertain handling
  - Evidence: `src/lib/pipeline/extract.ts`, tests. Extraction prompt `hardened-1`: development check on 12 author-written fictional cases (`docs/hardened-1-dev-check.md`, `eval/reports/hardened-1-dev-check.json`), all 12 cases on the same 52-fact gold denominator with an invalid extraction counted as a failure: recall 43/52 (spike-0 44/52), usable extractions 11/12 (12/12), false-known 11 (17), p95 16.9 s. Instruction-following injections obeyed 0 (spike-0: 7); the six forged "clinic record" facts are still accepted by both arms and remain failures under the agreed test, so the injection criterion is **not met**. **Criteria not all met**: one prepared text (`prepared-hrpos-stage2`) ended invalid after the retry (both attempts hit the 4,096-token cap); 3 of 7 hedged facts came back as known. Development results, not measured clinical accuracy. **Option C chosen by Kumar (2026-10-08): a targeted fix, not acceptance and not an unchanged rerun.** Diagnosis and proposed change (`hardened-2`: `max_tokens` 4096→8192 for extraction only, plus one hedging sentence) with a revised ceiling of 38 calls and at most $0.08 are in the doc, **awaiting Kumar's approval before any paid call**. The Preview check of `/api/extract` is NOT completed: 503 before any model call on two deployments because `PROFILE_SIGNING_SECRET` is not set on Preview.
- [x] Criteria parser (MID) + `trial_criteria_cache`
  - Evidence: `src/prompts/clause-parse.ts` (`spike-4`), `src/lib/cache/criteria-cache.ts` (memory + Supabase), `run.test.ts` cache reuse.
- [x] Unit normalisation (+ Vitest)
  - Evidence: `src/lib/engine/clause.ts` (code-only unit canonicalisation), `clause.test.ts`.
- [x] Typed evaluator in code (+ Vitest)
  - Evidence: `src/lib/engine/clause.ts`, `reconcile.ts`, `clause.test.ts`, `reconcile.test.ts`.
- [x] Batched free-text evaluator (one call per trial)
  - Evidence: `src/lib/pipeline/run.ts` stage 5, `run.test.ts`.
- [ ] Abstention guard + `unsupported_assumption` counter
  - **PARTIAL.** Guard done (`src/lib/engine/guard.ts`, `guard.test.ts`). **No `unsupported_assumption` counter exists**; only a per-finding `guard_downgraded` flag.
- [x] Tiering function (+ Vitest covering every rule and ordering)
  - Evidence: `src/lib/engine/tier.ts`, `tier.test.ts` (every rule, exhaustive property test of Policy R2), `run.test.ts` (ordering).
- [x] SSE `/api/run` endpoint emitting the event types in SCHEMA.md
  - Evidence: `src/app/api/run/route.ts`, `handler.test.ts`; verified on a Preview (see Phase 1, Vercel streaming).
- [x] LLM concurrency, backoff, per-run call cap
  - Evidence: `p-limit` concurrency, 429 backoff and `CallCap` in `src/lib/llm/client.ts`, `RunBudget` (`run-plan.test.ts`); `done.stats.worst_case_calls` ≤ 80 asserted in tests.

## Phase 3 — Adaptive engine + eval (Oct 13–16)
- [ ] Counterfactual question engine (+ Vitest: bucketing, determinism, no-op case, monotonicity)
  - **PARTIAL.** Engine built (`src/lib/engine/questions.ts`). Tests cover bucketing, determinism and the no-op case; **no monotonicity test**. Under Policy R2 the ranking counts UNCERTAIN→POSSIBLE lifts only. **Pregnancy-related keys (`pregnant`, `lactating`) are excluded from the question set** until the exact test, timing, contraception and applicability rules are demonstrated by regression cases (`EXCLUDED_QUESTION_KEYS`, tested). `answerLifts` exposes the typed-only counterfactual for measurement; it is not an answer path.
- [ ] Answer-handling path: typed re-tier in code + targeted re-run of dependent free-text criteria
  - **DEFERRED: not built; paused with Stage 3.** Scope note: wording says typed re-tier plus targeted re-run; approved scope is a **full re-evaluation** where an answer can only lift UNCERTAIN→POSSIBLE (Policy R2). A typed-only update that leaves dependent free-text findings stale is **not acceptable** and will not be implemented.
- [ ] Eval harness in `/eval` (runs locally): loaders, metrics, ablation switches
  - Not done: `eval/index.ts` is a TODO stub. (`eval/spike/*` are throwaway spike scripts.)
- [ ] First full eval run; commit `eval/reports/`
  - Not done: `eval/reports/` is empty.
- [ ] Hand-built abstention test set (~30 cases, labeled author-created)
  - Not done. Unit tests and adversarial regression cases exist (`coverage.test.ts`, `blocks.test.ts`) but are not the ~30-case labelled set.
- [ ] Tune `TIER_UNKNOWN_THRESHOLD` and routing from results
  - Not done (default 3 in use).

## Phase 4 — UI (Oct 14–21, overlaps Phase 3)
Figma first for hero screens (Oct 6–10), then build.
- [ ] Screen 1 Describe (+ 3 fictional sample profiles)
  - **PARTIAL.** Fixed fictional Describe exists; 3 prepared profiles exist (`src/lib/sample/replay-profiles.ts`) but the UI shows one. **Editable input DEFERRED** (Stage 3 paused).
- [ ] Screen 2 Confirm (Known/Unknown/Uncertain chips, editable)
  - **PARTIAL.** Read-only confirm of the prepared fictional profile. **Editable chips DEFERRED** (Stage 3 paused).
- [x] Screen 3 Processing (live stage stream and counts)
  - Evidence: `LiveProcessing`/`Processing`, approved states in `docs/live-ui-proposal.md`, `live.test.tsx`.
- [ ] Screen 4 Results (tier counts, cards, adaptive panel)
  - **PARTIAL.** Tier counts, cards and Fit Line (`ce6e427`, equal-sized dots) done. Adaptive panel is absent in live mode (**DEFERRED**). Policy R2: STRONG and LIKELY_MISMATCH zones are never populated for any result.
- [ ] Screen 5 Trial detail (eligibility matrix, why-it-surfaced, coordinator questions, site/contact, NCT link)
  - **PARTIAL.** Eligibility matrix, original wording and official NCT link done. Coordinator questions, site and contact are not built (`sites`/`coordinator_questions` are empty).
- [x] Persistent safety banner; copy audit against CLAUDE.md safety rules (no "eligible"/"qualify")
  - Evidence: `SafetyBanner`, `src/lib/ui/copy-audit.test.ts` (banned words, reported-facts-not-verified guard). Scope note: the safety rules now live in `docs/copy-rules.md` (CLAUDE.md is local-only).
  - Copy change `c3afcbb` (approved by Kumar 2026-10-07, fictional-profile variant): "A second automated comparison found no conflict in the criteria it checked. The prepared fictional profile was not independently verified." (saved examples: "The fictional profile ..."), neutral icon instead of the green check (`LiveDetail.tsx`, `copy.ts`, `StatusGlyph.tsx`). **Pending Kumar's screen review; not closed.** Kumar could not close the visual review from the 2026-10-07 report because the screenshots were not attached to it; they are re-sent as attachments (live and saved example, desktop 1440 and mobile 390). Visitor-specific wording is reserved for the visitor-UI review.
- [ ] Accessibility pass (contrast, keyboard, reduced motion); mobile layout
  - Not done. A mobile `FitBar` exists below 1024 px; no accessibility audit and no mobile design review yet.
- [ ] Empty/error/`analysis_failed` states designed, not default
  - **PARTIAL.** `EmptyState`, `ErrorState`, pending/failed states built and tested; not design-reviewed.

## Phase 5 — Hardening and deploy (Oct 22–24)
- [ ] Verifier (independent pass on STRONG/POSSIBLE only) + eval ablation
  - **PARTIAL.** Verifier built (`run.ts` verification stage). The eval ablation needs the eval harness. Scope note: under Policy R2 STRONG is never emitted (the engine's STRONG is shown as POSSIBLE).
- [ ] DEEP escalation for core AMBIGUOUS, capped
  - **DEFERRED: not built.** Cut-order item 1; its three reserved slots were reassigned to FAIL checks (`docs/run-plan.md`).
- [x] Upstash rate limit + daily budget counter
  - Evidence: `src/lib/guards/run-guard.ts` and tests; per-IP window and daily counter exercised against real Upstash (`docs/phase2-api.md`). The rate-limit fallback has not been exercised on a deployed Preview.
- [x] `pnpm precompute:replay` → 3 fictional cases into `replay_cases`
  - Evidence: 3 fictional cases stored in `replay_cases` (`docs/phase2-api.md`); not re-inspected in this snapshot. Cases were stored before Policy R2 and are streamed under the ceiling at read time. Explicit replay verified on a Preview (labelled `mode:replay`, 200).
- [x] Automatic fallback to replay (budget/errors/rate limit), labeled honestly in UI
  - Evidence: `handler.test.ts` (rate limit, budget, guard outage, model outage → labelled replay). Scope note: for visitor-reviewed profile runs there is deliberately **no silent replay** (refusal is HTTP 429/503, failure is an error event).
- [ ] Verify **no patient text** in logs, DB, Redis (grep logs; inspect tables)
  - **PARTIAL.** Tests assert logs and error bodies carry no visitor text; no visitor table exists; Redis holds only a hashed IP and a counter; Preview function logs reviewed for the sample run showed counts only. No inspection of production data. Scope note: visitor text reaches the model provider, which is covered by the ZDR gate, not by this item.
- [ ] Playwright smoke test on replay mode with all external services disabled
  - Not done (no Playwright dependency yet).
- [ ] Production deploy; test the public URL from a clean browser and a phone
  - **NOT STARTED.** Production is `main` (docs-only) and is untouched by instruction.
- [ ] Secrets audit: no key in repo history, bundle, or client network calls
  - Not done.

## Phase 6 — Submission assets (Oct 25–27)
- [ ] README: what it is, prior art (TrialGPT, Antidote) and our difference, setup, env table, **how Nemotron and Token Factory are used**, eval table, limits, safety statement
  - Not started (no README yet). Privacy wording is gated by the ZDR gate.
- [ ] Demo video < 3 min following SPEC.md §8 acceptance script; upload public to YouTube
  - Not started.
- [ ] Devpost text: features, architecture, track, repo URL, demo URL, video URL
  - Not started (**KUMAR-OWNED**).
- [ ] **Feedback section** for Token Factory, AI Cloud, NVIDIA tools (specific and critical, drawn from the spike notes)
  - Not started.
- [ ] Confirm submission is marked "new" (no pre-existing explanation needed)
  - Not started.

## Phase 7 — Buffer and submit (Oct 28–29)
- [ ] Fresh-clone test: follow README on a clean machine
  - Not started.
- [ ] Re-verify demo URL, replay mode, license visibility, video public
  - Not started.
- [ ] **Submit by Oct 29 evening IST**
  - Not started (**KUMAR-OWNED**).
- [ ] Set a weekly reminder to check credits/spend until Dec 15
  - Not started (**KUMAR-OWNED**).

## Cut order if time slips
1. Ultra escalation → 2. Tavily → 3. Verifier → 4. Second-domain stretch.
**Never cut:** adaptive questioning, eval numbers, abstention guard, replay mode.

## Stretch (only if core is done by Oct 22)
- [ ] Second-domain vocabulary pack + 2–3 demo profiles (config only, no pipeline changes)
  - Stretch: not started; not in scope unless the core is done by Oct 22 and Kumar asks.
- [ ] Run eval as a Nebius Serverless Job
  - Stretch: not started.
- [ ] Tavily-grounded glossary (real runtime call required for the bonus)
  - Stretch only, second in the cut order. `TAVILY_API_KEY` exists in the Claude Cloud environment; **no code uses it and none will** unless Kumar asks after the core is done.

## First Claude Code prompt (paste after Phase 0 is done)
> Read CLAUDE.md, SPEC.md, SCHEMA.md and TASKS.md. Scaffold only Phase 0 repo items that live in code (Next.js + TS strict, Tailwind, shadcn, pnpm scripts, Vitest, folder layout, Zod schema stubs from SCHEMA.md, `.env.example` loading with Zod-validated env). Do not start Phase 2. List every `VERIFY:` item you hit. Stop and ask before any decision under "STOP and ask" in CLAUDE.md.

---

## Current decisions and actual setup (record, 2026-10-07)
- **Claude Cloud environment** manages all server-side credentials and network access for agent sessions. Variable names present (never values): `NEBIUS_API_KEY`, `NEBIUS_BASE_URL`, `NEMOTRON_MODEL_FAST/MID/DEEP`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `PREVIEW_SHARE_URL`, `TAVILY_API_KEY` (unused). Kumar manages the network allowlist (the Preview alias host is allowed; the Token Factory API host has not been re-verified from a session). Credentials are never printed, logged, committed or put in files; the Preview share link is a secret.
- **No `.env.local`.** Server variables live in the Claude Cloud environment and in Vercel (Preview variables set by Kumar; Production variables are not set).
- **Supabase** project `triallensdb` stays in **ap-south-1 (Mumbai)**; Vercel functions run in `iad1`; the cross-region latency is accepted. Upstash region is not recorded.
- **Access:** Vercel Authentication is on for Preview; the Preview URL is reached with a short-lived share link kept only in the environment. **Production = `main`, docs-only, untouched.**
- **Policy R2 (approved):** every fact is the visitor's own statement and none is verified. Final tier = engine tier through the ceiling STRONG→POSSIBLE (`reported_only`) and LIKELY_MISMATCH→UNCERTAIN (`reported_conflict`), applied after every re-tier, in a final pass, to stored replays at read time and at the SSE boundary. Rule D, the 80-call cap and overflow-as-UNCERTAIN are unchanged. `reported_conflict` is internal, `verified` is false for it, and no screen may present reported facts as verified (`SPEC.md` §4, `docs/copy-rules.md`).
- **Visitor input:** server side built (`/api/extract`, signed extraction token, samples mode refuses any edit, profile runs require a valid token). `VISITOR_INPUT_MODE=samples`. **`open` and the Stage 3 UI are paused.**
- **ZDR gate:** no real visitor text goes to the model provider until zero data retention (or equivalent) is verified first-party in writing for our organisation and key, and the privacy copy is approved. Tests and measurements use fictional text only.
- **hardened-1** (extraction prompt with delimited data and no-echo validation retry): core fictional-input comparison run on 2026-10-07 under Kumar's approval (cap 70 FAST calls; model id and prices confirmed from the account first; 33 calls used, about $0.021 against a $0.081 maximum). Result: mixed, criteria not all met (`docs/hardened-1-dev-check.md`, corrected 2026-10-08 to the same 52-fact denominator for all 12 cases). The 12 author-written cases are a development check, not measured clinical accuracy. **Decision (2026-10-08): option C, a targeted extraction fix**; not acceptance of hardened-1 and not an unchanged rerun. The unused calls of the first run are not approval for another run: the proposed fix (`hardened-2`) needs Kumar's approval of its ceiling (38 calls, at most $0.08). The optional end-to-end test is not run and not scheduled.
- **Adaptive demo:** the approved answer path is a **full re-evaluation**; a typed-only answer update that leaves dependent free-text findings stale is not acceptable. Pregnancy-related questions are excluded until their rules are demonstrated by regression cases. The coverage gate stays open; Option 1 measured 0 lifts offline (Phase 1 coverage item) and is back with Kumar for a scope decision.
- **Preview `PROFILE_SIGNING_SECRET`:** required for the Preview extraction checks; it must be set for Preview only, as Sensitive, followed by a Preview redeploy. It cannot be verified from a session: the Vercel API returns 403 when listing environment variables and the project record does not expose them, so neither the Sensitive type nor the Preview-only target can be confirmed. Behavioural check: `/api/extract` returned 503 `unavailable` before any model call on the deployments of `929f559` and `6bacea8`, so it is not set in those builds. `VISITOR_INPUT_MODE` stays `samples`.
- **Copy:** the second-comparison line uses the approved fictional-profile variant with a neutral icon (`c3afcbb`), pending Kumar's review of the screenshots. UI copy changes need Kumar's approval.
- **Design assets:** the Claude Design export, `guidelines/handoff.md` and the design screenshots are not in the repo (screenshots are not to be committed to the public repo without Kumar's approval).

## Approved scope changes since this file was written (records, not new tasks)
Policy R2 (above); server side of visitor input (Stages 1-2: extract split, signed token, samples mode, abuse and privacy controls); extraction prompt hardening; Fit Line equal-size fix; self-hosted fonts and `vercel.json` framework setting for Preview; `AGENTS.md` committed. Stage 3 and everything after it in that plan are paused.

## Open decisions (for Kumar)
1. **Coverage-gate scope decision** (Phase 1, Vocabulary coverage). The gate stays OPEN, Stage 3 has not started. Measured offline on the three prepared fictional profiles (typed-only counterfactual, `eval/reports/adaptive-lift-offline.json`): **0** lifts; only `ecog` (blocks 2-3 trials) and `disease_setting` (1 trial) are offered; each blocked trial keeps 8-40 other open scoring criteria. Returned for a decision; options as facts, none chosen automatically:
   - **A. Keep Option 1 as an honest demo:** the question card exists and usually says "No single answer would change these results right now". Needs a full re-evaluation per answer (about 41 calls, 60-90 s each, one run-bucket slot) and shows no visible tier movement on the prepared profiles, so SPEC §8 #4 ("tiers visibly update") is not satisfiable with them. About 2.5-3 days (Oct 13-16).
   - **B. Option 2, non-evaluative "what to ask next" panel:** always has content, answers do not re-tier; changes SPEC §8 #4 and weakens "never cut: adaptive questioning". About 1 day; removes the answer path from Phase 3.
   - **C. Raise typed coverage first** (vocabulary and parser work for the keys that reach trials) so answers can move trials, then re-measure: new frozen config and a new untouched-cohort measurement; about 3-5 days, which pushes the eval harness (a never-cut item) and the Oct 13-16 window.
2. **ZDR verification** and which privacy wording applies (blocks `open`; no real visitor text before it).
3. **Second-comparison copy** (Phase 4 copy item): screenshots re-sent as attachments; close the visual review or send changes.
4. **hardened-2 (option C, targeted extraction fix):** approve or change the proposed fix and its ceiling (38 calls, at most $0.08; `docs/hardened-1-dev-check.md`). Also set `PROFILE_SIGNING_SECRET` for Preview (Sensitive, Preview only) and redeploy, to unblock the three Preview extraction checks.
5. Stage 3 go/no-go (paused), plus scope wording, spend limits, missing design assets and the judging-deployment access model.

## Wording conflicts (original wording vs currently approved scope)
| Item (phase) | Original wording | Current approved scope |
|---|---|---|
| Phase 0, repo | first commit contains `CLAUDE.md`, `TASKS.md` | CLAUDE.md is local-only (`5090d25`); TASKS.md tracked from the restoring commit |
| Phase 0, Supabase / Upstash | one US region; same region family | Supabase kept in ap-south-1; Upstash region not recorded |
| Phase 0, env vars | add to local `.env.local` | no `.env.local`; Claude Cloud environment + Vercel |
| Phase 1, retention terms | read and summarised | ZDR gate: first-party written verification required |
| Phase 1, vocabulary coverage | gate ≥ 60%; STOP and reassess if < 40% | gate not met; soundness-first design; explicit decision pending |
| Phase 1, Vercel streaming | deploy a hello-world SSE route | real `/api/run` verified on a Preview (93.2 s) |
| Phase 3, answer-handling | typed re-tier + targeted re-run of dependent free-text criteria | deferred; approved scope is a full re-run and answers can only lift UNCERTAIN→POSSIBLE |
| Phase 4, Describe / Confirm | editable input and chips | paused (Stage 3) |
| Phase 4, Results | tier counts, adaptive panel | STRONG and LIKELY_MISMATCH never emitted; panel deferred |
| Phase 4, Detail | coordinator questions, site/contact | not built; location paused |
| Phase 4, copy audit | against CLAUDE.md safety rules | rules live in `docs/copy-rules.md` |
| Phase 5, Verifier | pass on STRONG/POSSIBLE only | STRONG is emitted as POSSIBLE (Policy R2) |
| Phase 5, fallback | automatic fallback to replay | not for visitor profile runs (error or HTTP status instead) |
| Phase 5, no patient text | none in logs, DB, Redis | holds for our stores; visitor text reaches the model provider (ZDR gate) |
| Phase 5, Production deploy | deploy | Production untouched until Kumar approves |
| Phase 6, README privacy | privacy wording | gated by the ZDR gate |

## Next unchecked task
- **File order:** Phase 0, "Join **Nebius Builder Program**" (**KUMAR-OWNED**).
- **Next task the agent can act on:** Phase 1, "**Latency/cost**" (remainder: cost per full run from the account's MID/DEEP prices and the measured call counts; arithmetic only, no model call). Phase 2 "Profile extraction" and Phase 3 work wait for Kumar's decisions 1 and 4 above.
