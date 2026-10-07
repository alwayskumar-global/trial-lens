"""Criterion-input validity check (docs/eval-annotation-mapping.md section 13). PROPOSAL: tested on synthetic fixtures only; NOT run on the annotation set.

Purpose: before any draw, decide whether each row's own criterion input (original criterion text, criterion type, note, label) is usable for an offline
criterion-level diagnostic. It replaces the earlier current-record alignment stop condition. It judges form only, never clinical meaning. PURE: reports
reason codes, counts and ids; never echoes row text.
"""
INCLUSION_LABELS = frozenset({"included", "not included"})
EXCLUSION_LABELS = frozenset({"excluded", "not excluded"})
EITHER_LABELS = frozenset({"not enough information"})
NOT_APPLICABLE = "not applicable"
TYPES = ("inclusion", "exclusion")
MIN_TEXT, MAX_TEXT, HEADER_MAX = 12, 2000, 60  # proposed thresholds (characters after strip); Kumar may change them before any run
REASONS = ("MISSING_TEXT", "TEXT_TOO_SHORT", "TEXT_TOO_LONG", "HEADER_ONLY", "BAD_TYPE", "LABEL_TYPE_MISMATCH", "MISSING_NOTE", "UNKNOWN_LABEL")


def check_row(row):
    """Reason codes (a sorted list; empty = valid). Not-applicable rows are out of scope, not invalid, and are handled by the caller."""
    r = set()
    text = row.get("criterion_text")
    t = text.strip() if isinstance(text, str) else ""
    if not t:
        r.add("MISSING_TEXT")
    else:
        if len(t) < MIN_TEXT:
            r.add("TEXT_TOO_SHORT")
        if len(t) > MAX_TEXT:
            r.add("TEXT_TOO_LONG")
        if len(t) <= HEADER_MAX and t.endswith(":"):
            r.add("HEADER_ONLY")
    ty, label = row.get("criterion_type"), row.get("expert_eligibility")
    if ty not in TYPES:
        r.add("BAD_TYPE")
    if label not in INCLUSION_LABELS | EXCLUSION_LABELS | EITHER_LABELS | {NOT_APPLICABLE}:
        r.add("UNKNOWN_LABEL")
    elif ty in TYPES and ((ty == "inclusion" and label in EXCLUSION_LABELS) or (ty == "exclusion" and label in INCLUSION_LABELS)):
        r.add("LABEL_TYPE_MISMATCH")
    note = row.get("note")
    if not (isinstance(note, str) and note.strip()):
        r.add("MISSING_NOTE")
    return sorted(r)


def assess(rows, population_type="exclusion", candidate_label="excluded"):
    """Counts and ids only. Population = rows of `population_type` whose label is not 'not applicable'.
    verdict STOP_CANDIDATE_INVALID if any candidate (label == candidate_label) fails: candidates are never dropped silently, the plan returns to Kumar.
    Candidates are labelled candidates, not adjudicated FAILs."""
    pop = [x for x in rows if x.get("criterion_type") == population_type and x.get("expert_eligibility") != NOT_APPLICABLE]
    by_reason = {k: 0 for k in REASONS}
    valid, invalid = [], []
    for x in pop:
        rs = check_row(x)
        for k in rs:
            by_reason[k] += 1
        (invalid if rs else valid).append(x["annotation_id"])
    cand = [x for x in pop if x.get("expert_eligibility") == candidate_label]
    bad_cand = sorted(x["annotation_id"] for x in cand if check_row(x))
    return {
        "population_rows": len(pop), "valid_rows": len(valid), "invalid_rows": len(invalid), "invalid_by_reason": by_reason,
        "candidates": len(cand), "invalid_candidate_ids": bad_cand,
        "verdict": "STOP_CANDIDATE_INVALID" if bad_cand else "PROCEED_TO_RECOMPUTE_STRATA",
        "valid_ids": sorted(valid),
    }
