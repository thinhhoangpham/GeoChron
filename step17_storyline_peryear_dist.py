"""
Step 17 (distance-gate variant, per-year renderer): storyline data with one
column per YEAR (window correlation assigned to its middle year), for the
distance-gated, GEO-sourced pipeline.

Non-destructive clone of step17_storyline_peryear.py. Same middle-year relabeling
and eligibility/cohort logic, but reads the GEO inputs + the distance-gate
communities (unfiltered; the browser applies ths live) and emits a SINGLE global
band -- see step17_storyline_dist.py's header for why the distance gate needs one
band. Wire schema matches storyline_data_peryear_{RULE}.json exactly so
storyline_peryear.js renders it unchanged.

  "v" = the segment's OWN raw score at that window's middle year (None if unobserved).
  "s" = distance-gate Louvain session index within window k (browser applies ths).

Usage: python step17_storyline_peryear_dist.py [THD_KM] [THR]   (defaults 10.0, 0.7)
Output: storyline_data_peryear_dist{THD}_geo{tag}.json
"""
import csv, json, collections, re, sys, os
import numpy as np


def connected_components(edge_dir, n):
    """Union-find over the UNION of all windows' pruned (i,j) edges in `edge_dir`
    (step9 distance-gated network: correlation-AND-<=THD edges). The i/j arrays
    index into windows_W5_geo 'sections', which is the SAME order as the geo
    matrix used here, so component ids map directly onto our segment indices.
    Returns (root: list[int] per section index, size: Counter root->component size).
    Two segments share a component iff transitively linked by an edge in ANY window."""
    parent = list(range(n))
    rank = [0] * n

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra == rb:
            return
        if rank[ra] < rank[rb]:
            ra, rb = rb, ra
        parent[rb] = ra
        if rank[ra] == rank[rb]:
            rank[ra] += 1

    for fn in sorted(os.listdir(edge_dir)):
        if not fn.endswith(".npz"):
            continue
        d = np.load(os.path.join(edge_dir, fn))
        for a, b in zip(d["i"].tolist(), d["j"].tolist()):
            union(int(a), int(b))
    root = [find(x) for x in range(n)]
    return root, collections.Counter(root)

THD  = float(sys.argv[1]) if len(sys.argv) > 1 else 10.0
THR  = float(sys.argv[2]) if len(sys.argv) > 2 else 0.7
tag  = "" if abs(THR - 0.7) < 1e-9 else f"_thr{round(THR*100)}"
dtag = f"dist{THD:g}"

SEGMENT_LENGTH_MI = 0.5

def clean_and_round(value):
    cleaned = re.sub(r"[^0-9.]", "", value or "")
    if cleaned in ("", "."):
        return 0.0
    return round(float(cleaned), 3)

r = csv.reader(open("section_year_matrix_geo.csv", encoding="utf-8"))
next(r); SCORES, sections = [], []
for row in r:
    sections.append(row[0])
    SCORES.append([float(v) if v != "" else np.nan for v in row[1:]])
SCORES = np.array(SCORES, dtype=np.float32)

win = json.load(open("windows_W5_geo.json", encoding="utf-8"))
years = win["years"]; yidx = {y: i for i, y in enumerate(years)}
pos = {s: i for i, s in enumerate(sections)}
win_meta = win["windows"]

middle_years = [w["start"] + 2 for w in win_meta]
assert middle_years == sorted(middle_years) and len(set(middle_years)) == len(middle_years)

def year_score(seg, year):
    v = SCORES[seg, yidx[year]]
    return round(float(v), 1) if np.isfinite(v) else None

roadbed = {}; county = {}; marker = {}; begin_pos = {}; pavtype = {}
for row in csv.DictReader(open("sections_meta_geo.csv", encoding="utf-8")):
    p = pos.get(row["section_id"])
    if p is not None:
        roadbed[p] = row["roadbed"]; county[p] = row["county"]
        pavtype[p] = row["pavtype"]
        bm = clean_and_round(row["begin_marker"])
        bd = clean_and_round(row["begin_disp"])
        marker[p] = bm
        begin_pos[p] = bm + bd

_sess_file = f"step10_communities_W5_{dtag}{tag}.json"
sess = json.load(open(_sess_file))["windows"]; sess.sort(key=lambda w: w["k"])
seg_session = collections.defaultdict(dict)  # seg -> {k: s}
for k, w in enumerate(sess):
    for s, members in enumerate(w["sessions"]):
        for m in members:
            seg_session[m][k] = s

seg_eligible = collections.defaultdict(list)
for k, w in enumerate(win_meta):
    for m in w["section_idx"]:
        seg_eligible[m].append(k)

seg_win = {}
for m, ks in seg_eligible.items():
    seg_win[m] = [{"k": k, "s": seg_session[m].get(k), "v": year_score(m, middle_years[k])}
                  for k in ks]

# Band by DISCONNECTED NETWORK -- one display band per connected component of the
# THD-pruned graph (union of all windows' step9 distance edges); stable band_key
# across windows. Components of size >= 2 are networks (largest first); size-1
# components pool into one trailing catch-all. See step17_storyline_dist.py.
# Within a band, keep (roadbed, marker) order.
_edge_dir = f"step9_network_W5_{dtag}{tag}"
comp_root, comp_size = connected_components(_edge_dir, len(sections))

sort_key = lambda m: (roadbed.get(m, "?"), marker.get(m, 0))

def seg_obj(m):
    b = begin_pos.get(m, 0.0)
    return {
        "id": sections[m], "marker": marker.get(m, 0.0),
        "begin": b, "end": b + SEGMENT_LENGTH_MI,
        "roadbed": roadbed.get(m, ""), "county": county.get(m, ""),
        "pavtype": pavtype.get(m, ""),
        "win": seg_win[m]}

by_comp = collections.defaultdict(list)
singletons = []
for m in sorted(seg_win, key=sort_key):
    (by_comp[comp_root[m]] if comp_size[comp_root[m]] >= 2 else singletons).append(m)

comp_order = sorted(by_comp, key=lambda c: (comp_size[c], len(by_comp[c])), reverse=True)
road_entries = []
for rank, c in enumerate(comp_order, 1):
    members = by_comp[c]
    dom_rb = collections.Counter(roadbed.get(m, "") for m in members).most_common(1)[0][0]
    dom_co = collections.Counter(county.get(m, "") for m in members).most_common(1)[0][0]
    label = f"Network {rank} · {len(members)} seg · {dom_rb}/{dom_co}"
    road_entries.append({"roadbed": label, "segments": [seg_obj(m) for m in members]})

if singletons:
    road_entries.append({
        "roadbed": f"Unconnected (no ≤ {THD:g} km correlated edge) · {len(singletons):,} seg",
        "segments": [seg_obj(m) for m in singletons]})

out = {
    "windows": [{"k": k, "start": y, "end": y, "label": str(y)} for k, y in enumerate(middle_years)],
    "roads": road_entries,
}
out_file = f"storyline_data_peryear_{dtag}_geo{tag}.json"
json.dump(out, open(out_file, "w"))
_n_seg = sum(len(r["segments"]) for r in road_entries)
print(f"[peryear/{dtag}{tag}] years: {middle_years[0]}-{middle_years[-1]} ({len(middle_years)})   "
      f"network bands: {len(comp_order)}   singletons: {len(singletons):,}   segments: {_n_seg:,}")
if comp_order:
    print("  largest bands: " + ", ".join(str(len(by_comp[c])) for c in comp_order[:6]))
print(f"wrote {out_file}")
