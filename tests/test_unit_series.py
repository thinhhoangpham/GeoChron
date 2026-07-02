import math, unittest
from build_unit_series import level_of, spread_of, build_units

class TestUnitSeriesMath(unittest.TestCase):
    def test_level_penalizes_bad_segments_harder(self):
        # all-fair (60) vs mixed good(80)+very-poor(20), same mean score
        all_fair = level_of([60.0] * 10)
        mixed = level_of([80.0] * 5 + [20.0] * 5)
        self.assertAlmostEqual(all_fair, 1600.0, places=6)   # (100-60)^2
        self.assertAlmostEqual(mixed, 3400.0, places=6)      # (400*5+6400*5)/10
        self.assertGreater(mixed, all_fair)

    def test_level_excludes_invalid_and_handles_empty(self):
        self.assertAlmostEqual(level_of([90.0, 0.5, 90.0]), 100.0, places=6)  # 0.5 dropped
        self.assertTrue(math.isnan(level_of([0.5, 0.0])))

    def test_spread_uniform_vs_mixed(self):
        self.assertAlmostEqual(spread_of([85.0] * 6), 0.0, places=6)
        self.assertGreater(spread_of([95, 95, 95, 75, 75, 75]), 9.0)

    def test_spread_single_is_zero_empty_is_nan(self):
        self.assertEqual(spread_of([70.0]), 0.0)
        self.assertTrue(math.isnan(spread_of([])))

class TestBuildUnits(unittest.TestCase):
    def _meta(self, n, roadbed, county):
        return {f"s{i}": (roadbed, county) for i in range(n)}

    def test_small_unit_dropped_and_key_format(self):
        years = [2000, 2001]
        rows = {f"s{i}": [80.0, 70.0] for i in range(15)}
        meta = self._meta(15, "SH0240", "Tarrant")
        out = build_units(rows, list(rows), years, meta)
        self.assertEqual(len(out["units"]), 1)
        self.assertEqual(out["units"][0]["key"], "SH0240 · Tarrant")
        self.assertEqual(out["units"][0]["n_segments"], 15)
        # a 14-segment unit is dropped
        rows14 = {f"s{i}": [80.0, 70.0] for i in range(14)}
        out14 = build_units(rows14, list(rows14), years, self._meta(14, "X", "Y"))
        self.assertEqual(out14["units"], [])

    def test_year_gap_is_none(self):
        years = [2000, 2001]
        rows = {f"s{i}": [80.0, None] for i in range(15)}   # nobody observed 2001
        meta = self._meta(15, "SH0240", "Tarrant")
        u = build_units(rows, list(rows), years, meta)["units"][0]
        self.assertIsNotNone(u["level"][0])
        self.assertIsNone(u["level"][1])
        self.assertIsNone(u["spread"][1])

if __name__ == "__main__":
    unittest.main()
