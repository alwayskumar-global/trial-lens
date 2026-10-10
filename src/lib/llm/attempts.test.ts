// What llm_calls counts (HTTP request attempts, capped) versus what usage `calls` counts (logical callJson calls). No network.
import OpenAI from "openai";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { CallCap, callJson } from "./client";
import { UsageMeter } from "./usage";

const Schema = z.object({ ok: z.boolean() });
const reply = (content: string) => ({ choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
const rateLimit = () => new OpenAI.RateLimitError(429, { message: "x" }, "x", new Headers());
// steps: a reply string, or "429"
function client(steps: string[]) {
  let i = 0;
  const c = { chat: { completions: { create: async () => { const s = steps[i++]; if (s === "429") throw rateLimit(); return reply(s ?? '{"ok":true}'); } } } } as unknown as OpenAI;
  return { c, sent: () => i };
}
const args = (c: OpenAI, cap: CallCap) => ({ client: c, cap, model: "m", mode: "prompt_only" as const, system: "S", user: "U", schema: Schema, schemaName: "s" });

describe("attempt accounting", () => {
  it("a 429 backoff retry takes a cap slot but is part of ONE logical call (llm_calls 2, usage calls 1)", async () => {
    vi.useFakeTimers();
    try {
      const cap = new CallCap(10);
      const meter = new UsageMeter();
      const f = client(["429", '{"ok":true}']);
      const p = callJson(args(f.c, cap));
      await vi.advanceTimersByTimeAsync(1000);
      const { data, stats } = await p;
      meter.record("parse", "MID", stats);
      expect(data).toEqual({ ok: true });
      expect(stats).toMatchObject({ attempts: 1, responses: 1, rateLimited: 1 }); // the 429 returned no response and no tokens
      expect(cap.used).toBe(2);
      expect(meter.snapshot().total.calls).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cap.used equals requests actually sent; the usage meter counts the logical call once", async () => {
    const cap = new CallCap(10);
    const meter = new UsageMeter();
    const f = client(['{"ok":"no"}', '{"ok":true}']); // validation retry: 2 requests, 1 logical call
    const { data, stats } = await callJson(args(f.c, cap));
    meter.record("parse", "MID", stats);
    expect(data).toEqual({ ok: true });
    expect(f.sent()).toBe(2);
    expect(cap.used).toBe(2); // llm_calls
    expect(meter.snapshot().total.calls).toBe(1); // usage.total.calls
    expect(meter.snapshot().total).toMatchObject({ calls_with_usage: 1, prompt_tokens: 20, completion_tokens: 10 });
  });
});

describe("the call cap reports attempts accurately", () => {
  it("never counts a refused attempt: used stops at max and nothing is sent past it", async () => {
    const cap = new CallCap(2);
    const f = client(['{"ok":true}', '{"ok":true}', '{"ok":true}', '{"ok":true}']);
    const meter = new UsageMeter();
    const results = [];
    for (let i = 0; i < 4; i++) {
      const r = await callJson(args(f.c, cap));
      meter.record("parse", "MID", r.stats);
      results.push(r);
    }
    expect(f.sent()).toBe(2);
    expect(cap.used).toBe(2); // not 5 or 6: refused attempts are not counted
    expect(results.map((r) => r.data !== null)).toEqual([true, true, false, false]);
    expect(results[2]!.stats).toMatchObject({ attempts: 0, errorKind: "CALL_CAP_EXCEEDED" });
    expect(meter.snapshot().total.calls).toBe(2); // refused calls sent nothing and are not accounted
  });

  it("a validation retry refused by the cap keeps the attempt that WAS sent (attempts 1) and counts it once", async () => {
    const cap = new CallCap(1);
    const f = client(['{"ok":"no"}']);
    const meter = new UsageMeter();
    const { data, stats } = await callJson(args(f.c, cap));
    meter.record("parse", "MID", stats);
    expect(data).toBeNull();
    expect(stats).toMatchObject({ attempts: 1, errorKind: "CALL_CAP_EXCEEDED", responses: 1 });
    expect(cap.used).toBe(1);
    expect(meter.snapshot().total.calls).toBe(1);
  });
});
