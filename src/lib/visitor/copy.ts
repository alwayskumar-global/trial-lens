// PROPOSED copy for the judge/visitor-entered flow (open mode). NOT approved: every string here is VERIFY(copy) and is listed in
// docs/visitor-flow-copy-review.md for Kumar's review. The samples-mode screens keep the approved fictional-profile copy in
// src/lib/live/copy.ts. Rules: docs/copy-rules.md (banned words listed there; Policy R2: nothing the visitor says is ever called verified).
import type { ReplayReason } from "@/lib/live/copy";

// ---- Describe ("Your situation") ----------------------------------------------------------------
export const D_TAG = "Demo · fictional situations only";
export const D_TITLE = "Find clinical trials worth asking about.";
export const D_LEAD = "Describe a situation in your own words. We'll show what we understood before anything is searched. This demo searches recruiting breast-cancer studies only.";
export const D_LABEL = "Your situation";
export const D_HELPER = "For example: age, type and stage of cancer, treatments so far. Use a made-up situation.";
export const D_PLACEHOLDER = "I'm 58 and was diagnosed with stage II breast cancer that is hormone receptor positive…";
export const D_PRIVACY = "Please don't type your name, contact details or real medical records. This is a demo: use a made-up or fictional situation. What you type is sent to Nebius Token Factory, an AI model provider, to be read. TrialLens does not store it.";
export const D_SAMPLES_HEADING = "Or start from a fictional example";
export const D_CTA = "Review what we understood";
export const D_CTA_BUSY = "Reading your situation…";
export const D_EMPTY = "Describe a situation to continue.";

// ---- Gated state (server has typed input switched off) -----------------------------------------
export const G_NOTICE_TITLE = "Typing a new situation is switched off in this demo environment";
export const G_NOTICE_BODY = "You can still try the whole flow with a fictional example below. This demo searches recruiting breast-cancer studies only.";
export const G_PLACEHOLDER = "Choose a fictional example below.";
export const G_LOADING = "Checking what this demo allows…";

// ---- Confirm ("Here is what we understood") ---------------------------------------------------
export const C_TITLE = "Here is what we understood";
export const C_LEAD = "Check each detail and correct anything we got wrong. TrialLens can't check these details, so the results depend on them being right.";
export const C_LEAD_READONLY = "These details come from the fictional example. They can't be edited in this environment.";
export const C_YOUR_TEXT = "What you wrote";
export const C_KNOWN = "Details we'll use to compare";
export const C_KNOWN_NOTE = "Used to compare with each study.";
export const C_NONE_KNOWN = "We didn't find any details we could use. Add some below, or go back and add more to your description.";
export const C_UNKNOWN = "Not mentioned";
export const C_UNKNOWN_NOTE = "These become questions to ask, not problems.";
export const C_ADD_SUMMARY = (n: number) => `Add a detail we missed (${n})`;
export const C_ADD = "Add";
export const C_REMOVE = "Remove";
export const C_SURE = "I'm sure";
export const C_UNSURE = "Not sure";
export const C_SURE_LABEL = "How sure";
export const C_CHOOSE = "Choose…";
export const C_RUN = "Search for studies";
export const C_BACK = "Back";
export const C_ERR_FIX = "Fix the highlighted details to continue.";
export const C_NEED_VALUE = "Enter a value, or remove this detail.";
export const C_BAD_NUMBER = "Enter a number.";
export const C_OUT_OF_RANGE = "That number is outside the usual range.";
export const C_REMOVED = (label: string) => `${label} removed. It is now listed under Not mentioned.`;
export const C_ADDED = (label: string) => `${label} added. Enter its value.`;

// ---- Run, results, detail: how the pages refer to the details ----------------------------------
export const V_SUBJECT = "your details";
export const V_BANNER = "TrialLens compares public trial criteria with the details you entered. It can't confirm eligibility, and it hasn't checked your details. Only a study team can confirm.";
export const V_PROCESSING_LEAD = "We're reading public trial criteria against the details you entered. Nothing here is a decision. It's a map to bring to your care team.";
export const V_EXTRACTION_STAGE = "Reading the details you entered";
export const V_RESULTS_NOTE = "These are recruiting breast-cancer studies this demo selected to read. Selection is not a match. Possible match means no conflict was found with the details you entered, not confirmed eligibility. Only a study team can confirm.";
export const V_PANEL_SUB = "Some criteria in these studies can't be checked from the details you entered. The study team can confirm the detail.";
export const V_PANEL_NOTE = "These questions relate to the details you entered. They do not change the results shown.";
export const V_RESTART = "Describe a different situation";
export const V_EDIT = "Edit details and search again";

// ---- Footer / privacy ---------------------------------------------------------------------------
/** Current approved footer (samples mode, unchanged). */
export const FOOTER_CURRENT = "TrialLens does not store your information.";
/** Proposed footer when typed input is on: the current line is true for TrialLens's own storage but omits the model provider. */
export const FOOTER_OPEN = "TrialLens does not store what you enter. Your text is sent to Nebius Token Factory, an AI model provider, to be read.";

// ---- Errors (extract and run) ------------------------------------------------------------------
export interface FlowError { title: string; body: string; action?: "retry" | "back" | "restart" | "example" }
export function extractError(status: number, code: string): FlowError {
  if (code === "input_too_long") return { title: "That's longer than this demo can read", body: "Shorten the description and try again.", action: "retry" };
  if (code === "bad_request") return { title: "We couldn't use that text", body: "Check that it isn't empty, then try again.", action: "retry" };
  if (code === "visitor_input_disabled") return { title: G_NOTICE_TITLE, body: G_NOTICE_BODY, action: "example" };
  if (code === "rate_limited" || status === 429) return { title: "You've reached the hourly limit", body: "Reading a new situation is limited each hour. Try a fictional example, or come back later.", action: "example" };
  if (code === "forbidden") return { title: "This request was blocked", body: "Reload the page and try again.", action: "retry" };
  if (status === 0) return { title: "We couldn't reach the server", body: "Check your connection and try again.", action: "retry" };
  return { title: "Reading your situation isn't available right now", body: "Please try again later, or try a fictional example.", action: "example" };
}
export function runError(status: number, code: string): FlowError {
  if (code === "invalid_token") return { title: "Your details need to be read again", body: "The review session expired or couldn't be confirmed. Nothing was searched. Go back and read your situation again.", action: "restart" };
  if (code === "visitor_input_disabled") return { title: G_NOTICE_TITLE, body: G_NOTICE_BODY, action: "example" };
  if (code === "rate_limited" || status === 429) return { title: "You've reached the hourly limit for live analysis", body: "Nothing was searched. You can view a saved fictional example instead, which is not an analysis of your details.", action: "example" };
  if (code === "bad_request") return { title: "We couldn't use those details", body: "Go back, check each detail, and try again.", action: "back" };
  return { title: "Live analysis isn't available right now", body: "No results are available from this run. You can view a saved fictional example instead, which is not an analysis of your details.", action: "example" };
}
export const EXAMPLE_BUTTON = "View a saved fictional example";
export const RETRY_BUTTON = "Try again";
export const REPLAY_REASON_FOR_EXAMPLE: ReplayReason = "requested";
