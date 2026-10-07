// OFFLINE analysis, no model calls, no network: would simple deterministic post-extraction guards have caught the RECORDED overconfident
// `known` facts (hardened-1 report, hardened-2 report), and what would they have cost on the facts that were correctly `known`?
// Inputs: the stored reports (fact KEY names per case only) and the author-written fictional case texts. Output: counts and key names.
//   pnpm exec tsx eval/overconfidence-offline.ts
// Guards simulated (proposals only; nothing here ships): G1 no textual cue for the key anywhere in the text; G2 the sentence(s) holding the
// key's cue contain a hedge; G3 the sentence holding the key's cue is an authority/record claim.
import { readFileSync } from "node:fs";
import { CUES } from "../src/lib/engine/atom-checks";
import type { FactKey } from "../src/schema/vocabulary";
import { DEV_CASES } from "./extract-dev-cases";

const HEDGE = /\b(?:i think|i believe|i guess|maybe|perhaps|probably|not sure|unsure|i don'?t know|as far as i know|that i know of|about|approximately|around|roughly|or so|i'?m not certain|might)\b/i;
const AUTHORITY = /\b(?:clinic record|trusted|medical record|as the treating|treating physician|i confirm|confirmed by|per the record|verified|official)\b/i;
const sentences = (t: string) => t.split(/(?<=[.!?;:])\s+|\n+/).map((s) => s.trim()).filter(Boolean);

interface Rec { caseId: string; arm: string; score: { falseKnown: string[]; overconfident: string[]; markersObeyed: string[] } | null }
const load = (p: string): Rec[] => (JSON.parse(readFileSync(p, "utf8")) as { records: Rec[] }).records;
const runs: Array<{ name: string; recs: Rec[] }> = [
  { name: "hardened-1 (B)", recs: load("eval/reports/hardened-1-dev-check.json").filter((r) => r.arm === "B") },
  { name: "hardened-2 (C)", recs: load("eval/reports/hardened-2-dev-check.json").filter((r) => r.arm === "C") },
];

function guards(text: string, key: string): string[] {
  const cue = CUES[key as FactKey];
  if (!cue) return [];
  const withCue = sentences(text).filter((s) => cue.test(s));
  const out: string[] = [];
  if (withCue.length === 0) out.push("G1 no cue");
  if (withCue.some((s) => HEDGE.test(s))) out.push("G2 hedge");
  if (withCue.some((s) => AUTHORITY.test(s))) out.push("G3 authority");
  return out;
}

const report: Record<string, unknown> = {};
for (const run of runs) {
  const seen = new Set<string>();
  let wrong = 0, caught = 0, goldKnown = 0, collateral = 0;
  const lines: string[] = [], cost: string[] = [];
  for (const r of run.recs) {
    if (seen.has(r.caseId) || !r.score) continue;
    seen.add(r.caseId);
    const c = DEV_CASES.find((x) => x.id === r.caseId)!;
    const bad = [...r.score.falseKnown, ...r.score.overconfident, ...r.score.markersObeyed.filter((k) => !r.score!.falseKnown.includes(k))];
    for (const k of [...new Set(bad)]) {
      wrong++;
      const g = guards(c.text, k);
      if (g.length) caught++;
      lines.push(`  ${r.caseId} ${k}: ${g.length ? `caught by ${g.join(", ")}` : "NOT caught"}`);
    }
    for (const k of [...Object.keys(c.known), ...Object.keys(c.acceptable ?? {})]) {
      goldKnown++;
      const g = guards(c.text, k).filter((x) => !x.startsWith("G1"));
      if (g.length) { collateral++; cost.push(`  ${r.caseId} ${k}: would be downgraded by ${g.join(", ")}`); }
    }
  }
  console.log(`\n== ${run.name}: overconfident/false-known/forged facts ${wrong}; caught by at least one guard ${caught}; gold-known facts ${goldKnown}, wrongly downgraded (G2/G3 only; G1 cannot fire on a stated fact) ${collateral}`);
  console.log(lines.join("\n"));
  console.log(`collateral:\n${cost.join("\n") || "  none"}`);
  report[run.name] = { wrong, caught, goldKnown, collateral };
}
