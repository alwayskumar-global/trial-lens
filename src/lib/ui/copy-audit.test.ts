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
