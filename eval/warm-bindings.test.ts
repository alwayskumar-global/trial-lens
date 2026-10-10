// The REAL bindings driven by fakes: no network, no model call, no database call.
import OpenAI from "openai";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetEnvCacheForTests } from "../src/lib/env";
import { classifyError, makeCacheStore, openAiPort, priceMatches, type ChatClientLike } from "./warm-bindings";
import { PortError } from "./lib/warm-dispatch";
import { CONFIRM_VALUE, EXECUTE_ENABLED, MAX_BUDGET_USD, executeGate, type PlanFile } from "./lib/warm-run";
import { planFingerprint, type PlannedTrial } from "./lib/warm-guard";

afterEach(() => { vi.unstubAllEnvs(); resetEnvCacheForTests(); });

const clientReturning = (r: unknown): ChatClientLike & { seen: Array<Record<string, unknown>> } => { const seen: Array<Record<string, unknown>> = []; return { seen, chat: { completions: { create: async (p) => { seen.push(p); return r as never; } } } }; };
const clientThrowing = (e: unknown): ChatClientLike => ({ chat: { completions: { create: async () => { throw e; } } } });
const req = { model: "m", messages: [{ role: "user" as const, content: "x" }], max_tokens: 8192, temperature: 0 };

describe("openAiPort (provider binding)", () => {
  it("passes the request through unchanged and returns content and reported usage", async () => {
    const c = clientReturning({ choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 12, completion_tokens: 3 } });
    expect(await openAiPort(c).create(req)).toEqual({ content: '{"ok":true}', usage: { prompt_tokens: 12, completion_tokens: 3 } });
    expect(c.seen[0]).toEqual(req);
  });
  it("null content becomes an empty string and missing usage stays null (so the dispatcher charges the worst case and halts)", async () => {
    expect(await openAiPort(clientReturning({ choices: [{ message: { content: null } }] })).create(req)).toEqual({ content: "", usage: null });
    expect(await openAiPort(clientReturning({ choices: [] })).create(req)).toEqual({ content: "", usage: null });
  });
  it("maps every SDK failure to a fixed PortError kind", async () => {
    const h = new Headers();
    const cases: Array<[unknown, string]> = [
      [new OpenAI.RateLimitError(429, { message: "x" }, "x", h), "rate_limited"],
      [new OpenAI.APIConnectionTimeoutError({ message: "t" }), "timeout"],
      [new OpenAI.APIConnectionError({ message: "c" }), "network"],
      [new OpenAI.InternalServerError(500, { message: "x" }, "x", h), "http"],
      [new OpenAI.BadRequestError(400, { message: "x" }, "x", h), "http"],
      [new Error("anything else"), "network"],
    ];
    for (const [err, kind] of cases) {
      expect(classifyError(err).kind).toBe(kind);
      await expect(openAiPort(clientThrowing(err)).create(req)).rejects.toBeInstanceOf(PortError);
      await expect(openAiPort(clientThrowing(err)).create(req)).rejects.toMatchObject({ kind });
    }
  });
  it("never leaks provider text: the thrown error carries only the fixed kind", async () => {
    const e = await openAiPort(clientThrowing(new OpenAI.InternalServerError(500, { message: "SECRET-PROVIDER-TEXT" }, "SECRET-PROVIDER-TEXT", new Headers()))).create(req).catch((x: Error) => x);
    expect(String((e as Error).message)).toBe("http");
  });
});

describe("production client settings (assumption A4: no hidden retries)", () => {
  it("makeClient has maxRetries 0 and an explicit 120 s timeout", async () => {
    vi.stubEnv("NEBIUS_API_KEY", "test-key-not-real"); vi.stubEnv("NEBIUS_BASE_URL", "https://example.invalid/v1/"); resetEnvCacheForTests();
    const { makeClient } = await import("../src/lib/llm/client");
    const c = makeClient();
    expect(c.maxRetries).toBe(0);
    expect(c.timeout).toBe(120_000);
  });
});

describe("makeCacheStore (Supabase binding)", () => {
  it("binds the real client lazily with only the surface the insert-only store uses; construction makes no call", async () => {
    vi.stubEnv("SUPABASE_URL", "https://example.invalid"); vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-key-not-real"); resetEnvCacheForTests();
    const store = makeCacheStore();
    expect(typeof store.exists).toBe("function");
    expect(typeof store.insertIfAbsent).toBe("function");
    expect(Object.keys(store).sort()).toEqual(["exists", "insertIfAbsent"]); // no update, no delete, no raw client exposed
    const { getSupabase } = await import("../src/lib/supabase");
    const q = getSupabase().from("trial_criteria_cache");
    expect(typeof q.select).toBe("function");
    expect(typeof q.upsert).toBe("function");
  });
});

describe("priceMatches (fail closed)", () => {
  const price = { p: 3e-7, c: 9e-7 };
  const ok = (body: unknown, status = 200) => (async (url: string, init?: RequestInit) => { void url; void init; return new Response(JSON.stringify(body), { status }); }) as unknown as typeof fetch;
  const o = (f: typeof fetch) => ({ fetchImpl: f, baseUrl: "https://prov.example/v1/", apiKey: "k", modelId: "mid", price });
  it("true only when the model lists exactly the priced prompt and completion prices", async () => {
    expect(await priceMatches(o(ok({ data: [{ id: "mid", pricing: { prompt: "0.0000003", completion: "0.0000009" } }] })))).toBe(true);
  });
  it("false on a changed price, a missing model, a malformed price, an HTTP error or a network error", async () => {
    expect(await priceMatches(o(ok({ data: [{ id: "mid", pricing: { prompt: "0.0000004", completion: "0.0000009" } }] })))).toBe(false);
    expect(await priceMatches(o(ok({ data: [{ id: "other", pricing: { prompt: "0.0000003", completion: "0.0000009" } }] })))).toBe(false);
    expect(await priceMatches(o(ok({ data: [{ id: "mid", pricing: { prompt: "free", completion: "0.0000009" } }] })))).toBe(false);
    expect(await priceMatches(o(ok({}, 500)))).toBe(false);
    expect(await priceMatches(o((async () => { throw new Error("down"); }) as unknown as typeof fetch))).toBe(false);
  });
  it("calls the metadata endpoint (a GET), not an inference endpoint", async () => {
    const seen: string[] = [];
    await priceMatches(o((async (u: string, init?: RequestInit) => { seen.push(`${init?.method ?? "GET"} ${u}`); return new Response("{}", { status: 200 }); }) as unknown as typeof fetch));
    expect(seen).toEqual(["GET https://prov.example/v1/models?verbose=true"]);
  });
});

describe("executeGate and the disabled entry point", () => {
  const cleanEnv = { PATH: process.env["PATH"] ?? "" } as unknown as NodeJS.ProcessEnv; // no keys, no URLs
  const trials: PlannedTrial[] = [{ nct_id: "NCT00000001", source_version: "2026-01-01", criteria: 5, chunks: 1 }, { nct_id: "NCT00000002", source_version: "2026-01-01", criteria: 17, chunks: 2 }];
  const plan: PlanFile = { policy: "relevance-v1:interventional", parser_version: "p1", trials, fingerprint: planFingerprint("p1", "relevance-v1:interventional", trials) };
  const env = { WARM_CONFIRM: CONFIRM_VALUE, WARM_PLAN: plan.fingerprint, WARM_BUDGET_USD: "0.75" };

  it("PINNED: execution is disabled. Flipping EXECUTE_ENABLED is a reviewed change that needs Kumar's separate approval (and this test updated with it)", () => {
    expect(EXECUTE_ENABLED).toBe(false);
  });
  it("refuses while disabled, even with a perfect environment", () => {
    expect(executeGate(env, plan)).toEqual({ ok: false, reason: "disabled" });
  });
  it("when enabled it still needs confirmation, a sane budget, a consistent plan file and the approved fingerprint", () => {
    expect(executeGate({ ...env, WARM_CONFIRM: "yes" }, plan, true)).toEqual({ ok: false, reason: "not_confirmed" });
    for (const b of ["0", "-1", "abc", String(MAX_BUDGET_USD + 1), ""]) expect(executeGate({ ...env, WARM_BUDGET_USD: b }, plan, true)).toEqual({ ok: false, reason: "bad_budget" });
    expect(executeGate(env, null, true)).toEqual({ ok: false, reason: "plan_missing" });
    expect(executeGate(env, { ...plan, trials: [...trials, { nct_id: "NCT00000009", source_version: "x", criteria: 1, chunks: 1 }] }, true)).toEqual({ ok: false, reason: "plan_file_inconsistent" });
    expect(executeGate({ ...env, WARM_PLAN: "0".repeat(64) }, plan, true)).toEqual({ ok: false, reason: "fingerprint_mismatch" });
    const g = executeGate(env, plan, true);
    expect(g).toEqual({ ok: true, approval: { fingerprint: plan.fingerprint, trials, budgetUsd: 0.75, attemptCeiling: 6, maxWrites: 2 } });
  });
  it("the entry point exits 2 immediately and touches nothing (run with a clean environment: no keys, no URLs)", () => {
    const r = spawnSync(process.execPath, ["--import", "tsx", "eval/warm-execute.ts"], { env: cleanEnv, encoding: "utf8", timeout: 60_000 });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("DISABLED");
    expect(r.stdout).toBe("");
  });
  it("warm-cache.ts --execute is also refused", () => {
    const r = spawnSync(process.execPath, ["--import", "tsx", "eval/warm-cache.ts", "--execute"], { env: cleanEnv, encoding: "utf8", timeout: 60_000 });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("NOT approved");
  });
});
