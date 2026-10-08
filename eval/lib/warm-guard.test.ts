import { describe, expect, it } from "vitest";
import { diffPlans, estTokens, planFingerprint, SpendGuard, worstAttemptUsd, type PlannedTrial } from "./warm-guard";

describe("SpendGuard: the dollar bound holds BEFORE dispatch", () => {
  it("refuses an attempt that could push actual + in-flight worst case over the budget", () => {
    const g = new SpendGuard(0.01, 100);
    const a = g.tryReserve(0.004), b = g.tryReserve(0.004);
    expect(a.ok && b.ok).toBe(true);
    const c = g.tryReserve(0.004); // 0.012 > 0.01
    expect(c).toEqual({ ok: false, reason: "budget" });
    if (a.ok) g.settle(a.reservation, 0.001); // the real cost was lower: room is freed
    expect(g.tryReserve(0.004).ok).toBe(true);
  });

  it("property: with every actual <= its worst case, spend never exceeds the budget, whatever the interleaving", () => {
    for (let seed = 1; seed <= 200; seed++) {
      let s = seed;
      const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
      const budget = 0.05 + rnd() * 0.5, g = new SpendGuard(budget, 500);
      const open: Array<{ r: { id: number; worst: number } }> = [];
      for (let i = 0; i < 400; i++) {
        if (open.length && (rnd() < 0.5 || open.length >= 6)) {
          const { r } = open.splice(Math.floor(rnd() * open.length), 1)[0]!;
          g.settle(r, rnd() < 0.1 ? null : r.worst * rnd());
        } else {
          const t = g.tryReserve(0.002 + rnd() * 0.009);
          if (t.ok) open.push({ r: t.reservation });
        }
        expect(g.upperBoundUsd).toBeLessThanOrEqual(budget + 1e-9);
      }
      for (const { r } of open) g.settle(r, r.worst);
      expect(g.spentUsd).toBeLessThanOrEqual(budget + 1e-9);
    }
  });

  it("unavailable usage is charged at the worst case, never at zero", () => {
    const g = new SpendGuard(1, 10);
    const t = g.tryReserve(0.3);
    if (t.ok) g.settle(t.reservation, null);
    expect(g.spentUsd).toBeCloseTo(0.3);
  });

  it("an attempt that costs more than its worst case halts all further dispatch (fail closed)", () => {
    const g = new SpendGuard(1, 10);
    const t = g.tryReserve(0.01);
    if (t.ok) g.settle(t.reservation, 0.02);
    expect(g.halted).toBe("estimate_violated");
    expect(g.tryReserve(0.001)).toEqual({ ok: false, reason: "halted" });
  });

  it("the attempt ceiling is separate and also enforced; refused attempts are not counted", () => {
    const g = new SpendGuard(10, 2);
    expect(g.tryReserve(0.001).ok && g.tryReserve(0.001).ok).toBe(true);
    expect(g.tryReserve(0.001)).toEqual({ ok: false, reason: "attempts" });
    expect(g.attempts).toBe(2);
  });

  it("rejects nonsense config and double settlement", () => {
    expect(() => new SpendGuard(0, 5)).toThrow();
    expect(() => new SpendGuard(1, 0)).toThrow();
    const g = new SpendGuard(1, 5);
    const t = g.tryReserve(0.1);
    if (t.ok) { g.settle(t.reservation, 0.05); expect(() => g.settle(t.reservation, 0.05)).toThrow(); }
  });
});

describe("estimates and plan fingerprint", () => {
  it("token estimate is conservative (>= chars/4) and worst-case dollars use the output cap", () => {
    expect(estTokens(10_000)).toBeGreaterThan(10_000 / 4);
    expect(worstAttemptUsd(2000, 8192, { p: 3e-7, c: 9e-7 })).toBeCloseTo(2000 * 3e-7 + 8192 * 9e-7);
  });
  const T = (id: string, sv = "2026-01-01", n = 5): PlannedTrial => ({ nct_id: id, source_version: sv, criteria: n, chunks: Math.ceil(n / 15) });
  it("fingerprint is stable, and changes with membership, order, version, parser version or policy", () => {
    const base = [T("NCT1"), T("NCT2")];
    const f = planFingerprint("p1", "pol", base);
    expect(planFingerprint("p1", "pol", [T("NCT1"), T("NCT2")])).toBe(f);
    for (const other of [[T("NCT2"), T("NCT1")], [T("NCT1")], [T("NCT1"), T("NCT2", "2026-02-02")], [T("NCT1"), T("NCT2", "2026-01-01", 20)]]) expect(planFingerprint("p1", "pol", other)).not.toBe(f);
    expect(planFingerprint("p2", "pol", base)).not.toBe(f);
    expect(planFingerprint("p1", "other", base)).not.toBe(f);
  });
  it("diffPlans reports added, removed and changed trials", () => {
    const d = diffPlans([T("A"), T("B"), T("C")], [T("B"), T("C", "2026-09-09"), T("D")]);
    expect(d).toEqual({ added: ["D"], removed: ["A"], version_changed: ["C"] });
  });
});
