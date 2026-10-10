// The in-flight gate must be released BEFORE the response stream closes (an instance can be frozen once the response ends, losing a late decrement).
import { describe, expect, it } from "vitest";
import { MemoryReplayStore } from "@/lib/cache/replay";
import { createRunGuard } from "@/lib/guards/run-guard";
import { handleRun, type RunHandlerDeps } from "@/lib/pipeline/handler";
import { fakeDeps, trial } from "./test-fakes";

const allow = createRunGuard({ limiter: { limit: async () => ({ success: true }) }, counter: { incr: async () => 1, expire: async () => 0 }, dailyBudget: 10 });
const req = () => new Request("http://x/api/run", { method: "POST", body: JSON.stringify({ text: "fictional profile text" }) });

function deps(release: () => Promise<void>): RunHandlerDeps {
  return {
    maxInputChars: 4000, replayFallbackEnabled: true, visitorInputMode: "open", guard: () => allow, replay: new MemoryReplayStore(),
    makePipeline: () => fakeDeps([trial("NCT00000001", ["Age 18 years or older."])]),
    gate: () => ({ acquire: async () => ({ ok: true as const, release }) }),
    ip: () => "1.2.3.4", log: () => undefined,
  };
}
const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("in-flight release ordering", () => {
  it("the stream stays open until the release has completed, and closes right after it", async () => {
    let finishRelease!: () => void;
    let released = false;
    const gate = new Promise<void>((r) => (finishRelease = r));
    const res = await handleRun(req(), deps(async () => { await gate; released = true; }));
    const reader = res.body!.getReader();
    let sawDone = false, closed = false;
    const dec = new TextDecoder();
    // read until the done event has been delivered
    while (!sawDone) {
      const { done, value } = await reader.read();
      if (done) { closed = true; break; }
      if (dec.decode(value).includes('"type":"done"')) sawDone = true;
    }
    expect(sawDone).toBe(true);
    expect(closed).toBe(false);
    const next = reader.read().then((r) => ({ closedAt: released, done: r.done }));
    await tick(50);
    expect(released).toBe(false); // release still pending, so the stream must not have ended yet
    finishRelease();
    expect(await next).toEqual({ closedAt: true, done: true }); // closed only after release completed
  });

  it("a hung release cannot hold the response open forever (bounded wait)", async () => {
    const res = await handleRun(req(), deps(() => new Promise<void>(() => undefined)));
    const t0 = Date.now();
    await res.text();
    expect(Date.now() - t0).toBeLessThan(4000);
  }, 10_000);

  it("a release that fails still lets the stream finish", async () => {
    const res = await handleRun(req(), deps(async () => { throw new Error("redis down"); }));
    expect(await res.text()).toContain('"type":"done"');
  });
});
