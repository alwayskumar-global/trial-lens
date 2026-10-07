"""Run: python -m unittest eval/test_criterion_input_validity.py   (synthetic fixtures only; no dataset content)"""
import importlib.util
import json
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("civ", Path(__file__).resolve().parent / "criterion_input_validity.py")
civ = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(civ)

SENT = "SYNTHETIC-SENTINEL-TEXT"


def row(i, ty="exclusion", label="not excluded", text=SENT + " criterion about a made-up condition", note=SENT + " note"):
    return {"annotation_id": i, "criterion_type": ty, "expert_eligibility": label, "criterion_text": text, "note": note}


class Check(unittest.TestCase):
    def test_valid(self):
        self.assertEqual(civ.check_row(row(1)), [])

    def test_each_reason(self):
        self.assertEqual(civ.check_row(row(1, text=None)), ["MISSING_TEXT"])
        self.assertEqual(civ.check_row(row(1, text="   ")), ["MISSING_TEXT"])
        self.assertEqual(civ.check_row(row(1, text="short")), ["TEXT_TOO_SHORT"])
        self.assertEqual(civ.check_row(row(1, text="x" * 2001)), ["TEXT_TOO_LONG"])
        self.assertEqual(civ.check_row(row(1, text="Synthetic exclusion list:")), ["HEADER_ONLY"])
        self.assertEqual(civ.check_row(row(1, ty="other")), ["BAD_TYPE"])
        self.assertEqual(civ.check_row(row(1, label="included")), ["LABEL_TYPE_MISMATCH"])
        self.assertEqual(civ.check_row(row(1, ty="inclusion", label="excluded")), ["LABEL_TYPE_MISMATCH"])
        self.assertEqual(civ.check_row(row(1, label="mystery")), ["UNKNOWN_LABEL"])
        self.assertEqual(civ.check_row(row(1, note=None)), ["MISSING_NOTE"])
        self.assertEqual(civ.check_row(row(1, note="")), ["MISSING_NOTE"])

    def test_either_label_ok_for_both_types(self):
        for ty in civ.TYPES:
            self.assertEqual(civ.check_row(row(1, ty=ty, label="not enough information")), [])


class Assess(unittest.TestCase):
    def rows(self):
        return [row(1, label="excluded"), row(2), row(3, text=None), row(4, label="not applicable"), row(5, ty="inclusion", label="included"), row(6, label="not enough information", note=None)]

    def test_counts_population_and_exclusions(self):
        a = civ.assess(self.rows())
        self.assertEqual(a["population_rows"], 4)  # 1,2,3,6: inclusion row 5 and not-applicable row 4 are outside
        self.assertEqual((a["valid_rows"], a["invalid_rows"]), (2, 2))
        self.assertEqual(a["invalid_by_reason"]["MISSING_TEXT"], 1)
        self.assertEqual(a["invalid_by_reason"]["MISSING_NOTE"], 1)
        self.assertEqual(a["candidates"], 1)
        self.assertEqual(a["verdict"], "PROCEED_TO_RECOMPUTE_STRATA")
        self.assertEqual(a["valid_ids"], [1, 2])

    def test_invalid_candidate_stops_and_is_not_dropped_silently(self):
        a = civ.assess([row(1, label="excluded", text=None), row(2)])
        self.assertEqual(a["verdict"], "STOP_CANDIDATE_INVALID")
        self.assertEqual(a["invalid_candidate_ids"], [1])
        self.assertEqual(a["candidates"], 1)  # still counted as a candidate, not presumed an adjudicated FAIL

    def test_output_never_contains_row_text(self):
        out = json.dumps(civ.assess(self.rows()))
        self.assertNotIn(SENT, out)


if __name__ == "__main__":
    unittest.main()
