// OFFLINE, READ-ONLY counts for the evaluate-stage proposal (docs/evaluate-stage-proposal.md): what the stored replays hold from the free-text evaluate stage. Select-only; no model
// call, no write. Counts only.   NODE_USE_ENV_PROXY=1 pnpm exec tsx eval/evaluate-stage-inventory.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { SupabaseReplayStore } from "../src/lib/cache/replay";
import { REPLAY_PROFILES } from "../src/lib/sample/replay-profiles";

const inc = (m: Record<string, number>, k: string, n = 1) => { m[k] = (m[k] ?? 0) + n; };
async function main(): Promise<void> {
  const store = new SupabaseReplayStore();
  const out: Array<Record<string, unknown>> = [];
  for (const p of REPLAY_PROFILES) {
    const c = await store.get(p.id);
    if (!c) throw new Error("stored replay case not available");
    const ts = c.events.flatMap((e) => (e.type === "trial_result" ? [e.assessment] : []));
    const modelRows: Record<string, number> = {}, evalTrials = { n: 0 }, codeFailTrials = { n: 0 }, llmFailTrials = { n: 0 }, openCodeRows = { n: 0 }, trialsAllRowsCode = { n: 0 };
    for (const t of ts) {
      const llm = t.findings.filter((f) => f.source === "llm_mid");
      llm.forEach((f) => inc(modelRows, f.status));
      if (llm.length) evalTrials.n++; else trialsAllRowsCode.n++;
      if (t.findings.some((f) => f.source === "code" && f.status === "FAIL")) codeFailTrials.n++;
      if (llm.some((f) => f.status === "FAIL")) llmFailTrials.n++;
      openCodeRows.n += t.findings.filter((f) => f.source === "code" && (f.status === "UNKNOWN" || f.status === "AMBIGUOUS")).length;
    }
    out.push({ profile: p.id, trials: ts.length, trialsWithModelEvaluatedRows_approxEvaluateCalls: evalTrials.n, modelRowsByStatus: modelRows, trialsWithModelFail: llmFailTrials.n, trialsWithCodeFail: codeFailTrials.n, codeRowsOpen: openCodeRows.n });
  }
  mkdirSync("eval/reports", { recursive: true });
  writeFileSync("eval/reports/evaluate-stage-inventory-offline.json", JSON.stringify({ note: "Counts from the stored fictional replays; read-only; no model calls, no writes.", profiles: out }, null, 1) + "\n");
  console.warn("wrote eval/reports/evaluate-stage-inventory-offline.json");
}
main().then(() => process.exit(0), (e: unknown) => { console.error(`inventory stopped: ${(e as Error)?.message?.slice(0, 200) ?? "unknown"}`); process.exit(1); });
