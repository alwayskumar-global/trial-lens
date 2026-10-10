// PROPOSAL, NOT WIRED (docs/eval-abstention-set.md, "Fail-closed design"). Pure; no LLM, no I/O.
//
// Rule: a free-text PASS/FAIL becomes UNKNOWN unless the ENTIRE finding has independently provable support. "Independent" means derivable by code from the
// vetted clause tree and the known facts, not from the model's own claim, not from a parser-declared `depends_on`, and not from a loose cue in the wording.
// Support is therefore the code evaluation of the WHOLE criterion (Kleene evaluation of every requirement of the tree): a conjunction needs every conjunct
// established, a disjunction needs one established-true disjunct (or all established-false for the opposite status), and a requirement carried by a text or
// timing leaf is NOT established (code never decides those). A key merely appearing in the wording, or being cited, proves nothing.
import type { ClauseNode, LlmClauseCriterion, LlmLeaf } from "@/schema/clause";
import type { CriterionFinding, Status } from "@/schema/criteria";
import type { PatientProfile } from "@/schema/profile";
import type { FactKey } from "@/schema/vocabulary";
import { atomProblems, evaluateClause, leafToNode, statusFromTruth } from "./clause";
import { vetCriterion, type VetStatus } from "./coverage";
import { CUES } from "./atom-checks";

/** Where a leaf of the vetted criterion came from. Only an executable atom carries authority over a fact key. */
export type LeafOrigin =
  | "executable_atom" // atom that survived vetting AND has no atomProblems (incl. semantic guards): the only leaf whose key may support a finding
  | "atom_rejected_semantic" // atom that survived vetting but fails atomProblems (e.g. pregnancy test, receptor threshold, source does not mention the fact)
  | "atom_rejected_vetting" // atom downgraded to a text leaf by the scope/coverage vetting; `toText` KEEPS its fact_key in depends_on
  | "parser_text" // text leaf as emitted by the parser (its depends_on is a declaration, unverified)
  | "parser_timing"
  | "criterion_rejected"; // the whole criterion was replaced by one text leaf (coverage_failed / when_on_exclusion)

export interface LeafProvenance {
  source: string;
  origin: LeafOrigin;
  /** keys the leaf mentions (fact_key and/or depends_on), kept for display and for the study-team panel only */
  keys: FactKey[];
  /** true only for executable atoms: a rejected atom's retained depends_on never regains authority */
  authoritative: boolean;
}

const flat = (b: LlmClauseCriterion["blocks"][number]): LlmLeaf[] => [...b.when, ...b.items, ...b.except];

/** Provenance of every leaf of a parser output after vetting. Compares the RAW parser output with what the vetting returned. */
export function leafProvenance(original: string, type: "inclusion" | "exclusion", raw: LlmClauseCriterion): { vet: VetStatus; leaves: LeafProvenance[] } {
  const v = vetCriterion(original, type, raw);
  if (v.status === "coverage_failed" || v.status === "when_on_exclusion") {
    return { vet: v.status, leaves: [{ source: original.trim(), origin: "criterion_rejected", keys: [], authoritative: false }] };
  }
  const out: LeafProvenance[] = [];
  v.criterion.blocks.forEach((b, bi) => {
    const rawLeaves = flat(raw.blocks[bi]!);
    flat(b).forEach((l, li) => {
      const r = rawLeaves[li]!;
      const keys = [...new Set([...(l.fact_key ? [l.fact_key] : []), ...l.depends_on])] as FactKey[];
      let origin: LeafOrigin;
      if (r.kind === "atom" && l.kind !== "atom") origin = "atom_rejected_vetting";
      else if (l.kind === "atom") {
        const node = leafToNode(l);
        origin = node.kind === "atom" && atomProblems(node).length === 0 ? "executable_atom" : "atom_rejected_semantic";
      } else origin = l.kind === "timing" ? "parser_timing" : "parser_text";
      out.push({ source: l.source, origin, keys, authoritative: origin === "executable_atom" });
    });
  });
  return { vet: v.status, leaves: out };
}

/** Keys that may support a finding: those of executable atoms only. Retained depends_on of rejected atoms and parser declarations are excluded. */
export const authoritativeKeys = (leaves: readonly LeafProvenance[]): FactKey[] => [...new Set(leaves.filter((l) => l.authoritative).flatMap((l) => l.keys))];

export interface Accepted {
  status: Status;
  evidence: string[];
  accepted: boolean;
  reason: "not_pass_fail" | "code_derived_same_status" | "no_independent_proof";
}

/**
 * Fail-closed acceptance of a free-text finding for one parsed criterion. A PASS/FAIL stands only if the code evaluation of the whole clause reaches the SAME
 * status and every cited key is among the facts that evaluation actually compared. Otherwise UNKNOWN with no evidence.
 */
export function acceptFreeTextFinding(finding: Pick<CriterionFinding, "status" | "evidence">, clause: ClauseNode | null, type: "inclusion" | "exclusion", profile: PatientProfile): Accepted {
  if (finding.status !== "PASS" && finding.status !== "FAIL") return { status: finding.status, evidence: [...finding.evidence], accepted: true, reason: "not_pass_fail" };
  if (clause === null) return { status: "UNKNOWN", evidence: [], accepted: false, reason: "no_independent_proof" }; // an unparsed criterion has nothing to derive from
  const ev = evaluateClause(clause, profile);
  const codeStatus = statusFromTruth(type, ev.truth);
  const supported = codeStatus === finding.status && finding.evidence.length > 0 && finding.evidence.every((k) => (ev.evidence as string[]).includes(k));
  return supported
    ? { status: finding.status, evidence: [...finding.evidence], accepted: true, reason: "code_derived_same_status" }
    : { status: "UNKNOWN", evidence: [], accepted: false, reason: "no_independent_proof" };
}

/** Same wording as the abstention guard's downgrade, so a card reads the same whichever guard produced the UNKNOWN. */
export const NOT_ENOUGH_INFO = "Not enough confirmed information to decide.";

/**
 * The pipeline entry point (stage `evaluate`, after the abstention guard): returns the finding unchanged when accepted, else the same finding as UNKNOWN with no
 * evidence, `guard_downgraded`, and no Rule D state (a downgraded FAIL has nothing to confirm). `source` is kept, as the existing guard keeps it.
 */
export function failClosedFinding(finding: CriterionFinding, clause: ClauseNode | null, type: "inclusion" | "exclusion", profile: PatientProfile): CriterionFinding {
  const r = acceptFreeTextFinding(finding, clause, type, profile);
  if (r.accepted) return finding;
  const { fail_check: _fc, applicability: _ap, ...rest } = finding;
  void _fc; void _ap;
  return { ...rest, status: "UNKNOWN", evidence: [], rationale: NOT_ENOUGH_INFO, guard_downgraded: true };
}

/**
 * RULE FOR TEXT-LEAF KEYS (shown for review; NOT USED by any behavior yet). A text leaf's declared key may be used as a study-team topic only if
 *  (1) the leaf's provenance is `parser_text` (derivable only where the RAW parse is available; a cached outcome cannot tell a rejected atom's text leaf from a
 *      parser text leaf, so cached outcomes never qualify), and
 *  (2) the leaf's OWN source matches a cue for the key (the cue is injected; the shared table is loose, a strict table is needed before use).
 */
export function independentlySupportedTextKeys(leaves: readonly LeafProvenance[], cueFor: (k: FactKey) => RegExp = (k) => CUES[k]): FactKey[] {
  const out = new Set<FactKey>();
  for (const l of leaves) if (l.origin === "parser_text") for (const k of l.keys) if (cueFor(k).test(l.source)) out.add(k);
  return [...out].sort();
}
