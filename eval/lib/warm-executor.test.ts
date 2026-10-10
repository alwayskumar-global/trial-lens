// Executor wired to the reservation dispatcher and the insert-only store, with a FAKE provider and a FAKE Supabase client. No network, no model, no database.
import { describe, expect, it } from "vitest";
import { cacheKeyFor, PARSER_VERSION } from "../../src/lib/cache/criteria-cache";
import type { SourceCriterion } from "../../src/lib/engine/reconcile";
import { makeParse } from "../../src/lib/pipeline/test-fakes";
import { executeWarm, type Approval, type CurrentPlan, type ExecuteDeps, type WarmTrial } from "./warm-executor";
import { PortError, type ChatPort, type ChatReply, type ChatRequest } from "./warm-dispatch";
import { makeInsertOnlyStore, type SupabaseLike } from "./warm-store";
import { planFingerprint, type PlannedTrial } from "./warm-guard";

const price = { p: 3e-7, c: 9e-7 };
const src = (nct: string, n: number): SourceCriterion[] => Array.from({ length: n }, (_, i) => ({ id: `${nct}:inclusion:${i}`, nct_id: nct, type: "inclusion" as const, text: i === 0 ? "Age 18 years or older." : `Free text criterion number ${i}.` }));
const trial = (nct: string, n: number, upd = "2026-01-01"): WarmTrial => ({ nct_id: nct, last_update: upd, sources: src(nct, n) });
const planned = (t: WarmTrial): PlannedTrial => ({ nct_id: t.nct_id, source_version: cacheKeyFor(t.nct_id, t.last_update).source_version, criteria: t.sources.length, chunks: Math.ceil(t.sources.length / 15) });
const planOf = (warm: WarmTrial[]): CurrentPlan => { const trials = warm.map(planned); return { fingerprint: planFingerprint(PARSER_VERSION, "relevance-v1:interventional", trials), trials, warm }; };
const approvalOf = (plan: CurrentPlan, budgetUsd = 5): Approval => ({ fingerprint: plan.fingerprint, trials: plan.trials, budgetUsd, attemptCeiling: 2 * plan.trials.reduce((a, t) => a + t.chunks, 0), maxWrites: plan.trials.length });

// A provider that answers a parse request with a valid clause batch, tracking calls.
function provider(over: (req: ChatRequest, n: number) => ChatReply | PortError | undefined = () => undefined) {
  const st = { calls: 0 };
  const port: ChatPort = {
    async create(req) {
      const n = st.calls++;
      const o = over(req, n); if (o instanceof PortError) throw o; if (o) return o;
      const user = req.messages.find((m) => m.role === "user")!.content;
      const items = user.split("\n").filter((l) => l.startsWith("{")).map((l) => JSON.parse(l) as { index: number; text: string });
      return { content: JSON.stringify({ criteria: items.map((i) => ({ index: i.index, ...makeParse(i.text) })) }), usage: { prompt_tokens: 3000, completion_tokens: 1500 } };
    },
  };
  return { port, st };
}

// A fake Supabase that records every call and keeps rows in memory.
function fakeSupabase(initial: string[] = []) {
  const rows = new Map<string, Record<string, unknown>>(initial.map((k) => [k, { seeded: true }]));
  const calls: string[] = [];
  const sb: SupabaseLike = {
    from(table) {
      calls.push(`from:${table}`);
      return {
        select() { const f: Record<string, string> = {}; const q = { eq(c: string, v: string) { f[c] = v; return q; }, async maybeSingle() { calls.push("select"); return { data: rows.get(`${f["nct_id"]}|${f["source_version"]}|${f["parser_version"]}`) ?? null, error: null }; } }; return q; },
        async upsert(row, opts) { calls.push(`upsert:${opts.ignoreDuplicates}:${opts.onConflict}`); const k = `${row["nct_id"]}|${row["source_version"]}|${row["parser_version"]}`; if (!rows.has(k)) rows.set(k, row); return { error: null }; },
      };
    },
  };
  return { sb, rows, calls };
}

function deps(plan: CurrentPlan, p: ReturnType<typeof provider>, fs: ReturnType<typeof fakeSupabase>, over: Partial<ExecuteDeps> = {}): ExecuteDeps {
  return { port: p.port, store: makeInsertOnlyStore(fs.sb), price, sleep: async () => undefined, checkPrice: async () => true, planNow: async () => plan, model: "fake-mid", system: "SYSTEM", maxTokens: 8192, calibration: 3, concurrency: 4, ...over };
}

describe("executeWarm: approved plan -> reservation dispatcher -> insert-only writer", () => {
  it("parses every chunk, writes one insert-only row per fully parsed planned trial, and nothing else", async () => {
    const plan = planOf([trial("NCT00000001", 5), trial("NCT00000002", 17), trial("NCT00000003", 3)]); // 1 + 2 + 1 chunks
    const p = provider(), fs = fakeSupabase();
    const r = await executeWarm(deps(plan, p, fs), approvalOf(plan));
    expect(r.status).toBe("done");
    if (r.status !== "done") return;
    expect(r.summary).toMatchObject({ written: 3, chunks_parsed: 4, attempts: 4, halted: null, skipped: {}, usage: { replies: 4, reported: 4, unavailable: 0, prompt_tokens_reported: 12000, completion_tokens_reported: 6000, no_reply: { rate_limited: 0, timeout: 0, http: 0, network: 0 } } });
    expect(r.summary.usage.reported_cost_usd).toBeCloseTo(4 * (3000 * price.p + 1500 * price.c), 6);
    expect(r.summary.spent_usd).toBeCloseTo(4 * (3000 * price.p + 1500 * price.c), 10);
    expect(p.st.calls).toBe(4);
    expect(fs.rows.size).toBe(3);
    // the ONLY database operations are exact-key selects and insert-ignore upserts on the production conflict target
    expect(fs.calls.filter((c) => c.startsWith("upsert"))).toEqual(Array(3).fill("upsert:true:nct_id,parser_version,source_version"));
    expect(fs.calls.every((c) => c === "from:trial_criteria_cache" || c === "select" || c.startsWith("upsert:true:"))).toBe(true);
    expect([...fs.rows.keys()].sort()).toEqual(plan.trials.map((t) => `${t.nct_id}|${t.source_version}|${PARSER_VERSION}`).sort());
  });

  it("FINGERPRINT GATE: if the selection changed, nothing is called and nothing is written; the diff names ids only", async () => {
    const approved = planOf([trial("NCT00000001", 5), trial("NCT00000002", 5)]);
    const changed = planOf([trial("NCT00000001", 5), trial("NCT00000009", 5)]);
    const p = provider(), fs = fakeSupabase();
    const r = await executeWarm(deps(changed, p, fs), approvalOf(approved));
    expect(r).toEqual({ status: "refused", reason: "plan_changed", diff: { added: ["NCT00000009"], removed: ["NCT00000002"], version_changed: [] } });
    expect(p.st.calls).toBe(0);
    expect(fs.rows.size).toBe(0);
    expect(fs.calls).toEqual([]);
    const upd = planOf([trial("NCT00000001", 5), trial("NCT00000002", 5, "2026-05-05")]);
    expect((await executeWarm(deps(upd, p, fs), approvalOf(approved)))).toMatchObject({ status: "refused", reason: "plan_changed", diff: { version_changed: ["NCT00000002"] } });
  });

  it("PRICE GATE: a changed provider price refuses before any call", async () => {
    const plan = planOf([trial("NCT00000001", 5)]); const p = provider(), fs = fakeSupabase();
    expect(await executeWarm(deps(plan, p, fs, { checkPrice: async () => false }), approvalOf(plan))).toEqual({ status: "refused", reason: "price_changed" });
    expect(p.st.calls).toBe(0);
  });

  it("approval sanity: ceiling must be 2 x chunks and max writes between 1 and the planned trial count", async () => {
    const plan = planOf([trial("NCT00000001", 5)]); const p = provider(), fs = fakeSupabase();
    for (const bad of [{ attemptCeiling: 99 }, { maxWrites: 7 }, { maxWrites: 0 }, { budgetUsd: 0 }]) expect(await executeWarm(deps(plan, p, fs), { ...approvalOf(plan), ...bad })).toEqual({ status: "refused", reason: "bad_approval" });
    expect(p.st.calls).toBe(0);
  });

  it("a key that already exists at write time is skipped (exact-key re-check), never overwritten", async () => {
    const t = trial("NCT00000001", 5), plan = planOf([t]), k = cacheKeyFor(t.nct_id, t.last_update);
    const fs = fakeSupabase([`${k.nct_id}|${k.source_version}|${k.parser_version}`]);
    const p = provider();
    const r = await executeWarm(deps(plan, p, fs), approvalOf(plan));
    expect(r).toMatchObject({ status: "done", summary: { written: 0, skipped: { already_cached: 1 } } });
    expect(p.st.calls).toBe(0); // existing at the pre-dispatch check: not even parsed
    expect(fs.calls.some((c) => c.startsWith("upsert"))).toBe(false);
    expect(fs.rows.get(`${k.nct_id}|${k.source_version}|${k.parser_version}`)).toEqual({ seeded: true });
  });

  it("a trial with an unparsed chunk is not written, while fully parsed trials are", async () => {
    const plan = planOf([trial("NCT00000001", 5), trial("NCT00000002", 17)]);
    // every reply for the 17-criteria trial's SECOND chunk (a single criterion) is garbage, including the retry
    const p = provider((req) => (req.messages.find((m) => m.role === "user")!.content.includes('"index":0') && req.messages[1]!.content.split("\n").filter((l) => l.startsWith("{")).length === 2 ? { content: "garbage", usage: { prompt_tokens: 100, completion_tokens: 10 } } : undefined));
    const fs = fakeSupabase();
    const r = await executeWarm(deps(plan, p, fs), approvalOf(plan));
    if (r.status !== "done") throw new Error("expected done");
    expect(r.summary.written).toBe(1);
    expect(r.summary.skipped).toEqual({ unparsed_chunk: 1 });
    expect(r.summary.chunks_unparsed).toEqual({ invalid_after_retry: 1 });
    expect([...fs.rows.keys()].map((k) => k.split("|")[0])).toEqual(["NCT00000001"]);
  });

  it("an assumption failure halts dispatch; only trials already fully parsed are written", async () => {
    const plan = planOf(Array.from({ length: 6 }, (_, i) => trial(`NCT0000010${i}`, 5)));
    const p = provider((_, n) => (n === 1 ? { content: "{}", usage: { prompt_tokens: 10, completion_tokens: 9000 } } : undefined)); // second reply exceeds max_tokens
    const fs = fakeSupabase();
    const r = await executeWarm(deps(plan, p, fs), approvalOf(plan));
    if (r.status !== "done") throw new Error("expected done");
    expect(r.summary.halted).toBe("completion_exceeds_max_tokens");
    expect(p.st.calls).toBe(2); // calibration runs one at a time, so dispatch stopped right after the violation
    expect(r.summary.written).toBe(1);
    expect(r.summary.written).toBeLessThan(plan.trials.length);
  });

  it("the approved write maximum is enforced even when more trials parse fully", async () => {
    const plan = planOf([trial("NCT00000001", 5), trial("NCT00000002", 5), trial("NCT00000003", 5)]);
    const p = provider(), fs = fakeSupabase();
    const r = await executeWarm(deps(plan, p, fs), { ...approvalOf(plan), maxWrites: 2 });
    if (r.status !== "done") throw new Error("expected done");
    expect(r.summary.written).toBe(2);
    expect(r.summary.skipped).toEqual({ max_writes_reached: 1 });
    expect(fs.rows.size).toBe(2);
  });

  it("the budget bounds the run: a tiny budget dispatches nothing and writes nothing", async () => {
    const plan = planOf([trial("NCT00000001", 5), trial("NCT00000002", 5)]); const p = provider(), fs = fakeSupabase();
    const r = await executeWarm(deps(plan, p, fs), approvalOf(plan, 0.001));
    if (r.status !== "done") throw new Error("expected done");
    expect(p.st.calls).toBe(0);
    expect(r.summary.written).toBe(0);
    expect(r.summary.chunks_unparsed).toEqual({ refused_budget: 2 });
    expect(fs.rows.size).toBe(0);
  });
});

describe("insert-only store (fake Supabase client)", () => {
  it("can only select and insert-ignore: no update, no delete, no plain insert", async () => {
    const fs = fakeSupabase(), store = makeInsertOnlyStore(fs.sb);
    const k = cacheKeyFor("NCT00000001", "2026-01-01");
    expect(await store.insertIfAbsent(k, [])).toBe("inserted");
    expect(await store.insertIfAbsent(k, [])).toBe("exists");
    expect(fs.calls.filter((c) => c.startsWith("upsert"))).toHaveLength(1);
    expect(fs.calls.every((c) => c === "from:trial_criteria_cache" || c === "select" || c === `upsert:true:nct_id,parser_version,source_version`)).toBe(true);
  });
  it("a select or insert error throws a fixed code and never reports success", async () => {
    const bad: SupabaseLike = { from: () => ({ select: () => { const q = { eq: () => q, maybeSingle: async () => ({ data: null, error: { message: "secret detail" } }) }; return q; }, upsert: async () => ({ error: { message: "secret detail" } }) }) };
    await expect(makeInsertOnlyStore(bad).insertIfAbsent(cacheKeyFor("NCT00000001", "x"), [])).rejects.toMatchObject({ code: "STORE_SELECT" });
    const noInsert: SupabaseLike = { from: () => ({ select: () => { const q = { eq: () => q, maybeSingle: async () => ({ data: null, error: null }) }; return q; }, upsert: async () => ({ error: { message: "secret detail" } }) }) };
    const e = await makeInsertOnlyStore(noInsert).insertIfAbsent(cacheKeyFor("NCT00000001", "x"), []).catch((x: Error) => x);
    expect(e).toMatchObject({ code: "STORE_INSERT" });
    expect(String((e as Error).message)).not.toContain("secret");
  });
});
