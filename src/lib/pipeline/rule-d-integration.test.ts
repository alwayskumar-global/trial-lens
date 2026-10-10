// Deterministic Rule D integration (no network, no model): a trial with a CODE-derived FAIL goes through the real pipeline, the real handler/SSE
// boundary (ceiling + assertEmittable), and then the SAME live assertions the Preview script applies to a paid run. A paid run is unlikely to hit this
// path (both live runs had 0 FAIL findings), so this is where the harness's Rule D checks are proven to accept the right shape and reject the wrong one.
import { describe, expect, it } from "vitest";
import { liveAssertions, type Timed } from "../../../eval/lib/live-assertions";
import { MemoryReplayStore } from "@/lib/cache/replay";
import { createRunGuard } from "@/lib/guards/run-guard";
import { handleRun, type RunHandlerDeps } from "@/lib/pipeline/handler";
import { SseEventSchema, type SseEvent } from "@/schema/sse";
import { fakeDeps, trial, type Script } from "./test-fakes";

const allow = createRunGuard({ limiter: { limit: async () => ({ success: true }) }, counter: { incr: async () => 1, expire: async () => 0 }, dailyBudget: 10 });
// Profile age is 52 (fake default). "Age 65 years or older." is a typed atom: code evaluates it FAIL. "Age 18..." PASSes. Free text stays UNKNOWN.
const TRIALS = [
  trial("NCT00000001", ["Age 65 years or older."]),
  trial("NCT00000002", ["Age 18 years or older.", "Able to understand and sign consent."]),
];

async function stream(script: Script): Promise<SseEvent[]> {
  const deps: RunHandlerDeps = {
    maxInputChars: 4000, replayFallbackEnabled: true, visitorInputMode: "open", guard: () => allow, replay: new MemoryReplayStore(),
    makePipeline: () => fakeDeps(TRIALS, script), ip: () => "1.2.3.4", log: () => undefined,
  };
  const res = await handleRun(new Request("http://x/api/run", { method: "POST", body: JSON.stringify({ text: "fictional profile text" }) }), deps);
  return (await res.text()).split("\n\n").filter(Boolean).map((c) => SseEventSchema.parse(JSON.parse(c.replace(/^data: /, ""))));
}
const run = (ev: SseEvent[]) => {
  const out: Array<[boolean, string]> = [];
  const timed: Timed[] = ev.map((e, i) => ({ e, t: 500 + i * 3000 }));
  liveAssertions({ status: 200, ttfb: 300, total: 90_000, events: timed, chunks: 30, ct: "text/event-stream" }, (ok, n) => out.push([ok, n]), () => undefined);
  return out;
};
const failed = (o: Array<[boolean, string]>) => o.filter(([ok]) => !ok).map(([, n]) => n);
const results = (ev: SseEvent[]) => ev.flatMap((e) => (e.type === "trial_result" ? [e.assessment] : []));

describe("Rule D, end to end offline", () => {
  it("a confirmed code FAIL: verified fail_check, reported_conflict, tier capped to UNCERTAIN, verified=false; every live assertion passes", async () => {
    const ev = await stream({ failCheck: "confirm" });
    const r = results(ev).find((a) => a.nct_id === "NCT00000001")!;
    const fail = r.findings.find((f) => f.status === "FAIL")!;
    expect(fail.source).toBe("code");
    expect(fail.fail_check).toBe("verified");
    expect(r.tier).toBe("UNCERTAIN"); // LIKELY_MISMATCH capped by Policy R2
    expect(r.verifier_flags).toContain("reported_conflict");
    expect(r.verified).toBe(false);
    expect(results(ev).find((a) => a.nct_id === "NCT00000002")!.findings.every((f) => f.fail_check === undefined || f.status === "FAIL")).toBe(true);
    expect(failed(run(ev))).toEqual([]);
  });

  it("a rejected FAIL check: no conflict flag, still no surviving model PASS/FAIL; assertions pass", async () => {
    const ev = await stream({ failCheck: "reject" });
    const r = results(ev).find((a) => a.nct_id === "NCT00000001")!;
    expect(r.findings.find((f) => f.status === "FAIL")!.fail_check).toBe("rejected");
    expect(r.verifier_flags).not.toContain("reported_conflict");
    expect(failed(run(ev))).toEqual([]);
  });

  it("a model FAIL on free text is downgraded, so Rule D never sees it; the stream still passes", async () => {
    const ev = await stream({ evaluate: "fail", failCheck: "confirm" });
    expect(results(ev).flatMap((a) => a.findings).filter((f) => f.source !== "code").every((f) => f.status === "UNKNOWN")).toBe(true);
    expect(failed(run(ev))).toEqual([]);
  });

  it("negative control: tampering the confirmed-FAIL stream so the conflict has no verified check, or the FAIL looks model-derived, is caught", async () => {
    const ev = await stream({ failCheck: "confirm" });
    const tamper = (f: (a: ReturnType<typeof results>[number]) => void) => ev.map((e) => {
      if (e.type !== "trial_result" || e.assessment.nct_id !== "NCT00000001") return e;
      const a = structuredClone(e.assessment); f(a); return { ...e, assessment: a } as SseEvent;
    });
    expect(failed(run(tamper((a) => { a.findings.find((x) => x.status === "FAIL")!.fail_check = "rejected"; }))).join("|")).toMatch(/reported_conflict is backed/);
    expect(failed(run(tamper((a) => { a.findings.find((x) => x.status === "FAIL")!.source = "llm_mid"; }))).join("|")).toMatch(/every FAIL is code-derived/);
    expect(failed(run(tamper((a) => { a.verified = true; }))).join("|")).toMatch(/reported_conflict is backed|never verified/);
  });
});
