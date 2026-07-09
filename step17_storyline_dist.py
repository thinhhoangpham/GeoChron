"""
Step 17 (distance-gate variant, main/window-range renderer): storyline data for
the distance-gated, GEO-sourced pipeline.

Non-destructive clone of step17_storyline_data.py. Same wire schema and same
eligibility/cohort logic, but:
  * reads the GEO inputs (section_year_matrix_geo.csv, sections_meta_geo.csv,
    windows_W5_geo.json) so segment indices match the distance-gated network, and
  * reads the distance-gate communities (step10_communities_W5_dist{THD}{tag}.json)
    UNFILTERED -- the geo pages apply the paper's session filter (ths) live in the
    browser, exactly like the county/hwcounty *_geo datasets, and
  * uses a SINGLE global band. The distance gate has no county/roadbed partition, so
    a Louvain session can span any roads within THD; the front end tracks and filters
    cohorts within each "road" band (buildRoadStructure runs per band), so putting
    every segment in one band is required for cross-road distance cohorts to render
    as one bundle instead of fragmenting. Segments are ordered by (roadbed, marker) --
    a meaningful spatial order along corridors, the same tie-break the county rule
    uses -- not alphabetically.

Output schema matches storyline_data_{RULE}.json exactly (windows / roads /
segments / win:[{k,s,v,yv}]) so storyline.js renders it unchanged.

  "v"  = mean condition score over that window's years (null if unobserved).
  "yv" = per-year raw scores inside the window (for the gradient bars).
  "s"  = distance-gate Louvain session index within window k (browser applies ths).

Usage: python step17_storyline_dist.py [THD_KM] [THR]   (defaults 10.0, 0.7)
Output: storyline_data_dist{THD}_geo{tag}.json
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
win_meta = win["windows"]; nW = len(win_meta)
wcols = [[yidx[y] for y in range(w["start"], w["end"] + 1)] for w in win_meta]
def wscore(seg, k):
    v = SCORES[seg, wcols[k]]
    return round(float(np.nanmean(v)), 1) if np.isfinite(v).any() else None

def yvals(seg, k):
    return [round(float(SCORES[seg, c]), 1) if np.isfinite(SCORES[seg, c]) else None
            for c in wcols[k]]

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

# distance-gate communities, read UNFILTERED (browser applies the paper session filter live)
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
    seg_win[m] = [{"k": k, "s": seg_session[m].get(k), "v": wscore(m, k), "yv": yvals(m, k)}
                  for k in ks]

# Band by DISCONNECTED NETWORK: each display band = one connected component of the
# THD-pruned graph (union of ALL windows' step9 distance edges). A segment's
# component is fixed across all 25 windows (stable band_key). Components of size
# >= 2 are real networks (one band each, largest first); every size-1 component
# pools into ONE trailing catch-all band. Within a band, keep (roadbed, marker)
# order -- spatial along corridors, same tie-break the county rule uses.
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

# network bands, largest component first (meaningful order, not alphabetical)
comp_order = sorted(by_comp, key=lambda c: (comp_size[c], len(by_comp[c])), reverse=True)
road_entries = []
for rank, c in enumerate(comp_order, 1):
    members = by_comp[c]
    dom_rb = collections.Counter(roadbed.get(m, "") for m in members).most_common(1)[0][0]
    dom_co = collections.Counter(county.get(m, "") for m in members).most_common(1)[0][0]
    label = f"Network {rank} · {len(members)} seg · {dom_rb}/{dom_co}"
    road_entries.append({"roadbed": label, "segments": [seg_obj(m) for m in members]})

# trailing catch-all: unconnected singletons (no THD-correlated edge in any window)
if singletons:
    road_entries.append({
        "roadbed": f"Unconnected (no ≤ {THD:g} km correlated edge) · {len(singletons):,} seg",
        "segments": [seg_obj(m) for m in singletons]})

out = {
    "windows": [{"k": k, "start": w["start"], "end": w["end"],
                 "label": f'{w["start"]}-{w["end"]}'} for k, w in enumerate(win_meta)],
    "roads": road_entries,
}
out_file = f"storyline_data_{dtag}_geo{tag}.json"
json.dump(out, open(out_file, "w"))
_n_seg = sum(len(r["segments"]) for r in road_entries)
print(f"[{dtag}{tag}] network bands: {len(comp_order)}   singletons: {len(singletons):,}   "
      f"segments: {_n_seg:,}   windows: {nW}")
if comp_order:
    print("  largest bands: " + ", ".join(str(len(by_comp[c])) for c in comp_order[:6]))
print(f"wrote {out_file}")
