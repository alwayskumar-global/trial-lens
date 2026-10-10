// Stored replays written before Policy R2 may hold STRONG or LIKELY_MISMATCH. They must never reach a visitor as such.
import { describe, expect, it } from "vitest";
import { MemoryReplayStore, replayEvents, StoredEventsSchema, type ReplayCase } from "@/lib/cache/replay";
import { createRunGuard } from "@/lib/guards/run-guard";
import { handleRun } from "@/lib/pipeline/handler";
import { trial } from "@/lib/live/fixtures.test-util";
import { SseEventSchema, type SseEvent } from "@/schema/sse";
import { fakeDeps } from "./test-fakes";

const legacy = [
  { type: "counts", discovered: 120, filtered: 115, selected: 4 },
  { type: "trial_result", assessment: trial({ nct_id: "NCT00000001", tier: "STRONG", verified: true }) },
  { type: "trial_result", assessment: trial({ nct_id: "NCT00000002", tier: "POSSIBLE", verified: true }) },
  { type: "trial_result", assessment: trial({ nct_id: "NCT00000003", tier: "UNCERTAIN" }) },
  { type: "trial_result", assessment: trial({ nct_id: "NCT00000004", tier: "LIKELY_MISMATCH", verified: true }) },
  { type: "counts", assessed: 4, pending: 0, failed: 0 },
] as const;
const CASE: ReplayCase = { id: "legacy-case", label: "Fictional legacy profile", profile_text: "fictional", events: legacy as unknown as ReplayCase["events"] };
const tiers = (es: SseEvent[]) => es.flatMap((e) => (e.type === "trial_result" ? [e.assessment] : []));

describe("stored replay results are streamed under the R2 ceiling", () => {
  it("replayEvents maps legacy STRONG → POSSIBLE and LIKELY_MISMATCH → UNCERTAIN with flags, verified:false on the conflict, and fact_basis", () => {
    const rs = tiers(replayEvents(CASE, "requested"));
    expect(rs.map((r) => r.tier)).toEqual(["POSSIBLE", "POSSIBLE", "UNCERTAIN", "UNCERTAIN"]);
    expect(rs[0]).toMatchObject({ verifier_flags: ["reported_only"], verified: true });
    expect(rs[3]).toMatchObject({ verifier_flags: ["reported_conflict"], verified: false });
    expect(rs.every((r) => r.fact_basis === "visitor_reported")).toBe(true);
  });

  it("order stays non-decreasing in the new tiers, and non-result events are unchanged", () => {
    const es = replayEvents(CASE, "requested");
    const rank = ["POSSIBLE", "UNCERTAIN"];
    const order = tiers(es).map((r) => rank.indexOf(r.tier));
    expect([...order].sort()).toEqual(order);
    expect(es.filter((e) => e.type !== "trial_result").map((e) => e.type)).toEqual(["mode", "counts", "counts", "done"]);
  });

  it("through the HTTP handler: an explicit replay never emits STRONG or LIKELY_MISMATCH", async () => {
    const replay = new MemoryReplayStore();
    await replay.put(CASE);
    const allow = createRunGuard({ limiter: { limit: async () => ({ success: true }) }, counter: { incr: async () => 1, expire: async () => 0 }, dailyBudget: 10 });
    const res = await handleRun(new Request("http://x/api/run", { method: "POST", body: JSON.stringify({ replay_id: "legacy-case" }) }), {
      maxInputChars: 2000, replayFallbackEnabled: true, visitorInputMode: "samples", guard: () => allow, replay, makePipeline: () => fakeDeps([]), ip: () => "1.2.3.4", log: () => undefined,
    });
    const es = (await res.text()).split("\n\n").filter(Boolean).map((c) => SseEventSchema.parse(JSON.parse(c.replace(/^data: /, ""))));
    expect(tiers(es).map((r) => r.tier)).toEqual(["POSSIBLE", "POSSIBLE", "UNCERTAIN", "UNCERTAIN"]);
    expect(es[es.length - 1]).toEqual({ type: "done", replay: true });
  });

  it("legacy stored events (with the old tiers and no fact_basis) still validate, so a stored case is never 'unavailable'", () => {
    const parsed = StoredEventsSchema.safeParse(legacy);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toHaveLength(legacy.length);
  });
});
