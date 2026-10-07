// PROPOSAL, NOT WIRED INTO THE PIPELINE OR THE ABSTENTION GUARD (docs/eval-abstention-set.md, "Relevance check design"). Pure; no LLM, no I/O.
//
// Problem: a free-text PASS/FAIL may cite any fact that is known (the abstention guard only checks known-ness). Restricting citations to the criterion's
// parsed dependencies is not enough by itself, because `depends_on` is DECLARED BY THE PARSER and is not checked against the criterion's wording.
//
// Verification rule (declared AND anchored): a dependency key counts as VERIFIED for a criterion only if the leaf that declares it carries it in
//   (a) depends_on / fact_key (declared by the parser), AND
//   (b) the leaf's own `source` (an exact fragment of the original criterion text; enforced by the batch schema and the vetting) matches that key's cue, AND
//   (c) for an atom leaf, no semantic problem (e.g. the pregnancy-test or receptor-threshold guards).
// The cue is injected (`cueFor`). The default is the shared CUES table, which is LOOSE; it is used here to MEASURE and to illustrate. A production
// version needs a strict, anchored per-key table (as study-questions.ts already does for two noisy keys) before it may gate anything.
import type { ClauseNode, LeafNode } from "@/schema/clause";
import type { FactKey } from "@/schema/vocabulary";
import { CUES, atomSemanticProblems } from "./atom-checks";
import { leaves } from "./clause";

export interface DependencyReport {
  declared: FactKey[];
  verified: FactKey[];
  unverified: FactKey[]; // declared but not supported by the declaring leaf's own source
}

function declaredBy(l: LeafNode): FactKey[] {
  return l.kind === "atom" ? [l.fact_key] : l.depends_on;
}

export function verifyDependencies(clause: ClauseNode, cueFor: (k: FactKey) => RegExp = (k) => CUES[k]): DependencyReport {
  const declared = new Set<FactKey>();
  const verified = new Set<FactKey>();
  for (const l of leaves(clause)) {
    for (const k of declaredBy(l)) {
      declared.add(k);
      const anchored = cueFor(k).test(l.source);
      const clean = l.kind !== "atom" || atomSemanticProblems(l).length === 0;
      if (anchored && clean) verified.add(k);
    }
  }
  const unverified = [...declared].filter((k) => !verified.has(k));
  return { declared: [...declared].sort(), verified: [...verified].sort(), unverified: unverified.sort() };
}

/** True only if every cited key is a verified dependency. An empty citation list is not "relevant". */
export function citesOnlyVerified(evidence: readonly string[], report: DependencyReport): boolean {
  return evidence.length > 0 && evidence.every((k) => (report.verified as readonly string[]).includes(k));
}
