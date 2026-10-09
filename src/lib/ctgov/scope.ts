// Scope of one CT.gov study relative to the breast-cancer search (pure; no network).
export type ScopeClass = "breast_specific" | "breast_with_other" | "no_breast_signal";

export interface ScopeInput { mesh: readonly string[]; ancestors: readonly string[]; conditions: readonly string[]; studyType: string | undefined }

const isBreastTerm = (t: string): boolean => /breast|mammary|\bTNBC\b|\bHER2\b/i.test(t);

/**
 * A "breast signal" is a breast MeSH term/ancestor OR a breast term in the free-text condition list (new studies often have no MeSH mapping yet,
 * so MeSH alone would call them out of scope).
 *  breast_specific   a breast signal and no non-breast MeSH condition term
 *  breast_with_other a breast signal AND at least one non-breast MeSH condition term (basket / pan-tumour / comorbidity)
 *  no_breast_signal  neither a breast MeSH term/ancestor nor a breast condition string
 */
export function classifyScope(s: ScopeInput): ScopeClass {
  const signal = s.mesh.some(isBreastTerm) || s.ancestors.some((a) => /^Breast (Neoplasms|Diseases)$/i.test(a)) || s.conditions.some(isBreastTerm);
  if (!signal) return "no_breast_signal";
  return s.mesh.some((m) => !isBreastTerm(m)) ? "breast_with_other" : "breast_specific";
}
