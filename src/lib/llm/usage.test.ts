import { describe, expect, it } from "vitest";
import { UsageMeter } from "./usage";

const ok = (model: string, prompt: number, completion: number, attempts = 1) => ({ attempts, model, usageComplete: true, promptTokens: prompt, completionTokens: completion });
const missing = (model: string, attempts = 1) => ({ attempts, model, usageComplete: false, promptTokens: 0, completionTokens: 0 });

describe("UsageMeter", () => {
  it("groups by stage, tier and model and sums exact counts when every call reported usage", () => {
    const m = new UsageMeter();
    m.record("parse", "MID", ok("mid", 100, 50));
    m.record("parse", "MID", ok("mid", 200, 70));
    m.record("extraction", "FAST", ok("fast", 30, 10));
    const s = m.snapshot();
    expect(s.version).toBe("u-1");
    expect(s.stages).toEqual([
      { stage: "parse", tier: "MID", model: "mid", calls: 2, calls_with_usage: 2, calls_without_usage: 0, prompt_tokens: 300, completion_tokens: 120 },
      { stage: "extraction", tier: "FAST", model: "fast", calls: 1, calls_with_usage: 1, calls_without_usage: 0, prompt_tokens: 30, completion_tokens: 10 },
    ]);
    expect(s.total).toEqual({ calls: 3, calls_with_usage: 3, calls_without_usage: 0, prompt_tokens: 330, completion_tokens: 130 });
  });

  it("missing provider usage is UNAVAILABLE: null tokens, never 0", () => {
    const m = new UsageMeter();
    m.record("evaluate", "MID", missing("mid"));
    m.record("evaluate", "MID", missing("mid"));
    const [row] = m.snapshot().stages;
    expect(row).toMatchObject({ calls: 2, calls_with_usage: 0, calls_without_usage: 2, prompt_tokens: null, completion_tokens: null });
    expect(m.snapshot().total).toMatchObject({ prompt_tokens: null, completion_tokens: null, calls_without_usage: 2 });
  });

  it("a mix is a lower bound: the sum over the calls that reported, with the count of calls that did not", () => {
    const m = new UsageMeter();
    m.record("verify", "MID", ok("mid", 100, 40));
    m.record("verify", "MID", missing("mid"));
    const [row] = m.snapshot().stages;
    expect(row).toMatchObject({ calls: 2, calls_with_usage: 1, calls_without_usage: 1, prompt_tokens: 100, completion_tokens: 40 });
  });

  it("a call whose usage was partial contributes no partial tokens", () => {
    const m = new UsageMeter();
    // usageComplete false with non-zero reported sums (one attempt reported, the retry did not)
    m.record("mismatch", "MID", { attempts: 2, model: "mid", usageComplete: false, promptTokens: 500, completionTokens: 300 });
    expect(m.snapshot().stages[0]).toMatchObject({ calls_without_usage: 1, prompt_tokens: null, completion_tokens: null });
  });

  it("a call that sent no request (attempts 0, e.g. cap reached) is not recorded at all", () => {
    const m = new UsageMeter();
    m.record("parse", "MID", missing("mid", 0));
    expect(m.snapshot()).toEqual({ version: "u-1", stages: [], total: { calls: 0, calls_with_usage: 0, calls_without_usage: 0, prompt_tokens: null, completion_tokens: null } });
  });

  it("keeps the same stage on different models separate", () => {
    const m = new UsageMeter();
    m.record("parse", "MID", ok("mid-a", 1, 1));
    m.record("parse", "MID", ok("mid-b", 2, 2));
    expect(m.snapshot().stages.map((r) => r.model)).toEqual(["mid-a", "mid-b"]);
  });

  it("the snapshot is labels and integers only (no free text can enter)", () => {
    const m = new UsageMeter();
    m.record("parse", "MID", ok("mid", 1, 1));
    const flat = JSON.stringify(m.snapshot());
    expect(Object.keys(JSON.parse(flat).stages[0]).sort()).toEqual(["calls", "calls_with_usage", "calls_without_usage", "completion_tokens", "model", "prompt_tokens", "stage", "tier"]);
  });
});
