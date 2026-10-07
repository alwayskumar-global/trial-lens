// Pure live-run assertions over a parsed SSE stream (no network). Prints counts, codes and verdicts only: never criterion text, facts, links or cookies.
import type { SseEvent } from "../../src/schema/sse";

export interface Timed { e: SseEvent; t: number }
const types = (ev: Timed[]) => Object.fromEntries([...new Set(ev.map((x) => x.e.type))].map((k) => [k, ev.filter((x) => x.e.type === k).length]));
const sec = (ms: number) => (ms / 1000).toFixed(1) + "s";
// ---- live-run assertions (counts, codes and verdicts only; never prints criterion text, facts, links or cookies) ----
const PRICE = { FAST: { in: 0.00000006, out: 0.00000024 }, MID: { in: 0.0000003, out: 0.0000009 } } as const; // Token Factory, docs/cost-per-run.md
const tally = (xs: string[]) => xs.reduce<Record<string, number>>((a, k) => ((a[k] = (a[k] ?? 0) + 1), a), {});

export function liveAssertions(lv: { status: number; ttfb: number; total: number; events: Timed[]; chunks: number; ct: string }, check: (ok: boolean, name: string) => void, log: (m: string) => void = (m) => log(m)) {
  const ev = lv.events.map((x) => x.e);
  const first = ev[0];
  const done = ev.find((e) => e.type === "done");
  const trials = ev.flatMap((e) => (e.type === "trial_result" ? [e.assessment] : []));
  const findings = trials.flatMap((a) => a.findings.map((f) => ({ nct: a.nct_id, f })));
  const counts = ev.filter((e) => e.type === "counts").at(-1);
  const sq = ev.filter((e) => e.type === "study_questions");
  log(`live: status ${lv.status}, ttfb ${sec(lv.ttfb)}, total ${sec(lv.total)}, chunks ${lv.chunks}, events ${JSON.stringify(types(lv.events))}`);

  // 1. stream shape and completion
  check(lv.status === 200 && lv.ct.includes("text/event-stream"), "live: text/event-stream 200");
  check(first?.type === "mode" && first.mode === "live" && first.reason === undefined, "live: starts with mode:live");
  check(!ev.some((e) => e.type === "mode" && e.mode === "replay") && !ev.some((e) => e.type === "error"), "live: no replay fallback and no error event");
  check(!!done && done.type === "done" && done.replay === false, "live: ends with done(replay:false)");
  check(trials.length > 0, `live: ${trials.length} trial_result events`);
  check(!ev.some((e) => e.type === "question"), "live: no legacy question event");

  // 2. live findings
  log(`  tiers ${JSON.stringify(tally(trials.map((a) => a.tier)))}`);
  log(`  finding source ${JSON.stringify(tally(findings.map((x) => x.f.source)))}; status ${JSON.stringify(tally(findings.map((x) => x.f.status)))}; guard_downgraded ${findings.filter((x) => x.f.guard_downgraded).length}`);
  log(`  verified ${JSON.stringify(tally(trials.map((a) => String(a.verified))))}; verifier_flags ${JSON.stringify(tally(trials.flatMap((a) => a.verifier_flags)))}`);
  check(trials.every((a) => a.tier !== "STRONG" && a.tier !== "LIKELY_MISMATCH"), "live: no STRONG/LIKELY_MISMATCH tier (Policy R2)");
  check(trials.every((a) => a.fact_basis === "visitor_reported"), "live: fact_basis visitor_reported on every result");
  check(trials.every((a) => !a.verifier_flags.includes("reported_conflict") || !a.verified), "live: reported_conflict never verified");
  const noEvidence = findings.filter((x) => (x.f.status === "PASS" || x.f.status === "FAIL") && x.f.evidence.length === 0);
  check(noEvidence.length === 0, `live: every PASS/FAIL finding has evidence (${noEvidence.length} without)`);
  const modelDecided = findings.filter((x) => (x.f.status === "PASS" || x.f.status === "FAIL") && x.f.source !== "code");
  log(`  REVIEW (informational, not a pass/fail): model-source PASS/FAIL surviving the fail-closed guard = ${modelDecided.length} (${JSON.stringify(tally(modelDecided.map((x) => x.f.status)))})`);
  const unreasoned = findings.filter((x) => x.f.source !== "code" && x.f.status !== "UNKNOWN" && x.f.status !== "AMBIGUOUS" && !x.f.guard_downgraded && x.f.evidence.length === 0);
  check(unreasoned.length === 0, `live: no unevidenced model decision (${unreasoned.length})`);

  // 3. Rule D: a FAIL needs an independent check; only a verified code FAIL could ever lower a tier, and R2 caps it to UNCERTAIN anyway
  const fails = findings.filter((x) => x.f.status === "FAIL");
  log(`  Rule D: FAIL findings ${fails.length}; fail_check ${JSON.stringify(tally(fails.map((x) => x.f.fail_check ?? "absent")))}; FAIL by source ${JSON.stringify(tally(fails.map((x) => x.f.source)))}`);
  check(findings.every((x) => x.f.status === "FAIL" || x.f.fail_check === undefined || x.f.fail_check === "not_run"), "live: fail_check is meaningful only on FAIL findings");
  check(!trials.some((a) => a.tier === "LIKELY_MISMATCH"), "live: Rule D never produced a LIKELY_MISMATCH tier");

  // 4. study-team panel
  check(sq.length <= 1, `live: at most one study_questions event (${sq.length})`);
  const panel = sq[0];
  if (panel && panel.type === "study_questions") {
    const byNct = new Map(trials.map((a) => [a.nct_id, a]));
    const items = panel.questions;
    log(`  panel: version ${panel.version}, items ${items.length}, studies per item ${JSON.stringify(items.map((q) => q.study_count))}`);
    check(items.length <= 3, "panel: at most 3 items");
    check(items.every((q) => q.study_count === q.studies.length), "panel: study_count matches the listed studies");
    check(items.every((q) => q.studies.every((st) => byNct.has(st.nct_id))), "panel: every study was streamed as a trial_result");
    const wrongText = items.flatMap((q) => q.studies.flatMap((st) => st.criteria.filter((c) => !(byNct.get(st.nct_id)?.criteria ?? []).some((v) => v.id === c.criterion_id && v.text === c.text))));
    check(wrongText.length === 0, `panel: criterion wording is verbatim from the streamed criteria (${wrongText.length} mismatched)`);
    const notOpen = items.flatMap((q) => q.studies.flatMap((st) => st.criteria.filter((c) => { const f = byNct.get(st.nct_id)?.findings.find((x) => x.criterion_id === c.criterion_id); return !f || (f.status !== "UNKNOWN" && f.status !== "AMBIGUOUS"); })));
    check(notOpen.length === 0, `panel: every listed criterion is an open (UNKNOWN/AMBIGUOUS) finding (${notOpen.length} not)`);
    check(items.every((q) => !("score" in q) && !("tier" in q) && !("lift" in q)), "panel: no score/tier/lift fields");
    if (items.length === 0) log("  panel: computation ran and found no supported item (empty questions array)");
  } else log("  panel: NO study_questions event (computation did not run or failed; client shows nothing)");

  // 5. timings
  const firstTrial = lv.events.find((x) => x.e.type === "trial_result");
  const stages = lv.events.filter((x) => x.e.type === "stage");
  log(`  timings: ttfb ${sec(lv.ttfb)}, first trial_result ${firstTrial ? sec(firstTrial.t) : "n/a"}, stages ${stages.length} spanning ${stages.length > 1 ? sec(stages.at(-1)!.t - stages[0]!.t) : "n/a"}, total ${sec(lv.total)}, server wall ${done && done.type === "done" && done.stats ? sec(done.stats.wall_ms) : "n/a"}`);
  check(lv.chunks > 3, `live: delivery is progressive (${lv.chunks} network chunks)`);
  check(stages.length >= 10 && (stages.at(-1)?.t ?? 0) - (stages[0]?.t ?? 0) > 5000, "live: stage events spread over time (not buffered to the end)");
  check(lv.total < 300_000, `live: completed within the 300 s function limit (${sec(lv.total)})`);
  log(`  >60 s? ${lv.total > 60_000 ? "YES: beyond the default 60 s limit, so the longer maxDuration is active" : "no (completed under 60 s: this run does not prove the 300 s setting)"}`);

  // 6. counts: cold-cache pending trials are reported on their own
  if (counts && counts.type === "counts") log(`  counts (final): ${JSON.stringify({ ...counts, type: undefined })}`);
  const pendingFlag = trials.filter((a) => a.verifier_flags.includes("analysis_pending")).length;
  const failedFlag = trials.filter((a) => a.analysis_failed).length;
  log(`  COLD-CACHE / capacity (report separately, not failures): analysis_pending trials ${pendingFlag}; analysis_failed ${failedFlag}; counts.pending ${counts && counts.type === "counts" ? (counts.pending ?? 0) : "n/a"}`);

  // 7. calls, cap and token usage
  if (done && done.type === "done" && done.stats) {
    const st = done.stats, u = st.usage;
    log(`  calls: llm_calls ${st.llm_calls}, worst_case_calls ${st.worst_case_calls} (effective cap must be 80)`);
    check(st.llm_calls <= 80 && st.worst_case_calls <= 80, "live: llm_calls and worst_case_calls within the 80-call cap");
    check(!!u && u.version === "u-1", "live: usage block present (u-1)");
    if (u) {
      for (const r of u.stages) log(`  usage ${r.stage}/${r.tier}: calls ${r.calls}, with_usage ${r.calls_with_usage}, without ${r.calls_without_usage}, tokens in ${r.prompt_tokens ?? "unavailable"} out ${r.completion_tokens ?? "unavailable"}`);
      log(`  usage total: calls ${u.total.calls}, without_usage ${u.total.calls_without_usage}, tokens in ${u.total.prompt_tokens ?? "unavailable"} out ${u.total.completion_tokens ?? "unavailable"}${u.total.calls_without_usage > 0 ? " (LOWER BOUND)" : ""}`);
      check(u.total.calls === st.llm_calls, "live: usage.total.calls equals llm_calls");
      check(u.stages.every((r) => r.calls_with_usage + r.calls_without_usage === r.calls), "live: per-stage usage calls add up");
      check(u.stages.every((r) => (r.calls_with_usage === 0 ? r.prompt_tokens === null && r.completion_tokens === null : r.prompt_tokens !== null && r.completion_tokens !== null)), "live: tokens are null exactly when no call reported usage (never a fabricated 0)");
      const cost = u.stages.reduce((a, r) => a + (r.prompt_tokens ?? 0) * PRICE[r.tier].in + (r.completion_tokens ?? 0) * PRICE[r.tier].out, 0);
      log(`  estimated cost from reported tokens: $${cost.toFixed(3)}${u.total.calls_without_usage > 0 ? " (lower bound: some calls reported no usage)" : ""}`);
    }
  } else check(false, "live: done.stats present");
}
