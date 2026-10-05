import { describe, expect, it } from "vitest";
import { DEFAULT_RESERVATION, RunBudget, SLOT_COST } from "./run-plan";

describe("RunBudget (MAX_LLM_CALLS_PER_RUN = 80)", () => {
  it("never grants more slots than fit when every call retries", () => {
    const b = new RunBudget(80);
    let granted = 0;
    // greedy worst case: hammer every stage far beyond demand
    for (let i = 0; i < 500; i++) for (const s of ["extraction", "parse", "evaluate", "verify", "escalate"] as const) if (b.take(s)) granted++;
    expect(granted).toBe(40);
    expect(b.worstCaseCalls).toBe(80);
    expect(b.worstCaseCalls).toBeLessThanOrEqual(80);
  });
  it("parse + evaluate can never consume the verify/escalate/extraction reservation", () => {
    const b = new RunBudget(80);
    let heavy = 0;
    for (let i = 0; i < 500; i++) { if (b.take("parse")) heavy++; if (b.take("evaluate")) heavy++; }
    const r = DEFAULT_RESERVATION;
    expect(heavy).toBe(40 - r.extraction - r.verify - r.escalate);
    // verification still has its full reserve
    let verify = 0;
    while (b.take("verify")) verify++;
    expect(verify).toBeGreaterThanOrEqual(r.verify);
  });
  it("unused reserve flows forward after release()", () => {
    const b = new RunBudget(80);
    b.release("escalate");
    let evaluate = 0;
    while (b.take("evaluate")) evaluate++;
    expect(evaluate).toBe(40 - 1 - 8); // everything except extraction + verify reserves
  });
  it("warm cache: parse needs 0 slots, all of them remain for evaluate/verify", () => {
    const b = new RunBudget(80);
    expect(b.stats().parse).toBe(0);
    let evaluate = 0;
    while (b.take("evaluate")) evaluate++;
    expect(evaluate).toBe(28);
  });
  it("rejects a reservation larger than the budget", () => {
    expect(() => new RunBudget(10, { extraction: 1, verify: 8, escalate: 3 })).toThrow();
  });
  it("SLOT_COST reserves the retry", () => expect(SLOT_COST).toBe(2));
});
