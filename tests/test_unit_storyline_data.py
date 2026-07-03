import math, unittest
from build_unit_storyline_data import level_to_color_score, build_storyline

class TestColor(unittest.TestCase):
    def test_level_to_color(self):
        self.assertEqual(level_to_color_score(0.0), 100.0)      # perfect
        self.assertEqual(level_to_color_score(1600.0), 60.0)    # RMS gap 40 -> 60
        self.assertIsNone(level_to_color_score(None))

class TestBuild(unittest.TestCase):
    def _series(self):
        return {"years": [2000, 2001, 2002, 2003, 2004],
                "windows": [{"k": 0, "start": 2000, "end": 2004, "label": "2000-2004"}],
                "units": [
                    {"key": "A · X", "roadbed": "A", "county": "X", "n_segments": 15,
                     "level": [1600.0]*5, "spread": [2.0]*5, "member_windows": [0]},
                    {"key": "B · X", "roadbed": "B", "county": "X", "n_segments": 15,
                     "level": [0.0]*5, "spread": [10.0]*5, "member_windows": [0]}]}

    def test_band_grouped_by_county_and_fields(self):
        sessions = {"windows": [{"k": 0, "sessions": [[0, 1]]}]}
        out = build_storyline(self._series(), sessions)
        self.assertEqual(len(out["roads"]), 1)                 # one county band X
        self.assertEqual(out["roads"][0]["roadbed"], "X")
        segs = out["roads"][0]["segments"]
        self.assertEqual(len(segs), 2)
        w0 = segs[0]["win"][0]
        self.assertEqual(w0["s"], 0)                           # both in session 0
        self.assertEqual(w0["v"], 60.0)                        # unit A: level 1600 -> 60
        self.assertAlmostEqual(w0["sp"], 2.0, places=6)

if __name__ == "__main__":
    unittest.main()
