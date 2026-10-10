// Adaptive question engine (SPEC §5). Pure; no LLM; deterministic.
//
// For each askable fact that is unknown AND blocks a typed criterion in a candidate trial, simulate every possible
// answer (typed re-evaluation + tiering only) and measure how many UNCERTAIN candidates would rise to POSSIBLE. An answer is a
// visitor-supplied fact, so Policy R2 (tier.ts) applies to it like to every other fact: no STRONG and no LIKELY_MISMATCH, ever. A
// counterfactual FAIL also carries no independent check (rule D). So "decisive" means UNCERTAIN → POSSIBLE.
// score = gain / ask_cost. The result is a hint about which answer could sharpen results, not a prediction: the real run re-verifies
// after an answer.
import { leaves } from "@/lib/engine/clause";
import { applyAbstentionGuard } from "@/lib/engine/guard";
import { assessCriterion, type CriterionAssessment, type ParseOutcome, type SourceCriterion } from "@/lib/engine/reconcile";
import { tierTrialCeiled } from "@/lib/engine/tier";
import type { AdaptiveQuestion, Tier } from "@/schema/assessment";
import type { PatientProfile } from "@/schema/profile";
import { VOCABULARY, type FactKey, type VocabularyEntry } from "@/schema/vocabulary";

export interface QuestionTrial {
  sources: readonly SourceCriterion[];
  outcomes: readonly ParseOutcome[];
  assess: readonly CriterionAssessment[];
  tier: Tier;
}

// Plain-language wording for askable facts. VERIFY (Kumar): patient-facing copy; not shown in the fixed demo UI.
const LABELS: Partial<Record<FactKey, string>> = {
  stage: "cancer stage", disease_setting: "disease setting (early, locally advanced or metastatic)", ecog: "daily activity level (ECOG)",
  pregnant: "pregnancy status", lactating: "breastfeeding status", lvef_percent: "most recent heart ultrasound result (LVEF, %)",
  anc: "neutrophil count (ANC)", platelets: "platelet count", hemoglobin: "hemoglobin", creatinine_clearance: "creatinine clearance",
  bilirubin_x_uln: "bilirubin (times upper limit of normal)", ast_alt_x_uln: "liver enzymes AST/ALT (times upper limit of normal)",
  cardiac_disease: "heart disease status", prior_other_malignancy: "another cancer in the past", neuropathy_grade: "nerve damage (neuropathy) grade",
  cns_mets: "brain or spinal cord metastases", measurable_disease: "measurable disease on scans", her2_status: "HER2 status", er_status: "estrogen receptor (ER) status",
  pr_status: "progesterone receptor (PR) status", brca_germline: "inherited BRCA status", pik3ca_mutation: "PIK3CA mutation", menopausal_status: "menopausal status",
  metastatic_line: "number of treatment lines for metastatic disease", prior_anthracycline: "earlier anthracycline treatment", prior_taxane: "earlier taxane treatment",
  prior_trastuzumab: "earlier trastuzumab treatment", prior_adc: "earlier antibody-drug conjugate treatment", prior_cdk46i: "earlier CDK4/6 inhibitor treatment",
  prior_endocrine: "earlier hormone (endocrine) therapy", prior_chemo_any: "earlier chemotherapy", prior_radiation: "earlier radiation",
  days_since_last_systemic_therapy: "days since your last systemic treatment",
};


type Answer = { label: string; value: string | number | boolean | null };

function numericThresholds(trials: readonly QuestionTrial[], key: string): number[] {
  const out = new Set<number>();
  for (const t of trials) {
    for (const o of t.outcomes) {
      if (o.state !== "parsed") continue;
      for (const l of leaves(o.clause)) {
        if (l.kind !== "atom" || l.fact_key !== key) continue;
        const vs = Array.isArray(l.value) ? l.value : [l.value];
        for (const v of vs) if (typeof v === "number" && Number.isFinite(v)) out.add(v);
      }
    }
  }
  return [...out].sort((a, b) => a - b);
}

/** Answer set A(u): bool → both; enum → all values; number → buckets cut at the thresholds that appear in candidates. Always + "I don't know". */
function answerSet(entry: VocabularyEntry, thresholds: readonly number[]): Answer[] {
  const unit = entry.unit ? ` ${entry.unit}` : "";
  let a: Answer[];
  if (entry.type === "bool") a = [{ label: "Yes", value: true }, { label: "No", value: false }];
  else if (entry.type === "enum") a = (entry.values ?? []).map((v) => ({ label: v, value: v }));
  else {
    const T = thresholds;
    // One representative value per bucket: below the lowest cut, then each cut itself (cut ≤ x < next cut).
    // VERIFY: representatives sit on the cut, so strict (gt/lt) boundaries are approximated.
    a = T.length === 0 ? [] : [{ label: `below ${T[0]}${unit}`, value: T[0]! - 1 }, ...T.map((t, i) => ({ label: i + 1 < T.length ? `${t} to below ${T[i + 1]}${unit}` : `${t}${unit} or higher`, value: t }))];
  }
  return a.length === 0 ? [] : [...a, { label: "I don't know", value: null }];
}

/**
 * Never asked until the exact test, timing, contraception and applicability rules are demonstrated by regression cases
 * (Kumar, undated; recorded 2026-10-07). A pregnancy criterion is not a plain yes/no fact: it depends on which test, when, and which contraception rules apply.
 */
export const EXCLUDED_QUESTION_KEYS: readonly string[] = ["pregnant", "lactating"];

export interface KeyLifts {
  entry: VocabularyEntry;
  affecting: QuestionTrial[];
  answers: Array<Answer & { lifted: QuestionTrial[] }>;
}

/**
 * For every askable, unknown fact that blocks a typed criterion: the answer set and, per answer, the UNCERTAIN trials that would rise to
 * POSSIBLE. This is the TYPED-ONLY counterfactual: criteria not decided by the answered fact keep their stored findings, including
 * free-text ones. It is an estimate for ranking and measurement, never the answer path itself: the approved answer path is a full
 * re-evaluation, so a displayed result must never come from this function.
 */
export function answerLifts(allTrials: readonly QuestionTrial[], profile: PatientProfile, unknownThreshold: number): KeyLifts[] {
  const trials = allTrials.filter((t) => t.tier !== "LIKELY_MISMATCH");
  // criteria (per trial) that a typed answer on `key` could decide
  const blocking = (t: QuestionTrial, key: string): number[] =>
    t.outcomes.flatMap((o, i) => (o.state === "parsed" && t.assess[i]?.finding.status === "UNKNOWN" && leaves(o.clause).some((l) => l.kind === "atom" && l.fact_key === key) ? [i] : []));

  const keys = VOCABULARY.filter((v) => v.askable && !EXCLUDED_QUESTION_KEYS.includes(v.key) && profile.facts[v.key as FactKey]?.state === "unknown" && trials.some((t) => blocking(t, v.key).length > 0));

  return keys.flatMap((entry) => {
    const answers = answerSet(entry, numericThresholds(trials, entry.key));
    if (answers.length === 0) return [];
    const affecting = trials.filter((t) => blocking(t, entry.key).length > 0);
    return [{
      entry,
      affecting,
      answers: answers.map((ans) => {
        if (ans.value === null) return { ...ans, lifted: [] }; // "I don't know" changes nothing
        const cf: PatientProfile = { facts: { ...profile.facts, [entry.key]: { key: entry.key, state: "known", value: ans.value } } as PatientProfile["facts"] };
        const lifted = trials.filter((t) => {
          const idx = new Set(blocking(t, entry.key));
          if (idx.size === 0 || t.tier !== "UNCERTAIN") return false;
          const crit = t.assess.map((a, i) => {
            if (!idx.has(i)) return a;
            const re = assessCriterion(t.sources[i]!, t.outcomes[i]!, cf);
            return { ...re, finding: applyAbstentionGuard(re.finding, cf).finding };
          });
          // counterfactual FAILs have no independent check ⇒ UNCERTAIN (rule D); a would-be STRONG is POSSIBLE and a would-be mismatch UNCERTAIN (R2)
          const { tier } = tierTrialCeiled(crit.map((a) => ({ scoring: a.scoring, category: a.category, status: a.finding.status, completeness: a.completeness, failCheck: a.finding.fail_check })), { unknownThreshold, expectedCriteria: t.sources.length });
          return tier === "POSSIBLE";
        });
        return { ...ans, lifted };
      }),
    }];
  });
}

export function computeQuestions(allTrials: readonly QuestionTrial[], profile: PatientProfile, unknownThreshold: number, max = 3): AdaptiveQuestion[] {
  // A question exists only if at least one answer has a measured lift (UNCERTAIN→POSSIBLE). Zero-gain questions are never created, so the
  // UI can never promise a tier change that no answer produces.
  const scored = answerLifts(allTrials, profile, unknownThreshold).filter(({ answers }) => answers.some((a) => a.lifted.length > 0)).map(({ entry, affecting, answers }): AdaptiveQuestion => {
    const gain = answers.reduce((s, a) => s + a.lifted.length, 0) / answers.length;
    const cost = entry.ask_cost ?? 3;
    const label = LABELS[entry.key as FactKey] ?? entry.key.replace(/_/g, " ");
    return { fact_key: entry.key as FactKey, prompt: `Do you know your ${label}?`, answers: answers.map(({ label: l, value }) => ({ label: l, value })), affects_trials: affecting.length, score: gain / cost };
  });
  // deterministic order: score desc, affected trials desc, key asc
  return scored.sort((a, b) => b.score - a.score || b.affects_trials - a.affects_trials || a.fact_key.localeCompare(b.fact_key)).slice(0, max);
}
