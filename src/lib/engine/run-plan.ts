// LLM call budget for one run. Every LLM "slot" reserves TWO calls: the call and its single
// validation/backoff retry (CLAUDE.md rule 9). Hard guarantee: slots_granted × 2 ≤ maxCalls, so even if
// every call retries, the run never exceeds MAX_LLM_CALLS_PER_RUN.
//
// Verification is protected by RESERVATION: parse and free-text evaluation can only draw from the
// shared pool, never from the verify/escalate reserve. Work that does not get a slot degrades safely
// (see `Overflow` below); it is never silently skipped and never produces a reassuring tier.
export type Stage = "extraction" | "parse" | "evaluate" | "verify" | "escalate";

export const SLOT_COST = 2;

export interface Reservation {
  extraction: number;
  verify: number;
  escalate: number;
}
export const DEFAULT_RESERVATION: Reservation = { extraction: 1, verify: 8, escalate: 3 };
/** Parse may use at most this many slots per run so free-text evaluation is never starved by a cold cache. */
export const DEFAULT_STAGE_CAPS: Partial<Record<Stage, number>> = { parse: 14 };

/**
 * What an overflowing stage must do:
 *  - parse    → trial stays `analysis_pending` (all criteria unresolved ⇒ UNCERTAIN); queued for cache warm-up
 *  - evaluate → free-text criteria stay UNKNOWN (partial parse ⇒ never STRONG)
 *  - verify   → trial is NOT shown as STRONG/POSSIBLE; shown as UNCERTAIN "not verified within run budget"
 *  - escalate → AMBIGUOUS core finding stays AMBIGUOUS ⇒ UNCERTAIN
 * Abstention guard and typed evaluation are code (0 calls) and always run.
 */
export type Overflow = "analysis_pending" | "free_text_unknown" | "unverified_uncertain" | "stay_ambiguous";

export class RunBudget {
  readonly totalSlots: number;
  private reserve: Record<Stage, number>;
  private shared: number;
  private granted: Record<Stage, number> = { extraction: 0, parse: 0, evaluate: 0, verify: 0, escalate: 0 };

  constructor(
    readonly maxCalls: number,
    reservation: Reservation = DEFAULT_RESERVATION,
    private readonly caps: Partial<Record<Stage, number>> = DEFAULT_STAGE_CAPS,
  ) {
    this.totalSlots = Math.floor(maxCalls / SLOT_COST);
    const reserved = reservation.extraction + reservation.verify + reservation.escalate;
    if (reserved > this.totalSlots) throw new Error("reservation exceeds budget");
    this.reserve = { ...reservation, parse: 0, evaluate: 0 };
    this.shared = this.totalSlots - reserved;
  }

  /** Take one slot for `stage`. Own reserve first, then the shared pool. Never touches another stage's reserve. */
  take(stage: Stage): boolean {
    const cap = this.caps[stage];
    if (cap !== undefined && this.granted[stage] >= cap) return false;
    if (this.reserve[stage] > 0) {
      this.reserve[stage]--;
    } else if (this.shared > 0) {
      this.shared--;
    } else {
      return false;
    }
    this.granted[stage]++;
    return true;
  }

  /** A stage is finished: its unused reserve flows to the shared pool for later stages. */
  release(stage: Stage): void {
    this.shared += this.reserve[stage];
    this.reserve[stage] = 0;
  }

  get slotsGranted(): number {
    return Object.values(this.granted).reduce((a, b) => a + b, 0);
  }
  /** Upper bound on HTTP-level LLM calls, assuming every slot also uses its retry. */
  get worstCaseCalls(): number {
    return this.slotsGranted * SLOT_COST;
  }
  stats(): Record<Stage, number> & { slotsGranted: number; worstCaseCalls: number; sharedLeft: number } {
    return { ...this.granted, slotsGranted: this.slotsGranted, worstCaseCalls: this.worstCaseCalls, sharedLeft: this.shared };
  }
}
