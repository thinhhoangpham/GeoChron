"""
Cluster (roadbed, county) units whose space x time heatmaps look similar.

Input : unit_heatmaps.json (S x n_windows grid per unit, from build_unit_heatmaps.py)
Output: unit_clusters.json -- {cut_distance, clusters: [{cluster_id, unit_keys, avg_grid}]}

Method: flatten each unit's grid to one vector, compute pairwise Pearson
correlation (same "shape not level" philosophy as step6_corr.py), convert to
distance d = 1 - r, and cut a hierarchical (average-linkage) dendrogram at a
fixed distance threshold. No pre-set number of clusters.
"""
import json
import numpy as np
from scipy.cluster.hierarchy import linkage, fcluster
from scipy.spatial.distance import squareform

IN_FILE     = "unit_heatmaps.json"
OUT_FILE    = "unit_clusters.json"
CUT_DIST    = 0.7   # dendrogram cut distance (1 - correlation); tuned by sweeping
                     # 0.3-0.9 on this dataset.
LINKAGE     = "complete"  # average linkage chained visually-different pairs into
                          # one cluster (confirmed by eye on cluster_sample.png);
                          # complete linkage requires every member close to every
                          # other member, which avoids that.

data = json.load(open(IN_FILE, encoding="utf-8"))
units = data["units"]
keys = [u["key"] for u in units]
X = np.array([np.ravel(u["grid"]) for u in units], dtype=np.float64)  # (n_units, S*n_windows)

# pairwise Pearson correlation across all units
Xc = X - X.mean(axis=1, keepdims=True)
norms = np.linalg.norm(Xc, axis=1)
norms[norms == 0] = 1e-9  # guard against a perfectly flat (constant) unit
corr = (Xc @ Xc.T) / np.outer(norms, norms)
corr = np.clip(corr, -1.0, 1.0)
dist = 1.0 - corr
np.fill_diagonal(dist, 0.0)
dist = (dist + dist.T) / 2  # enforce exact symmetry (float round-trip)

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
