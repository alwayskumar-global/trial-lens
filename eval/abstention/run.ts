// pnpm exec tsx eval/abstention/run.ts  -> table of expected vs actual (no model, no network). Exit code 1 if any mismatch.
import { CASES } from "./cases";
import { runCase } from "./run-case";

let bad = 0;
for (const c of CASES) {
  const a = runCase(c);
  const miss: string[] = [];
  if (a.status !== c.expected.status) miss.push(`status expected ${c.expected.status} got ${a.status}`);
  if (a.tier !== c.expected.tier) miss.push(`tier expected ${c.expected.tier} got ${a.tier}`);
  if (c.expected.panel !== undefined && JSON.stringify(a.panel) !== JSON.stringify(c.expected.panel)) miss.push(`panel expected ${JSON.stringify(c.expected.panel)} got ${JSON.stringify(a.panel)}`);
  if (miss.length) bad++;
  console.log(`${c.id} ${c.group.padEnd(20)} ${c.layer.padEnd(13)} ${miss.length ? "MISMATCH: " + miss.join("; ") : "match"}`);
}
console.log(`${CASES.length - bad} of ${CASES.length} cases match their pre-written expectations; ${bad} mismatch`);
process.exit(bad ? 1 : 0);
