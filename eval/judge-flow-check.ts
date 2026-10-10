// Judge-entered flow check against a deployed (protected) Preview, FICTIONAL text only. Prints counts, timings and fixed codes only:
// never the text, the extraction token, facts' values beyond the edited fact keys, cookies or the share link.
//   Free (default): GET /api/input-mode, plus refusals that happen BEFORE any model call (forged and missing tokens; typed text in samples mode).
//   Paid (one extraction call + one full run, no retry):
//     PREVIEW_URL=https://<preview> RUN_JUDGE=1 CONFIRM_JUDGE_FLOW=one-extract-one-run pnpm exec tsx eval/judge-flow-check.ts
// Requires the server to report visitor_input=open and extract_ready=true; otherwise it refuses before any request that could spend.
import { cookieFromShare } from "./lib/preview-session";
import { add, parseExtractResponse, remove, setSure, setValue, toRunProfile, validate, type Drafts } from "../src/lib/visitor/facts";
import { SseEventSchema, type SseEvent } from "../src/schema/sse";
import { FACT_KEYS, type FactKey } from "../src/schema/vocabulary";

const BASE = (process.env.PREVIEW_URL ?? "").replace(/\/$/, "");
if (!BASE) { console.error("PREVIEW_URL is required"); process.exit(2); }
const results: Array<[boolean, string]> = [];
const check = (ok: boolean, name: string) => { results.push([ok, name]); console.warn(`${ok ? "PASS" : "FAIL"} ${name}`); };

// Fictional, made up for this check. Not a real person.
const TEXT = "I'm 58, a made-up person with stage II breast cancer that is hormone receptor positive and HER2 negative. I finished radiation last month and just started an aromatase inhibitor. My heart ultrasound showed an LVEF of 60%.";

async function main() {
  const cookie = await cookieFromShare(BASE);
  const h = { "content-type": "application/json", ...(cookie ? { cookie } : {}) };
  const modeRes = await fetch(`${BASE}/api/input-mode`, { headers: cookie ? { cookie } : {} });
  const mode = (await modeRes.json()) as { visitor_input?: string; extract_ready?: boolean; max_input_chars?: number };
  console.warn(`input-mode: visitor_input=${mode.visitor_input} extract_ready=${mode.extract_ready} max_input_chars=${mode.max_input_chars}`);
  check(modeRes.status === 200 && modeRes.headers.get("cache-control") === "no-store", "input-mode 200, no-store");

  // Free refusals (no model call can happen on these paths).
  const runBody = (b: unknown) => fetch(`${BASE}/api/run`, { method: "POST", headers: h, body: JSON.stringify(b) });
  const dummy = toRunProfile(parseExtractResponse({ profile: { facts: {} }, extract_token: "x" })!.drafts);
  const forged = await runBody({ profile: dummy, extract_token: "forged.token" });
  check(forged.status === 401, `forged token refused (401, got ${forged.status})`);
  const missing = await runBody({ profile: dummy });
  check(missing.status === 401, `missing token refused (401, got ${missing.status})`);
  if (mode.visitor_input === "samples") {
    const typed = await fetch(`${BASE}/api/extract`, { method: "POST", headers: h, body: JSON.stringify({ text: TEXT }) });
    check(typed.status === 403, `typed text refused in samples mode (403, got ${typed.status})`);
  }

  if (process.env.RUN_JUDGE !== "1") return;
  if (process.env.CONFIRM_JUDGE_FLOW !== "one-extract-one-run") { console.error("paid run refused: CONFIRM_JUDGE_FLOW=one-extract-one-run is required"); process.exit(2); }
  if (mode.visitor_input !== "open" || mode.extract_ready !== true) { console.error("paid run refused: server is not open + extract_ready"); process.exit(2); }

  // ONE extraction call.
  const t0 = performance.now();
  const ex = await fetch(`${BASE}/api/extract`, { method: "POST", headers: h, body: JSON.stringify({ text: TEXT }) });
  const exMs = performance.now() - t0;
  check(ex.status === 200, `extract 200 (got ${ex.status}) in ${(exMs / 1000).toFixed(1)}s`);
  if (ex.status !== 200) { console.error("extract failed; stopping (no retry):", ex.status, await ex.text().then((t) => t.slice(0, 80))); process.exit(1); }
  const parsed = parseExtractResponse(await ex.json());
  check(!!parsed, "extract body parses (every fact + token)");
  if (!parsed) process.exit(1);
  const known = FACT_KEYS.filter((k) => parsed.drafts[k].state === "known");
  const unknown = FACT_KEYS.filter((k) => parsed.drafts[k].state === "unknown");
  console.warn(`extracted: ${known.length} known, ${unknown.length} unknown; keys: ${known.join(",")}`);

  // Edits: correction, Not sure, removal, addition.
  const pick = (c: FactKey[], not: FactKey[]) => c.find((k) => !not.includes(k));
  const corrected: FactKey | undefined = known.includes("age") ? "age" : known.find((k) => typeof parsed.drafts[k].value === "number");
  const unsure = pick(known.filter((k) => k !== corrected), []);
  const removed = pick(known.filter((k) => k !== corrected && k !== unsure), []);
  const added: FactKey | undefined = unknown.includes("ecog") ? "ecog" : unknown[0];
  check(!!corrected && !!unsure && !!removed && !!added, `edit targets found (${[corrected, unsure, removed, added].join(",")})`);
  if (!corrected || !unsure || !removed || !added) process.exit(1);
  let d: Drafts = parsed.drafts;
  const newAge = Number(d[corrected].value) + 1;
  d = setValue(d, corrected, String(newAge));
  d = setSure(d, unsure, false);
  d = remove(d, removed);
  d = setValue(add(d, added), added, added === "ecog" ? "1" : String(Object.keys(d).length));
  check(Object.keys(validate(d, { needValue: "n", badNumber: "b", outOfRange: "r" })).length === 0, "edited profile validates");

  // ONE run, no retry.
  const r0 = performance.now();
  const run = await fetch(`${BASE}/api/run`, { method: "POST", headers: h, body: JSON.stringify({ profile: toRunProfile(d), extract_token: parsed.token }) });
  check(run.status === 200 && (run.headers.get("content-type") ?? "").includes("text/event-stream"), `run 200 event-stream (got ${run.status})`);
  if (run.status !== 200) { console.error("run failed; stopping (no retry):", run.status, await run.text().then((t) => t.slice(0, 80))); process.exit(1); }
  const events: SseEvent[] = [];
  const reader = run.body!.getReader(), dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split("\n\n"); buf = parts.pop() ?? "";
    for (const p of parts) { const line = p.split("\n").find((l) => l.startsWith("data: ")); if (line) { const v = SseEventSchema.safeParse(JSON.parse(line.slice(6))); if (v.success) events.push(v.data); } }
  }
  const runMs = performance.now() - r0;
  const hist = Object.fromEntries([...new Set(events.map((e) => e.type))].map((t) => [t, events.filter((e) => e.type === t).length]));
  console.warn(`run: ${(runMs / 1000).toFixed(1)}s events=${JSON.stringify(hist)}`);
  const modeEv = events.find((e) => e.type === "mode") as Extract<SseEvent, { type: "mode" }> | undefined;
  check(modeEv?.mode === "live", `live (not replay): mode=${modeEv?.mode}`);
  const prof = events.find((e) => e.type === "profile") as Extract<SseEvent, { type: "profile" }> | undefined;
  const by = Object.fromEntries((prof?.facts ?? []).map((f) => [f.key, f]));
  check(by[corrected]?.value === newAge && by[corrected]?.state === "known", `correction reached the run (${corrected})`);
  check(by[unsure]?.state === "uncertain", `Not sure reached the run (${unsure})`);
  check(!by[removed], `removal reached the run (${removed})`);
  check(by[added]?.state === "known", `addition reached the run (${added})`);
  const trials = events.filter((e) => e.type === "trial_result") as Array<Extract<SseEvent, { type: "trial_result" }>>;
  const tiers = trials.reduce<Record<string, number>>((a, t) => ({ ...a, [t.assessment.tier]: (a[t.assessment.tier] ?? 0) + 1 }), {});
  console.warn(`trials=${trials.length} tiers=${JSON.stringify(tiers)}`);
  check(trials.length > 0 && !("STRONG" in tiers) && !("LIKELY_MISMATCH" in tiers), "results present; R2 ceiling holds (no STRONG, no LIKELY_MISMATCH)");
  check(events.some((e) => e.type === "study_questions"), "study-team panel event arrived");
  check(events.at(-1)?.type === "done", "stream ends with done");
  const counts = events.filter((e) => e.type === "counts");
  console.warn(`counts events: ${JSON.stringify(counts.at(-1))}`);
}
main().catch((e) => { console.error("error:", (e as Error).message); process.exit(1); }).finally(() => {
  const fails = results.filter(([ok]) => !ok).length;
  console.warn(`${results.length - fails}/${results.length} checks passed`);
  if (fails) process.exitCode = 1;
});
