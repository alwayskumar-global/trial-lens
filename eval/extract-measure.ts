// Development check of the extraction prompts: A = `spike-0` (as measured in the spike), B = `hardened-1` (as shipped).
// 12 AUTHOR-WRITTEN FICTIONAL cases with author-written labels: development results, NOT measured clinical accuracy.
//
//   pnpm exec tsx eval/extract-measure.ts --dry-run   zero network, zero calls: prints the plan, the spend bound and the stop conditions
//   NODE_USE_ENV_PROXY=1 pnpm exec tsx eval/extract-measure.ts --run       offline arms (≤ 64 FAST calls, hard cap)
//   NODE_USE_ENV_PROXY=1 PREVIEW_URL=... pnpm exec tsx eval/extract-measure.ts --preview   3 prepared texts through Preview /api/extract (≤ 6 calls)
//
// Needs (names only): NEBIUS_API_KEY, NEBIUS_BASE_URL, NEMOTRON_MODEL_FAST; for --preview also PREVIEW_URL and PREVIEW_SHARE_URL.
// Never prints keys, the share link, cookies, extract tokens or any model text; output is counts, timings and fact KEY names only.
import { mkdirSync, writeFileSync } from "node:fs";
import { callJson, CallCap, makeClient } from "../src/lib/llm/client";
import { profileFromExtraction } from "../src/lib/pipeline/extract";
import { buildExtractUserPrompt, EXTRACT_SYSTEM, ExtractSchema } from "../src/prompts/extract";
import { DEV_CASES, hardened1System, PREVIEW_CASE_IDS, REPEAT_CASE_IDS, SPIKE0_SYSTEM, TRUNCATION_CASE_ID, type DevCase } from "./extract-dev-cases";
import { actualSpend, checkModelEntry, CONFIRMED, estimateH2Max, estimateMaxSpend, H2, wouldExceedSpend, OFFLINE_CALL_CAP, scoreCase, stopReason, summarizeArm, type CallRecord, type ExtractedFact } from "./extract-metrics";

const LABEL = "DEVELOPMENT CHECK: 12 author-written fictional cases with author-written labels; not measured clinical accuracy";
const OUT_DIR = "eval/reports";
const say = (s: string) => console.warn(s);
const factsOf = (profile: ReturnType<typeof profileFromExtraction>): ExtractedFact[] =>
  Object.values(profile.facts).flatMap((f) => ((f.state === "known" || f.state === "uncertain") && f.value !== undefined ? [{ key: f.key, state: f.state, value: f.value, ...(f.note ? { note: f.note } : {}) }] : []));

function plan(): void {
  say(`== ${LABEL}`);
  say(`model (confirmed from the Token Factory account API): ${CONFIRMED.modelId}`);
  say(`price per token: prompt ${CONFIRMED.promptPerToken}, completion ${CONFIRMED.completionPerToken} ($${(CONFIRMED.promptPerToken * 1e6).toFixed(2)} / $${(CONFIRMED.completionPerToken * 1e6).toFixed(2)} per 1M)`);
  say(`cases: ${DEV_CASES.length} (${["prepared", "plain", "adversarial"].map((k) => `${DEV_CASES.filter((c) => c.kind === k).length} ${k}`).join(", ")})`);
  say(`planned calls: offline ${DEV_CASES.length * 2} (arms A+B) + ${REPEAT_CASE_IDS.length * 2} latency repeats = ${DEV_CASES.length * 2 + REPEAT_CASE_IDS.length * 2} typical, ceiling ${OFFLINE_CALL_CAP}; Preview ${PREVIEW_CASE_IDS.length} requests, ceiling ${CONFIRMED.previewReserve}; total ceiling ${CONFIRMED.totalCallCap} FAST calls`);
  say(`estimated MAXIMUM spend for ${CONFIRMED.totalCallCap} calls (3,000 prompt + ${CONFIRMED.maxOutputTokens} output tokens each): $${estimateMaxSpend(CONFIRMED.totalCallCap).toFixed(4)} (limit $${CONFIRMED.maxSpendUsd.toFixed(2)})`);
  say(`stops: call cap ${OFFLINE_CALL_CAP} (counts retries); first provider/network error or timeout; 3 of the first 6 calls invalid after retry; ${CONFIRMED.tokenBudget} tokens; ${CONFIRMED.wallClockMs / 60000} min; preflight mismatch of model id or price`);
  for (const n of ["NEBIUS_API_KEY", "NEBIUS_BASE_URL", "NEMOTRON_MODEL_FAST", "NODE_USE_ENV_PROXY", "PREVIEW_URL", "PREVIEW_SHARE_URL"]) say(`env ${n}: ${process.env[n] ? "present" : "not set"}`);
}

async function runOffline(): Promise<void> {
  const need = ["NEBIUS_API_KEY", "NEBIUS_BASE_URL", "NEMOTRON_MODEL_FAST"].filter((n) => !process.env[n]);
  if (need.length) throw new Error(`missing env: ${need.join(", ")}. No call was made.`);
  const model = process.env.NEMOTRON_MODEL_FAST!;
  // Preflight (free, no inference): the account's own model list with pricing. Any difference from the confirmed model/price aborts.
  const r = await fetch(`${process.env.NEBIUS_BASE_URL!.replace(/\/$/, "")}/models?verbose=true`, { headers: { authorization: `Bearer ${process.env.NEBIUS_API_KEY}` } });
  if (!r.ok) throw new Error(`preflight failed: model list HTTP ${r.status}. No inference call was made.`);
  const list = ((await r.json()) as { data?: Array<{ id?: unknown; pricing?: { prompt?: unknown; completion?: unknown } }> }).data ?? [];
  const problems = checkModelEntry(list.find((m) => m.id === model), model);
  if (problems.length) throw new Error(`preflight aborted before any paid call: ${problems.join("; ")}`);
  say(`preflight OK: ${model}; prompt/completion price confirmed; estimated maximum $${estimateMaxSpend(CONFIRMED.totalCallCap).toFixed(4)}`);

  const client = makeClient();
  const cap = new CallCap(OFFLINE_CALL_CAP);
  const byId = new Map(DEV_CASES.map((c) => [c.id, c]));
  const order: Array<{ c: DevCase; arm: "A" | "B" }> = [
    ...DEV_CASES.flatMap((c) => [{ c, arm: "A" as const }, { c, arm: "B" as const }]),
    ...REPEAT_CASE_IDS.flatMap((id) => [{ c: byId.get(id)!, arm: "A" as const }, { c: byId.get(id)!, arm: "B" as const }]),
  ];
  const records: CallRecord[] = [];
  const firstInvalid: boolean[] = [];
  let tokens = 0, lastErr: string | null = null, stopped: string | null = null;
  const t0 = Date.now();
  for (const { c, arm } of order) {
    stopped = stopReason({ callsMade: cap.used, tokens, elapsedMs: Date.now() - t0, lastErrorKind: lastErr, firstCallsInvalid: firstInvalid });
    if (stopped) break;
    const { data, stats } = await callJson({
      client, cap, model, mode: "json_schema", schema: ExtractSchema, schemaName: "facts", maxTokens: CONFIRMED.maxOutputTokens, extraBody: { reasoning_effort: "low" },
      ...(arm === "A" ? { system: SPIKE0_SYSTEM, user: c.text } : { system: EXTRACT_SYSTEM, user: buildExtractUserPrompt(c.text), echoOnRetry: false }),
    });
    tokens += stats.promptTokens + stats.completionTokens;
    lastErr = stats.errorKind;
    if (firstInvalid.length < 6) firstInvalid.push(!stats.finalValid);
    records.push({
      caseId: c.id, arm, firstValid: stats.firstValid, finalValid: stats.finalValid, attempts: stats.attempts, latencyMs: stats.latencyMs,
      promptTokens: stats.promptTokens, completionTokens: stats.completionTokens, score: data ? scoreCase(c, factsOf(profileFromExtraction(data))) : null,
    });
    say(`  ${String(records.length).padStart(2)}/${order.length} ${arm} ${c.id}: valid ${stats.firstValid ? "first" : stats.finalValid ? "after retry" : "NO"}, ${stats.latencyMs} ms, ${stats.promptTokens}+${stats.completionTokens} tokens${lastErr && lastErr !== "ZOD_INVALID_AFTER_RETRY" ? `, error ${lastErr}` : ""}`);
  }
  stopped ??= stopReason({ callsMade: cap.used, tokens, elapsedMs: Date.now() - t0, lastErrorKind: lastErr, firstCallsInvalid: firstInvalid });

  const A = summarizeArm(records, "A"), B = summarizeArm(records, "B");
  const spend = actualSpend(A.promptTokens + B.promptTokens, A.completionTokens + B.completionTokens);
  say(`\n== ${LABEL}`);
  say(`calls made: ${cap.used}/${OFFLINE_CALL_CAP} (HTTP level, incl. retries); tokens ${tokens}; actual spend ≈ $${spend.toFixed(5)}; stopped early: ${stopped && records.length < order.length ? stopped : "no"}`);
  for (const [name, s] of [["A spike-0", A], ["B hardened-1", B]] as const) {
    say(`${name}: valid first ${s.firstValid}/${s.calls}, final ${s.finalValid}/${s.calls}, retried ${s.retries}; latency p50 ${s.p50Ms} p95 ${s.p95Ms} max ${s.maxMs} ms; recall ${s.hits}/${s.required} (wrong value ${s.wrongValue}, uncertain ${s.uncertainMiss}, absent ${s.absent}); false-known ${s.falseKnownTotal}; hedged ok ${s.hedgedOk}/${s.hedgedTotal}; injected obeyed ${s.markersObeyed}; prompt leaks ${s.promptLeaks}`);
  }
  for (const c of DEV_CASES) {
    for (const arm of ["A", "B"] as const) {
      const rec = records.find((x) => x.caseId === c.id && x.arm === arm);
      const s = rec?.score;
      if (!s) { say(`  ${c.id} ${arm}: ${rec ? "no usable output" : "not run"}`); continue; }
      const bits = [s.wrongValue.length && `wrong: ${s.wrongValue.join(",")}`, s.uncertainMiss.length && `uncertain: ${s.uncertainMiss.join(",")}`, s.absent.length && `absent: ${s.absent.join(",")}`, (s.falseKnown.length || s.overconfident.length) && `false-known: ${[...s.falseKnown, ...s.overconfident].join(",")}`, s.markersObeyed.length && `OBEYED: ${s.markersObeyed.join(",")}`, s.promptLeak && "PROMPT LEAK"].filter(Boolean);
      say(`  ${c.id} ${arm}: ${s.hits}/${s.required}${bits.length ? ` | ${bits.join(" | ")}` : ""}`);
    }
  }
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(`${OUT_DIR}/hardened-1-dev-check.json`, JSON.stringify({ label: LABEL, model, prices: { prompt: CONFIRMED.promptPerToken, completion: CONFIRMED.completionPerToken }, callsMade: cap.used, tokens, spendUsd: spend, stopped: stopped && records.length < order.length ? stopped : null, summary: { A, B }, records }, null, 2) + "\n");
  say(`wrote ${OUT_DIR}/hardened-1-dev-check.json (counts and key names only)`);
}

async function runPreview(): Promise<void> {
  const base = (process.env.PREVIEW_URL ?? "").replace(/\/$/, "");
  if (!base || !process.env.PREVIEW_SHARE_URL) throw new Error("PREVIEW_URL and PREVIEW_SHARE_URL are required. No request was made.");
  const sh = await fetch(process.env.PREVIEW_SHARE_URL, { redirect: "manual" });
  const cookie = (sh.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  const byId = new Map(DEV_CASES.map((c) => [c.id, c]));
  const out: Array<Record<string, unknown>> = [];
  let stop: string | null = null;
  for (const id of PREVIEW_CASE_IDS) {
    const c = byId.get(id)!;
    const t0 = performance.now();
    const res = await fetch(`${base}/api/extract`, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ text: c.text }) });
    const ms = Math.round(performance.now() - t0);
    if (res.status === 503) {
      const code = ((await res.json().catch(() => ({}))) as { code?: string }).code;
      stop = code === "unavailable" ? "503 unavailable BEFORE any model call: PROFILE_SIGNING_SECRET is not set on this Preview deployment (or the deployment predates it)" : `503 ${code ?? ""}`;
      say(`  ${id}: HTTP 503 ${code ?? ""} after ${ms} ms`);
      break;
    }
    if (res.status !== 200) { stop = `HTTP ${res.status}`; say(`  ${id}: HTTP ${res.status} after ${ms} ms`); await res.text(); break; }
    const body = (await res.json()) as { profile?: { facts?: Record<string, { key: string; state: string; value?: ExtractedFact["value"]; note?: unknown }> }; extract_token?: unknown };
    const facts = Object.values(body.profile?.facts ?? {});
    const ef: ExtractedFact[] = facts.flatMap((f) => ((f.state === "known" || f.state === "uncertain") && f.value !== undefined ? [{ key: f.key, state: f.state as "known" | "uncertain", value: f.value }] : []));
    const s = scoreCase(c, ef);
    const shape = { facts: facts.length, tokenIsString: typeof body.extract_token === "string" && body.extract_token.length > 20, noNotes: facts.every((f) => !("note" in f)) };
    out.push({ caseId: id, status: 200, ms, shape, hits: s.hits, required: s.required, wrongValue: s.wrongValue, falseKnown: [...s.falseKnown, ...s.overconfident] });
    say(`  ${id}: HTTP 200, ${ms} ms, ${shape.facts} facts, token ${shape.tokenIsString ? "present" : "MISSING"}, notes ${shape.noNotes ? "absent" : "PRESENT"}, recall ${s.hits}/${s.required}${s.wrongValue.length ? `, wrong: ${s.wrongValue.join(",")}` : ""}${s.falseKnown.length || s.overconfident.length ? `, false-known: ${[...s.falseKnown, ...s.overconfident].join(",")}` : ""}`);
  }
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(`${OUT_DIR}/hardened-1-preview-check.json`, JSON.stringify({ label: LABEL, requests: out.length, stopped: stop, results: out }, null, 2) + "\n");
  say(`${out.length}/${PREVIEW_CASE_IDS.length} Preview requests succeeded${stop ? `; stopped: ${stop}` : ""}`);
}

// ---- hardened-2 validation (approved: ≤ 32 offline FAST calls, ≤ $0.065, fictional text only) -----------------------------------------
const H2_LABEL = "DEVELOPMENT CHECK (hardened-2): 12 author-written fictional cases with author-written labels; not measured clinical accuracy";

function planH2(): void {
  say(`== ${H2_LABEL}`);
  say(`model to be re-confirmed from the account before any call: ${CONFIRMED.modelId}; prices ${CONFIRMED.promptPerToken} / ${CONFIRMED.completionPerToken} per token`);
  say(`planned: C hardened-2 (max_tokens ${H2.hardened2MaxTokens}) on ${DEV_CASES.length} cases + ${TRUNCATION_CASE_ID} x2; B hardened-1 (max_tokens ${H2.hardened1MaxTokens}) ${TRUNCATION_CASE_ID} x2 = ${H2.plannedCalls} typical; HTTP-call ceiling ${H2.callCap}`);
  say(`worst-case spend if every call retries at full cap: $${estimateH2Max().toFixed(4)} (limit $${H2.maxSpendUsd}); the run also stops before a call that could pass the limit`);
  say(`stops: provider/network error or timeout; 3 of the first 6 invalid; ${CONFIRMED.tokenBudget} tokens; ${CONFIRMED.wallClockMs / 60000} min; spend guard; preflight mismatch`);
  for (const n of ["NEBIUS_API_KEY", "NEBIUS_BASE_URL", "NEMOTRON_MODEL_FAST", "NODE_USE_ENV_PROXY"]) say(`env ${n}: ${process.env[n] ? "present" : "not set"}`);
}

async function runH2(): Promise<void> {
  const need = ["NEBIUS_API_KEY", "NEBIUS_BASE_URL", "NEMOTRON_MODEL_FAST"].filter((n) => !process.env[n]);
  if (need.length) throw new Error(`missing env: ${need.join(", ")}. No call was made.`);
  const model = process.env.NEMOTRON_MODEL_FAST!;
  const r = await fetch(`${process.env.NEBIUS_BASE_URL!.replace(/\/$/, "")}/models?verbose=true`, { headers: { authorization: `Bearer ${process.env.NEBIUS_API_KEY}` } });
  if (!r.ok) throw new Error(`preflight failed: model list HTTP ${r.status}. No inference call was made.`);
  const list = ((await r.json()) as { data?: Array<{ id?: unknown; pricing?: { prompt?: unknown; completion?: unknown } }> }).data ?? [];
  const entry = list.find((m) => m.id === model);
  const problems = checkModelEntry(entry, model, { worst: estimateH2Max, limit: H2.maxSpendUsd });
  if (problems.length) throw new Error(`preflight aborted before any paid call: ${problems.join("; ")}`);
  say(`preflight OK: ${model}; account prices ${String(entry?.pricing?.prompt)} / ${String(entry?.pricing?.completion)} per token; worst case $${estimateH2Max().toFixed(4)} (limit $${H2.maxSpendUsd})`);

  const client = makeClient();
  const cap = new CallCap(H2.callCap);
  const trunc = DEV_CASES.find((c) => c.id === TRUNCATION_CASE_ID)!;
  const h1System = hardened1System(EXTRACT_SYSTEM);
  if (h1System === EXTRACT_SYSTEM) throw new Error("hardened-1 text could not be derived from the current prompt. No call was made.");
  const order: Array<{ c: DevCase; arm: "B" | "C" }> = [
    ...DEV_CASES.map((c) => ({ c, arm: "C" as const })),
    { c: trunc, arm: "C" }, { c: trunc, arm: "B" }, { c: trunc, arm: "C" }, { c: trunc, arm: "B" },
  ];
  const records: CallRecord[] = [];
  const firstInvalid: boolean[] = [];
  let tokens = 0, promptT = 0, completionT = 0, lastErr: string | null = null, stopped: string | null = null;
  const t0 = Date.now();
  for (const { c, arm } of order) {
    const maxTokens = arm === "C" ? H2.hardened2MaxTokens : H2.hardened1MaxTokens;
    stopped = stopReason({ callsMade: cap.used, tokens, elapsedMs: Date.now() - t0, lastErrorKind: lastErr, firstCallsInvalid: firstInvalid }, H2.callCap)
      ?? (wouldExceedSpend(actualSpend(promptT, completionT), maxTokens) ? "spend guard: the next call could pass the $0.065 limit" : null);
    if (stopped) break;
    const { data, stats } = await callJson({
      client, cap, model, mode: "json_schema", schema: ExtractSchema, schemaName: "facts", maxTokens, extraBody: { reasoning_effort: "low" },
      system: arm === "C" ? EXTRACT_SYSTEM : h1System, user: buildExtractUserPrompt(c.text), echoOnRetry: false,
    });
    tokens += stats.promptTokens + stats.completionTokens; promptT += stats.promptTokens; completionT += stats.completionTokens;
    lastErr = stats.errorKind;
    if (firstInvalid.length < 6) firstInvalid.push(!stats.finalValid);
    records.push({
      caseId: c.id, arm, firstValid: stats.firstValid, finalValid: stats.finalValid, attempts: stats.attempts, latencyMs: stats.latencyMs,
      promptTokens: stats.promptTokens, completionTokens: stats.completionTokens, score: data ? scoreCase(c, factsOf(profileFromExtraction(data))) : null,
    });
    say(`  ${String(records.length).padStart(2)}/${order.length} ${arm} ${c.id}: valid ${stats.firstValid ? "first" : stats.finalValid ? "after retry" : "NO"}, ${stats.latencyMs} ms, ${stats.promptTokens}+${stats.completionTokens} tokens, truncated ${stats.truncated ? "YES" : "no"}${lastErr && lastErr !== "ZOD_INVALID_AFTER_RETRY" ? `, error ${lastErr}` : ""}`);
  }
  const done = records.length === order.length;
  const C = summarizeArm(records, "C"), Bsum = summarizeArm(records, "B");
  const spend = actualSpend(promptT, completionT);
  say(`\n== ${H2_LABEL}`);
  say(`calls made: ${cap.used}/${H2.callCap} (HTTP level, incl. retries); tokens ${tokens}; actual spend ≈ $${spend.toFixed(5)} (limit $${H2.maxSpendUsd}); stopped early: ${!done ? stopped : "no"}`);
  say(`C hardened-2 (12 cases, first call per case): usable ${records.filter((x) => x.arm === "C" && x.score).length}; recall ${C.hits}/${C.required} (wrong value ${C.wrongValue}, uncertain ${C.uncertainMiss}, absent ${C.absent}); false-known ${C.falseKnownTotal}; hedged ok ${C.hedgedOk}/${C.hedgedTotal}; injected obeyed ${C.markersObeyed}; prompt leaks ${C.promptLeaks}`);
  say(`C all calls: valid first ${C.firstValid}/${C.calls}, final ${C.finalValid}/${C.calls}; latency p50 ${C.p50Ms} p95 ${C.p95Ms} max ${C.maxMs} ms`);
  say(`B hardened-1 repeats of ${TRUNCATION_CASE_ID}: valid final ${Bsum.finalValid}/${Bsum.calls}`);
  for (const rec of records) {
    const s = rec.score;
    const bits = s ? [s.wrongValue.length && `wrong: ${s.wrongValue.join(",")}`, s.uncertainMiss.length && `uncertain: ${s.uncertainMiss.join(",")}`, s.absent.length && `absent: ${s.absent.join(",")}`, (s.falseKnown.length || s.overconfident.length) && `false-known: ${[...s.falseKnown, ...s.overconfident].join(",")}`, s.markersObeyed.length && `OBEYED: ${s.markersObeyed.join(",")}`, s.promptLeak && "PROMPT LEAK"].filter(Boolean) : [];
    say(`  ${rec.arm} ${rec.caseId}: ${s ? `${s.hits}/${s.required} hedged ok ${s.hedgedOk}/${s.hedgedTotal}${bits.length ? ` | ${bits.join(" | ")}` : ""}` : "no usable output"}`);
  }
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(`${OUT_DIR}/hardened-2-dev-check.json`, JSON.stringify({ label: H2_LABEL, model, prices: { prompt: CONFIRMED.promptPerToken, completion: CONFIRMED.completionPerToken }, callsMade: cap.used, tokens, spendUsd: spend, stopped: !done ? stopped : null, summary: { C, B: Bsum }, records }, null, 2) + "\n");
  say(`wrote ${OUT_DIR}/hardened-2-dev-check.json (counts and key names only)`);
}

const mode = process.argv[2];
(mode === "--dry-run" ? Promise.resolve(plan()) : mode === "--dry-run-h2" ? Promise.resolve(planH2()) : mode === "--run-h2" ? runH2() : mode === "--run" ? runOffline() : mode === "--preview" ? runPreview() : Promise.reject(new Error("usage: --dry-run | --run | --preview"))).then(
  () => process.exit(0),
  (e: unknown) => {
    console.error(`extract-measure stopped: ${(e as Error)?.message?.slice(0, 240) ?? "unknown"}`);
    process.exit(1);
  },
);
