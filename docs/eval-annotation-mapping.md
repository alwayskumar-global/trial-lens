# Proposed mapping: TrialGPT criterion annotations to TrialLens outcomes, and denominator rules (FOR REVIEW; NOT FROZEN; nothing has been run)

Status: **revision 3, proposal for Kumar's review. It is not frozen.** (Rev 3: headline denominator is all independently reviewed scorable rows with each outcome shown separately; the ES-only accuracy and the name "TrialLens criterion accuracy" are retired; the `training` flag is undefined so nothing is called held-out; aggregate-only inspection tooling and a review-protocol draft are added.) No model call, no evaluation, no publication claim. The annotation file has not been placed yet (`eval/data/trialgpt-criterion-annotations/` does not exist), so nothing below has been checked against the real file. Phase 1 "Public eval datasets" and Phase 3 "First full eval run" stay open. Related: `docs/eval-datasets.md`, harness `eval/lib/`.

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
- **Agreement under TrialGPT's conventions**: direct comparison of a TrialLens finding with `expert_eligibility` after the mapping in 3. It includes TrialGPT's convention of assuming absent facts are not true. It is **not clinical accuracy** and is never described as accuracy.
- **Agreement on reviewer-adjudicated rows**: the headline for any reviewed result. It is computed over **all independently reviewed, scorable rows** (outcomes SUPPORTED, INSUFFICIENT and ABSENT; UNCLEAR excluded and counted), with **each outcome's count and agreement shown separately** beside the pooled figure. **A headline is never computed on SUPPORTED rows alone, and SUPPORTED rows are never selected out as "the" result.** The earlier ES-only accuracy and the name "TrialLens criterion accuracy" are retired.
- A claim stronger than "agreement on reviewer-adjudicated rows" (for example accuracy against a clinical standard) needs a suitably qualified clinical review defined in the review protocol (section 10) and approved by Kumar; without it the wording stays as above and says it is not clinical accuracy.
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

## 4. `expert_sentences` and the independently reviewed rows
- **A nonempty `expert_sentences` is not automatic proof of PASS/FAIL.** The experts may have selected related sentences that do not establish the criterion, or sentences behind "not enough information". **An empty `expert_sentences` is not automatic proof of an unsupported assumption.** It may mean the note holds nothing relevant (a legitimate "not enough information"), that the expert judged from general knowledge, or that the field was left empty. The list is only a *candidate indicator* used for stratification and sampling; it never sets gold by itself.
- **Independently reviewed** = at least two reviewers, each blind to the other and to any TrialLens output (protocol in section 10). The review records the reviewers' adjudicated outcome per row: **SUPPORTED** (the note's sentences directly establish the premise; gold = the mapped label), **INSUFFICIENT** (sentences exist but do not establish it; gold = UNKNOWN), **ABSENT** (the note holds no relevant information, so the label rests on an assumption; gold = UNKNOWN), **UNCLEAR** (excluded and counted).
- **Scorable rows** = all reviewed rows with outcome SUPPORTED, INSUFFICIENT or ABSENT. The headline pools them and shows each outcome separately. Pools are stratified by label, criterion type, evidence-list presence and training value; the sampling design is fixed in section 10 before any row text is read.
- An unreviewed row is never promoted to gold UNKNOWN, and a reviewed outcome is never reassigned afterwards.

## 5. Exclusions with a precedence rule (a row falls in exactly one bucket)
Each row is assigned to the **first** matching bucket in this order; counts therefore partition D0 and cannot overlap:
1. **X1 MALFORMED**: required fields missing or unreadable (label, identifiers, criterion text).
2. **X2 TRAINING-EXCLUDED**: exists only if the authors' documentation defines `training` in a way that makes some rows unsuitable for evaluation (section 6); while the meaning is undefined this bucket is empty and the flag is only a stratifier.
3. **X3 UNALIGNED**: no exact normalized-text match to a TrialLens criterion (`splitTrialCriteria`); merged or split criteria included. No fuzzy matching, no relabelling. The alignment rate is reported.
4. **X4 NON-SCORING**: a TrialLens non-scoring criterion (consent/logistics) or a criterion whose only supporting text is TrialGPT's appended consent sentence.
5. **X5 NOT_APPLICABLE**: `expert_eligibility` = not applicable.
6. **X6 CONTESTED**: exists only if the file has per-annotator labels **[needs file]**; otherwise this bucket does not exist.
Remainder = **D_conv**, the rows used for "agreement under TrialGPT's conventions". Identity checked in code later: `D0 = X1 + X2 + X3 + X4 + X5 + X6 + D_conv`. A diagnostic reports how often TrialLens committed PASS/FAIL on X5 rows (it has no not-applicable status); it is not a score.

## 6. The `training` flag (meaning NOT established)
- **Sources checked for a definition (2026-10-07):** the TrialGPT repository README (full text), the code in `trialgpt_matching`, `trialgpt_ranking` and `trialgpt_retrieval`, `requirements.txt`, and the repository file listing: **none mentions a `training` field or flag.** The Nature Communications paper and the Hugging Face card are not reachable from this environment, and Kumar reports that the published README lists `training` without defining it. So the meaning is **unknown**: it could mark rows used to calibrate annotators, to design prompts, or something else.
- **Therefore `training == False` is NOT called held-out, and no number is described as held-out.** Until the authors define it, the flag is a **stratifier only**: counts and per-stratum results are reported for each value, never pooled silently, and never labelled train or test.
- **No tuning on any of these rows:** TrialLens prompts, rules, thresholds and this mapping are not adjusted using any annotation row, regardless of the flag. Any change motivated by looking at rows is logged here and the rows are then reported as development rows.
- **To establish the meaning** (not a blocker for aggregate inspection): the Methods/Data text of the Nature Communications paper on the 1,015 annotations, the full dataset README text around `training`, or an answer from the authors (GitHub issue on ncbi-nlp/TrialGPT or a Hugging Face discussion). If it turns out to mark rows unsuitable for evaluation, those rows move to bucket X2; if it marks a genuine training/held-out split, the held-out rows become a pre-declared stratum and the rule is logged here before use.

## 7. Denominators and rates
D0 = all rows; D_conv = D0 minus the exclusion buckets; Reviewed = rows with an independent, adjudicated review; Scorable = Reviewed rows with outcome SUPPORTED, INSUFFICIENT or ABSENT. Every rate prints numerator and denominator; a zero denominator prints "n/a". Coverage (the share of D_conv that is typed/fully parsed) is printed beside every number, and results are stratified (never pooled across cohorts, criterion types or parse status) as well as shown overall.
- **Agreement under TrialGPT's conventions** = rows where the TrialLens finding equals the mapped label / D_conv (AMBIGUOUS folds into UNKNOWN). Separate figure, separate name.
- **Agreement on reviewer-adjudicated rows (headline)** = Scorable rows where the TrialLens finding equals the reviewed gold / all Scorable rows, **plus the same ratio for each outcome separately** (SUPPORTED, INSUFFICIENT, ABSENT). Both appear together in every table; one is never shown without the other.
- **Unsupported-assumption rate** = committed PASS/FAIL predictions on Scorable rows whose reviewed gold is UNKNOWN (INSUFFICIENT and ABSENT) / all committed predictions on Scorable rows.
- **False-PASS on excluded patients** = exclusion rows with gold FAIL predicted PASS / exclusion rows with gold FAIL, reported separately for the convention gold and the reviewed gold.
- **Reviewer agreement** (between the independent reviewers) is reported with the headline. **Per-annotator agreement of the dataset's experts is not calculated** unless the downloaded file really contains per-annotator labels.
- Sampling note: if the reviewed rows are a sample, the headline is for that sample with its stated size and seed (section 10), not for all 1,015 rows.
- No claim of beating TrialGPT or any published system; no result is published without Kumar's review.

## 8. Rights and handling (the card's license tag is not assumed to cover everything)
| Part | Status | Rule |
|---|---|---|
| TrialGPT repository code | public domain notice (read) | usable |
| Annotation file (Hugging Face) | license tag **not yet read**; even once read it states rights over the annotations only | read the tag from the README; annotations only |
| Patient notes (SIGIR 2016 from CSIRO; TREC from NIST) | terms **not read**; described by the authors as synthetic | no assumption that the annotation card's license grants rights to them; never commit, publish or paste |
| Trial text (ClinicalTrials.gov) | NLM terms of use apply; not re-read here | never commit; reports carry NCT ids and counts only |
Everything stays in gitignored `eval/data/`. Reviews, reports, logs and docs hold ids and counts only. Sending the notes to a model is a decision for a later separately approved run.

## 9. Placing the file and aggregate-only inspection
- **File:** `data/train-00000-of-00001.parquet` (1,015 rows) from https://huggingface.co/datasets/ncbi/TrialGPT-Criterion-Annotations
- **Destination:** `eval/data/trialgpt-criterion-annotations/data/train-00000-of-00001.parquet` (inside the checkout; `eval/data/` is gitignored). **As of this revision the file is not there.**
- **Command (a machine with access; a public dataset needs no token):**
  `huggingface-cli download ncbi/TrialGPT-Criterion-Annotations data/train-00000-of-00001.parquet README.md --repo-type dataset --local-dir eval/data/trialgpt-criterion-annotations`
  (`README.md` is wanted for the license text and the `training` wording; it holds no patient text).
- **Inspection tool (ready, self-tested):** `eval/inspect-annotations.py`, run with `python3 eval/inspect-annotations.py` in a scratch venv with `pyarrow` (not a project dependency). It prints and writes (to gitignored `eval/data/trialgpt-criterion-annotations/schema-aggregates.json`) **only**: sha256 and size, column names and types, row count, null counts, value counts for label-like columns with at most 12 short values, empty versus nonempty counts for `expert_sentences`, whether per-annotator-like columns exist (names only), id-column distinct and duplicate counts, and the **cross-tab label x criterion type x evidence-list presence x training value**. It never prints a row, a note, trial text or criterion text; it refuses to read a file outside `eval/data/`; `--selftest` proves a sentinel note string never reaches the output. If no criterion-type column exists the type is derived from the label vocabulary alone and shown as such (`not enough information` and `not applicable` appear as "either").
- Once the file is there I will run it, report **only the counts**, mark each **[needs file]** item resolved or changed here, and keep this document unfrozen. No evaluation is run.

## 10. Review protocol, draft v0 (for approval BEFORE any row text is read; items that depend on the aggregate counts are pending)
1. **Reviewers and independence.** At least two reviewers per row, working separately, **blind to each other, to any TrialLens output and to `expert_eligibility`**. Reviewers see the criterion, the note and `expert_sentences`.
2. **Qualifications.** For the headline wording "agreement on reviewer-adjudicated rows": reviewers who can read an eligibility criterion and a clinical note, with the project author acceptable as one reviewer (non-clinical wording only). **For any claim beyond that wording, at least one reviewer per row must be a licensed physician, ideally with oncology or trial-screening experience, whose identity and credentials are recorded; the claim is then worded as agreement with that clinical review, still not a validated clinical accuracy.** Kumar names the reviewers (not decided here).
3. **What each reviewer records:** their own call (PASS / FAIL / UNKNOWN, type already applied) and the evidence basis (explicit statement / inference from stated facts / information absent from the note), plus UNCLEAR if the criterion cannot be judged from the note. The outcome (SUPPORTED / INSUFFICIENT / ABSENT / UNCLEAR) is then derived by fixed rules from the adjudicated call, the basis and the mapped expert label: SUPPORTED = adjudicated call equals the mapped label with an explicit or stated-fact basis; INSUFFICIENT = the call is UNKNOWN although the expert label commits, with relevant sentences present; ABSENT = the basis is information absent; UNCLEAR as stated.
4. **Adjudication.** Where the two reviewers differ on call or basis, a third reviewer decides without seeing the first two's reasons; if all three differ the row is UNCLEAR (excluded and counted). Reviewer-to-reviewer agreement is reported (a reviewer statistic, not the dataset annotators').
5. **Sampling.** A fixed integer **seed, to be written into this document before any row text is read** (proposed: `20261030`), over row ids sorted ascending, shuffled with `numpy.random.default_rng(seed)`, stratified by label, criterion type, evidence-list presence and `training` value. **Sample size per stratum: pending the aggregate counts.** Rule: review a whole stratum when it has at most a set number of rows, otherwise a fixed per-stratum n chosen from the counts for a stated interval width and total reviewer hours; strata with an empty evidence list are always sampled (never assumed). The numbers go into this document with the counts, before review.
6. **Handling.** All review work stays local in gitignored storage; decisions are stored as row id plus decision only; no text in logs, reports, commits, PR text or model prompts; no model sees these notes in this protocol.
7. **Not part of this protocol:** running TrialLens, computing any agreement, or publishing anything. Those follow approval of the mapping and this protocol, with a separately approved paid ceiling for any model call.
