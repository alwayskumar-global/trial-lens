// The SSE boundary is the last line of Policy R2: even if the pipeline itself were wrong, no forbidden tier reaches the stream.
import { describe, expect, it, vi } from "vitest";
import { MemoryReplayStore } from "@/lib/cache/replay";
import { createRunGuard } from "@/lib/guards/run-guard";
import { handleRun } from "@/lib/pipeline/handler";
import { trial } from "@/lib/live/fixtures.test-util";
import { SseEventSchema, type SseEvent } from "@/schema/sse";
import { SAMPLE_TEXT } from "@/lib/sample/triallens-sample";
import { fakeDeps } from "./test-fakes";

// A broken pipeline: it emits the two forbidden tiers (and a legacy-looking verified conflict) straight to the handler.
vi.mock("@/lib/pipeline/run", async (orig) => ({
  ...(await orig<typeof import("@/lib/pipeline/run")>()),
  runPipeline: async (_input: unknown, _deps: unknown, emit: (e: SseEvent) => void) => {
    emit({ type: "trial_result", assessment: trial({ nct_id: "NCT00000001", tier: "STRONG", verified: true }) });
    emit({ type: "trial_result", assessment: trial({ nct_id: "NCT00000002", tier: "LIKELY_MISMATCH", verified: true }) });
    emit({ type: "trial_result", assessment: trial({ nct_id: "NCT00000003", tier: "POSSIBLE", verified: true }) });
    emit({ type: "done", replay: false });
  },
}));

describe("handler boundary", () => {
  it("caps forbidden tiers coming out of the pipeline before they are streamed", async () => {
    const allow = createRunGuard({ limiter: { limit: async () => ({ success: true }) }, counter: { incr: async () => 1, expire: async () => 0 }, dailyBudget: 10 });
    const res = await handleRun(new Request("http://x/api/run", { method: "POST", body: JSON.stringify({ text: SAMPLE_TEXT }) }), {
      maxInputChars: 2000, replayFallbackEnabled: true, visitorInputMode: "samples", guard: () => allow, replay: new MemoryReplayStore(), makePipeline: () => fakeDeps([]), ip: () => "1.2.3.4", log: () => undefined,
    });
    const es = (await res.text()).split("\n\n").filter(Boolean).map((c) => SseEventSchema.parse(JSON.parse(c.replace(/^data: /, ""))));
    const rs = es.flatMap((e) => (e.type === "trial_result" ? [e.assessment] : []));
    expect(rs.map((r) => r.tier)).toEqual(["POSSIBLE", "UNCERTAIN", "POSSIBLE"]);
    expect(rs[1]).toMatchObject({ verified: false, verifier_flags: ["reported_conflict"], fact_basis: "visitor_reported" });
    expect(rs[0]).toMatchObject({ verifier_flags: ["reported_only"] });
    expect(es.some((e) => e.type === "error")).toBe(false);
  });
});
