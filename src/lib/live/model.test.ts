import { describe, expect, it } from "vitest";
import { cardModel, coverage, detailModel, initialRun, reduceRun, tierCounts, trialKind, usableExcerpt, rowTitle, type RunAction, type RunState } from "@/lib/live/model";
import { assessedPossible, failed, LONG, mismatch, noMet, pending, trial } from "@/lib/live/fixtures.test-util";
import type { SseEvent } from "@/schema/sse";

const run = (...as: RunAction[]): RunState => as.reduce(reduceRun, initialRun);
const tr = (t: ReturnType<typeof trial>): SseEvent => ({ type: "trial_result", assessment: t });

describe("reduceRun", () => {
  it("shows a count only after its event was received", () => {
    let s = run({ type: "start" }, { type: "mode", mode: "live" });
    expect(s.counts).toEqual({});
    s = reduceRun(s, { type: "counts", discovered: 120, filtered: 115, selected: 30 });
    expect(s.counts).toEqual({ discovered: 120, filtered: 115, selected: 30 });
    expect(s.counts.assessed).toBeUndefined();
    s = reduceRun(s, { type: "counts", assessed: 27, pending: 3, failed: 0 });
    expect(coverage(s)).toEqual({ assessed: 27, pending: 3, failed: 0 });
  });

  it("never stores the deprecated ambiguous `analyzed` count", () => {
    const s = run({ type: "mode", mode: "live" }, { type: "counts", analyzed: 30 });
    expect(s.counts).toEqual({});
  });

  it("lists stages in arrival order and updates a stage in place", () => {
    const s = run({ type: "mode", mode: "live" }, { type: "stage", stage: "extraction", status: "start" }, { type: "stage", stage: "extraction", status: "done" }, { type: "stage", stage: "discovery", status: "start" });
    expect(s.stages).toEqual([{ stage: "extraction", status: "done" }, { stage: "discovery", status: "start" }]);
  });

  it("a live stream that falls back to replay CLEARS all partial live state", () => {
    const partial = run(
      { type: "start" }, { type: "mode", mode: "live" }, { type: "stage", stage: "parse", status: "start" },
      { type: "profile", facts: [{ key: "age", state: "known", value: 52 }] }, { type: "counts", discovered: 120, selected: 30 }, tr(assessedPossible),
      { type: "error", code: "model_unavailable", message: "x", fallback_to_replay: true },
    );
    expect(partial.trials).toHaveLength(1);
    const replay = reduceRun(partial, { type: "mode", mode: "replay", reason: "model_unavailable", label: "Fictional profile" });
    expect(replay).toMatchObject({ mode: "replay", reason: "model_unavailable", replayLabel: "Fictional profile", stages: [], trials: [], counts: {}, profile: null, errorCode: null });
  });

  it("replay never shows live-style stages, but keeps the stored counts, profile and trials", () => {
    const s = run({ type: "mode", mode: "replay", reason: "requested" }, { type: "stage", stage: "parse", status: "start" }, { type: "counts", selected: 1 }, tr(pending), { type: "done", replay: true });
    expect(s.stages).toEqual([]);
    expect(s).toMatchObject({ status: "done", counts: { selected: 1 } });
    expect(s.trials).toHaveLength(1);
  });

  it("an error without fallback ends the run; with fallback it waits for the replay", () => {
    expect(run({ type: "mode", mode: "live" }, { type: "error", code: "internal", message: "x", fallback_to_replay: false }).status).toBe("error");
    expect(run({ type: "mode", mode: "live" }, { type: "error", code: "model_unavailable", message: "x", fallback_to_replay: true }).status).toBe("streaming");
  });

  it("http failures and a closed stream surface as errors; a closed stream after done does not", () => {
    expect(run({ type: "start" }, { type: "http_error", code: "rate_limited" })).toMatchObject({ status: "error", errorCode: "rate_limited" });
    expect(run({ type: "mode", mode: "live" }, { type: "closed" })).toMatchObject({ status: "error", errorCode: "stream_closed" });
    expect(run({ type: "mode", mode: "live" }, { type: "done", replay: false }, { type: "closed" }).status).toBe("done");
  });
});

describe("coverage / classification", () => {
  it("derives assessed/pending/failed from received trials when the counts event is incomplete, and keeps them separate", () => {
    const trials = [assessedPossible, noMet, pending, failed, mismatch];
    expect(coverage({ counts: {}, trials })).toEqual({ assessed: 3, pending: 1, failed: 1 });
    expect(coverage({ counts: { assessed: 9, pending: 1, failed: 2 }, trials })).toEqual({ assessed: 9, pending: 1, failed: 2 });
    expect([pending, failed, assessedPossible].map(trialKind)).toEqual(["pending", "failed", "assessed"]);
  });
  it("pending and failed trials are UNCERTAIN, never counted as matches or mismatches", () => {
    expect(tierCounts([pending, failed])).toEqual({ strong: 0, possible: 0, uncertain: 2, mismatch: 0 });
  });
});

describe("excerpt rule", () => {
  it("quotes only whole, single, short criteria", () => {
    expect(usableExcerpt("Women 18 years or older")).toBe(true);
    expect(usableExcerpt(LONG)).toBe(false); // too long to quote whole
    expect(usableExcerpt("1.Age: ≥65 years old; 2. Histologically confirmed stage IV TPBC")).toBe(false); // merged items
    expect(usableExcerpt(undefined)).toBe(false);
  });
  it("shortened row titles are always marked as cut", () => {
    expect(rowTitle("Short")).toEqual({ text: "Short", cut: false });
    const r = rowTitle(LONG);
    expect(r.cut).toBe(true);
    expect(r.text.endsWith("…")).toBe(true);
  });
});

describe("cardModel", () => {
  it("assessed card: complete short excerpts only, a long unknown is never cut off", () => {
    const m = cardModel(assessedPossible);
    expect(m.excerpts).toEqual([{ status: "meets", text: "Women 18 years or older" }]);
    expect(m.met).toBe(1);
    expect(m.unknown).toBe(2);
    expect(m.biggestUnknown).toEqual({ kind: "long" }); // first open criterion is the long one
  });
  it("pending and failed cards carry no findings-derived claims", () => {
    for (const t of [pending, failed]) {
      const m = cardModel(t);
      expect(m).toMatchObject({ tier: "uncertain", excerpts: [], met: 0, unknown: 0, biggestUnknown: null });
    }
    expect(cardModel(pending).kind).toBe("pending");
    expect(cardModel(failed).kind).toBe("failed");
  });
  it("official link is passed through; a trial without one has none", () => {
    expect(cardModel(noMet).url).toBe("https://clinicaltrials.gov/study/NCT00000002");
    expect(cardModel(trial({ nct_id: "X", url: null })).url).toBeNull();
  });
});

describe("detailModel", () => {
  it("assessed: attention, unknown and ok groups with evidence values and the automated note", () => {
    const m = detailModel(assessedPossible, [{ key: "age", value: 52 }]);
    expect(m.ok.map((r) => r.id)).toEqual(["a"]);
    expect(m.ok[0]!.evidence).toEqual([{ key: "age", value: 52 }]);
    expect(m.unknown.map((r) => r.id)).toEqual(["b", "c"]);
    expect(m.unknown[0]!.note).toBe("No data on prior genetic testing");
    expect(m.unknown[1]!.note).toBeNull();
    expect(m.unknown[1]!.evidence).toEqual([]); // renders "Not provided"
  });
  it("pending/failed: every original criterion is listed as not analyzed, with no evidence", () => {
    const m = detailModel(pending, null);
    expect(m.notAnalyzed).toHaveLength(2);
    expect(m.notAnalyzed.every((r) => r.status === "not_analyzed" && r.evidence.length === 0)).toBe(true);
    expect(m.attention.length + m.unknown.length + m.ok.length).toBe(0);
  });
});
