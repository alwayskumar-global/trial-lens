"""Offline tests for eval/sampling_plan.py (counts and ids only; no data). Run: python -m unittest eval/test_sampling_plan.py"""
import importlib.util
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("sampling_plan", Path(__file__).resolve().parent / "sampling_plan.py")
sp = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(sp)

STRATA = {"a": 400, "b": 250, "c": 120, "d": 60, "e": 14, "f": 9, "g": 30, "h": 0}


class Allocate(unittest.TestCase):
    def test_census_floors_budget_and_caps(self):
        a = sp.allocate(STRATA, 240, empty_keys={"d"})
        self.assertEqual(a["e"], 14)  # census
        self.assertEqual(a["f"], 9)
        self.assertEqual(a["h"], 0)  # empty stratum stays empty
        self.assertGreaterEqual(a["d"], 20)  # empty-evidence floor
        for k in ("a", "b", "c", "g"):
            self.assertGreaterEqual(a[k], 10)
        self.assertTrue(all(a[k] <= STRATA[k] for k in STRATA))
        self.assertLessEqual(sum(a.values()), 240)
        self.assertEqual(sum(a.values()), 240)  # budget fully used when strata can absorb it

    def test_deterministic_and_independent_of_dict_order(self):
        a = sp.allocate(STRATA, 240, empty_keys={"d"})
        b = sp.allocate(dict(reversed(list(STRATA.items()))), 240, empty_keys={"d"})
        self.assertEqual(a, b)

    def test_larger_strata_get_more_but_sublinearly(self):
        a = sp.allocate({"big": 900, "small": 100}, 100)
        self.assertGreater(a["big"], a["small"])
        self.assertLess(a["big"] / a["small"], 9)  # sqrt weighting, not proportional

    def test_budget_too_small_raises_instead_of_shrinking(self):
        with self.assertRaises(ValueError):
            sp.allocate(STRATA, 40)

    def test_never_over_a_stratum_and_stops_when_everything_is_reviewed(self):
        a = sp.allocate({"x": 50, "y": 30}, 500)
        self.assertEqual(a, {"x": 50, "y": 30})

    def test_bad_counts_rejected(self):
        with self.assertRaises(ValueError):
            sp.allocate({"x": -1}, 10)
        with self.assertRaises(ValueError):
            sp.allocate({"x": 1.5}, 10)


class Draw(unittest.TestCase):
    ids = [f"row-{i:04d}" for i in range(200)]

    def test_deterministic_regardless_of_input_order(self):
        a = sp.draw(self.ids, 25, 20261030, "k")
        b = sp.draw(list(reversed(self.ids)), 25, 20261030, "k")
        self.assertEqual(a, b)
        self.assertEqual(len(set(a)), 25)
        self.assertEqual(a, sorted(a))
        self.assertTrue(set(a) <= set(self.ids))

    def test_seed_and_stratum_change_the_draw(self):
        a = sp.draw(self.ids, 25, 20261030, "k")
        self.assertNotEqual(a, sp.draw(self.ids, 25, 20261031, "k"))
        self.assertNotEqual(a, sp.draw(self.ids, 25, 20261030, "other"))

    def test_whole_stratum_when_n_covers_it(self):
        self.assertEqual(sp.draw(["b", "a", "c"], 3, 1, "k"), ["a", "b", "c"])
        self.assertEqual(sp.draw(["b", "a"], 10, 1, "k"), ["a", "b"])

    def test_fixed_expected_output_pins_the_algorithm(self):
        # pinned on the numpy version used when this was written; a change here means the pre-registered draw would change
        self.assertEqual(sp.draw([f"r{i}" for i in range(10)], 3, 20261030, "pin"), ["r3", "r4", "r9"])


class Params(unittest.TestCase):
    def test_proposed_parameters(self):
        self.assertEqual(sp.PARAMS, {"seed": 20261030, "budget": 240, "census_max": 15, "floor": 10, "empty_floor": 20})


if __name__ == "__main__":
    unittest.main()
