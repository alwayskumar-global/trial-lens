// The REAL createPipelineDeps cache wiring against a recording fake Supabase client (no network, no model call).
// CRITERIA_CACHE_WRITES=false: neither a cache hit nor a cold miss may call upsert/insert/update/delete; the default (true) path keeps writing.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { leafToNode } from "@/lib/engine/clause";
import { atom } from "@/lib/engine/test-helpers";
import type { ParseOutcome } from "@/lib/engine/reconcile";
import { resetEnvCacheForTests } from "@/lib/env";

const calls: string[] = [];
let stored: unknown = null; // what a select(...).maybeSingle() returns as `parsed`

// Every builder method is recorded by name; select(...)...maybeSingle() resolves with `stored`.
function fakeClient() {
  const chain = (): Record<string, unknown> =>
    new Proxy({}, {
      get: (_t, name: string) => {
        if (name === "then") return undefined;
        return () => {
          calls.push(name);
          return name === "maybeSingle" ? Promise.resolve({ data: stored === null ? null : { parsed: stored }, error: null }) : name === "upsert" || name === "insert" || name === "update" || name === "delete" ? Promise.resolve({ error: null }) : chain();
        };
      },
    });
  return { from: (t: string) => (calls.push(`from:${t}`), chain()) };
}
vi.mock("@/lib/supabase", () => ({ getSupabase: () => fakeClient() }));

const WRITES = ["upsert", "insert", "update", "delete"];
const written = () => calls.filter((c) => WRITES.includes(c));
const outcome = (): ParseOutcome => ({ state: "parsed", category: "other", scoring: true, clause: leafToNode(atom("Age 65 years or older.", "age", "gte", 65, "years")), completeness: "full", vet: "ok" });
const KEY = { nct_id: "NCT00000001", source_version: "2026-01-01", parser_version: "p" };

const env = (writes: string | undefined) => {
  vi.stubEnv("NEBIUS_API_KEY", "test-key-not-real");
  vi.stubEnv("NEBIUS_BASE_URL", "https://example.invalid/v1/");
  vi.stubEnv("NEMOTRON_MODEL_FAST", "fast-model");
  vi.stubEnv("NEMOTRON_MODEL_MID", "mid-model");
  vi.stubEnv("CRITERIA_CACHE_WRITES", writes);
  resetEnvCacheForTests();
};
const makeDeps = async () => (await import("@/lib/pipeline/deps")).createPipelineDeps(new AbortController().signal);

beforeEach(() => {
  calls.length = 0;
  stored = null;
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCacheForTests();
});

describe("createPipelineDeps cache wiring", () => {
  it("flag false, cold miss: reads Supabase, set() calls no write method", async () => {
    env("false");
    const d = await makeDeps();
    expect(await d.cache.get(KEY)).toBeNull();
    await d.cache.set(KEY, [outcome()]);
    expect(calls).toContain("select");
    expect(written()).toEqual([]);
  });

  it("flag false, cache hit: returns the stored parse, writes nothing and keeps nothing in memory", async () => {
    env("false");
    stored = JSON.parse(JSON.stringify([outcome()]));
    const d = await makeDeps();
    expect(await d.cache.get(KEY)).toHaveLength(1);
    await d.cache.set(KEY, [outcome()]);
    expect(written()).toEqual([]);
    stored = null; // a second read must go to Supabase again (no memory layer retained the hit)
    expect(await d.cache.get(KEY)).toBeNull();
  });

  it("default (flag unset) and true: current behavior, a fully parsed set() upserts", async () => {
    for (const v of [undefined, "true"]) {
      calls.length = 0;
      env(v);
      const d = await makeDeps();
      await d.cache.set(KEY, [outcome()]);
      expect(calls.filter((c) => c === "upsert")).toHaveLength(1);
    }
  });

  it("default path still writes a memory hit back into the layers (read-through unchanged)", async () => {
    env("true");
    stored = JSON.parse(JSON.stringify([outcome()]));
    const d = await makeDeps();
    expect(await d.cache.get(KEY)).toHaveLength(1);
    stored = null;
    expect(await d.cache.get(KEY)).toHaveLength(1); // served from the memory layer
  });

  it("a writable shared instance is never reused once the flag is false, and the reverse (module-level cache)", async () => {
    env("true");
    const w = await makeDeps(); // builds the writable singleton first
    await w.cache.set(KEY, [outcome()]);
    expect(calls.filter((c) => c === "upsert")).toHaveLength(1);
    calls.length = 0;
    env("false"); // same process, same module: flag flips
    const r = await makeDeps();
    expect(r.cache).not.toBe(w.cache);
    await r.cache.set(KEY, [outcome()]);
    expect(written()).toEqual([]);
    env("true");
    const w2 = await makeDeps();
    expect(w2.cache).toBe(w.cache);
    await w2.cache.set(KEY, [outcome()]);
    expect(calls.filter((c) => c === "upsert")).toHaveLength(1);
  });

  it("an invalid flag value throws (no pipeline, no model call, no silent writable cache)", async () => {
    env("flase");
    await expect(makeDeps()).rejects.toThrow(/CRITERIA_CACHE_WRITES/);
    expect(calls).toEqual([]);
  });
});
