import { afterEach, describe, expect, it, vi } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";
import { effectiveConfigLogFields } from "./log-fields";

afterEach(() => { vi.unstubAllEnvs(); resetEnvCacheForTests(); });
const env = (o: Record<string, string | undefined>) => { for (const [k, v] of Object.entries(o)) vi.stubEnv(k, v); resetEnvCacheForTests(); };

describe("effectiveConfigLogFields", () => {
  it("defaults: writable cache, api-default selection, 80 calls, samples mode", () => {
    env({ CRITERIA_CACHE_WRITES: undefined, CTGOV_SELECTION_MODE: undefined, MAX_LLM_CALLS_PER_RUN: undefined, VISITOR_INPUT_MODE: undefined });
    expect(effectiveConfigLogFields()).toEqual({ cache_writes: true, selection_mode: "api-default", max_calls: 80, visitor_input_mode: "samples" });
  });
  it("reports the effective values that are set, as integers and fixed enums only", () => {
    env({ CRITERIA_CACHE_WRITES: "false", CTGOV_SELECTION_MODE: "relevance-v1-interventional", MAX_LLM_CALLS_PER_RUN: "64", VISITOR_INPUT_MODE: "samples" });
    expect(effectiveConfigLogFields()).toEqual({ cache_writes: false, selection_mode: "relevance-v1-interventional", max_calls: 64, visitor_input_mode: "samples" });
  });
  it("an invalid value is reported as env_invalid, never defaulted; the other fields still report", () => {
    env({ MAX_LLM_CALLS_PER_RUN: "lots", CTGOV_SELECTION_MODE: "nope" });
    const f = effectiveConfigLogFields();
    expect(f.max_calls).toBe("env_invalid");
    expect(f.selection_mode).toBe("env_invalid");
  });
  it("contains no secret-bearing field names", () => {
    env({ NEBIUS_API_KEY: "SECRET-KEY", SUPABASE_SERVICE_ROLE_KEY: "SECRET-SRK" });
    expect(JSON.stringify(effectiveConfigLogFields())).not.toContain("SECRET");
  });
});
