// Test-only fakes for the pipeline (fictional data; no network).
import type { z } from "zod";
import type { CallStats } from "@/lib/llm/client";
import type { Trial } from "@/lib/ctgov/client";
import type { LlmCallArgs, LlmPort, PipelineDeps } from "@/lib/pipeline/run";
import { MemoryCriteriaCache } from "@/lib/cache/criteria-cache";
import { atom, text } from "@/lib/engine/test-helpers";
import type { LlmClauseCriterion } from "@/schema/clause";

export const PROFILE_TEXT = "SENTINEL-PATIENT-TEXT: fictional 52-year-old woman with HER2-positive breast cancer.";

export const stats = (errorKind: string | null = null, usage: { prompt: number; completion: number } | null = null, model = "fake-model"): CallStats => ({
  attempts: 1, firstValid: !errorKind, finalValid: !errorKind, fenced: false, latencyMs: 1, promptTokens: usage?.prompt ?? 0, completionTokens: usage?.completion ?? 0, model, responses: 1, usageComplete: usage !== null, rateLimited: 0, httpErrors: 0, truncated: false, errorKind, problems: [],
});

export const trial = (id: string, inclusion: string[], exclusion: string[] = [], extra: Partial<Trial> = {}): Trial => ({
  nct_id: id, title: "Fictional trial " + id,
  eligibility_text: `Inclusion Criteria:\n${inclusion.map((c) => "* " + c).join("\n")}\n` + (exclusion.length ? `\nExclusion Criteria:\n${exclusion.map((c) => "* " + c).join("\n")}\n` : ""),
  min_age: "18 Years", max_age: null, sex: "ALL", last_update: "2026-01-01", sites: { total: 1, recruiting: 1, with_geo: 1 }, ...extra,
});

export interface Script {
  facts?: Array<{ key: string; state: "known" | "uncertain" | "unknown"; value: string | number | boolean | null; note: string | null }> | "fail";
  /** map criterion text → parsed criterion; unmapped text becomes one text leaf */
  parse?: (t: string) => LlmClauseCriterion | null;
  evaluate?: "unknown" | "fail";
  verify?: "none" | "block" | "fail";
  failCheck?: "confirm" | "fail" | "reject";
  /** What the fake provider reports as token usage: fixed counts (default) or nothing at all (usage unavailable). */
  usage?: "reported" | "missing";
}

const defaultFacts: NonNullable<Script["facts"]> = [
  { key: "age", state: "known", value: 52, note: null },
  { key: "sex", state: "known", value: "female", note: null },
  { key: "her2_status", state: "known", value: "positive", note: null },
];

export function makeParse(t: string): LlmClauseCriterion {
  const m = t.match(/^Age (\d+) years or older\.?$/);
  if (m) return { category: "other", blocks: [{ when: [], combine: "all", items: [atom(t, "age", "gte", Number(m[1]), "years")], except: [] }] };
  return { category: "other", blocks: [{ when: [], combine: "all", items: [text(t)], except: [] }] };
}

export function fakeLlm(script: Script = {}): LlmPort & { calls: Array<{ name: string; tier: string }>; seen: Array<{ name: string; system: string; user: string; echoOnRetry: boolean | undefined }> } {
  let used = 0;
  const calls: Array<{ name: string; tier: string }> = [];
  const seen: Array<{ name: string; system: string; user: string; echoOnRetry: boolean | undefined }> = [];
  return {
    calls,
    seen,
    used: () => used,
    async call<T>(a: LlmCallArgs<T>) {
      used++;
      calls.push({ name: a.schemaName, tier: a.tier });
      seen.push({ name: a.schemaName, system: a.system, user: a.user, echoOnRetry: a.echoOnRetry });
      const model = a.tier === "FAST" ? "fake-fast" : "fake-mid";
      const reported = script.usage === "missing" ? null : { prompt: 100, completion: 50 };
      const ok = (o: unknown) => ({ data: (a.schema as z.ZodType<T>).parse(o), stats: stats(null, reported, model) });
      const bad = { data: null, stats: stats("HTTP_503", null, model) };
      const lines = a.user.split("\n").filter((l) => l.startsWith("{"));
      switch (a.schemaName) {
        case "facts":
          return script.facts === "fail" ? bad : ok({ facts: script.facts ?? defaultFacts });
        case "clause_batch": {
          const items = lines.map((l) => JSON.parse(l) as { index: number; text: string });
          return ok({ criteria: items.map((i) => ({ index: i.index, ...((script.parse ?? makeParse)(i.text) ?? makeParse(i.text)) })) });
        }
        case "findings": {
          const items = lines.map((l) => JSON.parse(l) as { index: number });
          return ok({ findings: items.map((i) => ({ index: i.index, status: script.evaluate === "fail" ? "FAIL" : "UNKNOWN", evidence: script.evaluate === "fail" ? ["age"] : [], rationale: "fictional" })) });
        }
        case "verify":
          if (script.verify === "fail") return bad;
          return ok({ blocking: script.verify === "block" ? [{ index: 0, evidence: ["age"] }] : [] });
        case "fail_check": {
          if (script.failCheck === "fail") return bad;
          const items = lines.map((l) => JSON.parse(l) as { index: number; text: string });
          return ok({
            verdicts: items.map((i) =>
              script.failCheck === "reject"
                ? { index: i.index, verdict: "not_confirmed", source_quote: null, facts_used: [] }
                : { index: i.index, verdict: "confirmed", source_quote: i.text, facts_used: [{ key: "age", value: 52 }] },
            ),
          });
        }
        default:
          return bad;
      }
    },
  };
}

export function fakeDeps(trials: Trial[], script: Script = {}, over: Partial<PipelineDeps> = {}): PipelineDeps & { llm: ReturnType<typeof fakeLlm> } {
  const llm = fakeLlm(script);
  return { discover: async () => trials, cache: new MemoryCriteriaCache(), maxCalls: 80, maxCandidates: 30, concurrency: 6, unknownThreshold: 3, ...over, llm };
}
