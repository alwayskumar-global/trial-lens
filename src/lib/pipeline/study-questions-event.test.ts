import { describe, expect, it } from "vitest";
import { atom } from "@/lib/engine/test-helpers";
import { runPipeline } from "@/lib/pipeline/run";
import { SseEventSchema, type SseEvent } from "@/schema/sse";
import type { LlmClauseCriterion } from "@/schema/clause";
import { fakeDeps, PROFILE_TEXT, trial } from "./test-fakes";

const ECOG = "ECOG performance status 0 or 1";
const parseEcog = (t: string): LlmClauseCriterion | null =>
  t === ECOG ? { category: "performance", blocks: [{ when: [], combine: "all", items: [atom(t, "ecog", "in", ["0", "1"])], except: [] }] } : null;

const run = async (trials: ReturnType<typeof trial>[], parse?: typeof parseEcog) => {
  const es: SseEvent[] = [];
  await runPipeline(PROFILE_TEXT, fakeDeps(trials, parse ? { parse } : {}), (e) => es.push(e));
  return es;
};
const sq = (es: SseEvent[]) => es.flatMap((e) => (e.type === "study_questions" ? [e] : []));

describe("pipeline: study_questions event (Option B)", () => {
  it("emits one versioned event with distinct studies and the original wording; never the legacy answer-oriented `question` event", async () => {
    const es = await run([trial("NCT00000001", [ECOG, ECOG]), trial("NCT00000002", [ECOG])], parseEcog);
    expect(es.some((e) => e.type === "question")).toBe(false);
    const [ev] = sq(es);
    expect(sq(es)).toHaveLength(1);
    expect(SseEventSchema.safeParse(ev).success).toBe(true);
    expect(ev!.version).toBe("sq-1");
    const [q] = ev!.questions;
    expect(q!.fact_key).toBe("ecog");
    expect(q!.study_count).toBe(2); // two studies, even though NCT00000001 has two such criteria
    expect(q!.studies.map((s) => s.nct_id)).toEqual(["NCT00000001", "NCT00000002"]);
    expect(q!.studies.flatMap((s) => s.criteria.map((c) => c.text))).toEqual([ECOG, ECOG, ECOG]);
    // after the results are known, and before `done`
    const idx = (t: string) => es.findIndex((e) => e.type === t);
    expect(idx("study_questions")).toBeLessThan(idx("trial_result"));
    expect(idx("study_questions")).toBeLessThan(idx("done"));
  });

  it("an empty list is emitted when the computation ran and found no supported item", async () => {
    const [ev] = sq(await run([trial("NCT00000003", ["Willing to follow study procedures."])]));
    expect(ev!.questions).toEqual([]);
  });

  it("the event carries no score, lift or tier", async () => {
    const [ev] = sq(await run([trial("NCT00000004", [ECOG])], parseEcog));
    expect(JSON.stringify(ev)).not.toMatch(/"(score|lift|tier|answers|affects_trials)"/);
  });
});
