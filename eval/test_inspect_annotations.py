"""Offline tests for eval/inspect-annotations.py (stdlib unittest + pyarrow; no network, no model, no real data).
Run (scratch venv with pyarrow):  python -m unittest eval/test_inspect_annotations.py
Fictional sentinel text is used to prove no row text reaches the output."""
import contextlib
import importlib.util
import io
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

import pyarrow as pa

SPEC = importlib.util.spec_from_file_location("inspect_annotations", Path(__file__).resolve().parent / "inspect-annotations.py")
ia = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ia)

SENTINEL = "SENTINEL-NOTE the patient denies chest pain"


class Classify(unittest.TestCase):
    def test_empty_forms(self):
        for v in ["", "   ", "[]", " [ ] ", "[\n]", "\t[]\n"]:
            self.assertEqual(ia.classify_serialized(v), "empty", repr(v))

    def test_null(self):
        self.assertEqual(ia.classify_serialized(None), "null")

    def test_nonempty_recognised_forms(self):
        for v in ["[1]", "[1, 2, 3]", '["a"]', "['a', 'b']", "[0]", f'["{SENTINEL}"]', '[1, "2"]']:
            self.assertEqual(ia.classify_serialized(v), "nonempty", repr(v))

    def test_unrecognised_is_unknown_not_guessed(self):
        for v in [SENTINEL, "1, 2, 3", "none", "null", "N/A", "[1,", "{\"a\": 1}", '[""]', '["  "]', "[[1], [2]]", "[true]", "[None]", "[1] extra", "(1, 2)", "[" + "x" * 5 + "]"]:
            self.assertEqual(ia.classify_serialized(v), "unknown-serialization", repr(v))

    def test_non_string_is_unknown(self):
        self.assertEqual(ia.classify_serialized(5), "unknown-serialization")

    def test_shape_hint_contains_no_text(self):
        hint = ia.shape_of_unknown(SENTINEL)
        self.assertNotIn("SENTINEL", hint)
        self.assertEqual(hint, "first:other last:other len:<=200")
        self.assertEqual(ia.shape_of_unknown('["' + "x" * 300 + '"'), "first:[ last:\" len:>200")


class Tables(unittest.TestCase):
    def table(self, sentences):
        n = len(sentences)
        return pa.table({
            "patient_id": [f"p{i}" for i in range(n)],
            "trial_id": [f"NCT0000000{i}" for i in range(n)],
            "criterion_text": [SENTINEL] * n,
            "expert_sentences": sentences,
            "expert_eligibility": ["included", "not included", "excluded", "not excluded", "not enough information", "not applicable"][:n],
            "training": [True, False] * (n // 2) + ([True] if n % 2 else []),
        })

    def test_string_column_counts_and_no_text(self):
        t = self.table(["[]", "[1, 2]", SENTINEL, None, "", "[\"" + SENTINEL + "\"]"])
        res = ia.inspect_table(t, {"synthetic": True})
        self.assertEqual(res["evidence_presence"], {"empty": 2, "nonempty": 2, "unknown-serialization": 1, "null": 1})
        self.assertEqual(res["evidence_unknown_serialization_shapes"], {"first:other last:other len:<=200": 1})
        self.assertEqual(res["evidence_column_arrow_type"], "string")
        text = json.dumps(res)
        self.assertNotIn("SENTINEL", text)
        self.assertEqual(sum(r["n"] for r in res["crosstab_label_type_evidence_training"]), 6)
        # the cross-tab never invents 'empty' for an unknown serialization
        unk = [r for r in res["crosstab_label_type_evidence_training"] if r["evidence"] == "unknown-serialization"]
        self.assertEqual(sum(r["n"] for r in unk), 1)

    def test_bracket_empty_string_counts_as_empty_not_nonempty(self):
        res = ia.inspect_table(self.table(["[]"] * 4), {})
        self.assertEqual(res["evidence_presence"], {"empty": 4})

    def test_native_list_column_still_supported(self):
        t = self.table([[1], [], [1, 2], None])
        res = ia.inspect_table(t, {})
        self.assertEqual(res["evidence_presence"], {"nonempty": 2, "empty": 1, "null": 1})

    def test_other_text_columns_are_withheld(self):
        res = ia.inspect_table(self.table(["[]"] * 3), {})
        self.assertEqual(res["value_counts"]["criterion_text"]["values"], "withheld")

    def test_selftest_runs_without_leaking(self):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            ia.selftest()
        self.assertNotIn("SENTINEL", buf.getvalue())


class Paths(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name).resolve() / "checkout"
        (self.root / "eval" / "data" / "d" / "data").mkdir(parents=True)
        (self.root / "other").mkdir()
        (self.root / ".gitignore").write_text("eval/data/\n")
        subprocess.run(["git", "init", "-q", str(self.root)], check=True)
        self.f = self.root / "eval" / "data" / "d" / "data" / "x.parquet"
        self.f.write_bytes(b"x")
        (self.root / "other" / "y.parquet").write_bytes(b"y")

    def tearDown(self):
        self.tmp.cleanup()

    def test_inside_ignored_ok_and_relative_is_checkout_relative(self):
        self.assertEqual(ia.resolve_inside_data(self.f, root=self.root), self.f)
        cwd = os.getcwd()
        try:
            os.chdir(tempfile.gettempdir())  # a different working directory
            self.assertEqual(ia.resolve_inside_data("eval/data/d/data/x.parquet", root=self.root), self.f)
        finally:
            os.chdir(cwd)

    def test_outside_refused(self):
        with self.assertRaises(SystemExit):
            ia.resolve_inside_data(self.root / "other" / "y.parquet", root=self.root)
        with self.assertRaises(SystemExit):
            ia.resolve_inside_data("../other/y.parquet", root=self.root)
        with self.assertRaises(SystemExit):
            ia.resolve_inside_data("/etc/passwd", root=self.root)

    def test_other_checkout_with_same_relative_name_refused(self):
        other = Path(self.tmp.name).resolve() / "other-checkout" / "eval" / "data"
        other.mkdir(parents=True)
        (other / "z.parquet").write_bytes(b"z")
        with self.assertRaises(SystemExit):
            ia.resolve_inside_data(other / "z.parquet", root=self.root)

    def test_symlink_escape_refused(self):
        link = self.root / "eval" / "data" / "d" / "data" / "link.parquet"
        link.symlink_to(self.root / "other" / "y.parquet")
        with self.assertRaises(SystemExit):
            ia.resolve_inside_data(link, root=self.root)

    def test_inside_but_not_gitignored_refused(self):
        (self.root / ".gitignore").write_text("")
        with self.assertRaises(SystemExit):
            ia.resolve_inside_data(self.f, root=self.root)

    def test_missing_file_refused_without_reading(self):
        with self.assertRaises(SystemExit):
            ia.resolve_inside_data(self.root / "eval" / "data" / "d" / "data" / "nope.parquet", root=self.root)

    def test_output_path_inside_data_and_never_through_a_symlink(self):
        out = ia.output_path_for(self.f, root=self.root)
        self.assertEqual(out, self.root / "eval" / "data" / "d" / ia.OUT_NAME)
        (self.root / "eval" / "data" / "d" / ia.OUT_NAME).symlink_to(self.root / "other" / "y.parquet")
        with self.assertRaises(SystemExit):
            ia.output_path_for(self.f, root=self.root)

    def test_output_dir_symlink_escape_refused(self):
        evil = self.root / "eval" / "data" / "e"
        (evil).mkdir()
        (evil / "data").symlink_to(self.root / "other")  # eval/data/e/data -> other/
        f = evil / "data" / "y.parquet"
        with self.assertRaises(SystemExit):
            ia.resolve_inside_data(f, root=self.root)  # resolves to other/y.parquet: outside


if __name__ == "__main__":
    unittest.main()
