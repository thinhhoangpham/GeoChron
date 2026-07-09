"""
Step 8/9 (distance gate): continuous spatial proximity filter -- the paper's
Section 4 distance threshold (thd) -- as a drop-in ALTERNATIVE to the categorical
county / (roadbed,county) partition in step8_network.py.

Proximity rule (this file): two sections are "spatially close" iff the great-circle
(haversine) distance between their geometry CENTROIDS is <= THD kilometres. There is
NO county or roadbed key at all: the partition is replaced entirely by the distance
test, exactly as the paper's Section 4 filter does. Sections near a county/highway
boundary can now be linked across it, which the categorical rules never allowed.

Step 9 intersects this gate with the correlation edges: an edge survives only if the
pair is BOTH trend-correlated (Step 6/7 edge) AND within THD. The test is applied
only to pairs that already survived the correlation threshold (the edges in i/j), so
it is O(edges), not O(n^2).

Centroid = mean of ALL polyline vertices of the section's geometry in
section_lines_geo.geojson (MultiLineString: mean over every vertex of every part),
matching the spec. Sections with no geometry get no centroid; any edge with an
endpoint lacking a centroid is DROPPED and counted (reported per window + total).

Inputs : windows_W5_geo.json          (section order == geo matrix / edge indices)
         section_lines_geo.geojson     (per-section polyline geometry)
         step6_edges_W5_geo{tag}/win*.npz  (geo correlation edges + members)
Output : step9_network_W5_dist{THD}{tag}/win*.npz  (distance-gated edges i, j + members)
         step9_summary_dist{THD}{tag}.json

Usage: python step8_network_dist.py [THD_KM] [THR]
       THD_KM default 10.0 (great-circle km); THR default 0.7 (selects the geo edge dir).
"""
import json, math, os, sys
import numpy as np

THD  = float(sys.argv[1]) if len(sys.argv) > 1 else 10.0   # distance threshold, km
THR  = float(sys.argv[2]) if len(sys.argv) > 2 else 0.7    # correlation threshold (matches step6)
tag  = "" if abs(THR - 0.7) < 1e-9 else f"_thr{round(THR*100)}"
dtag = f"dist{THD:g}"                                       # e.g. dist10

WIN_FILE  = "windows_W5_geo.json"
GEOJSON   = "section_lines_geo.geojson"
IN_DIR    = f"step6_edges_W5_geo{tag}"
OUT_DIR   = f"step9_network_W5_{dtag}{tag}"

EARTH_R_KM = 6371.0088

# ---- section order (matches geo matrix / correlation indices) ---------------
win = json.load(open(WIN_FILE, encoding="utf-8"))
sections = win["sections"]
sec_pos = {sid: i for i, sid in enumerate(sections)}
n_sec = len(sections)

# ---- centroid per section: mean of every polyline vertex --------------------
def line_vertices(geom):
    """Yield [lon,lat] vertices from a LineString or MultiLineString geometry."""
    t = geom.get("type")
    c = geom.get("coordinates")
    if t == "LineString":
        for pt in c:
            yield pt
    elif t == "MultiLineString":
        for part in c:
            for pt in part:
                yield pt

lon = np.full(n_sec, np.nan, dtype=np.float64)
lat = np.full(n_sec, np.nan, dtype=np.float64)
gj = json.load(open(GEOJSON, encoding="utf-8"))
n_geom = 0
for feat in gj.get("features", []):
    sid = (feat.get("properties") or {}).get("id")
    p = sec_pos.get(sid)
    if p is None:
        continue
    geom = feat.get("geometry") or {}
    xs = ys = 0.0
    k = 0
    for pt in line_vertices(geom):
        if len(pt) >= 2:
            xs += pt[0]; ys += pt[1]; k += 1
    if k:
        lon[p] = xs / k
        lat[p] = ys / k
        n_geom += 1
del gj
n_no_centroid = int(np.isnan(lon).sum())

# precompute radians for vectorized haversine over edge endpoints
lon_r = np.radians(lon)
lat_r = np.radians(lat)

def haversine_km(i, j):
    """Great-circle distance (km) between centroids at index arrays i and j.
    NaN where either endpoint lacks a centroid."""
    dlon = lon_r[j] - lon_r[i]
    dlat = lat_r[j] - lat_r[i]
    a = np.sin(dlat / 2.0) ** 2 + np.cos(lat_r[i]) * np.cos(lat_r[j]) * np.sin(dlon / 2.0) ** 2
    return 2.0 * EARTH_R_KM * np.arcsin(np.sqrt(np.clip(a, 0.0, 1.0)))

os.makedirs(OUT_DIR, exist_ok=True)

summary = {"rule": f"centroid-to-centroid great-circle distance <= {THD} km",
           "thd_km": THD, "correlation_thr": THR,
           "sections_total": n_sec,
           "sections_with_centroid": n_geom,
           "sections_without_centroid": n_no_centroid,
           "windows": []}
tot_in = tot_out = tot_dropped_nogeo = 0
print(f"{'win':>3} {'corr_edges':>12} {'kept':>11} {'retained%':>10} {'dropped_nogeo':>14}")
for fn in sorted(os.listdir(IN_DIR)):
    if not fn.endswith(".npz"):
        continue
    k = int(fn[3:5])
    d = np.load(os.path.join(IN_DIR, fn))
    i, j, members = d["i"], d["j"], d["members"]
    dist = haversine_km(i, j)
    has_geo = np.isfinite(dist)
    keep = has_geo & (dist <= THD)
    fi, fj = i[keep], j[keep]
    np.savez_compressed(os.path.join(OUT_DIR, fn),
                        i=fi.astype(np.int32), j=fj.astype(np.int32),
                        members=members)
    n_in, n_out = int(i.size), int(fi.size)
    n_drop = int((~has_geo).sum())
    tot_in += n_in; tot_out += n_out; tot_dropped_nogeo += n_drop
    pct = (100.0 * n_out / n_in) if n_in else 0.0
    summary["windows"].append({"k": k, "corr_edges": n_in, "kept": n_out,
                               "retained_pct": round(pct, 3),
                               "dropped_missing_geometry": n_drop})
    print(f"{k:>3} {n_in:>12} {n_out:>11} {pct:>9.3f}% {n_drop:>14}")

summary["total_corr_edges"] = tot_in
summary["total_kept"] = tot_out
summary["total_dropped_missing_geometry"] = tot_dropped_nogeo
summary["overall_retained_pct"] = round(100.0 * tot_out / tot_in, 3) if tot_in else 0.0
json.dump(summary, open(f"step9_summary_{dtag}{tag}.json", "w"), indent=2)
print(f"\n[{dtag}{tag}] centroids: {n_geom:,}/{n_sec:,}"
      f"   sections without geometry: {n_no_centroid}")
print(f"total edges: {tot_in:,} -> kept {tot_out:,} "
      f"({summary['overall_retained_pct']}%)   "
      f"dropped (endpoint w/o geometry): {tot_dropped_nogeo:,}")
print(f"wrote {OUT_DIR}/win*.npz + step9_summary_{dtag}{tag}.json")
