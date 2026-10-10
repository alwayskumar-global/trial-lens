"""Run: python -m unittest eval/test_evidence_categories.py"""
import importlib.util
import itertools
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("evidence_categories", Path(__file__).resolve().parent / "evidence_categories.py")
ec = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ec)


class Exhaustive(unittest.TestCase):
    def test_every_combination_has_exactly_one_known_category(self):
        seen = set()
        for call, basis, sent in itertools.product(ec.CALLS, ec.BASES, ec.SENTENCE_STATUS):
            c = ec.derive_category(call, basis, sent)
            self.assertIn(c, ec.CATEGORIES)
            seen.add(c)
        self.assertEqual(seen, set(ec.CATEGORIES))  # and no category is unreachable

    def test_clear_note_supported_call_with_empty_sentences_is_scored_in_its_own_category(self):
        for call in ("PASS", "FAIL"):
            for basis in ("explicit", "inferred"):
                self.assertEqual(ec.derive_category(call, basis, "none_empty_or_null"), "SUPPORTED_BY_NOTE_NO_EXPERT_SENTENCES")
                self.assertEqual(ec.derive_category(call, basis, "unreadable_serialization"), "SUPPORTED_BY_NOTE_SENTENCES_UNREADABLE")

    def test_category_does_not_depend_on_the_call_except_through_basis(self):
        for basis, sent in itertools.product(ec.BASES, ec.SENTENCE_STATUS):
            self.assertEqual(len({ec.derive_category(c, basis, sent) for c in ec.CALLS}), 1)

    def test_precedence(self):
        self.assertEqual(ec.derive_category("PASS", "undetermined", "establish"), "UNDETERMINED_BASIS")
        self.assertEqual(ec.derive_category("UNKNOWN", "absent", "establish"), "ABSENT")
        self.assertEqual(ec.derive_category("UNKNOWN", "partial", "none_empty_or_null"), "PARTIAL_INFORMATION")
        self.assertEqual(ec.derive_category("PASS", "explicit", "related_not_establishing"), "NOTE_SUPPORTED_EXPERT_SENTENCES_NOT_ESTABLISHING")
        self.assertEqual(ec.derive_category("FAIL", "inferred", "unrelated"), "NOTE_SUPPORTED_EXPERT_SENTENCES_NOT_ESTABLISHING")

    def test_rule_breaks_are_flagged_not_hidden(self):
        self.assertTrue(ec.rule_breaks("PASS", "absent"))
        self.assertFalse(ec.rule_breaks("UNKNOWN", "absent"))

    def test_unknown_inputs_rejected(self):
        with self.assertRaises(ValueError):
            ec.derive_category("MAYBE", "explicit", "establish")


if __name__ == "__main__":
    unittest.main()
