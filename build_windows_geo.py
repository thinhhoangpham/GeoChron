"""
Step 4 (geo variant): overlapping W=5 windows over the GEO-sourced matrix.

Non-destructive clone of build_windows.py that reads section_year_matrix_geo.csv
(the results_dfo_highway GeoJSON export) instead of section_year_matrix.csv, and
emits ONLY windows_W5_geo.json. Same participation rule (a section joins a window
iff it has >= MIN_OBS real observations inside it). Width is fixed at 5 (the
distance-gate pipeline only ever consumes W=5); the multi-width comparison in
build_windows.py is not needed here.

The section order written to windows_W5_geo.json["sections"] is exactly the geo
matrix row order, so the correlation-edge indices, the centroid lookup, and the
storyline exporter all share one index space.

Output: windows_W5_geo.json
"""
import csv, json, collections

MATRIX  = "section_year_matrix_geo.csv"
OUT     = "windows_W5_geo.json"
MIN_OBS = 4          # min real observations for a section to join a window
W       = 5          # fixed window width

r = csv.reader(open(MATRIX, encoding="utf-8"))
hdr = next(r)
years = [int(y) for y in hdr[1:]]
sections = []          # section_id, in geo-matrix row order
obs = []               # list of {year_index: score} for observed cells
for row in r:
    sections.append(row[0])
    d = {}
    for i, v in enumerate(row[1:]):
        if v != "":
            d[i] = float(v)
    obs.append(d)
n_sec = len(sections)

win_records = []
part_counts = []
for s in range(0, len(years) - W + 1):
    cols = set(range(s, s + W))
    members = [i for i in range(n_sec)
               if sum(1 for c in obs[i] if c in cols) >= MIN_OBS]
    part_counts.append(len(members))
    win_records.append({"start": years[s], "end": years[s + W - 1],
                        "n_sections": len(members), "section_idx": members})

out = {"W": W, "MIN_OBS": MIN_OBS, "years": years,
       "sections": sections, "windows": win_records}
json.dump(out, open(OUT, "w"))

print(f"sections in geo matrix: {n_sec}   years: {years[0]}..{years[-1]}")
print(f"windows: {len(win_records)}   avg/win: {round(sum(part_counts)/len(part_counts))}"
      f"   min: {min(part_counts)}   max: {max(part_counts)}")
print(f"wrote {OUT}")
