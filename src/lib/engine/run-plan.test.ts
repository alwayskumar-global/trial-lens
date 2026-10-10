import { describe, expect, it } from "vitest";
import { DEFAULT_RESERVATION, planLedger, RunBudget, SLOT_COST } from "./run-plan";

describe("RunBudget (MAX_LLM_CALLS_PER_RUN = 80)", () => {
  it("never grants more slots than fit when every call retries", () => {
    const b = new RunBudget(80);
    let granted = 0;
    // greedy worst case: hammer every stage far beyond demand
    for (let i = 0; i < 500; i++) for (const s of ["extraction", "parse", "evaluate", "verify", "mismatch", "escalate"] as const) if (b.take(s)) granted++;
    expect(granted).toBe(40);
    expect(b.worstCaseCalls).toBe(80);
    expect(b.worstCaseCalls).toBeLessThanOrEqual(80);
  });
  it("parse + evaluate can never consume the verify/escalate/extraction reservation", () => {
    const b = new RunBudget(80);
    let heavy = 0;
    for (let i = 0; i < 500; i++) { if (b.take("parse")) heavy++; if (b.take("evaluate")) heavy++; }
    const r = DEFAULT_RESERVATION;
    expect(heavy).toBe(40 - r.extraction - r.verify - r.mismatch - r.escalate);
    // verification still has its full reserve
    let verify = 0;
    while (b.take("verify")) verify++;
    expect(verify).toBeGreaterThanOrEqual(r.verify);
  });
  it("unused reserve flows forward after release()", () => {
    const b = new RunBudget(80);
    b.release("verify");
    let evaluate = 0;
    while (b.take("evaluate")) evaluate++;
    expect(evaluate).toBe(40 - 1 - 3); // verify reserve (8) released to the shared pool; extraction 1 + mismatch 3 stay reserved
  });
  it("warm cache: parse needs 0 slots, all of them remain for evaluate/verify", () => {
    const b = new RunBudget(80);
    expect(b.stats().parse).toBe(0);
    let evaluate = 0;
    while (b.take("evaluate")) evaluate++;
    expect(evaluate).toBe(28 - 0);
  });
  it("parse is capped so a cold cache cannot starve evaluate", () => {
    const b = new RunBudget(80);
    let parse = 0;
    while (b.take("parse")) parse++;
    expect(parse).toBe(14);
    let evaluate = 0;
    while (b.take("evaluate")) evaluate++;
    expect(evaluate).toBe(14); // 28 shared − 14 parse
  });
  it("worst case with caps still ≤ 80 calls when every slot retries", () => {
    const b = new RunBudget(80);
    for (let i = 0; i < 200; i++) for (const s of ["extraction", "parse", "evaluate", "verify", "mismatch", "escalate"] as const) b.take(s);
    expect(b.worstCaseCalls).toBeLessThanOrEqual(80);
  });
  it("rejects a reservation larger than the budget", () => {
    expect(() => new RunBudget(10, { extraction: 1, verify: 8, mismatch: 3, escalate: 0 })).toThrow();
  });
  it("SLOT_COST reserves the retry", () => expect(SLOT_COST).toBe(2));

  it("evaluation never reads the mismatch reserve, and mismatch never takes evaluate's slots", () => {
    const b = new RunBudget(80);
    for (let i = 0; i < 500; i++) { b.take("evaluate"); b.take("parse"); }
    let mismatch = 0;
    while (b.take("mismatch")) mismatch++;
    expect(mismatch).toBeGreaterThanOrEqual(DEFAULT_RESERVATION.mismatch);
  });
});

describe("planLedger: reassigning the 3 escalation slots to mismatch checks", () => {
  it("default reservation: extraction 1, verify 8, mismatch 3, escalate 0 ⇒ 12 reserved, 28 shared, 40 slots / 80 calls", () => {
    expect(DEFAULT_RESERVATION).toEqual({ extraction: 1, verify: 8, mismatch: 3, escalate: 0 });
    const b = new RunBudget(80);
    expect(b.totalSlots).toBe(40);
    expect(b.stats().sharedLeft).toBe(28);
    expect(planLedger(80, {}).totalSlots).toBe(40);
  });
  it("WARM run 2 demand (parse 0, evaluate 21, verify 8, mismatch 12): evaluation fully covered, 10 of 12 checks covered", () => {
    const l = planLedger(80, { extraction: 1, parse: 0, evaluate: 21, verify: 8, mismatch: 12 });
    expect(l.granted.evaluate).toBe(21);
    expect(l.uncovered.evaluate).toBe(0);
    expect(l.granted.mismatch).toBe(10);
    expect(l.uncovered.mismatch).toBe(2); // those 2 trials stay UNCERTAIN (no_capacity)
    expect(l.slotsGranted).toBe(40);
    expect(l.worstCaseCalls).toBe(80);
  });
  it("COLD run 1 demand (parse 14, evaluate 12, verify 6, mismatch 4): everything covered, verify's unused reserve flows on", () => {
    const l = planLedger(80, { extraction: 1, parse: 14, evaluate: 12, verify: 6, mismatch: 4 });
    expect(l.uncovered).toMatchObject({ parse: 0, evaluate: 0, verify: 0, mismatch: 0 });
    expect(l.slotsGranted).toBe(37);
    expect(l.worstCaseCalls).toBe(74);
  });
  it("a flood of mismatch candidates cannot cut free-text evaluation", () => {
    const l = planLedger(80, { extraction: 1, parse: 0, evaluate: 21, verify: 8, mismatch: 30 });
    expect(l.granted.evaluate).toBe(21);
    expect(l.uncovered.mismatch).toBe(30 - 10);
    expect(l.worstCaseCalls).toBeLessThanOrEqual(80);
  });
  it("verification of STRONG/POSSIBLE keeps its full reserve however large evaluation demand is", () => {
    const l = planLedger(80, { extraction: 1, parse: 99, evaluate: 99, verify: 8, mismatch: 5 });
    expect(l.granted.verify).toBe(8);
    expect(l.granted.extraction).toBe(1);
    expect(l.worstCaseCalls).toBeLessThanOrEqual(80);
  });
});
