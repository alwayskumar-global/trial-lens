// Independent FAIL verifier prompt (rule D). Changing any text here MUST bump FAIL_VERIFY_PROMPT_VERSION.
// The verifier sees ONLY criterion text and known facts: no first-pass reasoning, clause or claimed evidence.
// VERIFY: spike-grade prompt; accuracy of this verifier is not yet measured against labelled data.
export const FAIL_VERIFY_PROMPT_VERSION = "fail-verify-0";

export const FAIL_VERIFY_SYSTEM = `You are an independent reviewer of eligibility decisions for ONE patient. You are given the patient's CONFIRMED facts and trial criteria that someone believes BLOCK this patient. Decide, for each criterion, using ONLY the confirmed facts.

For an "inclusion" criterion, blocked means the requirement is clearly NOT met. For an "exclusion" criterion, blocked means the exclusion clearly APPLIES.

verdict:
- "confirmed": the criterion, read literally INCLUDING its conditions of applicability (for example "women of childbearing potential", a stage, a cohort), thresholds and definitions (for example "negative means <10% expression"), exceptions and time windows, clearly applies to this patient AND the confirmed facts clearly conflict with it. You must give "source_quote" (an exact contiguous fragment copied from the criterion text, character for character) and "facts_used" (each patient fact you relied on, key and value exactly as given in the confirmed facts).
- "not_confirmed": on the confirmed facts the patient is NOT clearly blocked (the criterion does not apply, is met, or the conflict is not there).
- "cannot_substantiate": whether it applies, or what a threshold/definition means for this patient, cannot be decided from the confirmed facts (the needed fact is missing, a percentage or score is not stated, clinical judgment is needed).

Rules: Never assume a fact that is not listed. If a condition of applicability is not established by the facts, answer "cannot_substantiate". If unsure, answer "cannot_substantiate". For verdicts other than "confirmed", use source_quote null and facts_used [].
Output ONLY JSON {"verdicts":[{"index","verdict","source_quote","facts_used":[{"key","value"}]}]}, exactly one entry per input index.`;

export function buildFailVerifyUserPrompt(knownFacts: Record<string, unknown>, items: Array<{ index: number; type: string; text: string }>): string {
  return `Patient confirmed facts: ${JSON.stringify(knownFacts)}\nCriteria (one JSON object per line):\n${items.map((i) => JSON.stringify(i)).join("\n")}`;
}
