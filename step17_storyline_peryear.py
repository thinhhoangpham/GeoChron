"""
Step 17 (per-year variant): Data export for the paper-faithful per-year Storyline.

Same inputs and eligibility/cohort logic as step17_storyline_data.py -- reuses
windows_W5.json's centered 5-year windows (window k spans years[k]..years[k+4]) and
step11_sessions_W5_{RULE}.json's filtered cohorts UNCHANGED -- but relabels each
window's result to its middle year (paper Step 2: a wrapping window's correlation is
assigned back to its one focus time slice), producing one column per YEAR instead of
one column per WINDOW.

Output wire schema intentionally matches storyline_data_{RULE}.json's shape exactly
(same "windows"/"roads"/"segments"/"win" field names, no "yv") so storyline_peryear.js
and evolens.js can reuse storyline.js's logic without any schema translation:
  "windows": [{"k", "start", "end", "label"}]   # start == end == middle year
  "roads": [{"roadbed", "segments": [{"id","marker","roadbed","county","pavtype",
                                       "begin","end","win": [{"k","s","v"}]}]}]
  - "k" is windows_W5.json's own window index (already a contiguous 0-based index
    over the sorted middle years, since windows_W5.json's windows are sorted
    ascending by start).
  - "v" is the segment's OWN raw score AT that middle year (None if unobserved that
    year), NOT the window mean step17_storyline_data.py's wscore() computes.
  - Edge years (the first/last 2 years of section_year_matrix.csv) never appear as a
    middle year of any window and are therefore absent -- no special-casing needed.

Usage: python step17_storyline_peryear.py [county|hwcounty]  (default: hwcounty)
"""
import csv, json, collections, re, sys
import numpy as np

RULE = sys.argv[1] if len(sys.argv) > 1 else "hwcounty"
assert RULE in ("county", "hwcounty")

SEGMENT_LENGTH_MI = 0.5

def clean_and_round(value):
    cleaned = re.sub(r"[^0-9.]", "", value or "")
    if cleaned in ("", "."):
        return 0.0
    return round(float(cleaned), 3)

r = csv.reader(open("section_year_matrix.csv", encoding="utf-8"))
next(r); SCORES, sections = [], []
for row in r:
    sections.append(row[0])
    SCORES.append([float(v) if v != "" else np.nan for v in row[1:]])
SCORES = np.array(SCORES, dtype=np.float32)

win = json.load(open("windows_W5.json", encoding="utf-8"))
years = win["years"]; yidx = {y: i for i, y in enumerate(years)}
pos = {s: i for i, s in enumerate(sections)}
win_meta = win["windows"]

# windows_W5.json's windows are already sorted ascending by start, so window k's
# own index already IS the contiguous per-year column index we need.
middle_years = [w["start"] + 2 for w in win_meta]
assert middle_years == sorted(middle_years) and len(set(middle_years)) == len(middle_years)

def year_score(seg, year):
    v = SCORES[seg, yidx[year]]
    return round(float(v), 1) if np.isfinite(v) else None

roadbed = {}; county = {}; marker = {}; begin_pos = {}; pavtype = {}
for row in csv.DictReader(open("sections_meta.csv", encoding="utf-8")):
    p = pos.get(row["section_id"])
    if p is not None:
        roadbed[p] = row["roadbed"]; county[p] = row["county"]
        pavtype[p] = row["pavtype"]
        bm = clean_and_round(row["begin_marker"])
        bd = clean_and_round(row["begin_disp"])
        marker[p] = bm
        begin_pos[p] = bm + bd

# step11_sessions_W5_<rule>.json gives the KEPT cohort id (s) for segments that
# survived filtering; build seg -> {k: s} for fast lookup (k = windows_W5.json index).
sess = json.load(open(f"step11_sessions_W5_{RULE}.json"))["windows"]; sess.sort(key=lambda w: w["k"])
seg_session = collections.defaultdict(dict)  # seg -> {k: s}
for k, w in enumerate(sess):
    for s, members in enumerate(w["sessions"]):
        for m in members:
            seg_session[m][k] = s

# windows_W5.json's section_idx per window = Step-4 eligibility (>=MIN_OBS real
# observations). Build seg -> sorted list of eligible window indices.
seg_eligible = collections.defaultdict(list)
for k, w in enumerate(win_meta):
    for m in w["section_idx"]:
        seg_eligible[m].append(k)

# per segment: one entry per eligible window, keyed by that window's OWN index k
# (== the per-year column index), s = kept session id or None, v = the segment's
# own raw score at that window's middle year.
seg_win = {}
for m, ks in seg_eligible.items():
    seg_win[m] = [{"k": k, "s": seg_session[m].get(k), "v": year_score(m, middle_years[k])}
                  for k in ks]

roads = collections.defaultdict(list)
if RULE == "county":
    sort_key = lambda m: (roadbed.get(m, "?"), marker.get(m, 0))
    band_key = lambda m: county.get(m, "?")
else:
    sort_key = lambda m: marker.get(m, 0)
    band_key = lambda m: (roadbed.get(m, "?"), county.get(m, "?"))

for m in sorted(seg_win, key=sort_key):
    b = begin_pos.get(m, 0.0)
    roads[band_key(m)].append({
        "id": sections[m], "marker": marker.get(m, 0.0),
        "begin": b, "end": b + SEGMENT_LENGTH_MI,
        "roadbed": roadbed.get(m, ""), "county": county.get(m, ""),
        "pavtype": pavtype.get(m, ""),
        "win": seg_win[m]})

if RULE == "county":
    road_entries = [{"roadbed": cty, "segments": segs}
                    for cty, segs in sorted(roads.items(), key=lambda kv: -len(kv[1]))]
else:
    road_entries = [{"roadbed": f"{rb} · {cty}", "segments": segs}
                    for (rb, cty), segs in sorted(roads.items(), key=lambda kv: -len(kv[1]))]

out = {
    "windows": [{"k": k, "start": y, "end": y, "label": str(y)} for k, y in enumerate(middle_years)],
    "roads": road_entries,
}
out_file = f"storyline_data_peryear_{RULE}.json"
json.dump(out, open(out_file, "w"))
n_single = sum(1 for _, segs in roads.items() if len(segs) == 1)
print(f"[peryear/{RULE}] years: {middle_years[0]}-{middle_years[-1]} ({len(middle_years)})   "
      f"roads: {len(out['roads'])}   segments: {sum(len(r['segments']) for r in out['roads']):,}")
print(f"single-segment bands: {n_single}")
print(f"wrote {out_file}")
