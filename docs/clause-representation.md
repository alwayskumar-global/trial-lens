# Clause representation for compound criteria (proposal, implemented in `src/schema/clause.ts` + `src/lib/engine/clause.ts`)

**Problem.** One `fact_key`/operator/value per criterion cannot represent bundled bullets ("ANC ≥ 1500; PLT ≥ 100k; Hb ≥ 9"), alternatives ("HER2-positive or triple-negative"), exceptions ("unless …") or timing windows. Phase 1 measured the judge rejecting 30 of 54 code-valid single-fact parses as *partial*.

**Representation.** A criterion's *condition as written* is a tree. Leaves:
- `atom`: one comparison on one vocabulary fact (`fact_key`, `operator`, `value`, `unit`). Executable in code.
- `text`: unsupported logic, kept verbatim. Free-text/LLM path only.
- `timing`: a time window (`within_last | not_within_last`, amount, days/weeks/months) around an event that is not a vocabulary fact. Never decided in code.

Nodes: `all`, `any`, `except` (`base AND NOT any(exceptions)`). Every leaf carries `source`, an exact fragment of the original text; `original_text` itself is never altered or replaced (CLAUDE.md copy rule). The parser-facing schema is flat (one level of items + one list of exceptions) so a mid-size model can fill it reliably under strict JSON-schema output; deeper nesting must be a single `text` leaf.

**Semantics (code, three-valued Kleene).** Leaf truth ∈ {true,false,unknown}; unknown fact ⇒ unknown; text/timing ⇒ unknown (never decided in code). Status: inclusion true→PASS false→FAIL; exclusion true→FAIL false→PASS; unknown→UNKNOWN. A partial tree can still decide when short-circuiting allows (e.g. `all` with a known-false atom), but is never counted as "typed".

**Completeness (feeds tiering).** `full` = every leaf is an executable atom (valid operator/value/unit, convertible in code) · `partial` = any text/timing leaf or non-executable atom · `unresolved` = no valid parse.

**Safety properties enforced in code/tests.** Batch must return exactly indices 0..n−1; sources must be verbatim fragments (NFKC/whitespace/markdown-insensitive); malformed atom/timing leaves downgrade to `text`; `scoring` is derived (`category !== consent_logistics`), never model output; unresolved criteria are kept as UNKNOWN scoring criteria.

**Not solved.** ~75% of leaves still land on the free-text path because the vocabulary does not cover most real criteria; representation is necessary but not sufficient (see `docs/spike-results.md`).
