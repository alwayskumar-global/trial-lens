import { describe, expect, it } from "vitest";
import { dispatchJob, PortError, runJobs, type ChatPort, type ChatReply, type ChatRequest, type Job } from "./warm-dispatch";
import { SpendGuard } from "./warm-guard";

const price = { p: 3e-7, c: 9e-7 };
const MAXTOK = 8192;
const BIG = "c".repeat(6000); // realistic bodies are 13-17 KB; usage below must stay under the byte bound
const request = (user = BIG): ChatRequest => ({ messages: [{ role: "system", content: "SYS" }, { role: "user", content: user }], max_tokens: MAXTOK });
const job = (id: string, user = BIG): Job<{ ok: boolean }> => ({
  id, request: request(user),
  validate: (c) => { try { const j = JSON.parse(c) as { ok?: unknown }; return j.ok === true ? { ok: true, data: { ok: true } } : { ok: false, problem: "ok missing" }; } catch { return { ok: false, problem: "not json" }; } },
});
const good = (p = 1000, c = 500): ChatReply => ({ content: '{"ok":true}', usage: { prompt_tokens: p, completion_tokens: c } });
const cost = (p: number, c: number) => p * price.p + c * price.c;
const sleeps: number[] = [];
const sleep = async (ms: number) => { sleeps.push(ms); };

// A port that records concurrency and the guard's committed bound at call time.
function port(script: (req: ChatRequest, n: number) => ChatReply | PortError | Promise<ChatReply | PortError>, guard: SpendGuard) {
  let n = 0, active = 0;
  const seen = { maxActive: 0, maxBound: 0, calls: 0, bodies: [] as number[] };
  const p: ChatPort = {
    async create(req) {
      seen.calls++; active++; seen.maxActive = Math.max(seen.maxActive, active); seen.maxBound = Math.max(seen.maxBound, guard.upperBoundUsd);
      seen.bodies.push(Buffer.byteLength(JSON.stringify(req)));
      try { await Promise.resolve(); const r = await script(req, n++); if (r instanceof PortError) throw r; return r; } finally { active--; }
    },
  };
  return { p, seen };
}

describe("dispatchJob: every HTTP attempt is reserved, then reconciled with reported usage", () => {
  it("settles at the REPORTED cost, not the reservation", async () => {
    const guard = new SpendGuard(1, 10); const { p } = port(() => good(1000, 500), guard);
    const r = await dispatchJob({ port: p, guard, price, sleep }, job("a"));
    expect(r).toMatchObject({ status: "parsed", attempts: 1 });
    expect(guard.spentUsd).toBeCloseTo(cost(1000, 500), 12);
    expect(guard.upperBoundUsd).toBeCloseTo(cost(1000, 500), 12);
  });

  it("a validation retry is a SECOND reservation sized from the real (larger) retry body", async () => {
    const guard = new SpendGuard(1, 10);
    const { p, seen } = port((_, n) => (n === 0 ? { content: "not json", usage: { prompt_tokens: 800, completion_tokens: 100 } } : good(1200, 300)), guard);
    const r = await dispatchJob({ port: p, guard, price, sleep }, job("a"));
    expect(r).toMatchObject({ status: "parsed", attempts: 2 });
    expect(guard.attempts).toBe(2);
    expect(seen.bodies[1]!).toBeGreaterThan(seen.bodies[0]!); // echo + correction note
    expect(guard.spentUsd).toBeCloseTo(cost(800, 100) + cost(1200, 300), 12);
  });

  it("gives up after the one validation retry", async () => {
    const guard = new SpendGuard(1, 10); const { p } = port(() => ({ content: "nope", usage: { prompt_tokens: 10, completion_tokens: 5 } }), guard);
    expect(await dispatchJob({ port: p, guard, price, sleep }, job("a"))).toMatchObject({ status: "unparsed", reason: "invalid_after_retry", attempts: 2 });
  });

  it("a 429 backs off (1 s, 2 s), is charged its WORST case (no billing evidence that it is free) and consumes an attempt slot", async () => {
    sleeps.length = 0;
    const guard = new SpendGuard(1, 10); const { p, seen } = port((_, n) => (n < 2 ? new PortError("rate_limited") : good(500, 100)), guard);
    const r = await dispatchJob({ port: p, guard, price, sleep }, job("a"));
    expect(r).toMatchObject({ status: "parsed", attempts: 3 });
    expect(sleeps).toEqual([1000, 2000]);
    expect(guard.attempts).toBe(3);
    const worst = (bytes: number) => (bytes + 64) * price.p + MAXTOK * price.c;
    expect(guard.spentUsd).toBeCloseTo(worst(seen.bodies[0]!) + worst(seen.bodies[1]!) + cost(500, 100), 12); // two 429s at worst case + the real reply
    const tight = new SpendGuard(1, 1); const q = port(() => new PortError("rate_limited"), tight);
    expect(await dispatchJob({ port: q.p, guard: tight, price, sleep }, job("b"))).toMatchObject({ status: "unparsed", reason: "refused_attempts" }); // ceiling counts 429 attempts
  });

  it("repeated 429s cannot run away: each is reserved and charged, so the budget stops them", async () => {
    const guard = new SpendGuard(0.03, 1000); const { p, seen } = port(() => new PortError("rate_limited"), guard);
    const s = await runJobs({ port: p, guard, price, sleep }, Array.from({ length: 10 }, (_, i) => job(`j${i}`)), { calibration: 1, concurrency: 4 });
    expect(s.parsed).toBe(0);
    expect(guard.spentUsd).toBeLessThanOrEqual(0.03 + 1e-9);
    expect(seen.calls).toBeLessThanOrEqual(Math.floor(0.03 / ((Math.min(...seen.bodies) + 64) * price.p + MAXTOK * price.c)) + 1);
  });

  it("a timeout, network or HTTP error is charged at the WORST case (generation may have happened)", async () => {
    for (const kind of ["timeout", "network", "http"] as const) {
      const guard = new SpendGuard(1, 10); const { p, seen } = port(() => new PortError(kind), guard);
      const r = await dispatchJob({ port: p, guard, price, sleep }, job("a"));
      expect(r.status).toBe("unparsed");
      const worst = (seen.bodies[0]! + 64) * price.p + MAXTOK * price.c;
      expect(guard.spentUsd).toBeCloseTo(worst, 12);
    }
  });
});

describe("stop when an assumption fails", () => {
  it("missing usage: charged at the worst case, the job is still parsed, all further dispatch halts", async () => {
    const guard = new SpendGuard(1, 100); const { p, seen } = port((_, n) => (n === 0 ? { content: '{"ok":true}' } : good()), guard);
    const s = await runJobs({ port: p, guard, price, sleep }, [job("a"), job("b"), job("c")], { calibration: 1, concurrency: 3 });
    expect(s.results[0]).toMatchObject({ status: "parsed" });
    expect(s.results.slice(1).every((r) => r.status === "unparsed" && r.reason === "halted")).toBe(true);
    expect(s.halted).toBe("usage_unavailable");
    expect(seen.calls).toBe(1);
    expect(guard.spentUsd).toBeCloseTo((seen.bodies[0]! + 64) * price.p + MAXTOK * price.c, 12);
  });

  it("completion tokens above max_tokens halt dispatch even when the dollar reservation was not exceeded", async () => {
    const guard = new SpendGuard(1, 100); const { p } = port(() => good(10, MAXTOK + 8), guard);
    const s = await runJobs({ port: p, guard, price, sleep }, [job("a"), job("b")], { calibration: 1, concurrency: 2 });
    expect(s.halted).toBe("completion_exceeds_max_tokens");
    expect(s.results[1]).toMatchObject({ status: "unparsed", reason: "halted" });
  });

  it("prompt tokens above the byte bound halt dispatch", async () => {
    const guard = new SpendGuard(1, 100); const { p } = port(() => good(1_000_000, 10), guard);
    const s = await runJobs({ port: p, guard, price, sleep }, [job("a"), job("b")], { calibration: 1, concurrency: 2 });
    expect(s.halted).not.toBeNull();
    expect(s.results[1]).toMatchObject({ status: "unparsed", reason: "halted" });
  });

  it("calibration gate: the first K jobs run strictly one at a time and a violation there stops everything before concurrency opens", async () => {
    const guard = new SpendGuard(10, 100); const { p, seen } = port((_, n) => (n === 0 ? good(10, MAXTOK + 1) : good()), guard);
    const s = await runJobs({ port: p, guard, price, sleep }, Array.from({ length: 10 }, (_, i) => job(`j${i}`)), { calibration: 3, concurrency: 6 });
    expect(seen.maxActive).toBe(1);
    expect(seen.calls).toBe(1);
    expect(s.parsed).toBe(1);
    expect(s.halted).toBe("completion_exceeds_max_tokens");
  });

  it("calibration passes, then concurrency opens up to the limit", async () => {
    const guard = new SpendGuard(10, 100); const { p, seen } = port(async () => { await new Promise((r) => setTimeout(r, 2)); return good(); }, guard);
    const s = await runJobs({ port: p, guard, price, sleep }, Array.from({ length: 12 }, (_, i) => job(`j${i}`)), { calibration: 3, concurrency: 4 });
    expect(s.parsed).toBe(12);
    expect(seen.maxActive).toBeGreaterThan(1);
    expect(seen.maxActive).toBeLessThanOrEqual(4);
  });
});

describe("concurrent in-flight reservations and the ceilings", () => {
  const worstOne = (bytes: number) => (bytes + 64) * price.p + MAXTOK * price.c;

  it("in-flight reservations count against the budget: parallel workers wait for room instead of overspending, and every job still completes", async () => {
    const guard = new SpendGuard(0.05, 1000); // room for ~5 worst-case attempts (~$0.0092 each) at a time; 20 jobs cost $0.036 in total
    const { p, seen } = port(async () => { await new Promise((r) => setTimeout(r, 3)); return good(1500, 1500); }, guard);
    const s = await runJobs({ port: p, guard, price, sleep }, Array.from({ length: 20 }, (_, i) => job(`j${i}`)), { calibration: 1, concurrency: 8 });
    expect(seen.maxBound).toBeLessThanOrEqual(0.05 + 1e-9);
    expect(seen.maxActive).toBeLessThanOrEqual(Math.floor(0.05 / worstOne(seen.bodies[0]!)));
    expect(s.parsed).toBe(20);
    expect(s.spentUsd).toBeCloseTo(20 * cost(1500, 1500), 10);
  });

  it("when even a single worst-case attempt does not fit, nothing is sent", async () => {
    const guard = new SpendGuard(0.005, 100); const { p, seen } = port(() => good(), guard);
    const s = await runJobs({ port: p, guard, price, sleep }, [job("a"), job("b")], { calibration: 1, concurrency: 2 });
    expect(seen.calls).toBe(0);
    expect(s.unparsed["refused_budget"]).toBe(2);
    expect(s.spentUsd).toBe(0);
  });

  it("the attempt ceiling stops dispatch (retries and 429s included)", async () => {
    const guard = new SpendGuard(10, 5); const { p, seen } = port(() => ({ content: "bad", usage: { prompt_tokens: 10, completion_tokens: 5 } }), guard);
    const s = await runJobs({ port: p, guard, price, sleep }, Array.from({ length: 6 }, (_, i) => job(`j${i}`)), { calibration: 1, concurrency: 3 });
    expect(seen.calls).toBe(5);
    expect(s.attempts).toBe(5);
  });

  it("property: across random costs, failures and concurrency, the committed bound never exceeds the budget at any call and spend stays within it", async () => {
    for (let seed = 1; seed <= 60; seed++) {
      let st = seed;
      const rnd = () => ((st = (st * 1664525 + 1013904223) % 4294967296) / 4294967296);
      const budget = 0.02 + rnd() * 0.3, ceiling = 5 + Math.floor(rnd() * 60);
      const guard = new SpendGuard(budget, ceiling);
      const { p, seen } = port((req) => {
        const x = rnd(), bytes = Buffer.byteLength(JSON.stringify(req));
        if (x < 0.1) return new PortError("rate_limited");
        if (x < 0.15) return new PortError("timeout");
        if (x < 0.3) return { content: "bad", usage: { prompt_tokens: Math.floor(rnd() * bytes), completion_tokens: Math.floor(rnd() * 3000) } };
        return good(Math.floor(rnd() * bytes), Math.floor(rnd() * 4000));
      }, guard);
      const s = await runJobs({ port: p, guard, price, sleep }, Array.from({ length: 15 }, (_, i) => job(`j${i}`, "x".repeat(200 + Math.floor(rnd() * 3000)))), { calibration: 2, concurrency: 1 + Math.floor(rnd() * 6) });
      expect(seen.maxBound).toBeLessThanOrEqual(budget + 1e-9);
      expect(s.attempts).toBeLessThanOrEqual(ceiling);
      expect(s.spentUsd).toBeLessThanOrEqual(budget + 1e-9);
      expect(s.halted).toBeNull(); // every simulated actual stayed within its reservation
    }
  });
});
