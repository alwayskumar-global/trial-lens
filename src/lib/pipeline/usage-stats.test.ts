import { describe, expect, it } from "vitest";
import { MemoryReplayStore } from "@/lib/cache/replay";
import { createRunGuard } from "@/lib/guards/run-guard";
import { handleRun, type RunHandlerDeps } from "@/lib/pipeline/handler";
import { runPipeline } from "@/lib/pipeline/run";
import { SseEventSchema, type SseEvent } from "@/schema/sse";
import { fakeDeps, PROFILE_TEXT, trial, type Script } from "./test-fakes";

const TRIALS = () => [trial("NCT00000001", ["Age 18 years or older.", "Willing to follow study procedures."]), trial("NCT00000002", ["Age 18 years or older."], ["Active infection requiring treatment."])];
const run = async (script: Script = {}) => {
  const es: SseEvent[] = [];
  await runPipeline(PROFILE_TEXT, fakeDeps(TRIALS(), script), (e) => es.push(e));
  return es;
};
const done = (es: SseEvent[]) => es[es.length - 1] as Extract<SseEvent, { type: "done" }>;

describe("run stats: token usage per stage and model", () => {
  it("done.stats.usage has one row per stage and model with counts, and every FAKE call is accounted for", async () => {
    const es = await run();
    const d = done(es);
    const u = d.stats!.usage!;
    expect(SseEventSchema.safeParse(d).success).toBe(true);
    expect(u.version).toBe("u-1");
    const stages = u.stages.map((r) => `${r.stage}:${r.tier}:${r.model}`);
    expect(stages).toContain("extraction:FAST:fake-fast");
    expect(stages).toContain("parse:MID:fake-mid");
    for (const r of u.stages) {
      expect(r.calls_without_usage).toBe(0);
      expect(r.prompt_tokens).toBe(100 * r.calls);
      expect(r.completion_tokens).toBe(50 * r.calls);
    }
    expect(u.total.calls).toBe(u.stages.reduce((n, r) => n + r.calls, 0));
    expect(u.total.calls).toBeLessThanOrEqual(d.stats!.llm_calls); // retries are HTTP calls inside one accounted call
    expect(u.total.prompt_tokens).toBe(100 * u.total.calls);
  });

  it("when the provider reports no usage the tokens are null (unavailable), never 0", async () => {
    const u = done(await run({ usage: "missing" })).stats!.usage!;
    expect(u.total.calls_with_usage).toBe(0);
    expect(u.total.calls_without_usage).toBe(u.total.calls);
    expect(u.total.prompt_tokens).toBeNull();
    expect(u.total.completion_tokens).toBeNull();
    for (const r of u.stages) {
      expect(r.prompt_tokens).toBeNull();
      expect(r.completion_tokens).toBeNull();
    }
  });

  it("no profile text, prompt, response or criterion text appears in the usage block", async () => {
    const d = done(await run());
    const usage = JSON.stringify(d.stats!.usage);
    expect(usage).not.toContain("SENTINEL");
    expect(usage).not.toMatch(/Age 18|Willing|infection|HER2|woman/i);
    expect(Object.keys(d.stats!).sort()).toEqual(["llm_calls", "usage", "wall_ms", "worst_case_calls"]);
  });

  it("usage is optional in the schema: a done event without it (older stored replays) still validates", () => {
    expect(SseEventSchema.safeParse({ type: "done", replay: true }).success).toBe(true);
    expect(SseEventSchema.safeParse({ type: "done", replay: false, stats: { llm_calls: 1, worst_case_calls: 2, wall_ms: 3 } }).success).toBe(true);
    expect(SseEventSchema.safeParse({ type: "done", replay: false, stats: { llm_calls: 1, worst_case_calls: 2, wall_ms: 3, usage: { version: "u-1", stages: [], total: { calls: 0, calls_with_usage: 0, calls_without_usage: 0, prompt_tokens: null, completion_tokens: null }, extra: "x" } } }).success).toBe(false); // strict
  });
});

describe("handler log: token usage is integers only and omitted when unavailable", () => {
  async function logsFor(script: Script) {
    const logs: Array<Record<string, string | number | boolean>> = [];
    const allow = createRunGuard({ limiter: { limit: async () => ({ success: true }) }, counter: { incr: async () => 1, expire: async () => 0 }, dailyBudget: 10 });
    const deps: RunHandlerDeps = { maxInputChars: 4000, replayFallbackEnabled: true, visitorInputMode: "open", guard: () => allow, replay: new MemoryReplayStore(), makePipeline: () => fakeDeps(TRIALS(), script), ip: () => "1.2.3.4", log: (l) => logs.push(l) };
    const res = await handleRun(new Request("http://x/api/run", { method: "POST", body: JSON.stringify({ text: PROFILE_TEXT }) }), deps);
    await res.text();
    return logs;
  }
  it("reported usage: totals and calls_without_usage 0 are logged", async () => {
    const [l] = await logsFor({});
    expect(l).toMatchObject({ evt: "run", ok: true, calls_without_usage: 0 });
    expect(typeof l!.prompt_tokens).toBe("number");
    expect(typeof l!.completion_tokens).toBe("number");
    expect(JSON.stringify(l)).not.toContain("SENTINEL");
  });
  it("no usage reported: the token fields are omitted (not 0) and calls_without_usage says why", async () => {
    const [l] = await logsFor({ usage: "missing" });
    expect(l).not.toHaveProperty("prompt_tokens");
    expect(l).not.toHaveProperty("completion_tokens");
    expect(l!.calls_without_usage).toBeGreaterThan(0);
  });
});
