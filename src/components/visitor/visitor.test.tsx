import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { assessedPossible } from "@/lib/live/fixtures.test-util";
import { initialRun, reduceRun, type RunAction } from "@/lib/live/model";
import * as C from "@/lib/visitor/copy";
import { add, parseExtractResponse, setValue, validate } from "@/lib/visitor/facts";
import { LiveCopyContext, VISITOR_COPY } from "../live/LiveCopy";
import { LiveResults } from "../live/LiveResults";
import { VisitorConfirm } from "./VisitorConfirm";
import { VisitorDescribe } from "./VisitorDescribe";

const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const esc = (s: string) => s.replace(/'/g, "&#x27;");
const noop = () => {};
const drafts = parseExtractResponse({ profile: { facts: { age: { key: "age", state: "known", value: 52 }, her2_status: { key: "her2_status", state: "uncertain", value: "positive" } } }, extract_token: "t" })!.drafts;
const describeProps = { text: "", maxChars: 2000, busy: false, tag: "t", footer: "f", onText: noop, onSample: noop, onSubmit: noop } as const;
const M = { needValue: C.C_NEED_VALUE, badNumber: C.C_BAD_NUMBER, outOfRange: C.C_OUT_OF_RANGE };
const confirmProps = (editable: boolean, d = drafts, showErrors = false) => ({ drafts: d, errors: validate(d, M), text: "a made-up description", editable, tag: "t", announce: "", showErrors, onSure: noop, onValue: noop, onRemove: noop, onAdd: noop, onBack: noop, onNext: noop });

describe("VisitorDescribe", () => {
  it("open: an enabled, labelled textarea, fictional examples, the privacy notice and the proposed footer", () => {
    const h = html(<VisitorDescribe {...describeProps} mode="open" text="hello" footer={C.FOOTER_OPEN} />);
    expect(h).toContain("Your situation");
    expect(h).toMatch(/<textarea[^>]*id="tl-situation"/);
    expect(h).not.toMatch(/<textarea[^>]*disabled/);
    expect(h).toContain(esc(C.D_PRIVACY));
    expect(h).toContain("Or start from a fictional example");
    expect(h).toContain(C.FOOTER_OPEN);
    expect(h).toContain("maxLength=\"2000\"");
  });
  it("gated: the textarea is disabled, the reason is stated, examples remain, and nothing offers typing", () => {
    const h = html(<VisitorDescribe {...describeProps} mode="gated" footer={C.FOOTER_CURRENT} />);
    expect(h).toMatch(/<textarea[^>]*disabled/);
    expect(h).toContain(C.G_NOTICE_TITLE);
    expect(h).not.toContain(esc(C.D_PRIVACY));
    expect(h).toContain("stage III, HER2-positive");
    expect(h).toContain(C.FOOTER_CURRENT);
    expect(h).toMatch(/<button[^>]*disabled=""[^>]*>Review what we understood/);
  });
  it("busy disables everything and says it is reading; an extraction error is announced with a next step", () => {
    const busy = html(<VisitorDescribe {...describeProps} mode="open" text="x" busy />);
    expect(busy).toContain(C.D_CTA_BUSY);
    expect(busy).toMatch(/<textarea[^>]*disabled/);
    const err = html(<VisitorDescribe {...describeProps} mode="open" text="x" error={C.extractError(429, "rate_limited")} />);
    expect(err).toContain('role="alert"');
    expect(err).toContain(C.EXAMPLE_BUTTON);
  });
  it("validation message is shown on the textarea", () => {
    const h = html(<VisitorDescribe {...describeProps} mode="open" invalid={C.D_EMPTY} />);
    expect(h).toContain('aria-invalid="true"');
    expect(h).toContain(C.D_EMPTY);
  });
});

describe("VisitorConfirm", () => {
  it("editable: every provided detail has a labelled value control, a how-sure control and a remove button; unknown details can be added", () => {
    const h = html(<VisitorConfirm {...confirmProps(true)} />);
    expect(h).toContain("Here is what we understood");
    expect(h).toContain('for="tl-fact-age"');
    expect(h).toContain('aria-label="Remove Age"');
    expect(h).toContain('aria-label="How sure: HER2 status"');
    expect(h).toContain(C.C_ADD_SUMMARY(33));
    expect(h).toContain('aria-label="Add Cancer stage"');
    expect(h).toContain("What you wrote");
  });
  it("read-only (gated): chips only, no controls", () => {
    const h = html(<VisitorConfirm {...confirmProps(false)} />);
    expect(h).not.toMatch(/<input|<select/);
    expect(h).toContain(esc(C.C_LEAD_READONLY));
    expect(h).toContain("Age: 52 years");
  });
  it("an added detail without a value shows its error only after a failed attempt, tied to the control", () => {
    const d = add(drafts, "stage");
    const before = html(<VisitorConfirm {...confirmProps(true, d, false)} />);
    expect(before).not.toContain(C.C_NEED_VALUE);
    const after = html(<VisitorConfirm {...confirmProps(true, d, true)} />);
    expect(after).toContain(esc(C.C_NEED_VALUE));
    expect(after).toContain('aria-invalid="true"');
    expect(after).toContain('aria-describedby="tl-fact-stage-err"');
    expect(after).toContain(C.C_ERR_FIX);
    expect(html(<VisitorConfirm {...confirmProps(true, setValue(d, "stage", "III"), true)} />)).not.toContain(C.C_NEED_VALUE);
  });
  it("shows no location/travel control and no answer chips (Option B stays)", () => {
    const all = html(<VisitorConfirm {...confirmProps(true)} />) + html(<VisitorDescribe {...describeProps} mode="open" />);
    expect(all).not.toMatch(/location|travel|distance|\bmiles\b|zip|postcode|tl-achip[^>]*aria-pressed="(true|false)"[^>]*>(Yes|No|I don)/i);
  });
});

describe("visitor results copy", () => {
  it("refers to the details entered, keeps the study-team panel, and never says verified or eligible", () => {
    const actions: RunAction[] = [{ type: "mode", mode: "live" }, { type: "counts", discovered: 5, filtered: 4, selected: 1 }, { type: "trial_result", assessment: assessedPossible }, { type: "study_questions", version: "sq-1", questions: [] }, { type: "done", replay: false }];
    const run = actions.reduce(reduceRun, initialRun);
    const h = html(<LiveCopyContext.Provider value={VISITOR_COPY}><LiveResults run={run} onOpen={noop} actions={<span>ACTIONS</span>} /></LiveCopyContext.Provider>);
    expect(h).toContain("the details you entered");
    expect(h).toContain("Questions worth asking the study team");
    expect(h).toContain("ACTIONS");
    expect(h).not.toMatch(/prepared fictional profile/);
    expect(h).not.toMatch(/\b(eligible|verified)\b/i);
  });
});

describe("approved-with-fixes copy", () => {
  it("Describe says breast-cancer studies only and the disclosure names Nebius Token Factory; no retention claim about the provider", () => {
    const open = html(<VisitorDescribe {...describeProps} mode="open" footer={C.FOOTER_OPEN} />);
    expect(open).toContain("recruiting breast-cancer studies only");
    expect(open).toContain("Nebius Token Factory");
    expect(C.FOOTER_OPEN).toContain("Nebius Token Factory");
    expect(`${C.D_PRIVACY} ${C.FOOTER_OPEN}`).not.toMatch(/zero data retention|ZDR|not retain|doesn't keep|does not keep|deleted|private|secure/i);
    expect(html(<VisitorDescribe {...describeProps} mode="gated" footer={C.FOOTER_CURRENT} />)).toContain("recruiting breast-cancer studies only");
  });
  it("Results say selection is not a match and Possible is not confirmed eligibility", () => {
    for (const note of [C.V_RESULTS_NOTE]) {
      expect(note).toMatch(/breast-cancer/);
      expect(note).toMatch(/Selection is not a match/);
      expect(note).toMatch(/not confirmed eligibility/);
    }
  });
});
