// Production wiring for the pipeline: Nebius Token Factory (Nemotron FAST/MID), live CT.gov discovery, layered cache.
// Model IDs come only from env. Throws EnvError when Nebius env is incomplete (handler turns that into a replay).
import { discoverBySelectionMode } from "@/lib/ctgov/selection";
import { LayeredCriteriaCache, MemoryCriteriaCache, ReadOnlyCriteriaCache, SupabaseCriteriaCache, type CriteriaCache } from "@/lib/cache/criteria-cache";
import { EnvError, getNebiusEnv, getPipelineEnv, getSelectionEnv } from "@/lib/env";
import { callJson, CallCap, makeClient, type CallStats } from "@/lib/llm/client";
import type { LlmCallArgs, LlmPort, PipelineDeps } from "@/lib/pipeline/run";

// Reasoning off-by-default blows the output budget on Nemotron; `low` is the measured config (docs/spike-results.md 08).
const LOW = { reasoning_effort: "low" } as const;

export function createLlmPort(maxCalls: number): LlmPort {
  const env = getNebiusEnv();
  const missing = (["NEMOTRON_MODEL_FAST", "NEMOTRON_MODEL_MID"] as const).filter((k) => !env[k]);
  if (missing.length) throw new EnvError("nebius", missing.map((variable) => ({ variable, problem: "is missing or blank" })));
  const client = makeClient();
  const cap = new CallCap(maxCalls);
  return {
    used: () => cap.used,
    async call<T>(a: LlmCallArgs<T>) {
      try {
        return await callJson({ client, cap, model: (a.tier === "FAST" ? env.NEMOTRON_MODEL_FAST : env.NEMOTRON_MODEL_MID)!, mode: "json_schema", system: a.system, user: a.user, schema: a.schema, schemaName: a.schemaName, maxTokens: a.maxTokens, extraBody: LOW, ...(a.echoOnRetry === false ? { echoOnRetry: false } : {}) });
      } catch {
        // CALL_CAP_EXCEEDED or an unexpected SDK error: degrade, never crash the run.
        const stats: CallStats = { attempts: 0, firstValid: false, finalValid: false, fenced: false, latencyMs: 0, promptTokens: 0, completionTokens: 0, model: "unknown", responses: 0, usageComplete: false, rateLimited: 0, httpErrors: 0, truncated: false, errorKind: "CALL_FAILED", problems: [] };
        return { data: null, stats };
      }
    },
  };
}

// Module-level, one instance per mode: survives warm invocations of the same function instance. Supabase persists across instances.
// The two modes are separate singletons keyed by the flag, so a writable instance can never be handed to a read-only request (or the reverse),
// even if the flag differs between calls in one process.
const sharedCaches: { writable?: CriteriaCache; readOnly?: CriteriaCache } = {};
function criteriaCache(writes: boolean): CriteriaCache {
  if (!writes) return (sharedCaches.readOnly ??= new ReadOnlyCriteriaCache(new SupabaseCriteriaCache()));
  if (sharedCaches.writable) return sharedCaches.writable;
  let supa: CriteriaCache | undefined;
  try {
    supa = new SupabaseCriteriaCache(); // constructing is cheap; reads fail soft (treated as a miss) if env is unset
  } catch {
    supa = undefined;
  }
  return (sharedCaches.writable = new LayeredCriteriaCache(supa ? [new MemoryCriteriaCache(), supa] : [new MemoryCriteriaCache()]));
}

export function createPipelineDeps(signal: AbortSignal): PipelineDeps {
  const p = getPipelineEnv();
  const mode = getSelectionEnv().CTGOV_SELECTION_MODE; // invalid value -> EnvError -> labelled replay (never a silent default)
  return {
    llm: createLlmPort(p.MAX_LLM_CALLS_PER_RUN),
    discover: () => discoverBySelectionMode(mode, { base: p.CTGOV_API_BASE, maxPages: 2, signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) }),
    cache: criteriaCache(p.CRITERIA_CACHE_WRITES),
    maxCalls: p.MAX_LLM_CALLS_PER_RUN,
    maxCandidates: p.MAX_CANDIDATE_TRIALS,
    concurrency: p.LLM_CONCURRENCY,
    unknownThreshold: p.TIER_UNKNOWN_THRESHOLD,
    signal,
  };
}
