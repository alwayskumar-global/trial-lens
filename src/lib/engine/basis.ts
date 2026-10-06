// Evidence basis for Policy R (src/lib/engine/tier.ts). Pure.
import type { CriterionFinding } from "@/schema/criteria";

/** Every fact key a finding relies on: its own evidence plus the evidence behind each block's applicability. */
export function findingEvidenceKeys(f: CriterionFinding): string[] {
  return [...f.evidence, ...(f.applicability ?? []).flatMap((b) => b.evidence)];
}

/** True when any fact the finding relies on is in the visitor-edited set. */
export function relyOnEdited(f: CriterionFinding, edited: ReadonlySet<string>): boolean {
  return edited.size > 0 && findingEvidenceKeys(f).some((k) => edited.has(k));
}
