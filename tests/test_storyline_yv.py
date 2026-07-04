"""Integration test: the storyline data generator emits a per-year `yv`
array on every window entry, consistent with the mean `v`."""
import json, os, subprocess, sys, unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def regenerate(rule):
    subprocess.run([sys.executable, "step17_storyline_data.py", rule],
                   cwd=ROOT, check=True)
    with open(os.path.join(ROOT, f"storyline_data_{rule}.json"), encoding="utf-8") as f:
        return json.load(f)


class TestYv(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = regenerate("hwcounty")

    def _window_len(self, k):
        w = self.data["windows"][k]
        return w["end"] - w["start"] + 1

    def test_every_window_entry_has_yv_of_window_length(self):
        checked = 0
        for road in self.data["roads"]:
            for seg in road["segments"]:
                for w in seg["win"]:
                    self.assertIn("yv", w)
                    self.assertEqual(len(w["yv"]), self._window_len(w["k"]))
                    checked += 1
        self.assertGreater(checked, 0)

    def test_mean_of_nonnull_yv_matches_v(self):
        for road in self.data["roads"]:
            for seg in road["segments"]:
                for w in seg["win"]:
                    vals = [x for x in w["yv"] if x is not None]
                    if not vals:
                        self.assertIsNone(w["v"])
                        continue
                    self.assertAlmostEqual(round(sum(vals) / len(vals), 1),
                                           w["v"], delta=0.15)


if __name__ == "__main__":
    unittest.main()
