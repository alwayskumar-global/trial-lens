// Selection modes: one code path for the route and the planner; parity with today's behavior in the default mode; the counts contract; fail-closed behavior.
// No network (fake fetch), no model.
import { afterEach, describe, expect, it, vi } from "vitest";
import { planWarm } from "../../../eval/lib/warm-plan";
import { MemoryReplayStore } from "@/lib/cache/replay";
import { createRunGuard } from "@/lib/guards/run-guard";
import { resetEnvCacheForTests } from "@/lib/env";
import { handleRun, type RunHandlerDeps } from "@/lib/pipeline/handler";
import { PipelineError, runPipeline } from "@/lib/pipeline/run";
import { fakeDeps } from "@/lib/pipeline/test-fakes";
import { SseEventSchema, type SseEvent } from "@/schema/sse";
import { discoverRecruitingBreastTrials } from "./client";
import { INTERVENTIONAL_FILTER, discoverBySelectionMode, selectFromDiscovered } from "./selection";

interface S { type?: string; conds?: string[]; mesh?: string[]; min?: string; max?: string; sex?: string; upd?: string }
const study = (id: string, o: S = {}) => ({
  protocolSection: {
    identificationModule: { nctId: id, briefTitle: `Trial ${id}` },
    statusModule: { overallStatus: "RECRUITING", lastUpdatePostDateStruct: { date: o.upd ?? "2026-01-01" } },
    eligibilityModule: { eligibilityCriteria: "Inclusion Criteria:\n* Age 18 years or older.\n* Able to sign consent.", minimumAge: o.min ?? "18 Years", ...(o.max ? { maximumAge: o.max } : {}), sex: o.sex ?? "ALL" },
    conditionsModule: { conditions: o.conds ?? ["Breast Cancer"] },
    designModule: { studyType: o.type ?? "INTERVENTIONAL" },
  },
  derivedSection: { conditionBrowseModule: { meshes: (o.mesh ?? ["Breast Neoplasms"]).map((term) => ({ term })), ancestors: [] } },
});
const id = (n: number) => `NCT${String(10_000_000 + n)}`;

function fakeFetch(pages: unknown[][], over?: { status?: number; throws?: boolean; body?: unknown }) {
  const urls: string[] = [];
  const f = (async (url: string) => {
    urls.push(String(url));
    if (over?.throws) throw new Error("network down");
    if (over?.status && over.status !== 200) return new Response("nope", { status: over.status });
    if (over?.body !== undefined) return new Response(JSON.stringify(over.body), { status: 200 });
    const q = new URL(String(url)).searchParams, idx = q.get("pageToken") ? Number(q.get("pageToken")) : 0;
    return new Response(JSON.stringify({ studies: pages[idx] ?? [], ...(idx + 1 < pages.length ? { nextPageToken: String(idx + 1) } : {}) }), { status: 200 });
  }) as unknown as typeof fetch;
  return { f, urls };
}
const params = (url: string) => Object.fromEntries(new URL(url).searchParams.entries());
const BASE = "https://ct.example/api/v2";

// 6 studies: two outside age 52, one male-only, one with no breast signal at all.
const PAGE1 = [study(id(1)), study(id(2), { min: "60 Years" }), study(id(3), { sex: "MALE" }), study(id(4), { conds: ["Menopause"], mesh: ["Obesity"] }), study(id(5), { conds: ["HER2-positive Breast Cancer"], mesh: [] }), study(id(6), { max: "40 Years" })];
const PAGE2 = [study(id(7)), study(id(8), { mesh: ["Neoplasm Metastasis", "Breast Neoplasms"] })];

describe("default mode is byte-for-byte today's behavior", () => {
  it("api-default issues the original request (no sort, no scope filter) and returns exactly what discoverRecruitingBreastTrials returns", async () => {
    const a = fakeFetch([PAGE1, PAGE2]), b = fakeFetch([PAGE1, PAGE2]);
    const viaMode = await discoverBySelectionMode("api-default", { base: BASE, maxPages: 2, fetchImpl: a.f });
    const direct = await discoverRecruitingBreastTrials({ base: BASE, maxPages: 2, fetchImpl: b.f });
    expect(viaMode).toEqual(direct);
    expect(a.urls).toEqual(b.urls);
    for (const u of a.urls) { const p = params(u); expect(p["sort"]).toBeUndefined(); expect(p["filter.advanced"]).toBeUndefined(); expect(p["query.cond"]).toBe("breast cancer"); expect(p["filter.overallStatus"]).toBe("RECRUITING"); expect(p["pageSize"]).toBe("60"); }
  });
});

describe("relevance-v1-interventional", () => {
  it("sends sort=@relevance and the interventional filter on both pages, keeps window order, drops studies with no breast signal", async () => {
    const f = fakeFetch([PAGE1, PAGE2]);
    const trials = await discoverBySelectionMode("relevance-v1-interventional", { base: BASE, maxPages: 2, fetchImpl: f.f });
    expect(f.urls).toHaveLength(2);
    for (const u of f.urls) { const p = params(u); expect(p["sort"]).toBe("@relevance"); expect(p["filter.advanced"]).toBe(INTERVENTIONAL_FILTER); }
    expect(trials.map((t) => t.nct_id)).toEqual([1, 2, 3, 5, 6, 7, 8].map(id)); // id(4) has no breast signal; a free-text-only breast study (id(5)) is kept
  });
});

describe("counts contract and route/planner parity", () => {
  const profile = { age: 52, sex: "female" };
  it("selectFromDiscovered: discovered = window after the scope guard, filtered = after age/sex, selected = first max of filtered", () => {
    const all = [1, 2, 3, 5, 6, 7, 8].map((n) => ({ nct_id: id(n), title: "", eligibility_text: "x", min_age: n === 2 ? "60 Years" : "18 Years", max_age: n === 6 ? "40 Years" : null, sex: n === 3 ? "MALE" : "ALL", last_update: null, sites: { total: 0, recruiting: 0, with_geo: 0 } }));
    const r = selectFromDiscovered(all, profile, 2);
    expect(r.discovered).toBe(7);
    expect(r.filtered).toBe(4); // id 2 (min 60), 3 (male), 6 (max 40) excluded
    expect(r.candidates.map((t) => t.nct_id)).toEqual([id(1), id(5)]);
  });

  it("the pipeline's counts event and trial_results equal what the warm-up planner selects for the same profile (same code)", async () => {
    const f = fakeFetch([PAGE1, PAGE2]);
    const discover = () => discoverBySelectionMode("relevance-v1-interventional", { base: BASE, maxPages: 2, fetchImpl: f.f });
    const events: SseEvent[] = [];
    await runPipeline("fictional profile text", fakeDeps([], {}, { discover, maxCandidates: 30 }), (e) => events.push(e));
    const counts = events.find((e) => e.type === "counts" && e.discovered !== undefined);
    const results = events.flatMap((e) => (e.type === "trial_result" ? [e.assessment.nct_id] : []));
    const plan = await planWarm({ mode: "relevance-v1-interventional", base: BASE, profiles: [{ id: "p", filter: profile }], cached: new Map(), discover: (m, b) => discoverBySelectionMode(m, { base: b, maxPages: 2, fetchImpl: fakeFetch([PAGE1, PAGE2]).f }) });
    expect(counts).toMatchObject({ discovered: 7, filtered: plan.perProfile[0]!.filtered, selected: plan.perProfile[0]!.selected });
    expect([...results].sort()).toEqual(plan.selected.map((t) => t.nct_id).sort());
    expect(results).toHaveLength((counts as { selected: number }).selected);
  });
});

describe("FAIL CLOSED: no fallback ordering, ever", () => {
  const cases: Array<[string, Parameters<typeof fakeFetch>[1], string]> = [
    ["HTTP 500", { status: 500 }, "CTGOV_HTTP"], ["HTTP 400 (bad sort)", { status: 400 }, "CTGOV_HTTP"], ["network error / timeout", { throws: true }, "CTGOV_NETWORK"],
    ["malformed page", { body: { nope: true } }, "CTGOV_SHAPE"], ["malformed study", { body: { studies: [{ bogus: 1 }] } }, "CTGOV_SHAPE"],
  ];
  for (const [name, over, code] of cases) {
    it(`${name} throws ${code} after exactly one relevance request (no second, differently-ordered request)`, async () => {
      const f = fakeFetch([PAGE1], over);
      await expect(discoverBySelectionMode("relevance-v1-interventional", { base: BASE, fetchImpl: f.f })).rejects.toMatchObject({ code });
      expect(f.urls).toHaveLength(1);
      expect(params(f.urls[0]!)["sort"]).toBe("@relevance");
    });
  }
  it("a non-interventional study in an interventional-scoped result throws CTGOV_SCOPE", async () => {
    await expect(discoverBySelectionMode("relevance-v1-interventional", { base: BASE, fetchImpl: fakeFetch([[study(id(1)), study(id(2), { type: "OBSERVATIONAL" })]]).f })).rejects.toMatchObject({ code: "CTGOV_SCOPE" });
  });

  it("the pipeline turns a selection failure into ctgov_unavailable", async () => {
    const discover = () => discoverBySelectionMode("relevance-v1-interventional", { base: BASE, fetchImpl: fakeFetch([], { status: 503 }).f });
    await expect(runPipeline("fictional profile text", fakeDeps([], {}, { discover }), () => undefined)).rejects.toMatchObject({ kind: "ctgov_unavailable" });
    expect(new PipelineError("ctgov_unavailable").kind).toBe("ctgov_unavailable");
  });

  const allow = createRunGuard({ limiter: { limit: async () => ({ success: true }) }, counter: { incr: async () => 1, expire: async () => 0 }, dailyBudget: 10 });
  async function stream(replayFallbackEnabled: boolean): Promise<SseEvent[]> {
    const replay = new MemoryReplayStore();
    await replay.put({ id: "demo-her2", label: "Fictional HER2-positive profile", profile_text: "fictional", events: [{ type: "counts", discovered: 3, filtered: 2, selected: 2 }] });
    const deps: RunHandlerDeps = {
      maxInputChars: 4000, replayFallbackEnabled, visitorInputMode: "open", guard: () => allow, replay,
      makePipeline: () => fakeDeps([], {}, { discover: () => discoverBySelectionMode("relevance-v1-interventional", { base: BASE, fetchImpl: fakeFetch([], { throws: true }).f }) }),
      ip: () => "1.2.3.4", log: () => undefined,
    };
    const res = await handleRun(new Request("http://x/api/run", { method: "POST", body: JSON.stringify({ text: "fictional profile text" }) }), deps);
    return (await res.text()).split("\n\n").filter(Boolean).map((c) => SseEventSchema.parse(JSON.parse(c.replace(/^data: /, ""))));
  }
  it("route level: with replay fallback on, the stream is a labelled replay (reason ctgov_unavailable), never a live run on another ordering", async () => {
    const ev = await stream(true);
    expect(ev.some((e) => e.type === "trial_result")).toBe(false);
    expect(ev.find((e) => e.type === "error")).toMatchObject({ code: "ctgov_unavailable", fallback_to_replay: true });
    expect(ev.find((e) => e.type === "mode" && e.mode === "replay")).toMatchObject({ reason: "ctgov_unavailable", replay_id: "demo-her2", label: "Fictional HER2-positive profile" });
    expect(ev.at(-1)).toMatchObject({ type: "done", replay: true });
  });
  it("route level: with replay fallback off, the stream is the existing error with no replay", async () => {
    const ev = await stream(false);
    expect(ev.find((e) => e.type === "error")).toMatchObject({ code: "ctgov_unavailable", fallback_to_replay: false });
    expect(ev.some((e) => e.type === "mode" && e.mode === "replay")).toBe(false);
    expect(ev.some((e) => e.type === "trial_result")).toBe(false);
  });
});

describe("createPipelineDeps honours CTGOV_SELECTION_MODE (server-side setting, default = today's behavior)", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); resetEnvCacheForTests(); });
  const setup = (mode: string | undefined) => {
    vi.stubEnv("NEBIUS_API_KEY", "test-key-not-real"); vi.stubEnv("NEBIUS_BASE_URL", "https://example.invalid/v1/");
    vi.stubEnv("NEMOTRON_MODEL_FAST", "fast"); vi.stubEnv("NEMOTRON_MODEL_MID", "mid"); vi.stubEnv("CTGOV_API_BASE", BASE);
    vi.stubEnv("CTGOV_SELECTION_MODE", mode); resetEnvCacheForTests();
    const f = fakeFetch([PAGE1]); vi.stubGlobal("fetch", f.f);
    return f;
  };
  const discoverVia = async (mode: string | undefined) => {
    const f = setup(mode);
    const { createPipelineDeps } = await import("@/lib/pipeline/deps");
    await createPipelineDeps(new AbortController().signal).discover();
    return params(f.urls[0]!);
  };
  it("unset, blank and 'api-default' all use the original query", async () => {
    for (const m of [undefined, "", "api-default"]) { const p = await discoverVia(m); expect(p["sort"]).toBeUndefined(); expect(p["filter.advanced"]).toBeUndefined(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); }
  });
  it("'relevance-v1-interventional' switches the route to sort=@relevance + the interventional filter", async () => {
    const p = await discoverVia("relevance-v1-interventional");
    expect(p["sort"]).toBe("@relevance"); expect(p["filter.advanced"]).toBe(INTERVENTIONAL_FILTER);
  });
  it("any other value is an EnvError, so live discovery fails closed (labelled replay) instead of silently using another mode", async () => {
    setup("relevance");
    const { createPipelineDeps } = await import("@/lib/pipeline/deps");
    expect(() => createPipelineDeps(new AbortController().signal)).toThrow(/CTGOV_SELECTION_MODE/);
  });
});

