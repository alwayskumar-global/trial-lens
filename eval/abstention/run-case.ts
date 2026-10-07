// Runs one abstention case through the REAL deterministic engine layers (no model, no network). See cases.ts for the layer definitions.
import { reconcileBatch, assessCriterion, type ParseOutcome, type SourceCriterion } from "@/lib/engine/reconcile";
import { applyAbstentionGuard } from "@/lib/engine/guard";
import { tierTrialCeiled } from "@/lib/engine/tier";
import { studyTeamQuestions } from "@/lib/engine/study-questions";
import type { QuestionTrial } from "@/lib/engine/questions";
import type { Fact, PatientProfile } from "@/schema/profile";
import type { CriterionFinding } from "@/schema/criteria";
import { FACT_KEYS, type FactKey } from "@/schema/vocabulary";
import type { AbstentionCase } from "./cases";

export const TIER_UNKNOWN_THRESHOLD = 3; // the .env.example default

export function profileFor(c: AbstentionCase): PatientProfile {
  const facts = Object.fromEntries(
    FACT_KEYS.map((k): [FactKey, Fact] => [
      k,
      k in c.known ? { key: k, state: "known", value: c.known[k]! } : c.uncertain && k in c.uncertain ? { key: k, state: "uncertain", value: c.uncertain[k]! } : { key: k, state: "unknown" },
    ]),
  ) as Record<FactKey, Fact>;
  return { facts };
}

export interface Actual { status: string; tier: string; panel?: string[]; completeness: string }

export function runCase(c: AbstentionCase): Actual {
  const profile = profileFor(c);
  const src: SourceCriterion = { id: `SYN-${c.id}:${c.type}:0`, nct_id: `SYN-${c.id}`, type: c.type, text: c.text };
  let outcome: ParseOutcome;
  let completeness: string;
  let scoring: boolean;
  let category: AbstentionCase["category"] | null;
  let finding: CriterionFinding;
  if (c.layer === "typed") {
    outcome = reconcileBatch([src], { criteria: [{ index: 0, ...c.parse! }] } as never)[0]!;
    const a = assessCriterion(src, outcome, profile);
    finding = applyAbstentionGuard(a.finding, profile).finding;
    ({ completeness, scoring, category } = a);
  } else {
    outcome = { state: "unresolved", reason: "not_attempted" }; // unused in this layer
    finding = applyAbstentionGuard({ criterion_id: src.id, status: c.finding!.status, evidence: c.finding!.evidence, rationale: "fixture", source: "llm_mid" } as CriterionFinding, profile).finding;
    completeness = "partial"; // a free-text finding comes from a criterion that is not fully parsed
    scoring = c.category !== "consent_logistics";
    category = c.category;
  }
  const t = tierTrialCeiled([{ scoring, category, status: finding.status, completeness: completeness as never, failCheck: undefined }], { unknownThreshold: TIER_UNKNOWN_THRESHOLD, expectedCriteria: 1 });
  const out: Actual = { status: finding.status, tier: t.tier, completeness };
  if (c.expected.panel !== undefined && c.layer === "typed") {
    const trial: QuestionTrial = { sources: [src], outcomes: [outcome], assess: [{ criterion_id: src.id, category, scoring, completeness: completeness as never, finding }], tier: t.tier };
    out.panel = studyTeamQuestions([trial], profile).map((q) => q.fact_key);
  }
  return out;
}
