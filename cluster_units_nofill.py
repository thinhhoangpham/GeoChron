"""
Clustering variant using NO gap fill ("option 2"): correlation between two
units is computed only over grid cells where BOTH have a real (non-null)
value (pairwise-complete correlation), instead of filling gaps first and
running a single dense matrix correlation like cluster_units.py.

Input : unit_heatmaps_nofill.json (S x n_windows grid per unit, null = no data)
Output: unit_clusters_nofill.json -- same shape as unit_clusters.json, plus
        each cluster's avg_grid is a nan-mean over members (cells no member
        has data for stay null).

Pairs with too little overlap produce a statistically meaningless
correlation (e.g. 2 shared cells always correlate to ±1), so pairs with
fewer than MIN_OVERLAP shared cells are treated as maximally dissimilar
(distance = 1.0, i.e. uncorrelated) rather than trusting a thin-overlap
number.
"""
import json
import numpy as np
from scipy.cluster.hierarchy import linkage, fcluster
from scipy.spatial.distance import squareform

IN_FILE      = "unit_heatmaps_nofill.json"
OUT_FILE     = "unit_clusters_nofill.json"
CUT_DIST     = 0.7
LINKAGE      = "complete"
MIN_OVERLAP  = 10   # minimum shared non-null cells required to trust a pair's correlation

data = json.load(open(IN_FILE, encoding="utf-8"))
units = data["units"]
keys = [u["key"] for u in units]
n = len(units)
X = np.array([np.ravel([np.nan if v is None else v for v in u["grid"]]) for u in units],
             dtype=np.float64)  # (n_units, S*n_windows), NaN = no data

dist = np.zeros((n, n), dtype=np.float64)
thin_pairs = 0
for i in range(n):
    xi = X[i]
    for j in range(i + 1, n):
        xj = X[j]
        mask = np.isfinite(xi) & np.isfinite(xj)
        overlap = int(mask.sum())
        if overlap < MIN_OVERLAP:
            d = 1.0
            thin_pairs += 1
        else:
            a, b = xi[mask], xj[mask]
            a = a - a.mean()
            b = b - b.mean()
            denom = np.linalg.norm(a) * np.linalg.norm(b)
            r = 0.0 if denom == 0 else np.clip(float(np.dot(a, b) / denom), -1.0, 1.0)
            d = 1.0 - r
        dist[i, j] = dist[j, i] = d

condensed = squareform(dist, checks=False)
Z = linkage(condensed, method=LINKAGE)
labels = fcluster(Z, t=CUT_DIST, criterion="distance")

clusters = {}
for label, key, u in zip(labels, keys, units):
    clusters.setdefault(int(label), []).append((key, u["grid"]))

out_clusters = []
for cluster_id, members in sorted(clusters.items(), key=lambda kv: -len(kv[1])):
    grids = np.array(
        [[[np.nan if v is None else v for v in row] for row in g] for _, g in members],
        dtype=np.float64)
    avg = np.nanmean(grids, axis=0)
    out_clusters.append({
        "cluster_id": cluster_id,
        "unit_keys": [k for k, _ in members],
        "avg_grid": [[None if np.isnan(v) else round(float(v), 2) for v in row] for row in avg],
    })

json.dump({"cut_distance": CUT_DIST, "clusters": out_clusters}, open(OUT_FILE, "w"))

total_pairs = n * (n - 1) // 2
sizes = sorted((len(c["unit_keys"]) for c in out_clusters), reverse=True)
print(f"units clustered: {n}   clusters found: {len(out_clusters)}")
print(f"pairs with < {MIN_OVERLAP} overlapping cells (forced dissimilar): {thin_pairs:,} / {total_pairs:,} "
      f"({thin_pairs/total_pairs:.2%})")
print(f"cluster sizes (largest 10): {sizes[:10]}")
print(f"singleton clusters: {sum(1 for s in sizes if s == 1)}")
print(f"wrote {OUT_FILE}")
