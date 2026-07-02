"""
Data export for the EvoLens drill-down panel (paper Step 17, Level 2).

The main Storyline (storyline_data.json) only carries per-WINDOW (5-year) mean
scores, since that's what layout/color needs. EvoLens shows the real per-YEAR
"sawtooth" detail behind a brushed selection, so it needs the raw yearly scores
this file provides, keyed by segment id (same ids used in storyline_data.json).

Output: evolens_data.json
{
  "years": [1996, 1997, ..., 2024],
  "scores": { "<segment_id>": [v0, v1, ..., null, ...] }   # one entry per year,
                                                             # null where unobserved
}
Trend-motif normalization (z-score per brushed range) is left to the front end,
since it must be computed on whatever the user actually brushes, not fixed windows.
"""
import csv, json

r = csv.reader(open("section_year_matrix.csv", encoding="utf-8"))
hdr = next(r)
years = [int(y) for y in hdr[1:]]

scores = {}
for row in r:
    seg_id = row[0]
    vals = [float(v) if v != "" else None for v in row[1:]]
    scores[seg_id] = vals

out = {"years": years, "scores": scores}
json.dump(out, open("evolens_data.json", "w"))
print(f"years: {years[0]}-{years[-1]}  segments: {len(scores):,}")
print("wrote evolens_data.json")
