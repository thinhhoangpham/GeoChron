"""
Same clustering method as cluster_units.py (dense Pearson correlation,
average of -- actually complete-linkage hierarchical clustering, cut at a
fixed distance), applied to the fill1 (ffill/bfill + spatial interpolation)
heatmap grid instead of the flat-mean fill, for comparison.

Input : unit_heatmaps_fill1.json
Output: unit_clusters_fill1.json -- same shape as unit_clusters.json
"""
import json
import numpy as np
from scipy.cluster.hierarchy import linkage, fcluster
from scipy.spatial.distance import squareform

IN_FILE  = "unit_heatmaps_fill1.json"
OUT_FILE = "unit_clusters_fill1.json"
CUT_DIST = 0.7
LINKAGE  = "complete"

data = json.load(open(IN_FILE, encoding="utf-8"))
units = data["units"]
keys = [u["key"] for u in units]
X = np.array([np.ravel(u["grid"]) for u in units], dtype=np.float64)

Xc = X - X.mean(axis=1, keepdims=True)
norms = np.linalg.norm(Xc, axis=1)
norms[norms == 0] = 1e-9
corr = (Xc @ Xc.T) / np.outer(norms, norms)
corr = np.clip(corr, -1.0, 1.0)
dist = 1.0 - corr
np.fill_diagonal(dist, 0.0)
dist = (dist + dist.T) / 2

condensed = squareform(dist, checks=False)
Z = linkage(condensed, method=LINKAGE)
labels = fcluster(Z, t=CUT_DIST, criterion="distance")

clusters = {}
for label, key, u in zip(labels, keys, units):
    clusters.setdefault(int(label), []).append((key, u["grid"]))

out_clusters = []
for cluster_id, members in sorted(clusters.items(), key=lambda kv: -len(kv[1])):
    grids = np.array([g for _, g in members])
    out_clusters.append({
        "cluster_id": cluster_id,
        "unit_keys": [k for k, _ in members],
        "avg_grid": np.round(grids.mean(axis=0), 2).tolist(),
    })

json.dump({"cut_distance": CUT_DIST, "clusters": out_clusters}, open(OUT_FILE, "w"))

sizes = sorted((len(c["unit_keys"]) for c in out_clusters), reverse=True)
print(f"units clustered: {len(units)}   clusters found: {len(out_clusters)}")
print(f"cluster sizes (largest 10): {sizes[:10]}")
print(f"singleton clusters: {sum(1 for s in sizes if s == 1)}")
print(f"wrote {OUT_FILE}")
