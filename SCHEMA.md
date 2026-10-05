# SCHEMA.md — TrialLens

Source of truth for types. Mirror these in `/src/schema` as Zod schemas. The vocabulary is **v0**: refine it in the Phase 1 spike against real breast-cancer trial criteria text (target: ≥ 60% of scoring criteria across ~30 trials map to a typed `fact_key`; if < 40%, expand the vocabulary before building further).

## 1. Fact vocabulary

`askable`: may be asked in the adaptive panel. `ask_cost`: 1 easy · 2 needs a record · 3 needs a recent lab/test.

### Core pack
| fact_key | type | canonical unit / values | askable | ask_cost |
|---|---|---|---|---|
| `age` | number | years | no (from profile) | — |
| `sex` | enum | `female` `male` `other` | no | — |
| `stage` | enum | `0` `I` `II` `III` `IV` (+ substage string optional) | yes | 1 |
| `disease_setting` | enum | `early` `locally_advanced` `metastatic` | yes | 1 |
| `ecog` | enum | `0` `1` `2` `3` `4` | yes | 2 |
| `pregnant` | bool | | yes | 1 |
| `lactating` | bool | | yes | 1 |
| `lvef_percent` | number | % | yes | 3 |
| `anc` | number | ×10⁹/L | yes | 3 |
| `platelets` | number | ×10⁹/L | yes | 3 |
| `hemoglobin` | number | g/dL | yes | 3 |
| `creatinine_clearance` | number | mL/min | yes | 3 |
| `bilirubin_x_uln` | number | multiple of ULN | yes | 3 |
| `ast_alt_x_uln` | number | multiple of ULN | yes | 3 |
| `cardiac_disease` | enum | `none` `history` `active` | yes | 2 |
| `prior_other_malignancy` | bool | | yes | 1 |
| `neuropathy_grade` | enum | `0` `1` `2` `3` `4` | yes | 2 |
| `cns_mets` | enum | `none` `treated_stable` `active` | yes | 2 |
| `measurable_disease` | bool | | yes | 2 |

### Breast-oncology pack
| fact_key | type | values | askable | ask_cost |
|---|---|---|---|---|
| `her2_status` | enum | `positive` `negative` `low` | yes | 1 |
| `er_status` | enum | `positive` `negative` | yes | 1 |
| `pr_status` | enum | `positive` `negative` | yes | 1 |
| `brca_germline` | enum | `positive` `negative` | yes | 2 |
| `pik3ca_mutation` | bool | | yes | 2 |
| `menopausal_status` | enum | `pre` `peri` `post` | yes | 1 |
| `metastatic_line` | number | line of therapy in metastatic setting (0 = none) | yes | 2 |
| `prior_anthracycline` | bool | | yes | 1 |
| `prior_taxane` | bool | | yes | 1 |
| `prior_trastuzumab` | bool | | yes | 1 |
| `prior_adc` | bool | HER2-directed antibody–drug conjugate | yes | 2 |
| `prior_cdk46i` | bool | | yes | 1 |
| `prior_endocrine` | bool | | yes | 1 |
| `prior_chemo_any` | bool | | yes | 1 |
| `prior_radiation` | bool | | yes | 1 |
| `days_since_last_systemic_therapy` | number | days | yes | 2 |

Derived (computed in code, not asked): `tnbc` = `er=negative ∧ pr=negative ∧ her2=negative`.

Anything not mappable → `fact_key: null`, evaluated by the LLM path with `depends_on` listing any vocabulary keys it touches.

## 2. Types (Zod-equivalent TS)

```ts
type FactState = "known" | "unknown" | "uncertain";

interface Fact {
  key: FactKey;                 // from the vocabulary
  state: FactState;
  value?: number | string | boolean;
  note?: string;                // short, user-facing; NOT the raw free text
}

interface PatientProfile {
  facts: Record<FactKey, Fact>; // every vocabulary key present; default state "unknown"
  location?: { lat: number; lon: number; radius_miles: number }; // coarse only
}

type Operator = "eq" | "neq" | "gte" | "lte" | "gt" | "lt" | "in" | "not_in";
type Category =
  | "diagnosis" | "stage" | "biomarker" | "prior_therapy" | "disease_setting"   // core
  | "performance" | "lab" | "organ_function" | "comorbidity" | "demographic"
  | "washout_timing" | "consent_logistics" | "other";

interface ParsedCriterion {
  id: string;                   // `${nct_id}:${inclusion|exclusion}:${index}`
  nct_id: string;
  type: "inclusion" | "exclusion";
  category: Category;
  original_text: string;        // verbatim, never altered
  fact_key: FactKey | null;     // null => free-text / LLM path
  operator?: Operator;
  value?: number | string | boolean | Array<number | string>;
  unit: string | null;          // as written in the source, converted in code; null = absent/ambiguous (evaluator returns UNKNOWN); defaults to null
  depends_on: FactKey[];        // for free-text criteria
  scoring: boolean;             // false for consent_logistics
}

type Status = "PASS" | "FAIL" | "UNKNOWN" | "AMBIGUOUS";

interface CriterionFinding {
  criterion_id: string;
  status: Status;
  evidence: string[];           // fact keys; required for PASS/FAIL (guard enforces)
  rationale: string;            // 1–2 sentences, patient-safe wording
  source: "code" | "llm_mid" | "llm_deep";
  guard_downgraded?: boolean;   // true if PASS/FAIL coerced to UNKNOWN
}

type Tier = "STRONG" | "POSSIBLE" | "UNCERTAIN" | "LIKELY_MISMATCH";

interface TrialAssessment {
  nct_id: string;
  title: string;
  tier: Tier;
  findings: CriterionFinding[];
  verified: boolean;
  verifier_flags: string[];
  sites: Array<{ facility: string; city?: string; distance_miles?: number }>;
  coordinator_questions: string[];
  analysis_failed?: boolean;
}

interface AdaptiveQuestion {
  fact_key: FactKey;
  prompt: string;               // patient-friendly
  answers: Array<{ label: string; value: unknown }>;  // incl. "I don't know"
  affects_trials: number;
  score: number;
}

type SseEvent =
  | { type: "stage"; stage: string; status: "start" | "done" }
  | { type: "counts"; discovered?: number; filtered?: number; analyzed?: number }
  | { type: "trial_result"; assessment: TrialAssessment }
  | { type: "question"; questions: AdaptiveQuestion[] }
  | { type: "done"; replay: boolean }
  | { type: "error"; code: string; message: string; fallback_to_replay: boolean };
```

## 3. Unit normalisation (code only; unit tests required)
Convert source units to canonical before evaluation.
- `anc`, `platelets`: `/mm3`, `/µL`, `/uL`, `cells/mm3` → ÷1000 = ×10⁹/L (e.g. 1500/mm³ = 1.5 ×10⁹/L; 100,000/mm³ = 100 ×10⁹/L)
- `hemoglobin`: g/L → ÷10 = g/dL; mmol/L → ×1.61 (VERIFY factor before shipping)
- `bilirubin_x_uln`, `ast_alt_x_uln`: criteria stated as "× ULN" map directly; absolute values (mg/dL, U/L) → UNKNOWN unless profile supplies the same unit (do not guess ULN)
- `lvef_percent`: % only
- `creatinine_clearance`: mL/min only (mL/min/1.73m² treated as same, noted)
- Ambiguous or missing unit → parser sets `fact_key` but `unit: null`; evaluator returns UNKNOWN.

## 4. Supabase migration (`supabase/migrations/0001_init.sql`)
No patient data. RLS on, **no policies** (service role bypasses RLS; anon/authenticated get nothing).

```sql
create table if not exists trial_criteria_cache (
  nct_id          text        not null,
  source_version  text        not null,   -- CT.gov last-update date string (VERIFY field)
  parser_version  text        not null,
  parsed          jsonb       not null,   -- ParsedCriterion[]
  created_at      timestamptz not null default now(),
  primary key (nct_id, parser_version, source_version)
);

create table if not exists replay_cases (
  id          text primary key,           -- e.g. 'her2pos-stage3'
  label       text        not null,
  profile     jsonb       not null,       -- FICTIONAL profile only
  result      jsonb       not null,       -- full precomputed run output
  created_at  timestamptz not null default now()
);

create table if not exists eval_runs (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  config      jsonb       not null,       -- models, parser_version, thresholds
  metrics     jsonb       not null
);

alter table trial_criteria_cache enable row level security;
alter table replay_cases        enable row level security;
alter table eval_runs           enable row level security;
-- intentionally no policies
```

Cache TTL: trial status and locations change; refetch trial metadata each run (cheap), cache only parsed criteria keyed on `source_version`.

## 5. ClinicalTrials.gov v2 notes
- Base: `https://clinicaltrials.gov/api/v2` (public, no key). Studies endpoint with condition query, `RECRUITING` status filter, pagination. `VERIFY:` exact param names, the field list needed (eligibility text, eligibility min/max age, sex, locations with geo coordinates, last-update date), page size and rate limits.
- Validate every response with Zod; tolerate missing fields; never trust location coordinates to exist.
- Cite source (NCT ID + link) on every trial card.
