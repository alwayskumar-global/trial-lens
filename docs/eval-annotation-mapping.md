# Proposed mapping: TrialGPT criterion annotations to TrialLens outcomes, and denominator rules (FOR REVIEW; NOT FROZEN; nothing has been run)

Status: **revision 2, proposal for Kumar's review. It is not frozen.** No model call, no evaluation, no publication claim. The annotation file has not been placed yet (`eval/data/trialgpt-criterion-annotations/` does not exist), so nothing below has been checked against the real file. Phase 1 "Public eval datasets" and Phase 3 "First full eval run" stay open. Related: `docs/eval-datasets.md`, harness `eval/lib/`.

## 1. Sources and what is verified
**Read by me (TrialGPT repository code, https://github.com/ncbi-nlp/TrialGPT, `trialgpt_matching/TrialGPT.py`, `trialgpt_ranking/rank_results.py`):**
- TrialGPT's criterion label vocabulary. Inclusion: `included`, `not included`, `not enough information`, `not applicable`. Exclusion: `excluded`, `not excluded`, `not enough information`, `not applicable` ("excluded" = the patient meets the exclusion criterion; "not excluded" = the reverse).
- A synthetic sentence ("The patient will provide informed consent, and will comply with the trial protocol without any practical issues.") is appended to every note in TrialGPT's matching code.
- TrialGPT's matching instruction: "if the note does not mention a medically important fact, you can assume that the fact is not true for the patient." So TrialGPT's conventions can label a criterion from an absent fact; TrialLens abstains (UNKNOWN) when evidence is absent.
- Criteria are split from the trial text on blank lines and indexed per section.

**Published dataset README, as relayed by Kumar (I cannot open the Hugging Face page from this environment, so I have not read it myself):**
- one file, `data/train-00000-of-00001.parquet`, 1,015 rows (the 1,015 expert-annotated patient-criterion pairs);
- fields named `expert_sentences`, `expert_eligibility` and `training`.
**Still unknown until the file is inspected:** the other column names (patient, trial, criterion identifiers and text, whether model-produced fields are also present), the exact value set and type of `expert_eligibility`, the exact format of `expert_sentences` (sentence ids versus text), the meaning and values of `training`, whether labels are per annotator or one adjudicated label, and the license text. Anything below that depends on these is marked **[needs file]**. `expert_sentences` is used; **model-selected sentences are not used anywhere in this mapping.**

## 2. Names: what each number may be called
- **Agreement under TrialGPT's conventions** (name for direct comparison of a TrialLens finding with `expert_eligibility` after the label mapping in 3). It measures agreement with the expert label under TrialGPT's conventions, which include assuming absent facts are not true. It is **not clinical accuracy and not "TrialLens criterion accuracy"**, and is never labelled so.
- **TrialLens criterion accuracy** may only be said of a result computed on the **separately reviewed evidence-supported subset** (section 4), and even then it is "agreement with expert labels on reviewed rows, synthetic notes, no clinician validation by us", not clinical accuracy.
- Anything from author-created cases is a development result and is never published as a headline.

## 3. Label mapping (convention layer; used for "agreement under TrialGPT's conventions")
TrialLens finding semantics: inclusion criterion, PASS = the patient meets it; exclusion criterion, PASS = the patient is NOT excluded, FAIL = the patient meets the exclusion.

| `expert_eligibility` (verified TrialGPT vocabulary; confirm the dataset uses it **[needs file]**) | Criterion type | Mapped label |
|---|---|---|
| included | inclusion | PASS |
| not included | inclusion | FAIL |
| excluded | exclusion | FAIL |
| not excluded | exclusion | PASS |
| not enough information | either | UNKNOWN |
| not applicable | either | NOT_APPLICABLE (bucket X5, not scored) |

The mapped label says nothing about whether the note actually contains evidence. That is decided in section 4, not here.

## 4. `expert_sentences`, and the separately reviewed evidence-supported subset (ES)
- **A nonempty `expert_sentences` is not automatic proof of PASS/FAIL.** The experts may have selected sentences that are related but do not establish the criterion, or sentences behind "not enough information". **An empty `expert_sentences` is not automatic proof of an unsupported assumption.** It may mean the note holds nothing relevant (a legitimate "not enough information"), that the expert judged from general medical knowledge, or that the field was left empty. So the list is only a *candidate indicator*; it never sets gold by itself.
- **Candidate pool:** rows that survive the exclusions in section 5 and carry a committed label (PASS or FAIL after the mapping) and a nonempty `expert_sentences`. Rows with a committed label and an empty list form a second pool, **"no expert sentences"**, reported separately and never relabelled.
- **Review (separate from this proposal, needs Kumar's approval of the protocol):** a human reviewer reads, locally in gitignored storage, the criterion, the `expert_sentences` and the note, and records one outcome per reviewed row: **SUPPORTED** (the sentences directly establish the premise, gold = the mapped label), **INSUFFICIENT** (sentences exist but do not establish it, gold = UNKNOWN), **ABSENT** (the note holds no relevant information and the label rests on an assumption, gold = UNKNOWN), **UNCLEAR** (excluded and counted). Reviewed pools: the candidate pool, plus a pre-registered random sample (fixed seed, size set before looking) of the "no expert sentences" pool so that empty lists are checked rather than assumed. If a pool is larger than the reviewer can read, the sample size and seed are fixed beforehand and the reported figure is for the sample only.
- **ES = the SUPPORTED rows.** The reviewed decisions are stored as row id plus decision in a gitignored file (no text). ES and the review protocol are reviewed by Kumar before any run; **TrialLens criterion accuracy is computed on ES only.**
- **Unsupported-assumption rate and UNKNOWN detection** are computed on all reviewed rows with gold from the review (INSUFFICIENT and ABSENT count as gold UNKNOWN), never from list emptiness.
- An unreviewed row is never promoted to gold UNKNOWN or to ES.

## 5. Exclusions with a precedence rule (a row falls in exactly one bucket)
Each row is assigned to the **first** matching bucket in this order; counts therefore partition D0 and cannot overlap:
1. **X1 MALFORMED**: required fields missing or unreadable (label, identifiers, criterion text).
2. **X2 TRAINING**: excluded by the training-flag rule in section 6.
3. **X3 UNALIGNED**: no exact normalized-text match to a TrialLens criterion (`splitTrialCriteria`); merged or split criteria included. No fuzzy matching, no relabelling. The alignment rate is reported.
4. **X4 NON-SCORING**: a TrialLens non-scoring criterion (consent/logistics) or a criterion whose only supporting text is TrialGPT's appended consent sentence.
5. **X5 NOT_APPLICABLE**: `expert_eligibility` = not applicable.
6. **X6 CONTESTED**: exists only if the file has per-annotator labels **[needs file]**; otherwise this bucket does not exist.
Remainder = **D_conv**, the rows used for "agreement under TrialGPT's conventions". Identity checked in code later: `D0 = X1 + X2 + X3 + X4 + X5 + X6 + D_conv`. A diagnostic reports how often TrialLens committed PASS/FAIL on X5 rows (it has no not-applicable status); it is not a score.

## 6. The `training` flag (handled before any evaluation)
- First, read the README's definition and count the flag values from the file (aggregates only).
- **Rule:** reported agreement uses only `training == False` rows (held out). `training == True` rows go to X2: counted, **excluded from every reported number**, usable only for development checks of the harness and mapping (no accuracy reported from them). TrialLens prompts, rules and this mapping are never tuned on held-out rows; any change motivated by training rows is logged here.
- If the README defines the flag differently, if no row has `training == False`, or the column is missing, **no agreement figure is reported**, only counts, and the question comes back to Kumar.

## 7. Denominators and rates
D0 = all rows; D_conv as above; ES = reviewed SUPPORTED rows; Reviewed = candidate pool plus the pre-registered sample. Every rate prints numerator and denominator; a zero denominator prints "n/a". Coverage (the share of D_conv that is typed/fully parsed) is printed beside every number, and results are stratified (never pooled) by parse status, criterion type and cohort.
- **Agreement under TrialGPT's conventions** = rows where the TrialLens finding equals the mapped label / D_conv (AMBIGUOUS folds into UNKNOWN).
- **TrialLens criterion accuracy** = same comparison on ES only (the reviewed gold), labelled as in section 2.
- **Unsupported-assumption rate** = committed PASS/FAIL predictions on rows with reviewed gold UNKNOWN / all committed predictions on Reviewed.
- **False-PASS on excluded patients** = exclusion rows with gold FAIL predicted PASS / exclusion rows with gold FAIL (reported separately for D_conv convention gold and for ES).
- **Per-annotator agreement is not calculated** unless the downloaded file really contains per-annotator labels; this proposal no longer reports annotator agreement as a ceiling.
- No claim of beating TrialGPT or any published system; no result is published without Kumar's review.

## 8. Rights and handling (the card's license tag is not assumed to cover everything)
| Part | Status | Rule |
|---|---|---|
| TrialGPT repository code | public domain notice (read) | usable |
| Annotation file (Hugging Face) | license tag **not yet read**; even once read it states rights over the annotations only | read the tag from the README; annotations only |
| Patient notes (SIGIR 2016 from CSIRO; TREC from NIST) | terms **not read**; described by the authors as synthetic | no assumption that the annotation card's license grants rights to them; never commit, publish or paste |
| Trial text (ClinicalTrials.gov) | NLM terms of use apply; not re-read here | never commit; reports carry NCT ids and counts only |
Everything stays in gitignored `eval/data/`. Reviews, reports, logs and docs hold ids and counts only. Sending the notes to a model is a decision for a later separately approved run.

## 9. Placing the file (exactly)
- **File:** `data/train-00000-of-00001.parquet` (1,015 rows) from https://huggingface.co/datasets/ncbi/TrialGPT-Criterion-Annotations
- **Destination:** `eval/data/trialgpt-criterion-annotations/data/train-00000-of-00001.parquet` (inside the checkout; `eval/data/` is gitignored)
- **Command (a machine with access; a public dataset needs no token):**
  `huggingface-cli download ncbi/TrialGPT-Criterion-Annotations data/train-00000-of-00001.parquet README.md --repo-type dataset --local-dir eval/data/trialgpt-criterion-annotations`
  (`README.md` is wanted for the license text and the `training` definition; it holds no patient text.)
- **What I will do once it is there (aggregates only, nothing printed or committed):** record sha256 and size, read the Parquet schema (column names and types) and the row count, count the values of `expert_eligibility` and `training`, count empty versus nonempty `expert_sentences`, and report whether per-annotator labels exist. The sandbox has no Parquet reader installed; I will install one in a scratch environment outside the repo (no change to project dependencies). I will bring the schema findings back and mark each **[needs file]** item resolved or changed in this document, still not frozen. I will not run any evaluation.
