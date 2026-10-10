import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Product copy rule (CLAUDE.md): never "eligible", "you qualify", "you will be accepted", "enroll".
// "eligibility" (the concept) is allowed.
const ROOTS = ["src/components", "src/lib/sample", "src/lib/live", "src/lib/visitor", "src/app"];
const BANNED = [/\beligible\b/i, /\bqualif(y|ies|ied)\b/i, /\baccepted\b/i, /\benrol(l|ls|led|ling|lment)\b/i];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(tsx?|css)$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
}

describe("UI copy audit", () => {
  for (const f of ROOTS.flatMap(files)) {
    it(f, () => {
      const src = readFileSync(f, "utf8");
      for (const re of BANNED) expect(src, String(re)).not.toMatch(re);
    });
  }
});

// Live mode analyzes a PREPARED FICTIONAL profile; visitors provide no information. Live screens must never imply they did.
describe("live copy refers to the prepared fictional profile, not the visitor", () => {
  const BAD = [/what you told us/i, /your information/i, /your info\b/i, /your age and sex/i, /your description/i];
  const LIVE_FILES = [...files("src/components/live"), ...files("src/lib/live")];
  for (const f of LIVE_FILES) {
    it(f, () => {
      const src = readFileSync(f, "utf8");
      for (const re of BAD) expect(src, String(re)).not.toMatch(re);
    });
  }
});

describe("replay notices", () => {
  const REASONS = ["requested", "rate_limited", "budget_exhausted", "guard_unavailable", "model_unavailable", "ctgov_unavailable", "disabled"] as const;
  it("every reason says saved results for a fictional profile and that no new analysis is running; none mentions the visitor's description", async () => {
    const { replayNotice } = await import("@/lib/live/copy");
    for (const r of REASONS) {
      const n = replayNotice(r, "Fictional profile: stage III");
      expect(n, r).toMatch(/saved results for a fictional profile/);
      expect(n, r).toMatch(/No new analysis is running\./);
      expect(n, r).not.toMatch(/your description|what you told us|your info/i);
    }
    // each fallback reason stays distinguishable
    expect(replayNotice("rate_limited")).toMatch(/hourly limit/);
    expect(replayNotice("budget_exhausted")).toMatch(/daily limit/);
    expect(replayNotice("model_unavailable")).toMatch(/isn't available right now/);
  });
});

describe("no screen addresses the visitor as the source of the profile", () => {
  it("'From your info' appears nowhere (fixed demo says 'From the fictional profile')", () => {
    for (const f of ["src/components", "src/lib/sample", "src/lib/live"].flatMap(files)) expect(readFileSync(f, "utf8"), f).not.toMatch(/From your info/);
  });
  it("the SafetyBanner default refers to the prepared fictional profile", () => {
    expect(readFileSync("src/components/feedback/SafetyBanner.tsx", "utf8")).toMatch(/with the prepared fictional profile\./);
  });
});

// Policy R2: a second automated pass re-checks how criteria compare with what was REPORTED. No screen may read as if TrialLens
// verified the visitor's medical facts or confirmed a conflict as true.
describe("no visitor-facing string presents the reported facts as verified", () => {
  const VERIFIED_FACTS = [
    /\b(your|the) (facts?|information|diagnos\w*|details|records?) (is|are|was|were|has been|have been) (verified|confirmed)\b/i,
    /\b(verified|confirmed) (your|the) (facts?|information|diagnos\w*|details|records?)\b/i,
    /\bmedically (verified|confirmed)\b/i,
    /\b(we|TrialLens|an? (second )?(automated )?check) (has |have )?(verified|confirmed) (that )?(your|you|the facts?|the information)\b/i,
  ];
  for (const f of ["src/components", "src/lib/sample", "src/lib/live", "src/app"].flatMap(files)) {
    it(f, () => {
      const src = readFileSync(f, "utf8");
      for (const re of VERIFIED_FACTS) expect(src, String(re)).not.toMatch(re);
    });
  }
  it("the internal flags are never mapped to visitor text", () => {
    for (const f of ["src/components", "src/lib/live"].flatMap(files).filter((x) => !/\.test-util\./.test(x))) expect(readFileSync(f, "utf8"), f).not.toMatch(/reported_conflict|reported_only/);
  });
});

// Study-team panel (Option B, Kumar undated; recorded 2026-10-07): a counterfactual lift is a prediction; the panel never promises a tier change, has no answer step and
// no "decisiveness" claim. Applies to the panel component and the live copy.
describe("study-team panel copy", () => {
  const BAD = [/most decisive/i, /blocks the most/i, /sharpen/i, /\bwill (?:change|move|update)\b/i, /move to Possible/i, /answering (?:this|these|a)\b/i];
  for (const f of ["src/components/results/StudyTeamPanel.tsx", ...files("src/lib/live")]) {
    it(f, () => {
      const src = readFileSync(f, "utf8");
      for (const re of BAD) expect(src, String(re)).not.toMatch(re);
    });
  }
  it("uses the approved title and notes exactly", () => {
    const src = readFileSync("src/components/results/StudyTeamPanel.tsx", "utf8");
    expect(src).toContain('"Questions worth asking the study team"');
    expect(src).toContain('"These questions relate to the prepared fictional profile. They do not change the results shown."');
    expect(src).toContain('"No question could be identified from the criteria assessed in this run."');
  });
});

// Judge-entered flow (approved by Kumar 2026-10-10 subject to accuracy fixes). Storage and privacy claims are limited to what the code audit supports:
// TrialLens persists no visitor text (no table, logs carry counts only, Redis holds a hashed IP and counters). Nothing may claim anything about the model
// provider's retention (the ZDR confirmation is owner-attested, not quoted) and nothing may overstate security.
describe("visitor flow privacy and results wording", () => {
  const visitorCopy = readFileSync("src/lib/visitor/copy.ts", "utf8");
  const liveCopy = readFileSync("src/lib/live/copy.ts", "utf8");
  it("makes no claim about the provider's retention and no security overstatement", () => {
    for (const src of [visitorCopy, liveCopy]) expect(src).not.toMatch(/zero[- ]data[- ]retention|\bZDR\b|not retain|encrypt|\bsecure\b|anonymi[sz]ed|HIPAA|deleted immediately/i);
  });
  it("names Nebius Token Factory wherever typed text is said to be sent", () => {
    expect(visitorCopy).toMatch(/D_PRIVACY = "[^"]*Nebius Token Factory/);
    expect(visitorCopy).toMatch(/FOOTER_OPEN = "[^"]*Nebius Token Factory/);
  });
  it("every live results note says selection is not a match and Possible is not confirmed eligibility, and names breast-cancer studies", () => {
    for (const re of [/R_NOTE_FIXED = "[^"]*breast-cancer[^"]*Selection is not a match[^"]*not confirmed eligibility/, /R_NOTE_REPLAY = "[^"]*breast-cancer[^"]*Selection is not a match[^"]*not confirmed eligibility/]) expect(liveCopy).toMatch(re);
    expect(visitorCopy).toMatch(/V_RESULTS_NOTE = "[^"]*breast-cancer[^"]*Selection is not a match[^"]*not confirmed eligibility/);
  });
  it("the discovery sentence is built from applied filters, never a fixed 'age and sex' string", () => {
    expect(visitorCopy).not.toMatch(/fit the age and sex you entered/);
    expect(readFileSync("src/components/live/CoverageRow.tsx", "utf8")).not.toMatch(/age and sex/);
    expect(readFileSync("src/components/live/LiveProcessing.tsx", "utf8")).not.toMatch(/age and sex/);
  });
});
