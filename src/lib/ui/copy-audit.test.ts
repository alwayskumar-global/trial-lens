import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Product copy rule (CLAUDE.md): never "eligible", "you qualify", "you will be accepted", "enroll".
// "eligibility" (the concept) is allowed.
const ROOTS = ["src/components", "src/lib/sample", "src/lib/live", "src/app"];
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
