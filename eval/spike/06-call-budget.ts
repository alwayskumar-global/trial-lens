// Phase 1 spike 06: worst-case LLM calls per 30-trial run vs MAX_LLM_CALLS_PER_RUN (no LLM calls).
// Uses real criteria counts from the fixture. Retry = the one validation retry (CLAUDE.md rule 9).
import { getPipelineEnv } from "../../src/lib/env";
import { appendResults, loadFixture, splitCriteria } from "./lib";

const CHUNK = 25; // parse batch size used in 04
const ESCALATION_CAP = 10; // assumed per-run DEEP escalation cap (not yet specified in SPEC)
const SHORTLIST = 10; // assumed shortlisted trials getting plain-language + coordinator prep

const env = getPipelineEnv();
const trials = loadFixture();
const counts = trials.map((t) => splitCriteria(t).length);
const parseChunks = counts.reduce((a, n) => a + Math.max(1, Math.ceil(n / CHUNK)), 0);
const n = trials.length;
const row = (name: string, base: number, withRetry: number) => ({ name, base, withRetry });
const stages = [
  row("Profile extraction (FAST), 1 call", 1, 2),
  row(`Criteria parse (MID), ${parseChunks} chunk calls, UNCACHED`, parseChunks, parseChunks * 2),
  row(`Free-text evaluation (MID), 1 per trial × ${n}`, n, n * 2),
  row(`Verifier (MID/DEEP), STRONG/POSSIBLE only; worst case all ${n}`, n, n * 2),
  row(`DEEP escalation, capped at ${ESCALATION_CAP} (assumed)`, ESCALATION_CAP, ESCALATION_CAP * 2),
  row(`Plain-language + coordinator prep, ${SHORTLIST} shortlisted (assumed)`, SHORTLIST, SHORTLIST * 2),
];
const sum = (k: "base" | "withRetry") => stages.reduce((a, s) => a + s[k], 0);
const warmBase = sum("base") - parseChunks;
const lines = [
  `\n## ${new Date().toISOString()} — 06-call-budget (arithmetic over the real fixture; no LLM calls)\n`,
  `Criteria per trial in fixture: min ${Math.min(...counts)}, median ${[...counts].sort((a, b) => a - b)[Math.floor(n / 2)]}, max ${Math.max(...counts)}; parse batches of ≤${CHUNK}.`,
  "\n| Stage | Calls (no retry) | Calls (every call retries once) |\n|---|---|---|",
  ...stages.map((s) => `| ${s.name} | ${s.base} | ${s.withRetry} |`),
  `| **Total, uncached** | **${sum("base")}** | **${sum("withRetry")}** |`,
  `| Total, parse cache warm | ${warmBase} | ${sum("withRetry") - parseChunks * 2} |`,
  `\n- \`MAX_LLM_CALLS_PER_RUN\` default = ${env.MAX_LLM_CALLS_PER_RUN}. Uncached worst case ${sum("base")} (no retries) exceeds it: **${sum("base") > env.MAX_LLM_CALLS_PER_RUN ? "YES" : "no"}**; warm-cache no-retry total ${warmBase}: ${warmBase > env.MAX_LLM_CALLS_PER_RUN ? "exceeds" : "fits"}.`,
  `- Measured retry rates (02/04): first-attempt invalid ≈ 0–8% single-criterion, 2/34 parse batches; real retries ≈ 5%, not 100%.`,
  `- Consequence for design (decision for founder, not made here): either raise the cap for uncached runs, pre-warm the parse cache for demo trials, or define what is dropped when the cap bites (suggested order: plain-language prep for non-shortlisted → DEEP escalation → verifier on POSSIBLE → verifier on STRONG; never drop typed evaluation or the abstention guard).`,
  `- Measured wall time: 34 parse batches took 133 s at concurrency ${env.LLM_CONCURRENCY} (≈23 s per batch call, large JSON outputs), so an UNCACHED 30-trial run is ≥ 2 min of parsing alone. Warm-cache runs skip it. Implication: pre-parse and cache all demo-candidate trials offline; VERIFY Vercel \`maxDuration\` for the uncached path.`,
];
appendResults(lines.join("\n") + "\n");
console.log(lines.slice(1, 14).join("\n"));
