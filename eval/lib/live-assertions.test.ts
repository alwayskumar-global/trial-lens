import { describe, expect, it } from "vitest";
import type { SseEvent } from "../../src/schema/sse";
import { liveAssertions, type Timed } from "./live-assertions";

// Synthetic, fictional stream: no network, no model.
const crit = (id: string, text: string) => ({ id, type: "inclusion" as const, text, category: "other", completeness: "full" as const });
const finding = (id: string, status: string, o: Record<string, unknown> = {}) => ({ criterion_id: id, status, evidence: status === "PASS" || status === "FAIL" ? ["age"] : [], rationale: "x", source: "code", ...o });
const trial = (nct: string, o: Record<string, unknown> = {}) => ({
  nct_id: nct, title: "t", tier: "POSSIBLE", verified: false, verifier_flags: [], fact_basis: "visitor_reported", sites: [], coordinator_questions: [],
  criteria: [crit("c1", "Age 65 or older."), crit("c2", "ECOG 0-1.")],
  findings: [finding("c1", "PASS"), finding("c2", "UNKNOWN")], ...o,
});
const usageRow = (stage: string, tier: string, calls: number, p: number | null, c: number | null, wu = calls) => ({ stage, tier, model: "m", calls, calls_with_usage: wu, calls_without_usage: calls - wu, prompt_tokens: p, completion_tokens: c });
const good = (): SseEvent[] => [
  { type: "mode", mode: "live" },
  ...Array.from({ length: 12 }, (_, i) => ({ type: "stage", stage: `s${i}`, status: i % 2 ? "done" : "start" }) as SseEvent),
  { type: "counts", selected: 2, assessed: 2, pending: 0, failed: 0 },
  { type: "trial_result", assessment: trial("NCT00000001") } as SseEvent,
  { type: "study_questions", version: "sq-1", questions: [{ fact_key: "ecog", topic: "ECOG", study_count: 1, studies: [{ nct_id: "NCT00000001", criteria: [{ criterion_id: "c2", type: "inclusion", text: "ECOG 0-1." }] }] }] } as SseEvent,
  { type: "done", replay: false, stats: { llm_calls: 41, worst_case_calls: 80, wall_ms: 90000, usage: { version: "u-1", stages: [usageRow("extraction", "FAST", 1, 900, 300), usageRow("parse", "MID", 40, 100000, 80000)], total: { calls: 41, calls_with_usage: 41, calls_without_usage: 0, prompt_tokens: 100900, completion_tokens: 80300 } } } } as SseEvent,
];
const timed = (ev: SseEvent[]): Timed[] => ev.map((e, i) => ({ e, t: 1000 + i * 8000 }));
const run = (ev: SseEvent[], over: Record<string, unknown> = {}) => {
  const out: Array<[boolean, string]> = [];
  liveAssertions({ status: 200, ttfb: 800, total: 95000, events: timed(ev), chunks: 30, ct: "text/event-stream", ...over }, (ok, n) => out.push([ok, n]), () => undefined);
  return out;
};
const failed = (o: Array<[boolean, string]>) => o.filter(([ok]) => !ok).map(([, n]) => n);

describe("liveAssertions", () => {
  it("a well-formed live stream passes every check", () => expect(failed(run(good()))).toEqual([]));
  it("fails on replay fallback, STRONG/LIKELY_MISMATCH, legacy question", () => {
    const ev = good();
    ev.splice(1, 0, { type: "mode", mode: "replay", reason: "rate_limited" } as SseEvent, { type: "question", questions: [] } as SseEvent);
    ev[ev.findIndex((e) => e.type === "trial_result")] = { type: "trial_result", assessment: trial("NCT00000001", { tier: "LIKELY_MISMATCH" }) } as SseEvent;
    const f = failed(run(ev)).join("|");
    expect(f).toMatch(/no replay fallback/);
    expect(f).toMatch(/no STRONG\/LIKELY_MISMATCH/);
    expect(f).toMatch(/Rule D never produced/);
    expect(f).toMatch(/legacy question/);
  });
  it("fails when a PASS has no evidence", () => {
    const ev = good();
    ev[ev.findIndex((e) => e.type === "trial_result")] = { type: "trial_result", assessment: trial("NCT00000001", { findings: [finding("c1", "PASS", { evidence: [] }), finding("c2", "UNKNOWN")] }) } as SseEvent;
    expect(failed(run(ev)).join("|")).toMatch(/has evidence/);
  });
  it("fails on panel wording that is not verbatim, a closed criterion, or an unstreamed study", () => {
    const mk = (nct: string, text: string, cid: string) => good().map((e) => (e.type === "study_questions" ? ({ ...e, questions: [{ ...e.questions[0], studies: [{ nct_id: nct, criteria: [{ criterion_id: cid, type: "inclusion", text }] }] }] } as SseEvent) : e));
    expect(failed(run(mk("NCT00000001", "ECOG zero or one.", "c2"))).join("|")).toMatch(/verbatim/);
    expect(failed(run(mk("NCT00000001", "Age 65 or older.", "c1"))).join("|")).toMatch(/open \(UNKNOWN\/AMBIGUOUS\)/);
    expect(failed(run(mk("NCT00000099", "ECOG 0-1.", "c2"))).join("|")).toMatch(/streamed as a trial_result/);
  });
  it("fails on over-cap calls, a fabricated 0 token count, and inconsistent usage totals", () => {
    const over = good().map((e) => (e.type === "done" ? ({ ...e, stats: { ...e.stats!, llm_calls: 90 } } as SseEvent) : e));
    expect(failed(run(over)).join("|")).toMatch(/80-call cap/);
    const zero = good().map((e) => (e.type === "done" ? ({ ...e, stats: { ...e.stats!, usage: { ...e.stats!.usage!, stages: [usageRow("extraction", "FAST", 1, 0, 0, 0)] } } } as SseEvent) : e));
    expect(failed(run(zero)).join("|")).toMatch(/never a fabricated 0/);
  });
  it("fails when delivery is buffered or too slow", () => {
    expect(failed(run(good(), { chunks: 1 })).join("|")).toMatch(/progressive/);
    expect(failed(run(good(), { total: 301000 })).join("|")).toMatch(/300 s/);
  });
  it("reports cold-cache pending trials without failing", () => {
    const logs: string[] = [];
    const ev = good();
    ev[ev.findIndex((e) => e.type === "trial_result")] = { type: "trial_result", assessment: trial("NCT00000001", { tier: "UNCERTAIN", verifier_flags: ["analysis_pending"] }) } as SseEvent;
    liveAssertions({ status: 200, ttfb: 1, total: 95000, events: timed(ev), chunks: 30, ct: "text/event-stream" }, () => undefined, (m) => logs.push(m));
    expect(logs.join("\n")).toMatch(/COLD-CACHE.*analysis_pending trials 1/);
  });
});
