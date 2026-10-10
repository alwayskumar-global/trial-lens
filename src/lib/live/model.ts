// Pure state + view models for the live / replay / pending UI. No React, no network.
// Rules: a count exists only after its event was received; a live stream that falls back to replay CLEARS all partial
// live state; pending/failed trials stay UNCERTAIN with their own status; criterion text is verbatim.
import type { CriterionStatus } from "@/components/status/StatusGlyph";
import type { Tier } from "@/components/status/TierBadge";
import type { CriterionView, StudyQuestionItem, TrialResult } from "@/schema/assessment";
import type { SseEvent } from "@/schema/sse";
import type { ReplayReason } from "@/lib/live/copy";

export interface StageRow {
  stage: string;
  status: "start" | "done";
}
export interface Counts {
  discovered?: number;
  filtered?: number;
  selected?: number;
  assessed?: number;
  pending?: number;
  failed?: number;
}
export interface ProfileFact {
  key: string;
  /** known = used by the prefilter; uncertain facts are shown but never filter. */
  state?: "known" | "uncertain";
  value?: string | number | boolean;
}

/** Which discovery filters were actually applied. The server filters on age and sex only when each is a KNOWN fact (run.ts); uncertain or missing never filters. */
export interface AppliedFilters { age: boolean; sex: boolean }
export const appliedFilters = (profile: readonly ProfileFact[] | null): AppliedFilters | null =>
  profile ? { age: profile.some((f) => f.key === "age" && f.state === "known"), sex: profile.some((f) => f.key === "sex" && f.state === "known") } : null;
export interface RunState {
  status: "idle" | "connecting" | "streaming" | "done" | "error";
  mode: "live" | "replay" | null;
  reason?: ReplayReason;
  replayLabel?: string;
  stages: StageRow[]; // live only
  profile: ProfileFact[] | null;
  counts: Counts;
  trials: TrialResult[];
  /** Study-team question panel. null = the computation did not run or did not report (nothing is shown, nothing is claimed); [] = it ran and found no supported item. */
  studyQuestions: StudyQuestionItem[] | null;
  errorCode: string | null;
}
export const initialRun: RunState = { status: "idle", mode: null, stages: [], profile: null, counts: {}, trials: [], studyQuestions: null, errorCode: null };

export type RunAction = SseEvent | { type: "start" } | { type: "http_error"; code: string } | { type: "closed" };

export function reduceRun(s: RunState, a: RunAction): RunState {
  switch (a.type) {
    case "start":
      return { ...initialRun, status: "connecting" };
    case "http_error":
      return { ...initialRun, status: "error", errorCode: a.code };
    case "closed":
      return s.status === "done" || s.status === "error" ? s : { ...s, status: "error", errorCode: s.errorCode ?? "stream_closed" };
    case "mode":
      // Entering replay (also after partial live events) discards everything received so far.
      return { ...initialRun, status: "streaming", mode: a.mode, ...(a.reason ? { reason: a.reason } : {}), ...(a.label ? { replayLabel: a.label } : {}) };
    case "stage": {
      if (s.mode !== "live") return s; // replay never shows live-style progress
      const i = s.stages.findIndex((r) => r.stage === a.stage);
      const stages = i < 0 ? [...s.stages, { stage: a.stage, status: a.status }] : s.stages.map((r, j) => (j === i ? { ...r, status: a.status } : r));
      return { ...s, stages };
    }
    case "profile":
      return { ...s, profile: a.facts.map((f) => ({ key: f.key, state: f.state, ...(f.value !== undefined ? { value: f.value } : {}) })) };
    case "counts": {
      const { type: _t, analyzed: _legacy, ...c } = a; // `analyzed` is deprecated and ambiguous: never shown
      void _t; void _legacy;
      return { ...s, counts: { ...s.counts, ...c } };
    }
    case "trial_result":
      return { ...s, trials: [...s.trials.filter((t) => t.nct_id !== a.assessment.nct_id), a.assessment] };
    case "question":
      return s; // legacy answer-oriented event (older stored replays): ignored, the answer step is removed for the demo
    case "study_questions":
      return { ...s, studyQuestions: a.questions };
    case "done":
      return { ...s, status: "done" };
    case "error":
      // With fallback a `mode: replay` event follows and resets state; without it the run ends here.
      return a.fallback_to_replay ? { ...s, errorCode: a.code } : { ...s, status: "error", errorCode: a.code };
  }
}

// ---- trial classification --------------------------------------------------------------------------
export type TrialKind = "assessed" | "pending" | "failed";
export const trialKind = (t: TrialResult): TrialKind => (t.verifier_flags.includes("analysis_pending") ? "pending" : t.analysis_failed ? "failed" : "assessed");

export function uiTier(t: TrialResult): Tier {
  return ({ STRONG: "strong", POSSIBLE: "possible", UNCERTAIN: "uncertain", LIKELY_MISMATCH: "mismatch" } as const)[t.tier];
}

/** assessed + pending + failed. Uses the received counts event when complete, else derives from the received trials. */
export function coverage(s: Pick<RunState, "counts" | "trials">): { assessed: number; pending: number; failed: number } {
  const { assessed, pending, failed } = s.counts;
  if (assessed !== undefined && pending !== undefined && failed !== undefined) return { assessed, pending, failed };
  const k = { assessed: 0, pending: 0, failed: 0 };
  for (const t of s.trials) k[trialKind(t)]++;
  return k;
}

export const tierCounts = (trials: readonly TrialResult[]): Record<Tier, number> => {
  const c: Record<Tier, number> = { strong: 0, possible: 0, uncertain: 0, mismatch: 0 };
  for (const t of trials) c[uiTier(t)]++;
  return c;
};

export const statusOf = (s: string): CriterionStatus => (s === "PASS" ? "meets" : s === "FAIL" ? "conflict" : s === "AMBIGUOUS" ? "judgment" : "unknown");

// ---- excerpt rule ----------------------------------------------------------------------------------
export const clean = (s: string): string => s.replace(/\s+/g, " ").trim();
/** A criterion may be quoted on a card only if the WHOLE criterion is one short item: never cut off or merged. */
export const usableExcerpt = (s: string | undefined): s is string => !!s && clean(s).length <= 120 && !/;|\b\d\.\s*[A-Z]/.test(clean(s));
/** Row titles in Detail may be shortened, but the cut is always marked and the full wording is in the row. */
export function rowTitle(text: string, max = 80): { text: string; cut: boolean } {
  const t = clean(text);
  return t.length > max ? { text: t.slice(0, max - 1).trimEnd() + "…", cut: true } : { text: t, cut: false };
}

const criterionOf = (t: TrialResult, id: string): CriterionView | undefined => t.criteria?.find((c) => c.id === id);

// ---- card model ------------------------------------------------------------------------------------
export interface CardModel {
  nct: string;
  title: string;
  url: string | null;
  tier: Tier;
  kind: TrialKind;
  excerpts: Array<{ status: CriterionStatus; text: string }>;
  met: number;
  unknown: number;
  biggestUnknown: { kind: "excerpt"; text: string } | { kind: "long" } | null;
}

export function cardModel(t: TrialResult): CardModel {
  const kind = trialKind(t);
  const base = { nct: t.nct_id, title: t.title, url: t.url ?? null, tier: uiTier(t), kind };
  if (kind !== "assessed") return { ...base, excerpts: [], met: 0, unknown: 0, biggestUnknown: null };
  const fails = t.findings.filter((f) => f.status === "FAIL");
  const passes = t.findings.filter((f) => f.status === "PASS");
  const candidates = [...fails.slice(0, 1).map((f) => ({ f, status: "conflict" as const })), ...passes.slice(0, 3).map((f) => ({ f, status: "meets" as const }))];
  const excerpts = candidates.flatMap(({ f, status }) => {
    const text = criterionOf(t, f.criterion_id)?.text;
    return usableExcerpt(text) ? [{ status, text: clean(text) }] : [];
  }).slice(0, 2);
  const open = t.findings.find((f) => f.status === "UNKNOWN" || f.status === "AMBIGUOUS");
  const openText = open ? criterionOf(t, open.criterion_id)?.text : undefined;
  return {
    ...base,
    excerpts,
    met: passes.length,
    unknown: t.findings.filter((f) => f.status === "UNKNOWN").length,
    biggestUnknown: !open ? null : usableExcerpt(openText) ? { kind: "excerpt", text: clean(openText) } : { kind: "long" },
  };
}

// ---- detail model ----------------------------------------------------------------------------------
export interface RowModel {
  id: string;
  status: CriterionStatus | "not_analyzed";
  text: string;
  evidence: Array<{ key: string; value?: string | number | boolean }>;
  note: string | null; // model rationale, shown as "Automated note"
}
export interface DetailModel {
  kind: TrialKind;
  attention: RowModel[];
  unknown: RowModel[];
  ok: RowModel[];
  notAnalyzed: RowModel[];
}

export function detailModel(t: TrialResult, facts: readonly ProfileFact[] | null): DetailModel {
  const kind = trialKind(t);
  if (kind !== "assessed") {
    return { kind, attention: [], unknown: [], ok: [], notAnalyzed: (t.criteria ?? []).map((c) => ({ id: c.id, status: "not_analyzed", text: c.text, evidence: [], note: null })) };
  }
  const order: Record<CriterionStatus, number> = { conflict: 0, judgment: 1, unknown: 2, meets: 3 };
  const rows = t.findings.map((f): RowModel => ({
    id: f.criterion_id,
    status: statusOf(f.status),
    text: criterionOf(t, f.criterion_id)?.text ?? "",
    evidence: f.evidence.map((k) => {
      const v = facts?.find((p) => p.key === k)?.value;
      return { key: k, ...(v !== undefined ? { value: v } : {}) };
    }),
    note: f.source === "llm_mid" && f.rationale ? f.rationale : null,
  }));
  const st = (r: RowModel) => r.status as CriterionStatus;
  return {
    kind,
    attention: rows.filter((r) => st(r) === "conflict" || st(r) === "judgment").sort((a, b) => order[st(a)] - order[st(b)]),
    unknown: rows.filter((r) => st(r) === "unknown"),
    ok: rows.filter((r) => st(r) === "meets"),
    notAnalyzed: [],
  };
}

export const factLabel = (e: { key: string; value?: string | number | boolean }): string => e.key.replace(/_/g, " ") + (e.value !== undefined ? ": " + String(e.value) : "");
