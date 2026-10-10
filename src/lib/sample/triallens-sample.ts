// The design's own fictional sample data (ui_kits/triallens/data.jsx), typed. Every trial, site and NCT id is fictional
// and shown with the "Sample data" tag. Nothing here is real, and the UI built on it makes NO network request.
// VERIFY (Phase 2): replace with the real pipeline output; real NCT ids must link to https://clinicaltrials.gov/study/<id>.
import type { CriterionStatus } from "@/components/status/StatusGlyph";
import type { Tier } from "@/components/status/TierBadge";

export const SAMPLE_TEXT =
  "I'm 52 and was diagnosed with stage III HER2-positive breast cancer. I had surgery four months ago and I'm taking trastuzumab. No heart problems that I know of. I live near a mid-sized city and can travel about 100 miles.";

export const DEMO_SAMPLE_NAME = "Stage III, HER2-positive";
export const DEMO_LABEL = "Fixed fictional demo: not your results";
export const DEMO_BANNER = "This demo compares fictional trial criteria with a fictional profile. It can't confirm eligibility. Only a study team can.";

export interface ProfileGroups {
  known: string[];
  unknown: string[];
  uncertain: string[];
}
export const PROFILE: ProfileGroups = {
  known: ["Age 52", "Stage III", "HER2 positive", "Surgery completed", "Trastuzumab", "No known heart disease", "Travel up to 100 miles"],
  unknown: ["Daily activity level (ECOG)", "Heart ultrasound result (LVEF)", "Recent blood counts", "Brain imaging status"],
  uncertain: ["Last HER2 treatment: about four months ago"],
};

export interface WhyLine {
  status: CriterionStatus;
  text: string;
}
export interface SampleTrial {
  id: string;
  n: number;
  title: string;
  short: string;
  tier: Tier;
  phase: string;
  site: string;
  distance: string;
  nct: string;
  unknown?: string;
  reason?: string;
  why: WhyLine[];
}

const named: SampleTrial[] = [
  { id: "t1", n: 1, title: "Antibody-drug conjugate after surgery in HER2-positive breast cancer", short: "ADC after surgery", tier: "uncertain", phase: "Phase 3", site: "Sample Medical Center", distance: "42 miles", nct: "NCT0000001", unknown: "Heart ultrasound result", why: [{ status: "meets", text: "HER2-positive, stage III after surgery" }, { status: "unknown", text: "Heart function (LVEF) not yet known" }, { status: "conflict", text: "Recent trastuzumab timing may matter" }] },
  { id: "t2", n: 2, title: "Adding an oral targeted therapy to standard HER2 treatment", short: "Oral add-on therapy", tier: "possible", phase: "Phase 2", site: "Sample Regional Clinic", distance: "18 miles", nct: "NCT0000002", unknown: "Activity level and blood counts", why: [{ status: "meets", text: "HER2-positive disease" }, { status: "unknown", text: "Activity level (ECOG) not known" }, { status: "unknown", text: "Recent blood counts not known" }] },
  { id: "t3", n: 3, title: "Immunotherapy plus targeted therapy for residual disease", short: "Immunotherapy, residual disease", tier: "uncertain", phase: "Phase 2", site: "Sample University Hospital", distance: "63 miles", nct: "NCT0000003", unknown: "Whether residual disease was found at surgery", why: [{ status: "meets", text: "Age and HER2 status fit" }, { status: "unknown", text: "Residual disease not known" }, { status: "judgment", text: "Prior treatment needs clinical review" }] },
  { id: "t4", n: 4, title: "Treatment de-escalation after complete response", short: "De-escalation", tier: "possible", phase: "Phase 3", site: "Sample Cancer Institute", distance: "77 miles", nct: "NCT0000004", unknown: "Pathology response", why: [{ status: "meets", text: "Stage and HER2 status fit" }, { status: "unknown", text: "Pathology response not known" }, { status: "meets", text: "Within your travel distance" }] },
  { id: "t6", n: 6, title: "Oral maintenance therapy after surgery in HER2-positive disease", short: "Oral maintenance", tier: "possible", phase: "Phase 2", site: "Sample Regional Clinic", distance: "55 miles", nct: "NCT0000006", unknown: "Recent blood counts", why: [{ status: "meets", text: "HER2-positive, post-surgery" }, { status: "unknown", text: "Blood counts not known" }] },
  { id: "t7", n: 7, title: "Extended HER2 therapy after standard treatment", short: "Extended HER2 therapy", tier: "possible", phase: "Phase 3", site: "Sample Medical Center", distance: "88 miles", nct: "NCT0000007", unknown: "Activity level (ECOG)", why: [{ status: "meets", text: "HER2-positive, stage III" }, { status: "unknown", text: "Activity level not known" }] },
  { id: "t8", n: 8, title: "Targeted therapy for high-risk early breast cancer", short: "High-risk early disease", tier: "uncertain", phase: "Phase 2", site: "Sample University Hospital", distance: "71 miles", nct: "NCT0000008", unknown: "Heart ultrasound result", why: [{ status: "meets", text: "Age fits" }, { status: "unknown", text: "Heart function not known" }] },
  { id: "t9", n: 9, title: "Vaccine plus HER2 therapy after surgery", short: "Vaccine plus HER2 therapy", tier: "uncertain", phase: "Phase 2", site: "Sample Cancer Institute", distance: "94 miles", nct: "NCT0000009", unknown: "Time since last HER2 treatment", why: [{ status: "meets", text: "HER2-positive" }, { status: "judgment", text: "Treatment timing needs clinical review" }] },
];
export const TRIALS: readonly SampleTrial[] = named;

export const TIERS: ReadonlyArray<{ k: Tier; n: string }> = [
  { k: "strong", n: "Strong potential match" },
  { k: "possible", n: "Possible match" },
  { k: "uncertain", n: "Uncertain" },
  { k: "mismatch", n: "Likely mismatch" },
];

export interface SampleCriterion {
  status: CriterionStatus;
  name: string;
  original: string;
  plain: string;
  fromInfo: string | null;
}

export function criteriaFor(t: SampleTrial): SampleCriterion[] {
  const base: SampleCriterion[] = [
    { status: "conflict", name: "Prior HER2 therapy", original: "No HER2-directed therapy within 6 months prior to randomization.", plain: "Recent HER2 drugs may matter here. Timing of previous treatment may affect eligibility. Ask the study team.", fromInfo: "Trastuzumab, about 4 months ago" },
    { status: "unknown", name: "Activity level (ECOG)", original: "ECOG performance status 0 to 1.", plain: "You are fully active or can do light work.", fromInfo: null },
    { status: "unknown", name: "Heart function (LVEF)", original: "Left ventricular ejection fraction (LVEF) of 50% or higher by echocardiogram or MUGA.", plain: "A heart ultrasound shows your heart pumps blood well enough.", fromInfo: null },
    { status: "unknown", name: "Brain metastases", original: "No active or untreated brain metastases.", plain: "There are no brain tumors that are growing or untreated.", fromInfo: null },
    { status: "unknown", name: "Blood counts", original: "Adequate hematologic and organ function as defined in the protocol.", plain: "Your blood tests are in a safe range for the study treatment.", fromInfo: null },
    { status: "meets", name: "Age", original: "Age 18 years or older.", plain: "You are an adult.", fromInfo: "52" },
    { status: "meets", name: "HER2-positive disease", original: "Histologically confirmed HER2-positive breast cancer.", plain: "Your cancer tested positive for HER2.", fromInfo: "HER2 positive" },
    { status: "meets", name: "Stage after surgery", original: "Stage II to III disease after definitive surgery.", plain: "Your cancer was stage II or III and you have had surgery.", fromInfo: "Stage III, surgery completed" },
  ];
  if (t.id === "t1") return base;
  return [{ status: "unknown", name: t.unknown ?? "Study requirement", original: "Protocol-defined requirement related to: " + (t.unknown ?? "").toLowerCase() + ".", plain: "The study team checks this at screening.", fromInfo: null }, base[5]!, base[6]!];
}

export const QUESTIONS: readonly string[] = [
  "Does my prior trastuzumab treatment affect eligibility?",
  "Is a recent echocardiogram required to confirm my heart function?",
  "What blood tests would be needed at screening?",
];

export const DETAIL_PLAIN =
  "This sample study tests a new treatment option for people with HER2-positive breast cancer after surgery. Researchers want to learn whether it lowers the chance of the cancer coming back. Participants visit the clinic regularly for treatment and check-ups.";

