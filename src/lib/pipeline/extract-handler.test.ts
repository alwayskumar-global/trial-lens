// POST /api/extract: one FAST call, structured facts + signed token, no analysis. Fictional data only; no network.
import { describe, expect, it } from "vitest";
import { MemoryReplayStore } from "@/lib/cache/replay";
import { createRunGuard } from "@/lib/guards/run-guard";
import { handleExtract, type ExtractHandlerDeps } from "@/lib/pipeline/extract-handler";
import { handleRun } from "@/lib/pipeline/handler";
import { verifyExtraction } from "@/lib/profile/token";
import { SAMPLE_TEXT } from "@/lib/sample/triallens-sample";
import { SseEventSchema, type SseEvent } from "@/schema/sse";
import { FACT_KEYS } from "@/schema/vocabulary";
import { fakeDeps, fakeLlm, trial } from "./test-fakes";

const SECRET = "fictional-test-secret-0123456789-0123456789";
const NOW = new Date("2026-10-06T12:00:00Z");
const allow = () => createRunGuard({ limiter: { limit: async () => ({ success: true }) }, counter: { incr: async () => 1, expire: async () => 0 }, dailyBudget: 10 });
const post = (body: unknown, headers: Record<string, string> = {}) => new Request("http://x/api/extract", { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });

function setup(over: Partial<ExtractHandlerDeps> = {}, script = {}) {
  const logs: Array<Record<string, string | number | boolean>> = [];
  const llms: Array<ReturnType<typeof fakeLlm>> = [];
  const deps: ExtractHandlerDeps = {
    maxInputChars: 2000, visitorInputMode: "open", signingSecret: SECRET, guard: allow, now: () => NOW,
    makeLlm: () => { const l = fakeLlm(script); llms.push(l); return l; }, ip: () => "1.2.3.4", log: (l) => logs.push(l), ...over,
  };
  return { deps, logs, llms };
}

describe("POST /api/extract", () => {
  it("returns every vocabulary fact (state and value only) plus a verifiable token, with one FAST call and no analysis", async () => {
    const { deps, llms, logs } = setup();
    const res = await handleExtract(post({ text: "fictional description" }), deps);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as { profile: { facts: Record<string, { key: string; state: string; value?: unknown; note?: unknown }> }; extract_token: string };
    expect(Object.keys(body.profile.facts).sort()).toEqual([...FACT_KEYS].sort());
    expect(body.profile.facts.age).toEqual({ key: "age", state: "known", value: 52 });
    expect(body.profile.facts.stage).toEqual({ key: "stage", state: "unknown" });
    expect(Object.values(body.profile.facts).some((f) => "note" in f)).toBe(false);
    expect(llms[0]!.calls).toEqual([{ name: "facts", tier: "FAST" }]);
    expect([...verifyExtraction(body.extract_token, SECRET, NOW)!.facts.keys()].sort()).toEqual(["age", "her2_status", "sex"]);
    expect(logs).toEqual([{ evt: "extract", ok: true, facts: 3, calls: 1, ms: expect.any(Number) }]);
  });

  it("the extract → review → run round trip: unchanged is text-basis, one edit is capped by the server", async () => {
    const { deps } = setup();
    const body = (await (await handleExtract(post({ text: "fictional" }), deps)).json()) as { profile: { facts: Record<string, unknown> }; extract_token: string };
    const runDeps = async () => ({ maxInputChars: 2000, replayFallbackEnabled: true, visitorInputMode: "open" as const, signingSecret: SECRET, now: () => NOW, guard: allow, replay: new MemoryReplayStore(), makePipeline: () => fakeDeps([trial("NCT00000001", ["Age 18 years or older."])]), ip: () => "1.2.3.4", log: () => undefined });
    const tier = async (profile: unknown) => {
      const res = await handleRun(new Request("http://x/api/run", { method: "POST", body: JSON.stringify({ profile, extract_token: body.extract_token }) }), await runDeps());
      return (await res.text()).split("\n\n").filter(Boolean).map((c) => SseEventSchema.parse(JSON.parse(c.replace(/^data: /, "")))).flatMap((e: SseEvent) => (e.type === "trial_result" ? [e.assessment.tier] : []))[0];
    };
    expect(await tier(body.profile)).toBe("STRONG");
    expect(await tier({ facts: { ...body.profile.facts, age: { key: "age", state: "known", value: 50 } } })).toBe("POSSIBLE");
  });

  it("the token is flagged as a sample only for a prepared fictional text", async () => {
    const { deps } = setup();
    const sample = (await (await handleExtract(post({ text: SAMPLE_TEXT }), deps)).json()) as { extract_token: string };
    const other = (await (await handleExtract(post({ text: "some other fictional text" }), deps)).json()) as { extract_token: string };
    expect(verifyExtraction(sample.extract_token, SECRET, NOW)!.sample).toBe(true);
    expect(verifyExtraction(other.extract_token, SECRET, NOW)!.sample).toBe(false);
  });

  it("rejects malformed, empty, oversized and unknown-key bodies with fixed codes", async () => {
    const { deps } = setup();
    const cases: Array<[unknown, number, string]> = [["not json", 400, "bad_request"], [{}, 400, "bad_request"], [{ text: "   " }, 400, "bad_request"], [{ text: "x", extra: 1 }, 400, "bad_request"], [{ text: "x".repeat(2001) }, 413, "input_too_long"], [{ text: "x".repeat(20_000) }, 413, "input_too_long"]];
    for (const [b, status, code] of cases) {
      const res = await handleExtract(post(b), deps);
      expect(res.status).toBe(status);
      expect(await res.json()).toEqual({ code });
    }
  });

  it("samples mode sends only prepared fictional texts to the model; open mode needs a signing secret", async () => {
    const { deps, llms } = setup({ visitorInputMode: "samples" });
    const denied = await handleExtract(post({ text: "a real person's description" }), deps);
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ code: "visitor_input_disabled" });
    expect(llms).toHaveLength(0); // never reached the provider
    expect((await handleExtract(post({ text: SAMPLE_TEXT }), deps)).status).toBe(200);
    const none = setup({ signingSecret: undefined });
    expect((await handleExtract(post({ text: "x" }), none.deps)).status).toBe(503);
    expect(none.llms).toHaveLength(0);
  });

  it("has its own guard: refusals are 429/503, never a replay, and the model is not called", async () => {
    const mk = (limit: () => Promise<{ success: boolean }>) => createRunGuard({ limiter: { limit }, counter: { incr: async () => 1, expire: async () => 0 }, dailyBudget: 1 });
    const limited = setup({ guard: () => mk(async () => ({ success: false })) });
    expect((await handleExtract(post({ text: "x" }), limited.deps)).status).toBe(429);
    const down = setup({ guard: () => mk(async () => { throw new Error("down"); }) });
    expect((await handleExtract(post({ text: "x" }), down.deps)).status).toBe(503);
    const noRedis = setup({ guard: () => { throw new Error("no redis env"); } });
    expect((await handleExtract(post({ text: "x" }), noRedis.deps)).status).toBe(503);
    expect(limited.llms.length + down.llms.length + noRedis.llms.length).toBe(0);
  });

  it("a model failure or missing model env is a 503 with a fixed code, not a fabricated profile", async () => {
    const failing = setup({}, { facts: "fail" });
    const res = await handleExtract(post({ text: "x" }), failing.deps);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ code: "model_unavailable" });
    const noEnv = setup({ makeLlm: () => { throw new Error("env"); } });
    expect((await handleExtract(post({ text: "x" }), noEnv.deps)).status).toBe(503);
    expect(failing.logs[0]).toMatchObject({ evt: "extract", ok: false, reason: "model_unavailable" });
  });

  it("refuses browser cross-site POSTs", async () => {
    const { deps } = setup();
    expect((await handleExtract(post({ text: "x" }, { "sec-fetch-site": "cross-site" }), deps)).status).toBe(403);
    expect((await handleExtract(post({ text: "x" }, { origin: "https://evil.example", host: "x" }), deps)).status).toBe(403);
  });

  it("neither the text nor the facts reach a log line or an error body", async () => {
    const marker = "SENTINEL-MARKER-fictional-7c21";
    const { deps, logs } = setup({}, { facts: [{ key: "stage", state: "known", value: "III", note: marker }] });
    const ok = await handleExtract(post({ text: marker }), deps);
    expect(JSON.stringify(logs)).not.toContain(marker);
    expect(await ok.text()).not.toContain(marker); // the model's note is dropped, and the text is never echoed
    const bad = setup({ guard: () => { throw new Error(marker); } });
    const res = await handleExtract(post({ text: marker }), bad.deps);
    expect(await res.text()).not.toContain(marker);
    expect(JSON.stringify(bad.logs)).not.toContain(marker);
  });
});
