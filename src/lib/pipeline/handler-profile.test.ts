// Visitor-reviewed profile runs (/api/run {profile, extract_token}) and Policy R at the HTTP boundary. Fictional data only.
import { describe, expect, it } from "vitest";
import { MemoryReplayStore, type ReplayCase } from "@/lib/cache/replay";
import { profile } from "@/lib/engine/test-helpers";
import { createConcurrencyGate, createRunGuard } from "@/lib/guards/run-guard";
import { handleRun, type RunHandlerDeps } from "@/lib/pipeline/handler";
import { signExtraction } from "@/lib/profile/token";
import { SAMPLE_TEXT } from "@/lib/sample/triallens-sample";
import { SseEventSchema, type SseEvent } from "@/schema/sse";
import { fakeDeps, trial } from "./test-fakes";

const SECRET = "fictional-test-secret-0123456789-0123456789";
const NOW = new Date("2026-10-06T12:00:00Z");
const CASE: ReplayCase = { id: "demo-her2", label: "Fictional HER2-positive profile", profile_text: "fictional", events: [{ type: "counts", discovered: 3, filtered: 2, analyzed: 2 }] };
const base = () => profile({ age: 52, sex: "female", her2_status: "positive" });
const token = (p = base()) => signExtraction(p, SECRET, NOW);
const allow = () => createRunGuard({ limiter: { limit: async () => ({ success: true }) }, counter: { incr: async () => 1, expire: async () => 0 }, dailyBudget: 10 });

async function setup(over: Partial<RunHandlerDeps> = {}, trials = [trial("NCT00000001", ["Age 18 years or older."])], script = {}) {
  const replay = new MemoryReplayStore();
  await replay.put(CASE);
  const logs: Array<Record<string, string | number | boolean>> = [];
  const made: Array<ReturnType<typeof fakeDeps>> = [];
  const deps: RunHandlerDeps = {
    maxInputChars: 2000, replayFallbackEnabled: true, visitorInputMode: "open", signingSecret: SECRET, now: () => NOW,
    guard: allow, replay, makePipeline: () => { const d = fakeDeps(trials, script); made.push(d); return d; },
    ip: () => "1.2.3.4", log: (l) => logs.push(l), ...over,
  };
  return { deps, logs, made };
}
const post = (body: unknown, headers: Record<string, string> = {}) => new Request("http://x/api/run", { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
const events = async (res: Response): Promise<SseEvent[]> => (await res.text()).split("\n\n").filter(Boolean).map((c) => SseEventSchema.parse(JSON.parse(c.replace(/^data: /, ""))));
const results = (es: SseEvent[]) => es.flatMap((e) => (e.type === "trial_result" ? [e.assessment] : []));
const stageNames = (es: SseEvent[]) => es.flatMap((e) => (e.type === "stage" && e.status === "start" ? [e.stage] : []));

describe("profile runs: no extraction, server-derived basis (Policy R)", () => {
  it("an unchanged, validly signed profile skips extraction (no stage, no model call) and keeps STRONG", async () => {
    const { deps, made, logs } = await setup();
    const es = await events(await handleRun(post({ profile: base(), extract_token: token() }), deps));
    expect(es[0]).toEqual({ type: "mode", mode: "live" });
    expect(stageNames(es)[0]).toBe("discovery");
    expect(made[0]!.llm.calls.some((c) => c.name === "facts")).toBe(false);
    expect(es.some((e) => e.type === "profile")).toBe(true);
    const [r] = results(es);
    expect(r!.tier).toBe("STRONG");
    expect(r!.verifier_flags).not.toContain("self_edited_fact");
    expect(logs[0]).toMatchObject({ evt: "run", mode: "live", input: "profile", ok: true, edited: 0 });
    const done = es[es.length - 1] as Extract<SseEvent, { type: "done" }>;
    expect(done.stats!.worst_case_calls).toBeLessThanOrEqual(80);
  });

  it("an edited fact is capped by the SERVER: STRONG becomes POSSIBLE and the result says why", async () => {
    const edited = profile({ age: 53, sex: "female", her2_status: "positive" });
    const { deps, logs } = await setup();
    const [r] = results(await events(await handleRun(post({ profile: edited, extract_token: token() }), deps)));
    expect(r!.tier).toBe("POSSIBLE");
    expect(r!.verifier_flags).toContain("self_edited_fact");
    expect(logs[0]).toMatchObject({ edited: 1 });
  });

  it("an edit that does not touch a deciding fact changes nothing (row 10)", async () => {
    const edited = profile({ age: 52, sex: "female", her2_status: "positive", er_status: "positive" });
    const { deps } = await setup();
    expect(results(await events(await handleRun(post({ profile: edited, extract_token: token() }), deps)))[0]!.tier).toBe("STRONG");
  });

  it("a verified FAIL on a text-basis fact stays LIKELY_MISMATCH; on an edited fact it is UNCERTAIN (rows 3 and 4)", async () => {
    const t = [trial("NCT00000001", ["Age 65 years or older."])];
    const a = await setup({}, t, { failCheck: "confirm" });
    expect(results(await events(await handleRun(post({ profile: base(), extract_token: token() }), a.deps)))[0]!.tier).toBe("LIKELY_MISMATCH");
    const b = await setup({}, t, { failCheck: "confirm" });
    // the server extracted age 40; the visitor changed it to 52, which the (fake) verifier fully substantiates: only Policy R decides
    const r = results(await events(await handleRun(post({ profile: base(), extract_token: token(profile({ age: 40, sex: "female", her2_status: "positive" })) }), b.deps)))[0]!;
    expect(r.tier).toBe("UNCERTAIN");
    expect(r.verifier_flags).toContain("self_edited_fact");
  });

  it("missing, forged and wrong-profile tokens fail closed: every known fact counts as edited (row 12)", async () => {
    for (const extract_token of [undefined, "garbage", token().slice(0, -3) + "AAA", signExtraction(base(), "another-secret-0123456789-0123456789-x", NOW)]) {
      const { deps } = await setup();
      const [r] = results(await events(await handleRun(post({ profile: base(), ...(extract_token ? { extract_token } : {}) }), deps)));
      expect(r!.tier).toBe("POSSIBLE");
    }
    const { deps } = await setup({ signingSecret: undefined });
    expect(results(await events(await handleRun(post({ profile: base(), extract_token: token() }), deps)))[0]!.tier).toBe("POSSIBLE");
  });

  it("a token for a different extraction does not launder edits", async () => {
    const other = profile({ age: 60, sex: "female", her2_status: "positive" });
    const { deps } = await setup();
    const [r] = results(await events(await handleRun(post({ profile: base(), extract_token: token(other) }), deps)));
    expect(r!.tier).toBe("POSSIBLE"); // age differs from what the token says was extracted
  });
});

describe("profile body is untrusted", () => {
  const withFact = (k: string, patch: Record<string, unknown>) => ({ facts: { ...base().facts, [k]: { ...base().facts[k as "age"], ...patch } } });
  it("rejects client provenance/basis labels, notes, unknown keys, missing vocabulary keys and a bare token with fixed 400s", async () => {
    const { deps } = await setup();
    const bodies: unknown[] = [
      { profile: withFact("age", { provenance: "extracted" }), extract_token: token() },
      { profile: withFact("age", { basis: "text" }), extract_token: token() },
      { profile: withFact("age", { note: "free text" }), extract_token: token() },
      { profile: { ...base(), basis: "text" }, extract_token: token() },
      { profile: { facts: Object.fromEntries(Object.entries(base().facts).filter(([k]) => k !== "age")) }, extract_token: token() },
      { profile: withFact("age", { state: "known", value: "fifty-two" }), extract_token: token() },
      { profile: withFact("her2_status", { state: "uncertain", value: "x".repeat(65) }), extract_token: token() },
      { profile: base(), extract_token: token(), text: "also text" },
      { extract_token: token() },
      { text: "hello", extract_token: token() },
    ];
    for (const b of bodies) {
      const res = await handleRun(post(b), deps);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ code: "bad_request" });
    }
  });
});

describe("visitor input mode", () => {
  it("samples mode accepts only prepared fictional texts, and profiles only with a valid token", async () => {
    const { deps } = await setup({ visitorInputMode: "samples" });
    const denied = await handleRun(post({ text: "I am a real person with a real diagnosis" }), deps);
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ code: "visitor_input_disabled" });
    expect((await handleRun(post({ profile: base() }), deps)).status).toBe(403);
    expect((await handleRun(post({ profile: base(), extract_token: "forged" }), deps)).status).toBe(403);
    expect((await events(await handleRun(post({ text: SAMPLE_TEXT }), deps)))[0]).toEqual({ type: "mode", mode: "live" });
    expect((await events(await handleRun(post({ profile: base(), extract_token: token() }), deps)))[0]).toEqual({ type: "mode", mode: "live" });
    expect((await events(await handleRun(post({ replay_id: "demo-her2" }), deps)))[0]).toMatchObject({ mode: "replay", reason: "requested" });
  });
});

describe("no silent replay for visitor profile runs", () => {
  it("a guard refusal is an HTTP status even with fallback enabled (text runs still fall back)", async () => {
    const limited = createRunGuard({ limiter: { limit: async () => ({ success: false }) }, counter: { incr: async () => 1, expire: async () => 0 }, dailyBudget: 1 });
    const broken = createRunGuard({ limiter: { limit: async () => { throw new Error("down"); } }, counter: { incr: async () => 1, expire: async () => 0 }, dailyBudget: 1 });
    expect((await handleRun(post({ profile: base(), extract_token: token() }), (await setup({ guard: () => limited })).deps)).status).toBe(429);
    expect((await handleRun(post({ profile: base(), extract_token: token() }), (await setup({ guard: () => broken })).deps)).status).toBe(503);
    expect((await events(await handleRun(post({ text: "x" }), (await setup({ guard: () => limited })).deps)))[0]).toMatchObject({ mode: "replay", reason: "rate_limited" });
  });

  it("a model or CT.gov failure is an error event with no replay and no mixed state", async () => {
    const a = await setup({ makePipeline: () => { throw new Error("env"); } });
    const ea = await events(await handleRun(post({ profile: base(), extract_token: token() }), a.deps));
    expect(ea.map((e) => e.type)).toEqual(["error"]);
    expect(ea[0]).toMatchObject({ code: "model_unavailable", fallback_to_replay: false });
    const b = await setup({ makePipeline: () => fakeDeps([], {}, { discover: async () => { throw new Error("x"); } }) });
    const eb = await events(await handleRun(post({ profile: base(), extract_token: token() }), b.deps));
    expect(eb.find((e) => e.type === "error")).toMatchObject({ code: "ctgov_unavailable", fallback_to_replay: false });
    expect(eb.some((e) => e.type === "mode" && e.mode === "replay")).toBe(false);
    expect(eb.some((e) => e.type === "trial_result")).toBe(false);
    expect(b.logs.at(-1)).toMatchObject({ evt: "run", mode: "live", ok: false, reason: "ctgov_unavailable" });
  });
});

describe("cross-site and concurrency", () => {
  it("refuses browser cross-site POSTs; same-origin and header-less scripts pass", async () => {
    const { deps } = await setup();
    expect((await handleRun(post({ replay_id: "demo-her2" }, { "sec-fetch-site": "cross-site" }), deps)).status).toBe(403);
    expect((await handleRun(post({ replay_id: "demo-her2" }, { "sec-fetch-site": "same-site" }), deps)).status).toBe(403);
    expect((await handleRun(post({ replay_id: "demo-her2" }, { origin: "https://evil.example", host: "x" }), deps)).status).toBe(403);
    expect((await handleRun(post({ replay_id: "demo-her2" }, { "sec-fetch-site": "same-origin" }), deps)).status).toBe(200);
    expect((await handleRun(post({ replay_id: "demo-her2" }, { origin: "http://x", host: "x" }), deps)).status).toBe(200);
    expect((await handleRun(post({ replay_id: "demo-her2" }), deps)).status).toBe(200);
  });

  it("the in-flight gate refuses over the cap (shown as the rate-limit state) and releases when the stream ends", async () => {
    const m = new Map<string, number>();
    const port = { incr: async (k: string) => { m.set(k, (m.get(k) ?? 0) + 1); return m.get(k)!; }, decr: async (k: string) => { m.set(k, (m.get(k) ?? 0) - 1); return m.get(k)!; }, expire: async () => 1 };
    const gate = createConcurrencyGate({ counter: port, max: 1 });
    const { deps } = await setup({ gate: () => gate });
    const first = await handleRun(post({ profile: base(), extract_token: token() }), deps); // stream not consumed yet: holds the slot
    expect([...m.values()]).toEqual([1]);
    expect((await handleRun(post({ profile: base(), extract_token: token() }), deps)).status).toBe(429);
    expect((await events(await handleRun(post({ text: "x" }), deps)))[0]).toMatchObject({ mode: "replay", reason: "rate_limited" });
    await events(first);
    expect([...m.values()]).toEqual([0]);
  });
});

describe("privacy: nothing the visitor typed or edited reaches a log line or an error body", () => {
  it("logs and refusals carry counts and codes only", async () => {
    const marker = "SENTINEL-MARKER-fictional-9f3a";
    const p = base();
    p.facts.stage = { key: "stage", state: "uncertain", value: marker };
    const { deps, logs } = await setup();
    await events(await handleRun(post({ profile: p, extract_token: token() }), deps));
    const refused = await handleRun(post({ profile: { ...p, extra: marker }, extract_token: token() }), deps);
    expect(JSON.stringify(logs)).not.toContain(marker);
    expect(await refused.text()).not.toContain(marker);
    const g = await setup({ guard: () => { throw new Error(marker); } });
    await events(await handleRun(post({ text: marker }), g.deps));
    expect(JSON.stringify(g.logs)).not.toContain(marker);
  });
});
