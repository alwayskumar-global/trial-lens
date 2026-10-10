// Guards the read-only promise of the offline impact measurement: only `select`-style reads, no write/RPC/model calls in the script.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe.each(["eval/relevance-impact.ts", "eval/fail-closed-impact.ts", "eval/replay-failclosed-diff.ts", "eval/evaluate-stage-inventory.ts"])("%s is read-only", (file) => {
  const src = readFileSync(file, "utf8").replace(/^\s*\/\/.*$/gm, "");
  it("contains no Supabase write, rpc, replay put or model call", () => {
    expect(src).not.toMatch(/\.(insert|update|upsert|delete|rpc)\s*\(/);
    expect(src).not.toMatch(/\.put\s*\(/);
    expect(src).not.toMatch(/openai|chat\.completions|createLlm|LlmPort|llm\.call|callJson/i);
  });
  it("reads only through the replay store's get and one select", () => {
    expect((src.match(/\.select\(/g) ?? []).length).toBeLessThanOrEqual(1);
    expect(src).toMatch(/store\.get\(/);
  });
});
