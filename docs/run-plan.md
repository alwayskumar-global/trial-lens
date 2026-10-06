# Run plan within `MAX_LLM_CALLS_PER_RUN = 80` (implemented in `src/lib/engine/run-plan.ts`)

**Rule.** One LLM *slot* = one call + its single retry (CLAUDE.md rule 9) = 2 calls. 80 calls ⇒ 40 slots. Even if every call retries, a run cannot exceed 80 (tested). A hard `CallCap` in the spike additionally throws if exceeded.

**Allocation.** Reserved: extraction 1, verification of STRONG/POSSIBLE 8, FAIL checks (rule D) 3 (reassigned from the unbuilt escalation stage; `escalate` reserve is now 0). Shared pool: 28. Parse may take ≤ 14 slots (so a cold cache cannot starve free-text evaluation); evaluation takes what remains. Unused reserve flows forward after a stage `release()`s (escalation is unbuilt in the spike, so its 3 slots go to verification). Parse and evaluation can never draw from the verify/escalate/extraction reserve, so **verification is never dropped to make room for parsing**.

**Degradation when a stage has no slot (never silent, never reassuring):**

| Stage | Overflow behaviour |
|---|---|
| parse | trial `analysis_pending`: all its criteria `unresolved` ⇒ UNKNOWN ⇒ trial UNCERTAIN; queued for cache warm-up |
| evaluate | its free-text criteria stay UNKNOWN; trial is partial ⇒ never STRONG |
| verify | trial is not shown as STRONG/POSSIBLE; shown UNCERTAIN, flag `unverified_budget` |
| mismatch (FAIL check) | trial's FAILs stay unverified ⇒ UNCERTAIN, never LIKELY_MISMATCH (rule D) |
| escalate | not built |

Abstention guard and typed evaluation are code (0 calls) and always run.

**Warm vs cold.** Warm cache: parse needs ~0–3 slots; the demo pool should be pre-parsed offline (measured: 36 calls, 63 s for 29 trials). Cold: ≤14 parse slots ⇒ ~13 trials analysed, the rest `analysis_pending`. Measured runs: `docs/spike-results.md` (07).
