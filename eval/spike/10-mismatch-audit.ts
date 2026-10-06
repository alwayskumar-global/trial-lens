// Phase 1 audit: every LIKELY_MISMATCH in the saved warm e2e run (fixtures/e2e-warm.json; fictional profile).
// For each FAIL: code vs LLM origin, criterion source text, evidence + the profile values behind it.
// Prints to the console only (criterion text is public CT.gov text; not written to docs). No LLM calls.
import { readFileSync } from "node:fs";
import { fx } from "./lib";

interface Fact { key: string; state: string; value?: unknown }
interface Crit { id: string; type: string; text: string; completeness: string; category: string | null; finding: { status: string; evidence: string[]; source: string; guard_downgraded?: boolean }; clause: Node | null }
type Node = { kind: string; [k: string]: unknown };
const snap: { profile: Fact[]; trials: Array<{ nct_id: string; tier: string; flags: string[]; criteria: Crit[] }> } = JSON.parse(readFileSync(fx("e2e-warm"), "utf8"));
const pv = new Map(snap.profile.map((f) => [f.key, f]));
const fmt = (n: Node | null): string => {
  if (!n) return "∅";
  if (n.kind === "atom") return `${n.fact_key} ${n.operator} ${JSON.stringify(n.value)}${n.unit ? " " + n.unit : ""}`;
  if (n.kind === "all" || n.kind === "any") return `${String(n.kind).toUpperCase()}(${(n.children as Node[]).map(fmt).join("; ")})`;
  if (n.kind === "except") return `${fmt(n.base as Node)} EXCEPT(${(n.exceptions as Node[]).map(fmt).join("; ")})`;
  return `${n.kind}:"${String(n.source).slice(0, 50)}"`;
};
console.log("PROFILE (known/uncertain):", snap.profile.map((f) => `${f.key}=${JSON.stringify(f.value)}${f.state === "uncertain" ? "~" : ""}`).join(", "));
const mm = snap.trials.filter((t) => t.tier === "LIKELY_MISMATCH");
console.log(`\n${mm.length} LIKELY_MISMATCH trials of ${snap.trials.length}\n`);
let nFail = 0, code = 0, llm = 0;
mm.forEach((t, ti) => {
  const fails = t.criteria.filter((c) => c.finding.status === "FAIL");
  console.log(`#${ti + 1} ${t.nct_id} flags=[${t.flags}] FAILs=${fails.length}`);
  fails.forEach((c) => {
    nFail++;
    if (c.finding.source === "code") code++;
    else llm++;
    const ev = c.finding.evidence.map((k) => `${k}=${JSON.stringify(pv.get(k)?.value)}${pv.get(k)?.state === "uncertain" ? "(uncertain)" : ""}`).join(", ");
    console.log(`   - [${c.finding.source}] ${c.id.split(":").slice(1).join(":")} (${c.type}, ${c.completeness}, ${c.category})\n       TEXT: ${c.text.replace(/\s+/g, " ").slice(0, 190)}\n       EVIDENCE: ${ev || "(none)"}${c.finding.source === "code" ? `\n       CLAUSE: ${fmt(c.clause)}` : ""}`);
  });
});
console.log(`\nTOTAL FAIL findings ${nFail}: code ${code}, llm ${llm}`);
console.log(`trials with ≥1 code FAIL: ${mm.filter((t) => t.criteria.some((c) => c.finding.status === "FAIL" && c.finding.source === "code")).length}; only-LLM FAILs: ${mm.filter((t) => t.criteria.every((c) => c.finding.status !== "FAIL" || c.finding.source !== "code")).length}`);
