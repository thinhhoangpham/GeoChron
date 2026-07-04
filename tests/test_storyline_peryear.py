"""Integration test: the per-year storyline generator relabels each of
windows_W5.json's centered 5-year windows to its middle year, assigns each
segment its OWN raw score at that year (not the window mean), and matches
the exact wire schema storyline_peryear.js/evolens.js expect (no "yv",
start == end == label == the middle year)."""
import csv, json, os, subprocess, sys, unittest
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def regenerate(rule):
    subprocess.run([sys.executable, "step17_storyline_peryear.py", rule],
                    cwd=ROOT, check=True)
    with open(os.path.join(ROOT, f"storyline_data_peryear_{rule}.json"), encoding="utf-8") as f:
        return json.load(f)


def load_windows_w5():
    with open(os.path.join(ROOT, "windows_W5.json"), encoding="utf-8") as f:
        return json.load(f)


def load_matrix():
    with open(os.path.join(ROOT, "section_year_matrix.csv"), encoding="utf-8") as f:
        r = csv.reader(f)
        header = next(r)
        years = [int(y) for y in header[1:]]
        sections, rows = [], []
        for row in r:
            sections.append(row[0])
            rows.append([float(v) if v != "" else float("nan") for v in row[1:]])
    return sections, years, rows


class TestPerYear(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = regenerate("hwcounty")
        cls.win5 = load_windows_w5()
        cls.sections, cls.years, cls.rows = load_matrix()
        cls.yidx = {y: i for i, y in enumerate(cls.years)}
        cls.pos = {s: i for i, s in enumerate(cls.sections)}

    def test_windows_relabeled_to_middle_year_start_eq_end(self):
        w5 = self.win5["windows"]
        self.assertEqual(len(self.data["windows"]), len(w5))
        for k, w in enumerate(self.data["windows"]):
            expected_year = w5[k]["start"] + 2
            self.assertEqual(w["k"], k)
            self.assertEqual(w["start"], expected_year)
            self.assertEqual(w["end"], expected_year)
            self.assertEqual(w["label"], str(expected_year))

    def test_edge_years_never_appear(self):
        middle_years = {w["end"] for w in self.data["windows"]}
        self.assertNotIn(self.years[0], middle_years)
        self.assertNotIn(self.years[1], middle_years)
        self.assertNotIn(self.years[-1], middle_years)
        self.assertNotIn(self.years[-2], middle_years)

    def test_v_matches_segment_own_year_value_not_window_mean(self):
        checked = 0
        for road in self.data["roads"]:
            for seg in road["segments"]:
                p = self.pos.get(seg["id"])
                if p is None:
                    continue
                for w in seg["win"]:
                    year = self.data["windows"][w["k"]]["end"]
                    raw = self.rows[p][self.yidx[year]]
                    if np.isnan(raw):
                        self.assertIsNone(w["v"])
                    else:
                        self.assertAlmostEqual(w["v"], round(raw, 1), places=1)
                    checked += 1
        self.assertGreater(checked, 0)

    def test_no_yv_field_present(self):
        checked = 0
        for road in self.data["roads"]:
            for seg in road["segments"]:
                for w in seg["win"]:
                    self.assertNotIn("yv", w)
                    checked += 1
        self.assertGreater(checked, 0)


if __name__ == "__main__":
    unittest.main()
