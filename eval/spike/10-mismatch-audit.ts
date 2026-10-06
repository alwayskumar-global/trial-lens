// Phase 1 audit: every FAIL candidate in the saved WARM e2e run (fixtures/e2e-warm[-fresh].json; fictional profile).
// Shows: first-pass origin (code vs LLM), criterion source text, evidence + the profile values behind it, and the
// rule-D verifier's verdict/quote/facts and resolved check. Console only; criterion text is public CT.gov text and is
// not written to docs. No LLM calls. Usage: COHORT=original|fresh pnpm exec tsx eval/spike/10-mismatch-audit.ts
import { readFileSync } from "node:fs";
import { COHORT, fx } from "./lib";

interface Fact { key: string; state: string; value?: unknown }
type Node = { kind: string; [k: string]: unknown };
interface Crit { id: string; type: string; text: string; completeness: string; category: string | null; finding: { status: string; evidence: string[]; source: string; fail_check?: string }; clause: Node | null }
interface CheckLog { id: string; origin: string; check: string; verdict: string | null; item: { source_quote: string | null; facts_used: Array<{ key: string; value: unknown }> } | null }
const snap: { profile: Fact[]; failChecks: CheckLog[]; trials: Array<{ nct_id: string; tier: string; flags: string[]; criteria: Crit[] }> } = JSON.parse(readFileSync(fx("e2e-warm"), "utf8"));
const pv = new Map(snap.profile.map((f) => [f.key, f]));
const checks = new Map(snap.failChecks.map((c) => [c.id, c]));
const fmt = (n: Node | null): string => {
  if (!n) return "∅";
  if (n.kind === "atom") return `${n.fact_key} ${n.operator} ${JSON.stringify(n.value)}${n.unit ? " " + n.unit : ""}`;
  if (n.kind === "all" || n.kind === "any") return `${String(n.kind).toUpperCase()}(${(n.children as Node[]).map(fmt).join("; ")})`;
  if (n.kind === "except") return `${fmt(n.base as Node)} EXCEPT(${(n.exceptions as Node[]).map(fmt).join("; ")})`;
  return `${n.kind}:"${String(n.source).slice(0, 50)}"`;
};
console.log(`COHORT=${COHORT}`);
console.log("PROFILE (known/uncertain):", snap.profile.map((f) => `${f.key}=${JSON.stringify(f.value)}${f.state === "uncertain" ? "~" : ""}`).join(", "));
const cand = snap.trials.filter((t) => t.criteria.some((c) => c.finding.status === "FAIL"));
console.log(`\n${cand.length} FAIL-candidate trials of ${snap.trials.length}; final tiers: ${JSON.stringify(snap.trials.reduce<Record<string, number>>((a, t) => ((a[t.tier] = (a[t.tier] ?? 0) + 1), a), {}))}\n`);
const tally = { code: 0, llm: 0 };
const byCheck: Record<string, number> = {};
cand.forEach((t, ti) => {
  const fails = t.criteria.filter((c) => c.finding.status === "FAIL");
  console.log(`#${ti + 1} ${t.nct_id} final=${t.tier} FAILs=${fails.length}`);
  fails.forEach((c) => {
    if (c.finding.source === "code") tally.code++; else tally.llm++;
    byCheck[c.finding.fail_check ?? "none"] = (byCheck[c.finding.fail_check ?? "none"] ?? 0) + 1;
    const ev = c.finding.evidence.map((k) => `${k}=${JSON.stringify(pv.get(k)?.value)}`).join(", ");
    const ck = checks.get(c.id);
    console.log(`   - [${c.finding.source}] ${c.id.split(":").slice(1).join(":")} (${c.type}, ${c.completeness}, ${c.category}) → check=${c.finding.fail_check} verifier=${ck?.verdict ?? "-"}\n       TEXT: ${c.text.replace(/\s+/g, " ").slice(0, 230)}\n       FIRST-PASS EVIDENCE: ${ev || "(none)"}${c.finding.source === "code" ? `\n       CLAUSE: ${fmt(c.clause)}` : ""}${ck?.item ? `\n       VERIFIER QUOTE: ${String(ck.item.source_quote).slice(0, 160)} | FACTS: ${JSON.stringify(ck.item.facts_used)}` : ""}`);
  });
});
console.log(`\nTOTAL FAIL findings ${tally.code + tally.llm}: code ${tally.code}, llm ${tally.llm}; by check: ${JSON.stringify(byCheck)}`);
