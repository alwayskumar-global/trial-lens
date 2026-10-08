// Pure budget machinery for the (not yet approved) cache warm-up. No network, no model client, no database.
// SpendGuard makes the dollar limit ENFORCEABLE BEFORE DISPATCH: an attempt is sent only if
//     actual_spent + worst_case(all in-flight attempts) + worst_case(this attempt)  <=  budget
// so final spend can never exceed the budget as long as each attempt's real cost is at most its worst case. That assumption is checked at
// settle time: an attempt that costs more than its worst case halts all further dispatch ("estimate_violated") and is reported.
// An attempt whose usage is unavailable is charged at its worst case, never at zero.
import { createHash } from "node:crypto";

export type HaltReason = "estimate_violated";
export type Refusal = "budget" | "attempts" | "halted";

export interface Reservation { id: number; worst: number }

export class SpendGuard {
  private spent = 0;
  private inflight = new Map<number, number>();
  private next = 1;
  private dispatched = 0;
  halted: HaltReason | null = null;
  violations = 0;

  constructor(readonly budget: number, readonly maxAttempts: number) {
    if (!(budget > 0) || !Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error("bad_guard_config");
  }

  get attempts(): number { return this.dispatched; }
  get spentUsd(): number { return this.spent; }
  get inflightWorstUsd(): number { let s = 0; for (const w of this.inflight.values()) s += w; return s; }
  /** The most the run can have cost if every in-flight attempt takes its worst case. Never above `budget` while nothing has been violated. */
  get upperBoundUsd(): number { return this.spent + this.inflightWorstUsd; }

  tryReserve(worstUsd: number): { ok: true; reservation: Reservation } | { ok: false; reason: Refusal } {
    if (!(worstUsd >= 0) || !Number.isFinite(worstUsd)) throw new Error("bad_worst_case");
    if (this.halted) return { ok: false, reason: "halted" };
    if (this.dispatched + 1 > this.maxAttempts) return { ok: false, reason: "attempts" };
    if (this.upperBoundUsd + worstUsd > this.budget + 1e-12) return { ok: false, reason: "budget" };
    const id = this.next++;
    this.inflight.set(id, worstUsd);
    this.dispatched++;
    return { ok: true, reservation: { id, worst: worstUsd } };
  }

  /** `actualUsd === null` = usage unavailable: charged at the worst case. */
  settle(r: Reservation, actualUsd: number | null): void {
    if (!this.inflight.delete(r.id)) throw new Error("unknown_reservation");
    const charge = actualUsd === null ? r.worst : actualUsd;
    if (charge > r.worst + 1e-12) { this.halted = "estimate_violated"; this.violations++; }
    this.spent += charge;
  }
}

/** Conservative token estimate from character count (documented heuristic; verified at runtime by SpendGuard.settle). */
export const estTokens = (chars: number): number => Math.ceil(chars / 2.5) + 200;

export const worstAttemptUsd = (estPromptTokens: number, maxTokens: number, price: { p: number; c: number }): number => estPromptTokens * price.p + maxTokens * price.c;

export interface PlannedTrial { nct_id: string; source_version: string; criteria: number; chunks: number }

/** Fingerprint of an approved plan: parser version, selection policy and the ordered (trial, version, criteria, chunks) list. Any change in selection changes it. */
export function planFingerprint(parserVersion: string, policy: string, trials: readonly PlannedTrial[]): string {
  const h = createHash("sha256");
  h.update(`${parserVersion}\n${policy}\n`);
  for (const t of trials) h.update(`${t.nct_id}|${t.source_version}|${t.criteria}|${t.chunks}\n`);
  return h.digest("hex");
}

export interface PlanDiff { added: string[]; removed: string[]; version_changed: string[] }
export function diffPlans(approved: readonly PlannedTrial[], current: readonly PlannedTrial[]): PlanDiff {
  const a = new Map(approved.map((t) => [t.nct_id, t])), c = new Map(current.map((t) => [t.nct_id, t]));
  return {
    added: [...c.keys()].filter((k) => !a.has(k)),
    removed: [...a.keys()].filter((k) => !c.has(k)),
    version_changed: [...c.keys()].filter((k) => a.has(k) && (a.get(k)!.source_version !== c.get(k)!.source_version || a.get(k)!.criteria !== c.get(k)!.criteria)),
  };
}
