import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EnvError,
  getGuardEnv,
  getNebiusEnv,
  getPipelineEnv,
  getSupabaseEnv,
  getUpstashEnv,
  getVisitorEnv,
  resetEnvCacheForTests,
} from "./env";

// Fake, obviously-non-secret sentinel values used to prove nothing leaks.
const FAKE_KEY = "fake-test-key-SENTINEL-1234567890";
const FAKE_TOKEN = "fake-test-token-SENTINEL-abcdef";

const ALL_VARS = [
  "NEBIUS_API_KEY",
  "NEBIUS_BASE_URL",
  "NEMOTRON_MODEL_FAST",
  "NEMOTRON_MODEL_MID",
  "NEMOTRON_MODEL_DEEP",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "CTGOV_API_BASE",
  "PARSER_VERSION",
  "MAX_CANDIDATE_TRIALS",
  "MAX_LLM_CALLS_PER_RUN",
  "LLM_CONCURRENCY",
  "CRITERIA_CACHE_WRITES",
  "TIER_UNKNOWN_THRESHOLD",
  "MAX_INPUT_CHARS",
  "LOG_LEVEL",
  "RATE_LIMIT_RUNS_PER_IP_PER_HOUR",
  "DAILY_RUN_BUDGET",
  "REPLAY_FALLBACK_ENABLED",
  "VISITOR_INPUT_MODE",
  "PROFILE_SIGNING_SECRET",
  "RATE_LIMIT_IP_SALT",
  "RATE_LIMIT_EXTRACT_PER_IP_PER_HOUR",
  "DAILY_EXTRACT_BUDGET",
  "MAX_CONCURRENT_RUNS",
];

function captureError(fn: () => unknown): EnvError {
  try {
    fn();
  } catch (e) {
    if (e instanceof EnvError) return e;
    throw e;
  }
  throw new Error("expected EnvError");
}

beforeEach(() => {
  // Start every test from a clean slate, independent of the host environment.
  for (const v of ALL_VARS) vi.stubEnv(v, undefined);
  resetEnvCacheForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCacheForTests();
});

describe("getNebiusEnv", () => {
  it("accepts key + https base URL; model IDs optional", () => {
    vi.stubEnv("NEBIUS_API_KEY", FAKE_KEY);
    vi.stubEnv("NEBIUS_BASE_URL", "https://example.invalid/v1/");
    const env = getNebiusEnv();
    expect(env.NEBIUS_BASE_URL).toBe("https://example.invalid/v1/");
    expect(env.NEMOTRON_MODEL_FAST).toBeUndefined();
  });

  it("treats blank model IDs as unset", () => {
    vi.stubEnv("NEBIUS_API_KEY", FAKE_KEY);
    vi.stubEnv("NEBIUS_BASE_URL", "https://example.invalid/v1/");
    vi.stubEnv("NEMOTRON_MODEL_MID", "   ");
    expect(getNebiusEnv().NEMOTRON_MODEL_MID).toBeUndefined();
  });

  it("rejects a missing key and names the variable", () => {
    vi.stubEnv("NEBIUS_BASE_URL", "https://example.invalid/v1/");
    const err = captureError(getNebiusEnv);
    expect(err.variables).toEqual(["NEBIUS_API_KEY"]);
    expect(err.message).toContain("NEBIUS_API_KEY is missing or blank");
  });

  it("rejects a blank key", () => {
    vi.stubEnv("NEBIUS_API_KEY", "  ");
    vi.stubEnv("NEBIUS_BASE_URL", "https://example.invalid/v1/");
    expect(captureError(getNebiusEnv).variables).toEqual(["NEBIUS_API_KEY"]);
  });

  it("rejects a non-https base URL without echoing it", () => {
    vi.stubEnv("NEBIUS_API_KEY", FAKE_KEY);
    vi.stubEnv("NEBIUS_BASE_URL", "http://SENTINEL-host.invalid/v1");
    const err = captureError(getNebiusEnv);
    expect(err.variables).toEqual(["NEBIUS_BASE_URL"]);
    expect(err.message).not.toContain("SENTINEL");
  });

  it("validates lazily and caches after first success", () => {
    vi.stubEnv("NEBIUS_API_KEY", FAKE_KEY);
    vi.stubEnv("NEBIUS_BASE_URL", "https://example.invalid/v1/");
    const first = getNebiusEnv();
    vi.stubEnv("NEBIUS_API_KEY", undefined);
    expect(getNebiusEnv()).toBe(first);
  });
});

describe("secret values never appear in error text", () => {
  it("nebius: valid key, bad URL → message excludes the key", () => {
    vi.stubEnv("NEBIUS_API_KEY", FAKE_KEY);
    vi.stubEnv("NEBIUS_BASE_URL", "not a url");
    const err = captureError(getNebiusEnv);
    expect(err.message).not.toContain(FAKE_KEY);
    expect(err.message).not.toContain("not a url");
    expect(String(err.stack)).not.toContain(FAKE_KEY);
  });

  it("supabase: valid key, bad URL → message excludes the key", () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", FAKE_KEY);
    vi.stubEnv("SUPABASE_URL", "ftp://SENTINEL.invalid");
    const err = captureError(getSupabaseEnv);
    expect(err.message).not.toContain(FAKE_KEY);
    expect(err.message).not.toContain("SENTINEL");
  });

  it("upstash: valid token, bad URL → message excludes the token", () => {
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", FAKE_TOKEN);
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "SENTINEL");
    const err = captureError(getUpstashEnv);
    expect(err.message).not.toContain(FAKE_TOKEN);
    expect(err.message).not.toContain("SENTINEL");
  });

  it("pipeline: invalid numeric value is not echoed", () => {
    vi.stubEnv("MAX_LLM_CALLS_PER_RUN", "SENTINEL-NaN");
    const err = captureError(getPipelineEnv);
    expect(err.variables).toEqual(["MAX_LLM_CALLS_PER_RUN"]);
    expect(err.message).not.toContain("SENTINEL");
  });
});

describe("groups are independent", () => {
  it("nebius works with supabase/upstash entirely unset", () => {
    vi.stubEnv("NEBIUS_API_KEY", FAKE_KEY);
    vi.stubEnv("NEBIUS_BASE_URL", "https://example.invalid/v1/");
    expect(() => getNebiusEnv()).not.toThrow();
    expect(() => getPipelineEnv()).not.toThrow();
    expect(() => getGuardEnv()).not.toThrow();
    expect(() => getSupabaseEnv()).toThrow(EnvError);
    expect(() => getUpstashEnv()).toThrow(EnvError);
  });

  it("supabase errors only mention supabase variables", () => {
    const err = captureError(getSupabaseEnv);
    expect(err.group).toBe("supabase");
    expect([...err.variables].sort()).toEqual(["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_URL"]);
    expect(err.message).not.toContain("NEBIUS");
  });

  it("upstash errors only mention upstash variables", () => {
    const err = captureError(getUpstashEnv);
    expect([...err.variables].sort()).toEqual([
      "UPSTASH_REDIS_REST_TOKEN",
      "UPSTASH_REDIS_REST_URL",
    ]);
  });
});

describe("pipeline and guard defaults mirror .env.example", () => {
  it("pipeline defaults", () => {
    expect(getPipelineEnv()).toEqual({
      CTGOV_API_BASE: "https://clinicaltrials.gov/api/v2",
      PARSER_VERSION: "v0",
      MAX_CANDIDATE_TRIALS: 30,
      MAX_LLM_CALLS_PER_RUN: 80,
      LLM_CONCURRENCY: 6,
      CRITERIA_CACHE_WRITES: true,
      TIER_UNKNOWN_THRESHOLD: 3,
      MAX_INPUT_CHARS: 2000,
      LOG_LEVEL: "info",
    });
  });

  it("CRITERIA_CACHE_WRITES: only the exact strings true/false; a typo is an EnvError, never a silent re-enable", () => {
    vi.stubEnv("CRITERIA_CACHE_WRITES", "false");
    expect(getPipelineEnv().CRITERIA_CACHE_WRITES).toBe(false);
    resetEnvCacheForTests();
    vi.stubEnv("CRITERIA_CACHE_WRITES", "flase");
    expect(() => getPipelineEnv()).toThrow(/CRITERIA_CACHE_WRITES/);
  });

  it("guard defaults", () => {
    expect(getGuardEnv()).toEqual({
      RATE_LIMIT_RUNS_PER_IP_PER_HOUR: 8,
      DAILY_RUN_BUDGET: 150,
      REPLAY_FALLBACK_ENABLED: true,
    });
  });

  it("overrides are coerced", () => {
    vi.stubEnv("LLM_CONCURRENCY", "2");
    vi.stubEnv("REPLAY_FALLBACK_ENABLED", "false");
    expect(getPipelineEnv().LLM_CONCURRENCY).toBe(2);
    expect(getGuardEnv().REPLAY_FALLBACK_ENABLED).toBe(false);
  });

  it("rejects zero / negative tuning values", () => {
    vi.stubEnv("LLM_CONCURRENCY", "0");
    expect(captureError(getPipelineEnv).variables).toEqual(["LLM_CONCURRENCY"]);
  });
});

describe("visitor input group", () => {
  const SECRET = "fictional-test-secret-0123456789-0123456789";
  it("defaults to samples-only with conservative limits and needs no secrets", () => {
    expect(getVisitorEnv()).toEqual({
      VISITOR_INPUT_MODE: "samples",
      RATE_LIMIT_EXTRACT_PER_IP_PER_HOUR: 12,
      DAILY_EXTRACT_BUDGET: 300,
      MAX_CONCURRENT_RUNS: 3,
    });
  });

  it("open mode requires the signing secret and the IP-hash salt, and names them without values", () => {
    vi.stubEnv("VISITOR_INPUT_MODE", "open");
    const err = captureError(getVisitorEnv);
    expect(err.group).toBe("visitor");
    expect([...err.variables].sort()).toEqual(["PROFILE_SIGNING_SECRET", "RATE_LIMIT_IP_SALT"]);
    vi.stubEnv("PROFILE_SIGNING_SECRET", SECRET);
    vi.stubEnv("RATE_LIMIT_IP_SALT", "fictional-salt-0123456789");
    resetEnvCacheForTests();
    const ok = getVisitorEnv();
    expect(ok.VISITOR_INPUT_MODE).toBe("open");
    expect(JSON.stringify(captureError(() => { vi.stubEnv("PROFILE_SIGNING_SECRET", "short"); resetEnvCacheForTests(); getVisitorEnv(); }))).not.toContain("short");
  });

  it("rejects an unknown mode", () => {
    vi.stubEnv("VISITOR_INPUT_MODE", "everyone");
    expect(captureError(getVisitorEnv).variables).toEqual(["VISITOR_INPUT_MODE"]);
  });
});
