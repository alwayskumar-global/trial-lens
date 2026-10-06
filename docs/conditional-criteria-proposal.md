# Proposal for review: conditional criteria ("if A, then B")

**Status: proposal only. The clause schema is NOT changed.** Interim safety net: rule D (every FAIL must be independently verified, and the verifier must establish the condition of applicability), plus the splitter and atom-semantics fixes.

## Problem (Phase 1 audit)
"Women of childbearing potential (aged 15–49 years) must have a negative pregnancy test within 7 days before starting treatment…" was parsed as `ALL(age ≥ 15; age ≤ 49; pregnant = false; timing; text)`. A 52-year-old therefore FAILED the criterion, although it does not apply to her. The schema has `all / any / except` but no implication, so applicability conditions become requirements.

## Proposed semantics
A conditional criterion has an **applicability condition** `when` and a **requirement** `then`.

```
criterion truth  =  ¬when  ∨  then          (Kleene three-valued; "then" = combine(items) AND NOT any(except))
```

| when | then | truth | meaning |
|---|---|---|---|
| true | true | true | applies and met |
| true | false | false | applies and not met |
| true | unknown | unknown | applies, cannot decide |
| false | any | true | **not applicable** (vacuously satisfied) |
| unknown | true | true | met whether or not it applies |
| unknown | false | unknown | cannot tell whether it applies ⇒ **never FAIL** |
| unknown | unknown | unknown | |

Status mapping is unchanged (inclusion: true→PASS, false→FAIL, unknown→UNKNOWN). Two additions:
1. **`applicability`** on the finding: `applies | not_applicable | unknown`, derived in code from `when`. A PASS that is vacuous (`not_applicable`) must cite the known facts that made `when` false as evidence (abstention guard); a vacuous PASS with only unknown facts is downgraded to UNKNOWN.
2. **Inclusion only.** Exclusion statements that read as conditionals ("patients with X who also have Y are excluded") are conjunctions, and "excluded unless Z" is `except`. A `when` on an exclusion criterion is rejected by the batch schema (retry) and, if it persists, downgraded to a `text` leaf.

## Representation (flat parser schema + engine tree)
- Parser output gains optional `when: Leaf[]` (≤ 4 leaves, combined with `all`, default `[]`). Leaves are the existing `atom | text | timing`, each with a verbatim `source` fragment.
- Engine tree gains `{ kind: "if", when: ClauseNode, then: ClauseNode }`.
- Completeness: `full` only if every leaf in `when` **and** `then` is an executable atom; any `text`/`timing` leaf ⇒ `partial`.
- Nested conditionals stay a single `text` leaf (free-text path).
- Cache: clause-schema change ⇒ bump `PARSER_VERSION` and `CLAUSE_PARSE_PROMPT_VERSION`; update the parser and judge prompts.

## What this does not solve (needs a decision)
"Childbearing potential" is not a vocabulary fact. Without it, `when` is a `text` leaf ⇒ unknown, so the criterion for a 52-year-old resolves to `UNKNOWN` (or PASS if the test requirement is met), never FAIL. Deriving `childbearing_potential` from age, sex and menopausal status in code is a **clinical rule** and should be decided by Kumar with clinical input, not inferred.

## Proposed tests (to be written after approval)
| # | Case | Expected |
|---|---|---|
| T1 | WOCBP shape, patient 52 F, `pregnant=false` known, `when` = text leaf, `then` = `pregnant eq false` | PASS (then true ⇒ true), applicability `unknown`, evidence `pregnant` |
| T2 | same, patient `pregnant=true` known | **UNKNOWN, never FAIL** (applicability unknown) |
| T3 | `when` = `age lte 49`, patient age 52, `then` = `pregnant eq false` unknown | PASS, applicability `not_applicable`, evidence `age` |
| T4 | `when` = `age lte 49` true, `then` false | FAIL (still needs rule-D verification to become LIKELY_MISMATCH) |
| T5 | `when` unknown, `then` unknown | UNKNOWN |
| T6 | `when` false, `then` unknown | PASS vacuous, evidence = when-facts |
| T7 | `when` false but supported only by an unknown fact | guard downgrades to UNKNOWN |
| T8 | `when` on an exclusion criterion | batch schema rejects; after retry ⇒ text leaf |
| T9 | **Regression** NCT06627712:inclusion:9 shape `(age 15–49, pregnancy test within 7 days, contraception)` with a 52-year-old | no FAIL |
| T10 | Kleene truth-table property test for `if` over {true,false,unknown}² | matches the table above |
| T11 | `when` leaf `source` not a verbatim fragment | batch rejected |
| T12 | `when` containing a text leaf | completeness `partial`; tier cannot be STRONG |
| T13 | round-trip through `ClauseNodeSchema` | lossless |
| T14 | `except` inside `then` | `¬when ∨ (base ∧ ¬exceptions)` |

## Decisions requested
1. Approve the semantics (`¬when ∨ then`, inclusion only, vacuous PASS needs evidence).
2. Approve adding `applicability` to the finding schema.
3. Decide whether a derived `childbearing_potential` fact is wanted (clinical input needed) or whether `when` stays a text leaf.
