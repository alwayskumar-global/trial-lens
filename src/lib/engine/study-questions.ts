// "Questions worth asking the study team" (Option B, approved for the submission demo; docs/adaptive-scope-decision.md). Pure; no LLM.
//
// NOT an adaptive loop: there is no answer step, no re-tiering and no prediction of any tier change. The panel only points at open items.
// Rank = number of DISTINCT STUDIES that have at least one traceable unresolved scoring criterion depending on the topic. Several criteria
// in one study count once. Every study entry carries the NCT id and the original criterion wording, so each item can link to its study and
// show the criterion verbatim. A dependency that cannot be supported is omitted (never guessed): a (criterion, fact) pair is supported only if
//   - the criterion is scoring and its finding is UNKNOWN or AMBIGUOUS,
//   - its parsed clause references the fact (atom fact_key or text-leaf depends_on),
//   - the ORIGINAL wording contains a cue for that fact (strict cues for the noisy keys), and
//   - the visitor's profile does not already hold the fact as known.
// Pregnancy-related and non-askable facts (age, sex) are never offered.
import { CUES } from "@/lib/engine/atom-checks";
import { leaves } from "@/lib/engine/clause";
import type { QuestionTrial } from "@/lib/engine/questions";
import { EXCLUDED_QUESTION_KEYS } from "@/lib/engine/questions";
import { STUDY_QUESTIONS_VERSION } from "@/schema/assessment";
import type { PatientProfile } from "@/schema/profile";
import { VOCABULARY, type FactKey } from "@/schema/vocabulary";

export interface StudyCriterionRef {
  criterion_id: string;
  type: "inclusion" | "exclusion";
  /** original criterion wording, verbatim */
  text: string;
}
export interface StudyRef {
  nct_id: string;
  criteria: StudyCriterionRef[];
}
export interface StudyTeamQuestion {
  fact_key: FactKey;
  topic: string;
  /** distinct studies, NCT id ascending */
  studies: StudyRef[];
  study_count: number;
}

const TOPIC: Partial<Record<FactKey, string>> = {
  stage: "Cancer stage", disease_setting: "Disease setting (early, locally advanced or metastatic)", ecog: "Daily activity level (ECOG performance status)",
  lvef_percent: "Heart ultrasound result (LVEF)", anc: "Neutrophil count (ANC)", platelets: "Platelet count", hemoglobin: "Hemoglobin",
  creatinine_clearance: "Kidney function (creatinine clearance)", bilirubin_x_uln: "Bilirubin", ast_alt_x_uln: "Liver enzymes (AST/ALT)",
  cardiac_disease: "Heart disease", prior_other_malignancy: "Another cancer in the past", neuropathy_grade: "Nerve damage (neuropathy)",
  cns_mets: "Brain or spinal cord metastases", measurable_disease: "Measurable disease on scans", her2_status: "HER2 status",
  er_status: "Estrogen receptor (ER) status", pr_status: "Progesterone receptor (PR) status", brca_germline: "Inherited BRCA status",
  pik3ca_mutation: "PIK3CA mutation", menopausal_status: "Menopausal status", metastatic_line: "Treatment lines for metastatic disease",
  prior_anthracycline: "Earlier anthracycline treatment", prior_taxane: "Earlier taxane treatment", prior_trastuzumab: "Earlier trastuzumab treatment",
  prior_adc: "Earlier antibody-drug conjugate treatment", prior_cdk46i: "Earlier CDK4/6 inhibitor treatment", prior_endocrine: "Earlier hormone (endocrine) therapy",
  prior_chemo_any: "Earlier chemotherapy", prior_radiation: "Earlier radiation", days_since_last_systemic_therapy: "Time since the last systemic treatment",
};

// The shared cue lists are deliberately loose (a gap in coverage is cheap there). For this panel a wrong dependency would be shown to a visitor,
// so the two noisiest keys get narrow cues here. Any key that is neither in CUES nor here is never offered.
const STRICT_CUES: Partial<Record<FactKey, RegExp>> = {
  prior_other_malignancy: /\b(?:other|another|second|prior|previous|additional)\s+(?:primary\s+)?(?:malignanc(?:y|ies)|cancers?|neoplasms?|tumou?rs?)\b|\bhistory of (?:a |an )?(?:other |another )?(?:malignanc(?:y|ies)|cancers?)\b|\bsecond primary\b/i,
  days_since_last_systemic_therapy: /\b(?:washout|within|since|prior to|before|after|last|ago|previous|past)\b[^.;]{0,60}\b(?:chemotherap\w*|systemic|anticancer|anti-cancer|antineoplastic|radiotherap\w*|therap(?:y|ies)|treatment|dose)\b|\b(?:chemotherap\w*|systemic|anticancer|anti-cancer|antineoplastic|radiotherap\w*|therap(?:y|ies)|treatment|dose)\b[^.;]{0,60}\b(?:within|since|prior to|before|after|ago|washout)\b/i,
};
const cueFor = (k: FactKey): RegExp => STRICT_CUES[k] ?? CUES[k];
const NOT_OFFERED: ReadonlySet<string> = new Set<string>([...EXCLUDED_QUESTION_KEYS, ...VOCABULARY.filter((v) => !v.askable).map((v) => v.key)]);

export function studyTeamQuestions(trials: readonly QuestionTrial[], profile: PatientProfile, max = 3): StudyTeamQuestion[] {
  const byKey = new Map<FactKey, Map<string, StudyCriterionRef[]>>();
  for (const t of trials) {
    t.sources.forEach((src, i) => {
      const a = t.assess[i], o = t.outcomes[i];
      if (!a || !o || o.state !== "parsed" || !a.scoring) return;
      if (a.finding.status !== "UNKNOWN" && a.finding.status !== "AMBIGUOUS") return;
      const keys = new Set<FactKey>();
      for (const l of leaves(o.clause)) {
        if (l.kind === "atom") keys.add(l.fact_key);
        else if (l.kind === "text") l.depends_on.forEach((k) => keys.add(k));
      }
      for (const k of keys) {
        if (NOT_OFFERED.has(k) || profile.facts[k]?.state === "known" || !TOPIC[k] || !cueFor(k).test(src.text)) continue;
        const studies = byKey.get(k) ?? new Map<string, StudyCriterionRef[]>();
        const refs = studies.get(src.nct_id) ?? [];
        refs.push({ criterion_id: src.id, type: src.type, text: src.text });
        studies.set(src.nct_id, refs);
        byKey.set(k, studies);
      }
    });
  }
  const items = [...byKey].map(([k, studies]): StudyTeamQuestion => ({
    fact_key: k, topic: TOPIC[k]!, study_count: studies.size,
    studies: [...studies].sort(([x], [y]) => x.localeCompare(y)).map(([nct_id, criteria]) => ({ nct_id, criteria })),
  }));
  return items.sort((a, b) => b.study_count - a.study_count || a.fact_key.localeCompare(b.fact_key)).slice(0, max);
}

/** The `study_questions` SSE event (versioned). Shared by the pipeline and the replay-update script so both build it identically. */
export function buildStudyQuestionsEvent(trials: readonly QuestionTrial[], profile: PatientProfile): { type: "study_questions"; version: typeof STUDY_QUESTIONS_VERSION; questions: StudyTeamQuestion[] } {
  return { type: "study_questions", version: STUDY_QUESTIONS_VERSION, questions: studyTeamQuestions(trials, profile, 3) };
}
