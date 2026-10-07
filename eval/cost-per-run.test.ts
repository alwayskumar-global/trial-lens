import { describe, expect, it } from "vitest";
import { SLOT_COST } from "../src/lib/engine/run-plan";
import { checkDailyBudget, cost, DEFAULTS, typicalRun, worstCasePerRun } from "./cost-per-run";

describe("worstCasePerRun follows the cap", () => {
  it("matches the hand calculation for the shipped cap (80 calls = 40 slots: 1 FAST, 39 MID)", () => {
    const hand = 2 * cost("FAST", 700, 8192) + 39 * 2 * cost("MID", 4000, 8192);
    expect(SLOT_COST).toBe(2);
    expect(worstCasePerRun(80)).toBeCloseTo(hand, 10);
    expect(worstCasePerRun(80)).toBeCloseTo(0.673, 3);
  });
  it("is monotonic in the cap and a smaller cap lowers it", () => {
    expect(worstCasePerRun(60)).toBeLessThan(worstCasePerRun(80));
    expect(worstCasePerRun(100)).toBeGreaterThan(worstCasePerRun(80));
    expect(worstCasePerRun(2)).toBeCloseTo(2 * cost("FAST", 700, 8192), 10); // one slot: extraction only
  });
});

describe("checkDailyBudget (a projection, never an enforced dollar limit)", () => {
  it("fails when the worst case does not fit and reports how many runs would", () => {
    const r = checkDailyBudget({ dailyDollars: 50 });
    expect(r.worstDaily).toBeCloseTo(DEFAULTS.dailyRuns * worstCasePerRun(80), 6);
    expect(r.fitsWorstCase).toBe(false);
    expect(r.maxRunsAtWorstCase).toBe(Math.floor(50 / worstCasePerRun(80)));
    expect(r.maxRunsAtWorstCase).toBeLessThan(DEFAULTS.dailyRuns);
  });
  it("passes when the dollar figure covers the projected worst case", () => {
    const r = checkDailyBudget({ dailyDollars: 150 * worstCasePerRun(80) + 0.01 });
    expect(r.fitsWorstCase).toBe(true);
    expect(r.maxRunsAtWorstCase).toBeGreaterThanOrEqual(150);
  });
  it("typical figures are lower than the worst case and ordered low <= high", () => {
    const r = checkDailyBudget({ dailyDollars: 100 });
    expect(r.typicalDailyLow).toBeLessThan(r.typicalDailyHigh);
    expect(r.typicalDailyHigh).toBeLessThan(r.worstDaily);
    expect(r.typicalDailyLow).toBeCloseTo(DEFAULTS.dailyRuns * typicalRun(41, 2800, 2200), 6);
  });
  it("follows a changed run limit and a changed cap", () => {
    expect(checkDailyBudget({ dailyDollars: 100, dailyRuns: 50 }).worstDaily).toBeCloseTo(50 * worstCasePerRun(80), 6);
    expect(checkDailyBudget({ dailyDollars: 100, maxCalls: 40 }).worstPerRun).toBeCloseTo(worstCasePerRun(40), 10);
  });
  it("zero or tiny budgets fit no runs and never claim to be a limit", () => {
    const r = checkDailyBudget({ dailyDollars: 0.1 });
    expect(r.maxRunsAtWorstCase).toBe(0);
    expect(r.enforcement).toBe("call-count-only");
    expect(Object.keys(r)).not.toContain("limit");
  });
  it("leaves the shipped defaults unchanged: 80 calls per run, 150 runs per day", () => {
    expect(DEFAULTS).toEqual({ maxCalls: 80, dailyRuns: 150 });
  });
});
