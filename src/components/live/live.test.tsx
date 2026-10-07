import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OPEN_ON_CTGOV } from "@/lib/live/copy";
import { cardModel, initialRun, reduceRun, type RunAction, type RunState } from "@/lib/live/model";
import { assessedPossible, failed, mismatch, noMet, pending, reportedConflict, reportedOnly } from "@/lib/live/fixtures.test-util";
import { FitBar } from "../results/FitBar";
import { LiveCard } from "./LiveCard";
import { LiveDetail } from "./LiveDetail";
import { LiveProcessing } from "./LiveProcessing";
import { LiveResults } from "./LiveResults";

const run = (...as: RunAction[]): RunState => as.reduce(reduceRun, initialRun);
const resultsRun = (mode: "live" | "replay") =>
  run(
    { type: "mode", mode, ...(mode === "replay" ? { reason: "rate_limited" as const, label: "Fictional profile: stage III" } : {}) },
    { type: "counts", discovered: 120, filtered: 115, selected: 5 },
    ...[assessedPossible, noMet, pending, failed, mismatch].map((t): RunAction => ({ type: "trial_result", assessment: t })),
    { type: "counts", assessed: 3, pending: 1, failed: 1 },
    { type: "done", replay: mode === "replay" },
  );
const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const noop = () => {};

describe("LiveProcessing", () => {
  it("lists only started steps, shows counts only once received, never a percentage or duration", () => {
    const early = html(<LiveProcessing run={run({ type: "mode", mode: "live" }, { type: "stage", stage: "extraction", status: "start" })} />);
    expect(early).toContain("Reading the prepared fictional profile");
    expect(early).not.toContain("Finding recruiting studies"); // not started: no waiting rows
    expect(early).not.toMatch(/details found|\bfound\b.*selected/); // counts not received yet
    const later = html(
      <LiveProcessing run={run({ type: "mode", mode: "live" }, { type: "stage", stage: "extraction", status: "done" }, { type: "profile", facts: [{ key: "age", state: "known", value: 52 }, { key: "sex", state: "known", value: "female" }] }, { type: "stage", stage: "discovery", status: "done" }, { type: "counts", discovered: 120, filtered: 115, selected: 30 }, { type: "stage", stage: "parse", status: "start" })} />,
    );
    expect(later).toContain("2 details found");
    expect(later).toContain("Reading the prepared fictional profile");
    expect(later).toContain("120 found · 115 fit the prepared fictional profile&#x27;s age and sex · 30 selected");
    for (const h of [early, later]) {
      expect(h).not.toMatch(/\d\s?%/);
      expect(h).not.toMatch(/under a minute|usually takes|seconds|Skip/i);
      expect(h).not.toContain("Loading fixed demo");
      expect(h).toContain("Live run");
    }
  });
});

describe("LiveCard", () => {
  it("pending and failed cards keep distinct text, tags and stay Uncertain", () => {
    const p = html(<LiveCard m={cardModel(pending)} subject="the prepared fictional profile" onOpen={noop} />);
    const f = html(<LiveCard m={cardModel(failed)} subject="the prepared fictional profile" onOpen={noop} />);
    expect(p).toContain("Not analyzed this run");
    expect(p).toContain("didn&#x27;t have capacity");
    expect(f).toContain("Couldn&#x27;t be read");
    expect(f).toContain("couldn&#x27;t read this study&#x27;s criteria automatically");
    for (const h of [p, f]) {
      expect(h).toContain("Uncertain");
      expect(h).toContain("See original criteria");
      expect(h).not.toContain("Why it surfaced");
    }
    expect(p).not.toContain("couldn&#x27;t read this study");
  });

  it("no 'meets' tick when zero criteria are met; the tick appears once one is", () => {
    const zero = html(<LiveCard m={cardModel(noMet)} subject="the prepared fictional profile" onOpen={noop} />);
    expect(zero).toContain("0 criteria look fine so far");
    expect(zero).toContain("tl-glyph--unknown");
    expect(zero).not.toContain("tl-glyph--meets");
    const some = html(<LiveCard m={cardModel(assessedPossible)} subject="the prepared fictional profile" onOpen={noop} />);
    expect(some).toContain("tl-glyph--meets");
  });

  it("quotes only whole criteria, labelled 'Criterion excerpt'; a long one is never cut off", () => {
    const h = html(<LiveCard m={cardModel(assessedPossible)} subject="the prepared fictional profile" onOpen={noop} />);
    expect(h).toContain("Criterion excerpt");
    expect(h).toContain("“Women 18 years or older”");
    expect(h).toContain("too long to quote here");
    expect(h).not.toContain("BRCA1"); // the long criterion is not quoted at all
    expect(h).not.toContain("…");
    expect(h).toContain("See criteria and full wording");
  });

  it("links to the official study page only for a well-formed link", () => {
    expect(html(<LiveCard m={cardModel(assessedPossible)} subject="x" onOpen={noop} />)).toContain('href="https://clinicaltrials.gov/study/NCT00000001"');
    expect(html(<LiveCard m={{ ...cardModel(assessedPossible), url: null }} subject="x" onOpen={noop} />)).not.toContain("href=");
  });
});

describe("LiveResults", () => {
  it("shows assessed, pending and failed separately (zero included) and groups unfinished trials as Uncertain", () => {
    const h = html(<LiveResults run={resultsRun("live")} onOpen={noop} />);
    expect(h).toContain("3 assessed");
    expect(h).toContain("1 not analyzed this run");
    expect(h).toContain("1 couldn&#x27;t be read");
    expect(h).toContain("5 studies selected for review");
    expect(h).toContain("120 recruiting studies found, 115 fit the prepared fictional profile&#x27;s age and sex, 5 selected for review");
    expect(h).toContain("Not analyzed or couldn&#x27;t be read");
    expect(h).toContain("They are not matches or mismatches");
    expect(h).toContain("Live run");
    expect(h).not.toContain("Saved fictional example");
    expect(h).not.toContain("analyzed</h1>"); // no blended "N analyzed" headline
  });

  it("uses a zero count when no pending/failed exist (all three figures always shown)", () => {
    const r = run({ type: "mode", mode: "live" }, { type: "counts", selected: 1, assessed: 1, pending: 0, failed: 0 }, { type: "trial_result", assessment: noMet }, { type: "done", replay: false });
    const h = html(<LiveResults run={r} onOpen={noop} />);
    expect(h).toContain("0 not analyzed this run");
    expect(h).toContain("0 couldn&#x27;t be read");
    expect(h).not.toContain("Not analyzed or couldn&#x27;t be read"); // group only when there is something to show
  });

  it("Fit Line: dashed dots with accessible reasons for pending/failed, plus a text legend", () => {
    const h = html(<LiveResults run={resultsRun("live")} onOpen={noop} />);
    expect(h.match(/tl-dot--dashed/g)).toHaveLength(2);
    expect(h).toContain("not analyzed this run");
    expect(h).toContain("couldn&#x27;t be read");
    expect(h).toContain("Not analyzed this run or couldn&#x27;t be read (stays Uncertain)");
    expect(h).toMatch(/aria-label="Fictional trial NCT00000003, Uncertain, not analyzed this run"/);
    expect(h).toMatch(/aria-label="Fictional trial NCT00000004, Uncertain, couldn&#x27;t be read"/);
  });

  it("mobile Fit Bar: pending/failed are stated in text and in the accessible label without dashed dots", () => {
    const h = html(<LiveResults run={resultsRun("live")} onOpen={noop} />);
    expect(h).toContain("2 of the 3 Uncertain studies were not analyzed this run or couldn&#x27;t be read.");
    expect(h).toContain('aria-label="3 Uncertain, including 2 not analyzed this run or couldn&#x27;t be read"');
    expect(html(<FitBar counts={{ strong: 0, possible: 1, uncertain: 3, mismatch: 1 }} />)).not.toContain("aria-label=\"3 Uncertain");
  });

  it("replay carries the persistent 'Saved fictional example' tag, notice and banner, and no live labelling", () => {
    const h = html(<LiveResults run={resultsRun("replay")} onOpen={noop} />);
    expect(h).toContain("Saved fictional example");
    expect(h).toContain("You&#x27;ve reached the hourly limit for live analysis.");
    expect(h).toContain("This page shows saved results for a fictional profile. No new analysis is running.");
    expect(h).not.toMatch(/your description/);
    expect(h).toContain("compares public trial criteria with a fictional profile");
    expect(h).toContain("this profile&#x27;s age and sex");
    expect(h).not.toContain("Live run");
    expect(h).not.toMatch(/Analyzing live|Skip to results/);
  });
});

describe("LiveDetail", () => {
  const detail = (t: typeof assessedPossible, mode: "live" | "replay" = "live") => html(<LiveDetail run={{ ...resultsRun(mode), profile: [{ key: "age", value: 52 }] }} trial={t} onBack={noop} />);

  it("shows original wording and 'From the prepared fictional profile', no plain-language column, 'Automated note', 'Not provided'", () => {
    const h = detail(assessedPossible);
    expect(h).toContain("Original wording");
    expect(h).toContain("From the prepared fictional profile");
    expect(h).toContain("age: 52");
    expect(h).toContain("Automated note:");
    expect(h).toContain("No data on prior genetic testing");
    expect(h).toContain("Not provided");
    expect(h).toContain("Worth asking the study team.");
    expect(h).toContain("tl-strip__body--two");
    expect(h).not.toMatch(/In plain words|plain-language|Questions for the study team|Ask the team/);
    expect(h).toContain("Individuals who have previously undergone genetic testing"); // full original wording is in the row
  });

  it("row titles that are cut are labelled 'Criterion excerpt'", () => {
    expect(detail(assessedPossible)).toContain("Criterion excerpt:");
  });

  it("final CTA is 'Open on ClinicalTrials.gov' with the official link; never 'Contact study team' or the banned word", () => {
    const h = detail(assessedPossible);
    expect(h).toContain(OPEN_ON_CTGOV);
    expect(h).toContain("Open the official study page for current criteria and any listed locations or contacts.");
    expect(h).not.toMatch(/lists locations and contacts/);
    expect(h).toContain('href="https://clinicaltrials.gov/study/NCT00000001"');
    expect(h).toContain('rel="noopener noreferrer"');
    expect(h).not.toContain("Contact study team");
    expect(h).not.toMatch(/\benrol/i);
  });

  it("pending and failed: distinct explanation, original criteria only, nothing 'compared'", () => {
    const p = detail(pending), f = detail(failed);
    expect(p).toContain("Not analyzed in this run");
    expect(p).toContain("didn&#x27;t have capacity");
    expect(f).toContain("Couldn&#x27;t be read");
    expect(f).toContain("couldn&#x27;t read this study&#x27;s criteria automatically");
    for (const h of [p, f]) {
      expect(h).toContain("Not compared");
      expect(h).toContain("Nothing has been compared");
      expect(h).not.toContain("Why it surfaced");
      expect(h).not.toContain("tl-glyph--meets");
    }
    expect(p).toContain("Recently diagnosed with stage II, III, or IV breast cancer");
  });

  it("a likely mismatch never claims 'no conflict'", () => {
    expect(detail(mismatch)).not.toContain("found no conflict");
  });

  it("R2: a reported conflict never reads as verified, never as a mismatch, and its internal flag is never rendered", () => {
    const h = detail(reportedConflict);
    const card = html(<LiveCard m={cardModel(reportedConflict)} subject="the prepared fictional profile" onOpen={noop} />);
    for (const out of [h, card]) {
      expect(out).not.toMatch(/\bverified\b/i);
      expect(out).not.toContain("found no conflict");
      expect(out).not.toMatch(/reported_conflict|reported_only|fact_basis|visitor_reported|fail_check/);
      expect(out).not.toMatch(/Likely mismatch/i);
    }
    expect(cardModel(reportedConflict).tier).toBe("uncertain");
  });

  it("R2: a reported-only POSSIBLE result shows no flag text either", () => {
    const h = detail(reportedOnly);
    expect(html(<LiveCard m={cardModel(reportedOnly)} subject="the prepared fictional profile" onOpen={noop} />)).not.toMatch(/reported_only|reported_conflict|fact_basis|visitor_reported/);
    expect(h).not.toMatch(/reported_only|reported_conflict|fact_basis|visitor_reported/);
    expect(cardModel(reportedOnly).tier).toBe("possible");
  });

  it("replay Detail keeps the persistent notice and fictional-profile wording", () => {
    const h = detail(assessedPossible, "replay");
    expect(h).toContain("Saved fictional example");
    expect(h).toContain("No new analysis is running.");
    expect(h).toContain("From the fictional profile");
    expect(h).not.toContain("From the prepared fictional profile");
  });
});
