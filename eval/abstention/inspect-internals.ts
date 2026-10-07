// Diagnostic only: shows HOW each typed case was decided (vet status, completeness, evidence, applicability) so a match is not luck.
import { CASES } from "./cases";
import { profileFor } from "./run-case";
import { reconcileBatch, assessCriterion } from "@/lib/engine/reconcile";
for (const c of CASES.filter((x) => x.layer === "typed")) {
  const src = { id: `SYN-${c.id}:${c.type}:0`, nct_id: `SYN-${c.id}`, type: c.type, text: c.text };
  const o = reconcileBatch([src], { criteria: [{ index: 0, ...c.parse! }] } as never)[0]!;
  const a = assessCriterion(src, o, profileFor(c));
  console.log(c.id, o.state === "parsed" ? `vet=${o.vet} completeness=${o.completeness}` : o.reason, `status=${a.finding.status} evidence=${JSON.stringify(a.finding.evidence)}`, a.finding.applicability ? `applic=${JSON.stringify(a.finding.applicability.map((b) => b.state))}` : "");
}
