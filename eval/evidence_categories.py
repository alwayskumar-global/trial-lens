"""Evidence categories (docs/eval-annotation-mapping.md section 4): derived AFTER adjudication from the adjudicated call, the adjudicated basis and
the expert-sentence status. Pure; no row text. The categories are exhaustive: every combination of inputs maps to exactly one category, and the
category never changes the call."""
CALLS = ("PASS", "FAIL", "UNKNOWN")
BASES = ("explicit", "inferred", "partial", "absent", "undetermined")
# status of the expert sentences for the row: from the inspector's serialization status plus the Step B answer when sentences were shown
SENTENCE_STATUS = ("establish", "related_not_establishing", "unrelated", "none_empty_or_null", "unreadable_serialization")
CATEGORIES = (
    "UNDETERMINED_BASIS",
    "ABSENT",
    "PARTIAL_INFORMATION",
    "SUPPORTED_BY_EXPERT_SENTENCES",
    "SUPPORTED_BY_NOTE_NO_EXPERT_SENTENCES",
    "SUPPORTED_BY_NOTE_SENTENCES_UNREADABLE",
    "NOTE_SUPPORTED_EXPERT_SENTENCES_NOT_ESTABLISHING",
)


def derive_category(call, basis, sentences):
    if call not in CALLS or basis not in BASES or sentences not in SENTENCE_STATUS:
        raise ValueError("unknown input value")
    if basis == "undetermined":
        return "UNDETERMINED_BASIS"
    if basis == "absent":
        return "ABSENT"  # whatever the call: a PASS/FAIL call on this basis breaks the reviewer rule and is counted elsewhere
    if basis == "partial":
        return "PARTIAL_INFORMATION"
    # basis is explicit or inferred
    if sentences == "establish":
        return "SUPPORTED_BY_EXPERT_SENTENCES"
    if sentences == "none_empty_or_null":
        return "SUPPORTED_BY_NOTE_NO_EXPERT_SENTENCES"
    if sentences == "unreadable_serialization":
        return "SUPPORTED_BY_NOTE_SENTENCES_UNREADABLE"
    return "NOTE_SUPPORTED_EXPERT_SENTENCES_NOT_ESTABLISHING"  # related_not_establishing or unrelated


def rule_breaks(call, basis):
    """A committed PASS/FAIL call with basis 'absent' (or 'partial') breaks the reviewer rule; counted and reported, never silently fixed."""
    return call in ("PASS", "FAIL") and basis in ("absent", "partial")
