import { describe, expect, it } from "vitest";
import { cacheKeyFor, MemoryCriteriaCache } from "@/lib/cache/criteria-cache";
import { leafToNode } from "@/lib/engine/clause";
import { atom } from "@/lib/engine/test-helpers";
import { PipelineError, runPipeline } from "@/lib/pipeline/run";
import { splitTrialCriteria } from "@/lib/ctgov/split";
import type { SseEvent } from "@/schema/sse";
import { fakeDeps, PROFILE_TEXT, trial } from "./test-fakes";

const collect = async (deps: ReturnType<typeof fakeDeps>) => {
  const events: SseEvent[] = [];
  await runPipeline(PROFILE_TEXT, deps, (e) => events.push(e));
  return events;
};
const counts = (es: SseEvent[]) => Object.assign({}, ...es.flatMap((e) => (e.type === "counts" ? [e] : []))) as Extract<SseEvent, { type: "counts" }>;
const results = (es: SseEvent[]) => es.flatMap((e) => (e.type === "trial_result" ? [e.assessment] : []));

describe("runPipeline", () => {
  it("streams stages in order, results in tier order, and finishes within the 80-call cap", async () => {
    const deps = fakeDeps([trial("NCT00000001", ["Age 18 years or older.", "Willing to follow study procedures."]), trial("NCT00000002", ["Age 18 years or older."], ["Active infection requiring treatment."])]);
    const es = await collect(deps);
    const stages = es.filter((e) => e.type === "stage" && e.status === "start").map((e) => (e as { stage: string }).stage);
    expect(stages).toEqual(["extraction", "discovery", "parse", "typed_evaluation", "free_text_evaluation", "verification", "fail_checks", "questions"]);
    expect(es[es.length - 1]!.type).toBe("done");
    const done = es[es.length - 1] as Extract<SseEvent, { type: "done" }>;
    expect(done.replay).toBe(false);
    expect(done.stats!.llm_calls).toBe(deps.llm.used());
    expect(done.stats!.worst_case_calls).toBeLessThanOrEqual(80);
    expect(results(es)).toHaveLength(2);
    // every result carries the official link and verbatim criterion text
    for (const r of results(es)) {
      expect(r.url).toBe(`https://clinicaltrials.gov/study/${r.nct_id}`);
      expect(r.criteria!.every((c) => c.text.length > 0)).toBe(true);
    }
    const order = ["STRONG", "POSSIBLE", "UNCERTAIN", "LIKELY_MISMATCH"];
    const tiers = results(es).map((r) => order.indexOf(r.tier));
    expect([...tiers].sort()).toEqual(tiers);
  });

  it("never lets partially parsed trials reach STRONG; free-text criteria stay open (abstention)", async () => {
    const es = await collect(fakeDeps([trial("NCT00000001", ["Age 18 years or older.", "Able to understand and sign consent."])], { evaluate: "unknown" }));
    const [r] = results(es);
    expect(r!.tier).not.toBe("STRONG");
    expect(r!.findings.some((f) => f.status === "UNKNOWN")).toBe(true);
  });

  it("RULE D: a code FAIL with no verifier result stays UNCERTAIN; only a cited, verified FAIL is LIKELY_MISMATCH", async () => {
    const t = [trial("NCT00000001", ["Age 65 years or older."])];
    const unverified = results(await collect(fakeDeps(t, { failCheck: "fail" })))[0]!;
    expect(unverified.tier).toBe("UNCERTAIN");
    expect(unverified.findings.find((f) => f.status === "FAIL")!.fail_check).toBe("not_run");
    const rejected = results(await collect(fakeDeps(t, { failCheck: "reject" })))[0]!;
    expect(rejected.tier).toBe("UNCERTAIN");
    const verified = results(await collect(fakeDeps(t, { failCheck: "confirm" })))[0]!;
    expect(verified.tier).toBe("LIKELY_MISMATCH");
    expect(verified.verified).toBe(true);
  });

  it("capacity overflow stays UNCERTAIN, never LIKELY_MISMATCH, and the cap holds", async () => {
    // 60 fully cached FAIL trials: more FAIL checks demanded than slots exist.
    const trials = Array.from({ length: 60 }, (_, i) => trial(`NCT${String(10000000 + i)}`, ["Age 65 years or older."]));
    const cache = new MemoryCriteriaCache();
    for (const t of trials) {
      const srcs = splitTrialCriteria(t.nct_id, t.eligibility_text);
      await cache.set(cacheKeyFor(t.nct_id, t.last_update), srcs.map(() => ({ state: "parsed", category: "other", scoring: true, clause: leafToNode(atom("Age 65 years or older.", "age", "gte", 65, "years")), completeness: "full", vet: "ok" }) as const));
    }
    const deps = fakeDeps(trials, { failCheck: "confirm" }, { cache, maxCandidates: 60 });
    const es = await collect(deps);
    const rs = results(es);
    const mismatch = rs.filter((r) => r.tier === "LIKELY_MISMATCH").length;
    const noCap = rs.filter((r) => r.findings.some((f) => f.fail_check === "no_capacity")).length;
    expect(mismatch).toBeGreaterThan(0);
    expect(noCap).toBeGreaterThan(0);
    expect(mismatch + noCap).toBe(60);
    expect(rs.filter((r) => r.findings.some((f) => f.fail_check === "no_capacity")).every((r) => r.tier === "UNCERTAIN")).toBe(true);
    expect(deps.llm.used()).toBeLessThanOrEqual(80);
    expect((es[es.length - 1] as Extract<SseEvent, { type: "done" }>).stats!.worst_case_calls).toBeLessThanOrEqual(80);
  });

  it("reuses cached parses: no parse calls on a warm run", async () => {
    const cache = new MemoryCriteriaCache();
    const trials = [trial("NCT00000001", ["Age 18 years or older."])];
    await collect(fakeDeps(trials, {}, { cache }));
    const warm = fakeDeps(trials, {}, { cache });
    await collect(warm);
    expect(warm.llm.calls.some((c) => c.name === "clause_batch")).toBe(false);
  });

  it("fails with a typed error (caller falls back to replay) when extraction or discovery is unavailable", async () => {
    await expect(collect(fakeDeps([], { facts: "fail" }))).rejects.toMatchObject({ kind: "model_unavailable" });
    await expect(collect(fakeDeps([], {}, { discover: async () => { throw new Error("down"); } }))).rejects.toMatchObject({ kind: "ctgov_unavailable" });
    const ac = new AbortController();
    ac.abort();
    await expect(collect(fakeDeps([], {}, { signal: ac.signal }))).rejects.toBeInstanceOf(PipelineError);
  });

  it("a failed parse call degrades to UNCERTAIN with analysis_failed, never a crash", async () => {
    const deps = fakeDeps([trial("NCT00000001", ["Age 18 years or older."])]);
    const orig = deps.llm.call.bind(deps.llm);
    deps.llm.call = (async (a: Parameters<typeof orig>[0]) => (a.schemaName === "clause_batch" ? { data: null, stats: { errorKind: "ZOD_INVALID_AFTER_RETRY" } } : orig(a))) as typeof orig;
    const [r] = results(await collect(deps));
    expect(r!.tier).toBe("UNCERTAIN");
    expect(r!.analysis_failed).toBe(true);
    expect(r!.verifier_flags).not.toContain("analysis_pending");
  });

  it("counts: discovered/filtered/selected reflect the prefilter and the candidate cap; a failed parse is failed, not pending", async () => {
    const young = trial("NCT00000009", ["Age 18 years or older."], [], { max_age: "40 Years" }); // profile is 52 ⇒ filtered out
    const ok = Array.from({ length: 3 }, (_, i) => trial(`NCT3000000${i}`, ["Age 18 years or older."]));
    const es = await collect(fakeDeps([young, ...ok], {}, { maxCandidates: 2 }));
    expect(counts(es)).toMatchObject({ discovered: 4, filtered: 3, selected: 2, assessed: 2, pending: 0, failed: 0 });
    const deps = fakeDeps([ok[0]!]);
    const orig = deps.llm.call.bind(deps.llm);
    deps.llm.call = (async (a: Parameters<typeof orig>[0]) => (a.schemaName === "clause_batch" ? { data: null, stats: { errorKind: "ZOD_INVALID_AFTER_RETRY" } } : orig(a))) as typeof orig;
    expect(counts(await collect(deps))).toMatchObject({ selected: 1, assessed: 0, pending: 0, failed: 1 });
  });

  it("a warm cache reports every trial as assessed with none pending", async () => {
    const cache = new MemoryCriteriaCache();
    const trials = [trial("NCT00000001", ["Age 18 years or older."])];
    await collect(fakeDeps(trials, {}, { cache }));
    expect(counts(await collect(fakeDeps(trials, {}, { cache })))).toMatchObject({ selected: 1, assessed: 1, pending: 0, failed: 0 });
  });

  it("trials beyond the parse budget are analysis_pending (not failed) and stay UNCERTAIN", async () => {
    const trials = Array.from({ length: 20 }, (_, i) => trial(`NCT${String(20000000 + i)}`, ["Age 18 years or older."]));
    const es = await collect(fakeDeps(trials));
    const rs = results(es);
    const pending = rs.filter((r) => r.verifier_flags.includes("analysis_pending"));
    expect(pending.length).toBe(6); // parse cap is 14 slots, one chunk per trial
    // count contract: selected = assessed + pending + failed, each reported separately (never one "analyzed" number)
    expect(counts(es)).toMatchObject({ discovered: 20, filtered: 20, selected: 20, assessed: 14, pending: 6, failed: 0 });
    expect(counts(es)).not.toHaveProperty("analyzed");
    for (const r of pending) {
      expect(r.tier).toBe("UNCERTAIN");
      expect(r.analysis_failed).toBeUndefined();
    }
  });

  it("emitted events never contain the patient's text", async () => {
    const es = await collect(fakeDeps([trial("NCT00000001", ["Age 18 years or older."])]));
    expect(JSON.stringify(es)).not.toContain("SENTINEL-PATIENT-TEXT");
  });
});
