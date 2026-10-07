import { describe, expect, it, vi } from "vitest";
import { runPipeline } from "@/lib/pipeline/run";
import type { SseEvent } from "@/schema/sse";
import { fakeDeps, PROFILE_TEXT, trial } from "./test-fakes";

vi.mock("@/lib/engine/study-questions", () => ({
  buildStudyQuestionsEvent: () => {
    throw new Error("boom");
  },
}));

describe("pipeline: the study-team panel is auxiliary", () => {
  it("if its computation fails nothing is emitted (the client claims nothing) and the run still completes with its results", async () => {
    const es: SseEvent[] = [];
    await runPipeline(PROFILE_TEXT, fakeDeps([trial("NCT00000001", ["Willing to follow study procedures."])]), (e) => es.push(e));
    expect(es.some((e) => e.type === "study_questions" || e.type === "question")).toBe(false);
    expect(es.some((e) => e.type === "trial_result")).toBe(true);
    expect(es[es.length - 1]!.type).toBe("done");
  });
});
