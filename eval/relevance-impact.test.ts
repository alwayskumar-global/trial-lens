// Guards the read-only promise of the offline impact measurement: only `select`-style reads, no write/RPC/model calls in the script.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("eval/relevance-impact.ts is read-only", () => {
  const src = readFileSync("eval/relevance-impact.ts", "utf8").replace(/^\s*\/\/.*$/gm, "");
  it("contains no Supabase write, rpc, replay put or model call", () => {
    expect(src).not.toMatch(/\.(insert|update|upsert|delete|rpc)\s*\(/);
    expect(src).not.toMatch(/\.put\s*\(/);
    expect(src).not.toMatch(/openai|chat\.completions|createLlm|LlmPort|llm\.call|callJson/i);
  });
  it("reads only through the replay store's get and one select", () => {
    expect(src.match(/\.select\(/g)?.length).toBe(1);
    expect(src).toMatch(/store\.get\(/);
  });
});
