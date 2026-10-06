import { describe, expect, it } from "vitest";
import { MemoryReplayStore, type ReplayCase } from "@/lib/cache/replay";
import { createRunGuard } from "@/lib/guards/run-guard";
import { handleRun, type RunHandlerDeps } from "@/lib/pipeline/handler";
import { SseEventSchema, type SseEvent } from "@/schema/sse";
import { fakeDeps, PROFILE_TEXT, trial } from "./test-fakes";

const CASE: ReplayCase = {
  id: "demo-her2", label: "Fictional HER2-positive profile", profile_text: "fictional",
  events: [{ type: "stage", stage: "parse", status: "start" }, { type: "counts", discovered: 3, filtered: 2, analyzed: 2 }],
};

async function setup(over: Partial<RunHandlerDeps> = {}, withCase = true) {
  const replay = new MemoryReplayStore();
  if (withCase) await replay.put(CASE);
  const logs: Array<Record<string, string | number | boolean>> = [];
  const allow = createRunGuard({ limiter: { limit: async () => ({ success: true }) }, counter: { incr: async () => 1, expire: async () => 0 }, dailyBudget: 10 });
  const deps: RunHandlerDeps = {
    maxInputChars: 4000, replayFallbackEnabled: true, guard: () => allow, replay,
    makePipeline: () => fakeDeps([trial("NCT00000001", ["Age 18 years or older."])]),
    ip: () => "1.2.3.4", log: (l) => logs.push(l), ...over,
  };
  return { deps, logs };
}
const post = (body: unknown) => new Request("http://x/api/run", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });
const events = async (res: Response): Promise<SseEvent[]> =>
  (await res.text()).split("\n\n").filter(Boolean).map((chunk) => SseEventSchema.parse(JSON.parse(chunk.replace(/^data: /, ""))));

describe("POST /api/run handler", () => {
  it("rejects malformed, oversized, empty and ambiguous requests with fixed codes", async () => {
    const { deps } = await setup();
    expect((await handleRun(post("not json"), deps)).status).toBe(400);
    expect((await handleRun(post({}), deps)).status).toBe(400);
    expect((await handleRun(post({ text: "a", replay_id: "demo-her2" }), deps)).status).toBe(400);
    expect((await handleRun(post({ text: "   " }), deps)).status).toBe(400);
    expect((await handleRun(post({ text: "x", extra: 1 }), deps)).status).toBe(400);
    expect((await handleRun(post({ replay_id: "../etc/passwd" }), deps)).status).toBe(400);
    const big = await handleRun(post({ text: "x".repeat(4001) }), deps);
    expect(big.status).toBe(413);
    expect(await big.json()).toEqual({ code: "input_too_long" });
  });

  it("live run: labelled live, validated events, done with accounting; logs carry no patient text", async () => {
    const { deps, logs } = await setup();
    const res = await handleRun(post({ text: PROFILE_TEXT }), deps);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("cache-control")).toContain("no-store");
    const es = await events(res);
    expect(es[0]).toEqual({ type: "mode", mode: "live" });
    const done = es[es.length - 1] as Extract<SseEvent, { type: "done" }>;
    expect(done.type).toBe("done");
    expect(done.replay).toBe(false);
    expect(JSON.stringify(logs)).not.toContain("SENTINEL");
    expect(logs[0]).toMatchObject({ evt: "run", mode: "live", ok: true });
  });

  it("explicit replay streams the stored case, labelled as a replay, without touching the guard", async () => {
    let guardCalls = 0;
    const { deps } = await setup({ guard: () => { guardCalls++; throw new Error("must not be called"); } });
    const es = await events(await handleRun(post({ replay_id: "demo-her2" }), deps));
    expect(es[0]).toMatchObject({ type: "mode", mode: "replay", reason: "requested", replay_id: "demo-her2", label: CASE.label });
    expect(es.slice(1, -1)).toEqual(CASE.events);
    expect(es[es.length - 1]).toEqual({ type: "done", replay: true });
    expect(guardCalls).toBe(0);
  });

  it("rate limit, exhausted budget and a broken guard all fall back to a labelled replay", async () => {
    const mk = (limit: () => Promise<{ success: boolean }>, incr = async () => 1) => createRunGuard({ limiter: { limit }, counter: { incr, expire: async () => 0 }, dailyBudget: 1 });
    const cases: Array<[ReturnType<typeof mk>, string]> = [
      [mk(async () => ({ success: false })), "rate_limited"],
      [mk(async () => ({ success: true }), async () => 2), "budget_exhausted"],
      [mk(async () => { throw new Error("down"); }), "guard_unavailable"],
    ];
    for (const [g, reason] of cases) {
      const { deps } = await setup({ guard: () => g });
      const es = await events(await handleRun(post({ text: PROFILE_TEXT }), deps));
      expect(es[0]).toMatchObject({ type: "mode", mode: "replay", reason });
      expect(es[es.length - 1]).toEqual({ type: "done", replay: true });
    }
    const { deps } = await setup({ guard: () => { throw new Error("no redis env"); } });
    expect((await events(await handleRun(post({ text: PROFILE_TEXT }), deps)))[0]).toMatchObject({ reason: "guard_unavailable" });
  });

  it("with fallback disabled a refusal is an HTTP status, not a replay", async () => {
    const g = createRunGuard({ limiter: { limit: async () => ({ success: false }) }, counter: { incr: async () => 1, expire: async () => 0 }, dailyBudget: 1 });
    const { deps } = await setup({ guard: () => g, replayFallbackEnabled: false });
    expect((await handleRun(post({ text: PROFILE_TEXT }), deps)).status).toBe(429);
  });

  it("missing model env or a provider outage falls back to replay with an error event, never a blank stream", async () => {
    const a = await setup({ makePipeline: () => { throw new Error("env"); } });
    expect((await events(await handleRun(post({ text: PROFILE_TEXT }), a.deps)))[0]).toMatchObject({ mode: "replay", reason: "model_unavailable" });
    const b = await setup({ makePipeline: () => fakeDeps([], { facts: "fail" }) });
    const es = await events(await handleRun(post({ text: PROFILE_TEXT }), b.deps));
    expect(es.find((e) => e.type === "error")).toMatchObject({ code: "model_unavailable", fallback_to_replay: true });
    expect(es.find((e) => e.type === "mode" && e.mode === "replay")).toMatchObject({ reason: "model_unavailable" });
    expect(es[es.length - 1]).toEqual({ type: "done", replay: true });
    const c = await setup({ makePipeline: () => fakeDeps([], {}, { discover: async () => { throw new Error("x"); } }) });
    expect((await events(await handleRun(post({ text: PROFILE_TEXT }), c.deps))).find((e) => e.type === "mode" && e.mode === "replay")).toMatchObject({ reason: "ctgov_unavailable" });
  });

  it("when no replay exists the client still gets a friendly error event", async () => {
    const { deps } = await setup({}, false);
    const es = await events(await handleRun(post({ replay_id: "demo-her2" }), deps));
    expect(es).toEqual([{ type: "error", code: "replay_unavailable", message: "No saved example is available right now.", fallback_to_replay: false }]);
  });
});
