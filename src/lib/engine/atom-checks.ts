// Deterministic semantic guards on typed atoms. The LLM may emit a well-formed atom whose fact_key is
// unrelated to the text it cites (Phase 1: PD-L1 → prior_endocrine; HIV → prior_other_malignancy) or whose
// threshold language the vocabulary cannot express (ER/PR "≤10%" ≠ "negative"; HER2 IHC/ISH scoring).
// A failing atom is NOT executable: it is treated as a text leaf (free-text path) ⇒ criterion `partial`.
// Conservative by design: a lexical miss only costs coverage, never creates a false PASS/FAIL.
import type { AtomNode } from "@/schema/clause";
import type { FactKey } from "@/schema/vocabulary";

// Lexical cues: the atom's `source` fragment must match at least one for its fact_key.
// VERIFY: cue lists are English-only and tuned on the Phase 1 cohort; widen on evidence, not by feel.
const CUES: Record<FactKey, RegExp> = {
  age: /\bage\b|\baged\b|\byears?\b|\byrs?\b|\bolder\b|\badults?\b/i,
  sex: /\b(?:males?|females?|men|women|woman|man|sex|gender)\b/i,
  stage: /\bstage\b|\bAJCC\b|\bTNM\b|\b[cpy]?T[0-4x]|\bM[01]\b|\bN[0-3x]/i,
  disease_setting: /metasta|advanced|\bearly\b|locally|recurren|unresectable|neoadjuvant|adjuvant|\b[em]BC\b|\bLABC\b|stage\s*iv/i,
  ecog: /ecog|eastern cooperative|performance status|karnofsky|\bkps\b|\bPS\b|\bwho\b/i,
  pregnant: /pregnan|childbearing|child-bearing|reproductive|gestat/i,
  lactating: /lactat|breast.?feed|nursing/i,
  lvef_percent: /lvef|ejection fraction|\bEF\b|left ventricular/i,
  anc: /\banc\b|neutrophil|granulocyte/i,
  platelets: /platelet|\bplt\b|thrombocyt/i,
  hemoglobin: /hemoglobin|haemoglobin|\bhb\b|\bhgb\b/i,
  creatinine_clearance: /creatinine|clearance|\bcrcl\b|\bgfr\b|renal function|kidney/i,
  bilirubin_x_uln: /bilirubin/i,
  ast_alt_x_uln: /\bast\b|\balt\b|aminotransferase|transaminase|sgot|sgpt/i,
  cardiac_disease: /cardiac|cardio|heart|myocard|arrhythm|angina|\bchf\b|qtc?|ventricular|coronary|infarct/i,
  prior_other_malignancy: /malignan|cancer|neoplas|carcinoma|tumou?r|second primary|other primary/i,
  neuropathy_grade: /neuropath/i,
  cns_mets: /brain|\bcns\b|central nervous|leptomeningeal|spinal|intracranial/i,
  measurable_disease: /measurable|recist|target lesion|\blesions?\b/i,
  her2_status: /her-?2|erbb2/i,
  er_status: /\ber\b|\ber[+-]|estrogen|oestrogen|hormone receptor|\bhr\b|\ber\/p/i,
  pr_status: /\bpr\b|\bpgr\b|\bpr[+-]|progesterone|hormone receptor|\bhr\b|\ber\/p/i,
  brca_germline: /brca|germline/i,
  pik3ca_mutation: /pik3ca|pi3k/i,
  menopausal_status: /menopaus|ovarian suppression/i,
  metastatic_line: /\blines?\b|regimens?|metastatic setting|therapy for metastatic|treatment for metastatic/i,
  prior_anthracycline: /anthracycl|doxorubicin|epirubicin|adriamycin/i,
  prior_taxane: /taxane|paclitaxel|docetaxel|abraxane/i,
  prior_trastuzumab: /trastuzumab|herceptin|pertuzumab|her2[- ]targeted|anti-her2/i,
  prior_adc: /antibody.?drug|\badc\b|t-?dm1|deruxtecan|emtansine|sacituzumab|datopotamab|kadcyla|enhertu/i,
  prior_cdk46i: /cdk\s*4|cdk\s*6|palbociclib|ribociclib|abemaciclib|cdk inhibitor/i,
  prior_endocrine: /endocrine|hormon(?:e|al) therapy|tamoxifen|aromatase|letrozole|anastrozole|exemestane|fulvestrant|\bSERD\b|ovarian (?:suppression|ablation)/i,
  prior_chemo_any: /chemo|cytotoxic|systemic|antineoplastic|anti-?cancer|regimen/i,
  prior_radiation: /radiat|radiotherap|\bRT\b|brachy/i,
  days_since_last_systemic_therapy: /(?:chemo|systemic|therapy|treatment|dose|regimen|anti-?cancer|antineoplastic|radiotherap)/i,
};

// Receptor threshold / scoring language the vocabulary cannot express.
const RECEPTOR_THRESHOLD = /[<≤>≥=]\\?[<>=]?\s*\d+(?:\.\d+)?\s*%|\b\d+(?:\.\d+)?\s*%\s*(?:of\s+)?(?:tumou?r\s+)?(?:cells?|staining|nuclei)|\b(?:low|ER-low|PR-low)\b/i;
const HER2_SCORING = /\b(?:IHC|ISH|FISH|SISH|CISH)\b|\b[0-3]\s*\+|\bHER2[- ]low\b|overexpress|amplif/i;
// "evaluable" disease is not "measurable" disease (judge-flagged false-full in Phase 1).
const EVALUABLE_NOT_MEASURABLE = /\bevaluable\b/i;
const MEASURABLE = /\bmeasurable\b/i;

// A pregnancy TEST result/procedure is not pregnancy STATUS: `pregnant = false` is not evidence of a negative test
// (nor of its timing). Such sources stay on the text/timing path.
const PREGNANCY_TEST = /\b(?:tests?|testing|tested|hcg|urine|serum|screening)\b/i;

export function atomSemanticProblems(a: Pick<AtomNode, "fact_key" | "source">): string[] {
  const p: string[] = [];
  if (!CUES[a.fact_key].test(a.source)) p.push("source_does_not_mention_fact");
  if ((a.fact_key === "er_status" || a.fact_key === "pr_status") && RECEPTOR_THRESHOLD.test(a.source)) p.push("receptor_threshold_semantics");
  if (a.fact_key === "her2_status" && HER2_SCORING.test(a.source)) p.push("her2_scoring_semantics");
  if (a.fact_key === "pregnant" && PREGNANCY_TEST.test(a.source)) p.push("pregnancy_test_is_not_pregnancy_status");
  if (a.fact_key === "measurable_disease" && EVALUABLE_NOT_MEASURABLE.test(a.source) && !MEASURABLE.test(a.source)) p.push("evaluable_is_not_measurable");
  return p;
}
