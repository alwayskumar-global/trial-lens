# Proposed mapping: TrialGPT criterion annotations to TrialLens outcomes, and denominator rules (FOR REVIEW; nothing has been run)

Status: **proposal for Kumar's review before any evaluation.** No model call, no download of the annotation set (blocked here), no number published. Items stay unticked: Phase 1 "Public eval datasets" and Phase 3 "First full eval run". Related: `docs/eval-datasets.md`, harness `eval/lib/`.

## 1. What is verified and what is not
**Verified (read from the TrialGPT repository code, https://github.com/ncbi-nlp/TrialGPT, `trialgpt_matching/TrialGPT.py` and `trialgpt_ranking/rank_results.py`):** TrialGPT's criterion-level label vocabulary and its conventions.
- Inclusion criteria: `included`, `not included`, `not enough information`, `not applicable`.
- Exclusion criteria: `excluded`, `not excluded`, `not enough information`, `not applicable`. ("excluded" = the patient meets the exclusion criterion and is excluded; "not excluded" = the reverse.)
- Each criterion output is `[reasoning, [relevant sentence ids], label]`; the patient note is sentence-split and numbered, and **a fixed synthetic sentence is appended to every note: "The patient will provide informed consent, and will comply with the trial protocol without any practical issues."**
- **TrialGPT's instruction to the model: "Try to use as less 'not enough information' as possible because if the note does not mention a medically important fact, you can assume that the fact is not true for the patient."** This is the central difference from TrialLens: TrialGPT labels can rest on assuming an absent fact is false; TrialLens abstains (UNKNOWN) when evidence is absent (abstention guard, Rule D).
- Criteria are split from the trial text on blank lines (`parse_criteria`), indexed 0..n per inclusion and exclusion section.

**NOT verified (Hugging Face dataset page blocked here):** the exact files, field names, how the three physicians' labels are stored (per annotator or adjudicated), whether the evidence sentence ids and the explanation-correctness judgements are included, and the dataset card's license text. The mapping below is written against the verified label vocabulary and states which rules need which field; **it must be re-checked against the real schema when the files are provided.** The paper's description (three physicians, 1,015 patient-criterion pairs, criterion label plus evidence plus explanation correctness) is a recollection of the paper's abstract and methods, not read here.

## 2. Mapping to TrialLens gold (`PASS` / `FAIL` / `UNKNOWN` / `NOT_APPLICABLE`, type already applied)
TrialLens finding semantics: for an inclusion criterion PASS = the patient meets it; for an exclusion criterion PASS = the patient is NOT excluded, FAIL = the patient meets the exclusion.

| TrialGPT label | Criterion type | Evidence ids listed? | TrialLens gold (primary, strict view) | Notes |
|---|---|---|---|---|
| included | inclusion | yes | **PASS** | scored |
| included | inclusion | no / field absent | **UNSPLIT** (see 3) | not scored in the primary view |
| not included | inclusion | yes | **FAIL** | scored; TrialLens FAIL still needs the independent check to count as a verified conflict (Policy R2), so FAIL accuracy is about the finding, not the tier |
| not included | inclusion | no | **ASSUMED** (see 3) | the label rests on "absent means not true" |
| excluded | exclusion | yes | **FAIL** | scored |
| excluded | exclusion | no | **UNSPLIT** | |
| not excluded | exclusion | yes | **PASS** | scored |
| not excluded | exclusion | no | **ASSUMED** | the label rests on "absent means not true"; this is the dangerous direction for TrialLens (a false PASS on an exclusion) |
| not enough information | either | any | **UNKNOWN** | scored; this is where TrialLens's abstention is tested |
| not applicable | either | any | **NOT_APPLICABLE** | not scored (3, rule E1) |

## 3. Cases that are excluded or reported separately
The primary view keeps TrialLens's conservative behaviour: **where the note gives no evidence, UNKNOWN is the correct answer and a committed PASS/FAIL is an unsupported assumption.**
- **ASSUMED** (label is a committed negative with no evidence sentence): primary view treats the gold as **UNKNOWN** for the unsupported-assumption rate and for UNKNOWN detection. TrialLens answering UNKNOWN is correct; answering PASS/FAIL counts as an unsupported assumption. A **secondary, clearly labelled "TrialGPT-convention view"** reports agreement with the assumed label; it is never the headline and never mixed into the primary accuracy.
- **UNSPLIT** (dataset has no evidence field, or it cannot be read): all committed negatives (`not included`, `not excluded`) and positives without evidence are put aside as UNSPLIT, counted and reported, and excluded from primary accuracy. Only committed labels that come with a verified evidence field are scored as PASS/FAIL; if no evidence field exists at all, the primary accuracy covers only the `not enough information` (UNKNOWN) rows and the abstention metrics, and says so.
- **NOT_APPLICABLE** (E1): excluded from every denominator; counted; a diagnostic reports how often TrialLens committed PASS/FAIL on them (TrialLens has no not-applicable status).
- **Consent / compliance criteria** (E2): TrialGPT appends the synthetic consent sentence, so these are "included" by construction; TrialLens treats consent as non-scoring (`consent_logistics`). Excluded from scored denominators, counted.
- **Annotator disagreement** (E3, only if per-annotator labels exist): gold = majority; no majority = **CONTESTED**, excluded and counted. Agreement among annotators is reported as the ceiling.
- **Alignment** (E4): TrialGPT's criteria (blank-line split, indexed) must be aligned to TrialLens's own criterion split (`splitTrialCriteria`) by normalized exact text match. Unmatched, merged or split criteria are **UNALIGNED**: excluded and counted, and the alignment rate is reported. No fuzzy matching, no re-labelling.
- **Malformed or empty** rows (E5): excluded and counted.
- **Strata reported separately, never pooled:** by TrialLens parse status (typed and fully parsed / partially parsed text leaf / unresolved) because only a small share of criteria is typed (coverage gate not met), by criterion type (inclusion vs exclusion), and by cohort (SIGIR vs TREC 2021 vs TREC 2022). Breast-cancer slice only if the patients/trials can be identified from the data; otherwise "no breast slice" is stated.
- **Not scored at all:** the explanation-correctness judgements and the TrialGPT rankings (no relation to TrialLens tiers). SIGIR/TREC trial-level labels are **not** pooled with criterion-level results; they only feed the trial-level contingency table (`tierAgreement`).

## 4. Denominators (stated before any run)
| Name | Definition |
|---|---|
| D0 | all annotation rows for the cohort |
| D_excl | rows removed by E1 (NOT_APPLICABLE), E2 (consent), E3 (CONTESTED), E4 (UNALIGNED), E5 (malformed); each count reported |
| D_aligned | D0 minus D_excl |
| D_unsplit / D_assumed | rows put aside as UNSPLIT / ASSUMED (reported, not in the primary accuracy) |
| **D_primary** | D_aligned minus D_unsplit minus D_assumed: rows with gold PASS, FAIL or UNKNOWN backed by evidence (or by "not enough information") |
| **Primary accuracy** | correct / D_primary (AMBIGUOUS predictions fold into UNKNOWN) |
| **Unsupported-assumption rate** | committed PASS/FAIL predictions where the strict gold is UNKNOWN (D_primary UNKNOWN rows plus ASSUMED rows) / all committed predictions on D_primary plus ASSUMED rows |
| **False-PASS on excluded patients** | exclusion rows with gold FAIL predicted PASS / exclusion rows with gold FAIL (D_primary) |
| UNKNOWN detection | precision and recall over D_primary plus ASSUMED rows (gold UNKNOWN includes ASSUMED) |
| Coverage | the share of D_aligned that is typed/fully parsed, reported next to every accuracy so a number is never read as covering the unparsed text |
Every rate prints its numerator and denominator; a zero denominator prints "n/a", never 0 or 100%. Each exclusion count and the alignment rate are published beside the headline table.

## 5. Publication rules
- No headline accuracy from author-created cases (the abstention set is a development check, labelled as such).
- A figure from the public annotations is published only after Kumar reviews the mapping result, with D0, each exclusion count, the strict-view numbers first, scope (which cohorts, how many patients, synthetic notes, no clinician review by us) and the license/rights status. No claim of beating a published system.
- No evaluation run (paid or free) until this mapping is approved and frozen; any later change is logged here with the reason and re-reviewed.

## 6. Rights and data handling (the dataset card's license tag is not assumed to cover everything)
| Part | What we know | Rule |
|---|---|---|
| TrialGPT repository code and its small files | public domain notice (read) | usable |
| Annotation set on Hugging Face (physician labels) | the card's license tag has **not been read here**; even once read, it states the rights of the annotations, not of the material they refer to | check the tag; treat as annotations only |
| Patient notes (SIGIR 2016 from CSIRO; TREC from NIST) | licenses/terms **not read** (hosts blocked); the paper describes them as synthetic | do not assume the annotation card's license grants rights to them; never commit, publish or paste them |
| Trial text (ClinicalTrials.gov) | NLM terms of use apply; not re-read here | never commit; reports carry NCT ids only |
Handling: everything stays in gitignored `eval/data/`; reports and docs contain ids and counts only (the report writer already drops text); no patient note or trial text in commits, logs, PR text or model-provider test fixtures. Sending the public synthetic notes to a model in a later separately approved run is a decision for that run, not assumed here.

## 7. Exactly what to provide (the environment cannot download it)
The annotation repo is at https://huggingface.co/datasets/ncbi/TrialGPT-Criterion-Annotations. **I cannot see its file list, so I will not name a file I have not seen.** Please download the whole dataset snapshot (this avoids guessing names):

- **Destination:** `eval/data/trialgpt-criterion-annotations/` (inside the repo checkout; `eval/data/` is gitignored, verified by `git check-ignore`).
- **Command (on a machine with access; no token is needed for a public dataset):**
  `huggingface-cli download ncbi/TrialGPT-Criterion-Annotations --repo-type dataset --local-dir eval/data/trialgpt-criterion-annotations`
  (or the "Download" / "Files and versions" buttons on the page, keeping the file names and folder structure).
- **Then please send me, as text and without any patient-note or trial text:**
  1. the file list with sizes and sha256 (`cd eval/data/trialgpt-criterion-annotations && find . -type f -not -path './.cache/*' -exec sha256sum {} \; -exec ls -l {} \;`),
  2. the dataset card's license line(s) and any usage terms exactly as shown, and the dataset revision/commit shown under "History",
  3. a **schema-only** printout, for example for a JSON file `python3 -c "import json,sys;d=json.load(open(sys.argv[1]));x=d[0] if isinstance(d,list) else d;print(type(d).__name__,len(d));print({k:type(v).__name__ for k,v in (x.items() if isinstance(x,dict) else [])})" <file>` (and the equivalent for CSV/JSONL: header or first record's keys and value types only).
With those I will fix the loader (`loadCriterionAnnotations` still refuses to guess) and re-check section 3 against the real fields; the mapping and denominators here stay frozen unless the schema forces a change, which I will log and bring back for review.
