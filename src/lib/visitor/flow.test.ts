// The visitor flow end to end against the REAL handlers with fake providers: Describe → /api/extract → edits → signed /api/run.
// Fictional text only; no network, no model, no Supabase.
import { describe, expect, it } from "vitest";
import { MemoryReplayStore } from "@/lib/cache/replay";
import { createRunGuard } from "@/lib/guards/run-guard";
import { handleExtract, type ExtractHandlerDeps } from "@/lib/pipeline/extract-handler";
import { handleRun, type RunHandlerDeps } from "@/lib/pipeline/handler";
import { fakeDeps, fakeLlm, trial } from "@/lib/pipeline/test-fakes";
import { signExtraction } from "@/lib/profile/token";
import { SAMPLE_TEXT } from "@/lib/sample/triallens-sample";
import { SseEventSchema, type SseEvent } from "@/schema/sse";
import { requestExtraction } from "./client";
import { extractError, runError } from "./copy";
import { add, remove, setSure, setValue, toRunProfile, type Drafts } from "./facts";

const SECRET = "fictional-test-secret-0123456789-0123456789";
const NOW = new Date("2026-10-06T12:00:00Z");
const allow = () => createRunGuard({ limiter: { limit: async () => ({ success: true }) }, counter: { incr: async () => 1, expire: async () => 0 }, dailyBudget: 10 });
const deny = () => createRunGuard({ limiter: { limit: async () => ({ success: false }) }, counter: { incr: async () => 1, expire: async () => 0 }, dailyBudget: 10 });

function server(mode: "open" | "samples", o: { guard?: () => ReturnType<typeof allow>; now?: () => Date; secret?: string } = {}) {
  const ex: ExtractHandlerDeps = { maxInputChars: 2000, visitorInputMode: mode, signingSecret: o.secret ?? SECRET, guard: o.guard ?? allow, now: () => NOW, makeLlm: () => fakeLlm(), ip: () => "1.1.1.1", log: () => {} };
  const run = (): RunHandlerDeps => ({ maxInputChars: 2000, replayFallbackEnabled: true, visitorInputMode: mode, signingSecret: o.secret ?? SECRET, now: o.now ?? (() => NOW), guard: o.guard ?? allow, replay: new MemoryReplayStore(), makePipeline: () => fakeDeps([trial("NCT00000001", ["Age 18 years or older."])]), ip: () => "1.1.1.1", log: () => {} });
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const req = new Request("http://x" + url, { method: "POST", body: init.body as string });
    return url === "/api/extract" ? handleExtract(req, ex) : handleRun(req, run());
  }) as unknown as typeof fetch;
  return { fetchImpl, run };
}
const events = async (res: Response): Promise<SseEvent[]> => (await res.text()).split("\n\n").filter(Boolean).map((c) => SseEventSchema.parse(JSON.parse(c.replace(/^data: /, ""))));
const runWith = async (fetchImpl: typeof fetch, drafts: Drafts, token: string) => fetchImpl("/api/run", { method: "POST", body: JSON.stringify({ profile: toRunProfile(drafts), extract_token: token }) });
const extract = async (fetchImpl: typeof fetch, text: string) => { const r = await requestExtraction(text, { fetchImpl }); if (!r.ok) throw new Error(r.code); return r; };

describe("open mode: edits reach the submitted profile", () => {
  it("edited, unsure, removed and added details are what the pipeline receives", async () => {
    const { fetchImpl } = server("open");
    const x = await extract(fetchImpl, "a made-up description");
    let d = setValue(x.drafts, "age", "61");
    d = setSure(d, "sex", false);
    d = remove(d, "her2_status");
    d = setValue(add(d, "stage"), "stage", "III");
    const res = await runWith(fetchImpl, d, x.token);
    expect(res.status).toBe(200);
    const profile = (await events(res)).find((e) => e.type === "profile") as Extract<SseEvent, { type: "profile" }>;
    const by = Object.fromEntries(profile.facts.map((f) => [f.key, f]));
    expect(by.age).toMatchObject({ state: "known", value: 61 });
    expect(by.sex).toMatchObject({ state: "uncertain", value: "female" });
    expect(by.stage).toMatchObject({ state: "known", value: "III" });
    expect(by.her2_status?.state ?? "unknown").toBe("unknown");
  });
  it("the unchanged profile also runs", async () => {
    const { fetchImpl } = server("open");
    const x = await extract(fetchImpl, "a made-up description");
    expect((await runWith(fetchImpl, x.drafts, x.token)).status).toBe(200);
  });
});

describe("tokens", () => {
  it("missing, forged, foreign-secret and expired tokens are refused with 401 and map to the restart message", async () => {
    const { fetchImpl } = server("open");
    const x = await extract(fetchImpl, "a made-up description");
    const forged = x.token.slice(0, -2) + (x.token.endsWith("AA") ? "BB" : "AA");
    const foreign = signExtraction({ facts: {} as never }, "another-secret-0123456789-0123456789-xx", NOW);
    for (const token of [forged, foreign, ""]) {
      const res = await runWith(fetchImpl, x.drafts, token);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ code: "invalid_token" });
    }
    const later = server("open", { now: () => new Date(NOW.getTime() + 3 * 3600 * 1000) });
    const expired = await runWith(later.fetchImpl, x.drafts, x.token);
    expect(expired.status).toBe(401);
    expect(runError(401, "invalid_token").action).toBe("restart");
  });
  it("a profile claiming facts the extraction never had is accepted only as a visitor edit in open mode (server derives edits itself)", async () => {
    const { fetchImpl } = server("open");
    const x = await extract(fetchImpl, "a made-up description");
    expect((await runWith(fetchImpl, setValue(add(x.drafts, "ecog"), "ecog", "1"), x.token)).status).toBe(200);
  });
});

describe("samples mode stays closed", () => {
  it("typed text is refused at extraction; prepared sample runs unchanged; any edit is refused at run", async () => {
    const { fetchImpl } = server("samples");
    const typed = await requestExtraction("a made-up description", { fetchImpl });
    expect(typed).toEqual({ ok: false, status: 403, code: "visitor_input_disabled" });
    expect(extractError(403, "visitor_input_disabled").action).toBe("example");
    const x = await extract(fetchImpl, SAMPLE_TEXT);
    expect((await runWith(fetchImpl, x.drafts, x.token)).status).toBe(200);
    const edited = await runWith(fetchImpl, setValue(x.drafts, "age", "61"), x.token);
    expect(edited.status).toBe(403);
    expect(await edited.json()).toEqual({ code: "visitor_input_disabled" });
    // a token minted for typed text in open mode cannot be used against the samples server
    const open = server("open");
    const t = await extract(open.fetchImpl, "a made-up description");
    expect((await runWith(fetchImpl, t.drafts, t.token)).status).toBe(403);
  });
});

describe("rate limits and failures", () => {
  it("extraction and profile runs report 429 (no silent replay for a profile run) and the UI copy offers the labelled example", async () => {
    const { fetchImpl } = server("open");
    const x = await extract(fetchImpl, "a made-up description");
    const limited = server("open", { guard: deny });
    expect(await requestExtraction("a made-up description", { fetchImpl: limited.fetchImpl })).toEqual({ ok: false, status: 429, code: "rate_limited" });
    const run = await runWith(limited.fetchImpl, x.drafts, x.token);
    expect(run.status).toBe(429);
    expect(runError(429, "rate_limited").action).toBe("example");
    expect(extractError(429, "rate_limited").action).toBe("example");
  });
  it("error copy never says eligible/qualify and never implies verification", () => {
    for (const e of [extractError(0, "network"), extractError(503, "model_unavailable"), runError(503, "guard_unavailable"), runError(401, "invalid_token"), runError(400, "bad_request")]) {
      expect(`${e.title} ${e.body}`).not.toMatch(/\b(eligible|qualify|verified|confirmed your)\b/i);
    }
  });
});
