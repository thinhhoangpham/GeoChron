"""
Data export for the Storyline front-end (NO HTML here -- pure data).

Writes storyline_data.json consumed by the static front-end (index.html +
storyline.js), which does all layout and rendering in the browser.

Contract:
{
  "windows": [{"k", "start", "end", "label"}],          # 25 sliding windows
  "roads": [
    { "roadbed": "IH0010 R",
      "segments": [
        { "id", "marker", "county",
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
Cohorts never cross a (roadbed, county) pair (Step 8/9 proximity groups are keyed
on both together), so each "road" band here is keyed by (roadbed, county), not
roadbed alone -- a highway that passes through N counties becomes N independent
bands, one per county, matching the actual constraint sessions are already scoped
to (this is a display re-grouping only; it changes no session/track validity,
since a session's members already never spanned counties).
"""
import csv, json, collections
import numpy as np

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

roadbed = {}; county = {}; marker = {}
for row in csv.DictReader(open("sections_meta.csv", encoding="utf-8")):
    p = pos.get(row["section_id"])
    if p is not None:
        roadbed[p] = row["roadbed"]; county[p] = row["county"]
        try: marker[p] = float(row["begin_marker"])
        except: marker[p] = 0.0

# step11_sessions_W5.json gives the KEPT cohort id (s) for segments that survived
# filtering; build seg -> {k: s} for fast lookup.
sess = json.load(open("step11_sessions_W5.json"))["windows"]; sess.sort(key=lambda w: w["k"])
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
for m in sorted(seg_win, key=lambda m: marker.get(m, 0)):
    key = (roadbed.get(m, "?"), county.get(m, "?"))
    roads[key].append({
        "id": sections[m], "marker": marker.get(m, 0.0),
        "county": county.get(m, ""), "win": seg_win[m]})

out = {
    "windows": [{"k": k, "start": w["start"], "end": w["end"],
                 "label": f'{w["start"]}-{w["end"]}'} for k, w in enumerate(win_meta)],
    "roads": [{"roadbed": f"{rb} · {cty}", "segments": segs}
              for (rb, cty), segs in sorted(roads.items(), key=lambda kv: -len(kv[1]))],
}
json.dump(out, open("storyline_data.json", "w"))
n_single = sum(1 for _, segs in roads.items() if len(segs) == 1)
print(f"roads (roadbed x county): {len(out['roads'])}   segments: {sum(len(r['segments']) for r in out['roads']):,}")
print(f"single-segment bands: {n_single}")
print("wrote storyline_data.json")
