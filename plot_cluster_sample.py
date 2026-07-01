"""
Throwaway verification tool: render a grid of heatmap thumbnails for a few of
the largest clusters from cluster_units.py, so a human can eyeball whether
units grouped together actually look similar. Not part of the shipped pipeline.

Output: cluster_sample.png
"""
import json
import numpy as np
import matplotlib.pyplot as plt

IN_FILE   = "unit_clusters.json"
OUT_FILE  = "cluster_sample.png"
N_CLUSTERS_TO_SHOW = 3
N_UNITS_PER_CLUSTER = 4

data = json.load(open(IN_FILE, encoding="utf-8"))
clusters = data["clusters"][:N_CLUSTERS_TO_SHOW]  # already sorted largest-first

fig, axes = plt.subplots(N_CLUSTERS_TO_SHOW, N_UNITS_PER_CLUSTER,
                         figsize=(3 * N_UNITS_PER_CLUSTER, 3 * N_CLUSTERS_TO_SHOW))

units_by_key = {u["key"]: u["grid"] for u in json.load(open("unit_heatmaps.json"))["units"]}

for row, cluster in enumerate(clusters):
    sample_keys = cluster["unit_keys"][:N_UNITS_PER_CLUSTER]
    for col in range(N_UNITS_PER_CLUSTER):
        ax = axes[row, col]
        ax.axis("off")
        if col < len(sample_keys):
            key = sample_keys[col]
            grid = np.array(units_by_key[key])
            ax.imshow(grid, aspect="auto", cmap="RdYlGn", vmin=0, vmax=100)
            ax.set_title(key, fontsize=7)
    axes[row, 0].set_ylabel(f"cluster {cluster['cluster_id']} (n={len(cluster['unit_keys'])})",
                            fontsize=8)

fig.suptitle("Sample heatmaps from the largest clusters (rows) — space (x) vs. window (y)")
fig.tight_layout()
fig.savefig(OUT_FILE, dpi=120)
print(f"wrote {OUT_FILE}")
