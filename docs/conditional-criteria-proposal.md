# Conditional criteria ("if A, then B"): APPROVED design, implemented (revision 3)

**Status: approved by Kumar and implemented** (`src/schema/clause.ts`, `src/lib/engine/{clause,coverage,reconcile,guard}.ts`, parser prompt `spike-4`, checks `cov-1`). Approved: per-block structure; per-block applicability with cited evidence; proven non-applicability from a known-false atom in the criterion's own explicitly scoped, conjunctive `when`; no derived `childbearing_potential`. **Changed in rev 3:** the coverage check (below). Revision 2 corrected revision 1. Interim safety nets already in code: rule D (every FAIL independently verified, applicability must be established), the splitter fix, and the atom-semantics guards, including the new guard that a pregnancy *test* wording cannot be typed as `pregnant` status.

## What revision 1 got wrong
Revision 1's T1 let a 52-year-old with `pregnant = false` reach PASS on the "women of childbearing potential … must have a negative pregnancy test within 7 days … must use contraception" criterion. That is unsound for three reasons:
1. **`pregnant = false` is not evidence of a negative pregnancy test.** The requirement is an actual, recent test result. No vocabulary fact represents it, so it is unrepresented ⇒ UNKNOWN, never PASS.
2. **The seven-day timing and the contraception requirement were dropped** from the "then" side. A representation that loses requirements can only ever over-pass.
3. **Applicability is per requirement, not per bullet.** The test requirement is conditioned on "childbearing potential (aged 15–49)"; the contraception requirement on "reproductive potential" with no age band. One bullet = two conditional blocks. A patient outside the 15–49 band is outside the first block only.

## Principles (all enforced in code or tests)
1. **Every requirement stays represented.** Each requirement in the source is a leaf (`atom | timing | text`) with a verbatim `source`. Nothing is merged away or paraphrased.
2. **Unrepresented requirements stay UNKNOWN.** A `text` or `timing` leaf evaluates to *unknown* in code. A result can only be PASS if every requirement leaf of an applicable block is proven true by known facts.
3. **Vacuous PASS requires proven non-applicability** (below).
4. **No derived facts.** `childbearing_potential` is not derived from age, sex or menopausal status, anywhere. "Women of childbearing potential" is a `text` leaf ⇒ unknown.
5. **A fact is evidence only for what it says.** An atom may stand for a requirement only if the fact means the same thing. `pregnant` (status) ≠ negative pregnancy test (result + timing); `prior_chemo_any` ≠ "systemic therapy within 3 years".

## Representation (proposed; not implemented)
A criterion has one or more **blocks**; the criterion holds only if **every block** holds.

```
block      = { when: Leaf[]  (≤ 4, combined with AND; may be empty = always applies),
               then: Leaf[]  (≤ 6),  combine: "all" | "any",  except: Leaf[] }
criterion  = AND over blocks
```
- Engine tree: `{ kind: "if", when: ClauseNode, then: ClauseNode }`, blocks joined with `all`.
- **`when` is inclusion-only.** Exclusion statements read as conjunctions or `except`. A `when` on an exclusion criterion is rejected by the batch schema (retry) and, if it persists, downgraded to a single `text` leaf.
- Nested conditionals stay a single `text` leaf. Completeness is `full` only if every leaf in every `when` and `then` is an executable atom; otherwise `partial`.
- **Coverage check (code; rev 3, replaces the percentage idea):** there is **no tuned percentage**. Whitespace, list markers, markdown escapes, case and full-width punctuation are normalised; **connectives, negation, exceptions, thresholds and timing are never discarded**. The leaf `source` spans must tile the criterion: every uncovered word must be plain filler (articles, copulas, "must", generic nouns such as "patients") or a connective the block structure justifies (`and` ⇒ same `all` list or different blocks; `or` ⇒ same `any`/`except` list; `unless/except` ⇒ an except leaf; `who/with/if/for` ⇒ a `when` leaf). Any other uncovered word (negation, number, timing, population, modal, noun) fails the criterion. A word cannot be claimed twice; a leaf made only of logic words is rejected; negation inside a text/timing leaf downgrades every atom in its block. **If the parser cannot prove every requirement and its logical scope survived, the WHOLE criterion becomes one text leaf holding the verbatim original ⇒ UNKNOWN.**
- **Atom purity (code):** an executable atom is ONE affirmative proposition. Its source may contain no negation, connective (except an `in`-set "or" or a numeric "between … and"), time window, relative clause or modal, no number the atom does not carry, and no content word the fact, value or unit does not account for (so "Women of childbearing potential" is NOT `sex = female`). The operator must match the comparator words ("over 18" is `gt`; "within 28 days" is `lt/lte`), the unit must literally appear in the source, receptor polarity must match, and a `false`/`neq`/`not_in` assertion (which only negation language could justify) is never executable. A failing atom is downgraded to a text leaf in place.
- Parser/judge prompts and `PARSER_VERSION` change with the schema (cache invalidation).

## Corrected truth table
`w` = truth of `when` (AND of its leaves, Kleene), `r` = truth of the block's requirement (`then` ∧ ¬`except`). Block truth = `¬w ∨ r`. Criterion truth = AND of block truths. Status mapping is the existing inclusion mapping (true→PASS, false→FAIL, unknown→UNKNOWN).

| w | r | block truth | applicability | resulting status, evidence |
|---|---|---|---|---|
| true | true | true | applies | PASS; evidence = known facts proving `w` and `r` |
| true | false | **false** | applies | FAIL candidate (needs a rule-D verified check); evidence = facts proving `w` and `r` false |
| true | unknown | unknown | applies | **UNKNOWN** |
| **false** | any | true (vacuous) | **not_applicable, PROVEN** | PASS only with evidence = the **known facts that made `w` false** (see proof rule) |
| unknown | true | true | unknown | PASS **only if `r` is proven by known facts** (an atom). Never when `r` rests on a text/timing leaf, which cannot be true in code |
| unknown | false | **unknown** | unknown | **UNKNOWN, never FAIL** (cannot tell whether it applies) |
| unknown | unknown | unknown | unknown | **UNKNOWN** |

**Proof rule for non-applicability.** `w` is false only if at least one **atom** leaf in `when` is false from a *known* fact (standard Kleene AND; a `text` leaf contributes *unknown* and never *false*). The false atom must be a condition the criterion itself states (for example the band "aged 15–49"); the engine does not create or infer a `childbearing_potential` fact. A `when` made only of text leaves can never be proven false. The vacuous PASS requires the abstention guard's evidence: the known facts behind the false atom; with none, it is downgraded to UNKNOWN.

**Multi-block rule.** Blocks are evaluated independently, then ANDed. A vacuous PASS for one block never covers another block: the criterion is PASS only if every block is true; FAIL candidate if any block is false; otherwise UNKNOWN.

## Regression cases (written BEFORE implementation; now executable)
Implemented in `src/lib/engine/blocks.test.ts` (truth table, T1/T1b/T1c/T1d/T9, proven non-applicability, T11, guard) and `src/lib/engine/coverage.test.ts` (adversarial rounds 1–4: A1–A32, S1–S4, V1–V4). The table below is the review list that preceded them.
Source: the pregnancy-test bullet seen in the Phase 1 audit (NCT06627712 inclusion shape), quoted by fragment only.

| # | Case | Expected |
|---|---|---|
| **T1** | Parse must preserve **all** requirements as two blocks. Block 1: `when` = [text "Women of childbearing potential", atom `age ≥ 15`, atom `age ≤ 49`], `then` = [text "must have a negative pregnancy test", **timing "within 7 days before starting treatment"**]. Block 2: `when` = [text "Both male and female participants of reproductive potential"], `then` = [text "agree to use effective contraceptive measures during the study period and for 3 months after discontinuation"]. Patient 52 F, `pregnant = false`, `age = 52`. | Block 1: `w` false (age atom, proven), vacuous true, applicability `not_applicable`, evidence `age`. Block 2: `w` unknown, `r` unknown ⇒ unknown. **Criterion: UNKNOWN.** Never PASS (the contraception block is open) and never FAIL |
| T1b | Same, patient 30 F, `pregnant = false` | Block 1 `w` unknown (text leaf), `r` unknown (test and timing unrepresented). **UNKNOWN. `pregnant = false` is not evidence of a negative test** |
| T1c | Same, patient 30 F, `pregnant = true` | UNKNOWN (no FAIL derived: the test result and timing are unrepresented) |
| **T9** | Regression of NCT06627712:inclusion:9: the original parse `ALL(age ≥ 15; age ≤ 49; pregnant = false; timing; text)` must be impossible: (a) the age band lives in `when`, (b) `pregnant` atom is rejected by the guard because the source says "pregnancy test", (c) the 7-day timing and the contraception sentence are present as leaves; with a 52-year-old the criterion never FAILs and never PASSes | UNKNOWN; leaf `source`s: test sentence, "within 7 days before starting treatment", contraception sentence, all verbatim |
| T2 | Coverage: the parser returns only block 1 (drops the contraception sentence) | coverage check fails ⇒ whole criterion = one `text` leaf ⇒ UNKNOWN |
| T3 | `when` = [atom `age ≤ 49`], patient 52, single block, `then` = [text] | PASS, `not_applicable`, evidence `age` (the only proven-vacuous case) |
| T4 | `when` = [atom `age ≤ 49`] true, `then` = atom false | FAIL candidate (becomes LIKELY_MISMATCH only after a rule-D check) |
| T5 | `when` = [text only] | `w` unknown ⇒ never vacuous; UNKNOWN unless `r` proven by an atom |
| T6 | `when` unknown, `then` = atom true (known fact genuinely proving the requirement) | PASS, applicability `unknown`, evidence = the `then` fact |
| T7 | Guard: vacuous PASS whose false atom rests on an unknown fact | impossible by construction; test asserts UNKNOWN |
| T8 | `when` on an exclusion criterion | batch schema rejects; after retry ⇒ text leaf |
| T10 | Kleene property test over `{true,false,unknown}²` for block truth, and AND over blocks | matches the table above |
| T11 | Anti-HER2 conditional (NCT06623396 shape): "Patients with HER2-positive disease must have received ≥1 line of anti-HER2 therapy". Block: `when` = [atom `her2_status = positive`], `then` = [text or atom for anti-HER2 therapy] | patient HER2-negative ⇒ `w` false (known) ⇒ **PASS vacuous, evidence `her2_status`** (was a false code FAIL); patient HER2-positive, therapy unknown ⇒ UNKNOWN; HER2-positive and proven no anti-HER2 therapy ⇒ FAIL candidate |
| T12 | Splitter (NCT07694986 shape): the pregnancy-test bullet sits in the inclusion section | typed inclusion, never exclusion (covered by `split.test.ts`) |
| T13 | `when` leaf `source` not a verbatim fragment | batch rejected |
| T14 | Completeness: any text/timing leaf in any block | `partial`; trial cannot be STRONG |
| T15 | Tier: vacuous PASS in block 1 and UNKNOWN in block 2 | criterion UNKNOWN counts as an open criterion |
| T16 | Rule-D interplay (LLM-level, measured on development data, not a unit test): verifier given a conditional FAIL whose applicability is unknown | expected `cannot_substantiate` |
| T17 | `except` inside `then` | block truth `¬w ∨ (base ∧ ¬exceptions)` |
| T18 | Round trip through `ClauseNodeSchema` | lossless |

## Decisions requested
1. Approve the corrected semantics and the per-block structure.
2. **Non-applicability from the criterion's own stated band** (my recommendation: yes, via Kleene AND with an atom, as in T1/T3/T11) versus the stricter alternative (vacuous PASS only when *every* `when` leaf is an atom). Under the strict option T1 block 1 stays unknown (its `when` contains a text leaf) and T1 is UNKNOWN either way; T11 (a single-atom `when`) is unaffected. The cost of strict is more UNKNOWN on bullets whose applicability mixes a text phrase with a stated band.
3. Add `applicability` (per block) to the finding schema.
4. Coverage-check threshold (tune on development data, freeze, then measure on an untouched cohort).
5. `childbearing_potential` stays **not derived**. If a derived fact is ever wanted, it is a clinical rule to be specified by Kumar, not inferred by the engine.
