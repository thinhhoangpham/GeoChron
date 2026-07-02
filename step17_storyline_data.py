"""
Data export for the Storyline front-end (NO HTML here -- pure data).

Writes storyline_data.json consumed by the static front-end (index.html +
storyline.js), which does all layout and rendering in the browser.

Contract:
{
  "windows": [{"k", "start", "end", "label"}],          # 25 sliding windows
  "roads": [
    { "roadbed": "76 - FAYETTE",                        # a COUNTY band, not one highway
      "segments": [
        { "id", "marker", "roadbed", "county",
          "win": [ {"k", "s", "v"} ... ] }               # one entry per window the
                                                          # segment was ELIGIBLE for
                                                          # (per windows_W5.json's
                                                          # section_idx, i.e. before
                                                          # Step 11 filtering)
      ] } ]
}
  - "s" = step-11 session index within window k if the segment belongs to a KEPT
    session that window, else null. Two segments with the same (k, s) (s non-null)
    are in the SAME cohort that window. The front-end tracks cohorts across windows
    by membership overlap, lays out bundles, and colors by "v". s === null means the
    segment is unaffiliated that window (still drawn, just not bundled).
  - "v" = mean condition score over that window's years (null if unobserved).
  - Every segment has ONE ENTRY PER WINDOW IT QUALIFIED FOR (Step 4 eligibility, i.e.
    membership in windows_W5.json's section_idx) so the line is continuous across all
    eligible windows; only windows the segment never qualified for at all are absent
    (true, rare gaps).
Two proximity rules are supported, producing two separate output files -- this
script never overwrites one with the other, so both can be compared side by
side (index.html loads the original "hwcounty" file; a separate county-only
page loads the "county" file):

  hwcounty (original, paper-adapted rule): cohorts never cross a (roadbed,
    county) pair, so each "road" band is keyed by (roadbed, county) -- a
    highway that passes through N counties becomes N independent bands.

  county (looser, experimental rule): cohorts are scoped to a county alone, so
    each "road" band is keyed by COUNTY and can mix segments from several
    different highways that happen to share a county and be correlated.
    "marker" values are only comparable within one roadbed (TxDOT reference
    markers restart per highway), so segments are ordered by (roadbed, marker)
    within a band, not by marker alone, and each segment carries its own
    "roadbed" field since the band label no longer implies a single highway.

Usage: python step17_storyline_data.py [county|hwcounty]  (default: hwcounty)

Each segment also carries "begin"/"end" (real absolute reference-marker mile
position, length fixed at 0.5mi per the half-mile segment convention), used by
the EvoLens drill-down panel to draw real-position heatmaps per highway.
begin_marker can carry a letter suffix (e.g. "634A", a TxDOT control-section
marker); clean_and_round ports the reference chart's approach (strip
non-digit/non-dot characters before parsing) rather than failing/defaulting to
0 as a naive float() would -- see build_unit_segments_full.py for the same fix
applied to the clustering pipeline.
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
win_meta = win["windows"]; nW = len(win_meta)
wcols = [[yidx[y] for y in range(w["start"], w["end"] + 1)] for w in win_meta]
def wscore(seg, k):
    v = SCORES[seg, wcols[k]]
    return round(float(np.nanmean(v)), 1) if np.isfinite(v).any() else None

roadbed = {}; county = {}; marker = {}; begin_pos = {}
for row in csv.DictReader(open("sections_meta.csv", encoding="utf-8")):
    p = pos.get(row["section_id"])
    if p is not None:
        roadbed[p] = row["roadbed"]; county[p] = row["county"]
        bm = clean_and_round(row["begin_marker"])
        bd = clean_and_round(row["begin_disp"])
        marker[p] = bm  # kept for back-compat sort/display use
        begin_pos[p] = bm + bd

# step11_sessions_W5_<rule>.json gives the KEPT cohort id (s) for segments that
# survived filtering; build seg -> {k: s} for fast lookup.
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

# per segment: one entry per eligible window, s = kept session id or None
seg_win = {}
for m, ks in seg_eligible.items():
    seg_win[m] = [{"k": k, "s": seg_session[m].get(k), "v": wscore(m, k)} for k in ks]

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
        "win": seg_win[m]})

if RULE == "county":
    road_entries = [{"roadbed": cty, "segments": segs}
                    for cty, segs in sorted(roads.items(), key=lambda kv: -len(kv[1]))]
else:
    road_entries = [{"roadbed": f"{rb} · {cty}", "segments": segs}
                    for (rb, cty), segs in sorted(roads.items(), key=lambda kv: -len(kv[1]))]

out = {
    "windows": [{"k": k, "start": w["start"], "end": w["end"],
                 "label": f'{w["start"]}-{w["end"]}'} for k, w in enumerate(win_meta)],
    "roads": road_entries,
}
out_file = f"storyline_data_{RULE}.json"
json.dump(out, open(out_file, "w"))
n_single = sum(1 for _, segs in roads.items() if len(segs) == 1)
print(f"[{RULE}] roads: {len(out['roads'])}   segments: {sum(len(r['segments']) for r in out['roads']):,}")
print(f"single-segment bands: {n_single}")
print(f"wrote {out_file}")
