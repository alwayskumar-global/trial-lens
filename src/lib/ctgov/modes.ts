// Candidate-selection modes for live discovery. Dependency-free so env.ts can validate the setting without pulling in the CT.gov client.
// "api-default": the original query with no sort (CT.gov's undocumented default order). The default when CTGOV_SELECTION_MODE is unset.
// "relevance-v1-interventional": sort=@relevance, interventional studies only (API-side filter). Fail-closed (no fallback ordering). No post-fetch drop.
export const SELECTION_MODES = ["api-default", "relevance-v1-interventional"] as const;
export type SelectionMode = (typeof SELECTION_MODES)[number];
export const DEFAULT_SELECTION_MODE: SelectionMode = "api-default";
