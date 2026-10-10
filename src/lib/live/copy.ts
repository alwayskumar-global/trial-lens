// Approved copy for the live / replay / pending states (docs/live-ui-proposal.md revision 2, approved by Kumar).
// Rules: docs/copy-rules.md. Anything not in the approved proposal is marked VERIFY(copy).
import type { SseEvent } from "@/schema/sse";

type ModeEvent = Extract<SseEvent, { type: "mode" }>;
export type ReplayReason = NonNullable<ModeEvent["reason"]>;

export const TAG_LIVE = "Live run";
export const TAG_REPLAY = "Saved fictional example";
export const TAG_ENTRY = "Fictional profile"; // approved
export const LIVE_BANNER = "TrialLens compares public trial criteria with the prepared fictional profile. It can't confirm eligibility. Only a study team can.";
export const REPLAY_BANNER = "This example compares public trial criteria with a fictional profile. It can't confirm eligibility. Only a study team can.";

export const ANALYZE_LIVE = "Analyze fictional profile live"; // approved by Kumar (reviewer revision)
export const REPLAY_LOADING = "Loading the saved example."; // approved: neutral line while a replay streams in (no stages, no progress)

export const PROCESSING_TITLE = "Analyzing live";
export const PROCESSING_LEAD = "We're reading public trial criteria against the prepared fictional profile. Nothing here is a decision. It's a map to bring to your care team.";
export const PROCESSING_FOOT = "Steps and numbers appear as they happen. Results show when the analysis finishes.";

/** Patient-friendly stage names (SSE `stage` values). Unknown stage names are not shown. */
export const STAGE_LABELS: Record<string, string> = {
  extraction: "Reading the prepared fictional profile",
  discovery: "Finding recruiting studies",
  parse: "Reading each study's criteria",
  typed_evaluation: "Comparing what we can check directly",
  free_text_evaluation: "Comparing wording that needs a closer read",
  verification: "Double-checking possible matches",
  fail_checks: "Double-checking possible mismatches",
  questions: "Listing questions worth asking the study team",
};

export const REPLAY_NOTICE_LEAD = "Saved fictional example.";
/** Replay notice: keeps the fallback reason, and always says the page shows saved results for a fictional profile and that no new analysis is running. */
export function replayNotice(reason: ReplayReason | undefined, label?: string): string {
  const saved = "This page shows saved results for a fictional profile. No new analysis is running.";
  switch (reason) {
    case "requested":
      return `This page shows saved results for a fictional profile${label ? ` (${label})` : ""}. No new analysis is running.`;
    case "rate_limited":
      return `You've reached the hourly limit for live analysis. ${saved}`;
    case "budget_exhausted":
      return `Live analysis has reached its daily limit. ${saved}`;
    default:
      return `Live analysis isn't available right now. ${saved}`;
  }
}

export const PENDING_TAG = "Not analyzed this run";
export const FAILED_TAG = "Couldn't be read";
export const PENDING_CARD = "This run didn't have capacity to read this study's criteria, so we can't say how it fits. It stays Uncertain. Read the original criteria on ClinicalTrials.gov or ask the study team.";
export const FAILED_CARD = "We couldn't read this study's criteria automatically, so we can't say how it fits. It stays Uncertain. Read the original criteria on ClinicalTrials.gov or ask the study team.";
export const PENDING_DETAIL = "This run didn't have capacity to read this study's criteria, so we can't say how it fits. It stays Uncertain, which is not a match or a mismatch. The original criteria are below. Read them on ClinicalTrials.gov or ask the study team.";
export const FAILED_DETAIL = "We couldn't read this study's criteria automatically, so we can't say how it fits. It stays Uncertain, which is not a match or a mismatch. The original criteria are below. Read them on ClinicalTrials.gov or ask the study team."; // approved: detail wording for failed (mirrors the approved pending text)
export const NOT_ANALYZED_GROUP = "Not analyzed or couldn't be read";
export const NOT_ANALYZED_GROUP_NOTE = "These stay Uncertain. They are not matches or mismatches.";

export const LONG_WORDING = "its wording is too long to quote here. Open the criteria to read it.";
export const OPEN_ON_CTGOV = "Open on ClinicalTrials.gov";
/** How live screens refer to the profile. Visitors provide no information in this flow, so live copy never addresses the visitor as the source (see docs/copy-rules.md). */
export const LIVE_SUBJECT = "the prepared fictional profile";
export const REPLAY_SUBJECT = "the fictional profile";
export const ASK_TEAM = "Worth asking the study team.";
/**
 * Approved by Kumar (2026-10-07), fictional-profile variant: shown beside a neutral icon when a second automated pass found no conflict.
 * `subject` is LIVE_SUBJECT or REPLAY_SUBJECT. Visitor-specific wording ("Your reported details") is reserved for the visitor-UI review.
 */
export const secondComparison = (subject: string, plural = false): string => `A second automated comparison found no conflict in the criteria it checked. ${subject.charAt(0).toUpperCase()}${subject.slice(1)} ${plural ? "were" : "was"} not independently verified.`;

export const ERROR_TITLE = "Live analysis isn't available right now"; // approved
export const ERROR_BODY = "No results are available from this run. Please try again later."; // approved wording: "Nothing was analyzed" can be false after partial progress
