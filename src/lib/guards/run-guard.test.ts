import { describe, expect, it } from "vitest";
import { clientIp, createRunGuard, dayKey, ipBucket } from "./run-guard";

const counters = () => {
  const m = new Map<string, number>();
  const expired: string[] = [];
  return { m, expired, port: { incr: async (k: string) => { m.set(k, (m.get(k) ?? 0) + 1); return m.get(k)!; }, expire: async (k: string) => { expired.push(k); } } };
};

describe("run guard", () => {
  it("allows within limits and sets a TTL on the first daily increment", async () => {
    const c = counters();
    const g = createRunGuard({ limiter: { limit: async () => ({ success: true }) }, counter: c.port, dailyBudget: 2, now: () => new Date("2026-10-06T12:00:00Z") });
    expect(await g.check("1.2.3.4")).toEqual({ ok: true });
    expect(c.expired).toEqual([dayKey(new Date("2026-10-06T00:00:00Z"))]);
    expect(await g.check("1.2.3.4")).toEqual({ ok: true });
    expect(await g.check("1.2.3.4")).toEqual({ ok: false, reason: "budget_exhausted" });
  });

  it("rate-limited visitors do not consume the global daily budget", async () => {
    const c = counters();
    const g = createRunGuard({ limiter: { limit: async () => ({ success: false }) }, counter: c.port, dailyBudget: 1 });
    expect(await g.check("9.9.9.9")).toEqual({ ok: false, reason: "rate_limited" });
    expect(c.m.size).toBe(0);
  });

  it("any Redis failure degrades to guard_unavailable (caller falls back to replay), never throws", async () => {
    const g = createRunGuard({ limiter: { limit: async () => { throw new Error("down"); } }, counter: counters().port, dailyBudget: 1 });
    expect(await g.check("1.1.1.1")).toEqual({ ok: false, reason: "guard_unavailable" });
  });

  it("buckets are hashed IPs; daily key is the UTC day", () => {
    expect(ipBucket("1.2.3.4")).toMatch(/^[0-9a-f]{24}$/);
    expect(ipBucket("1.2.3.4")).not.toContain("1.2.3.4");
    expect(dayKey(new Date("2026-10-06T23:59:59Z"))).toBe("tl:runs:2026-10-06");
  });

  it("clientIp prefers the first x-forwarded-for hop", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "5.6.7.8, 10.0.0.1" }))).toBe("5.6.7.8");
    expect(clientIp(new Headers({ "x-real-ip": "4.4.4.4" }))).toBe("4.4.4.4");
    expect(clientIp(new Headers())).toBe("unknown");
  });
});
