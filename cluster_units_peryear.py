"""
PER-YEAR variant of cluster_units_bylength.py.

Ported VERBATIM in logic from cluster_units_bylength.py -- same S=20 spatial
block-nanmean resampling, same 3 gap-handling strategies (fill/fill1/nofill),
same dynamic n_segments quartile bucketing, same complete-linkage clustering at
CUT_DIST=0.7, same nofill pairwise-complete correlation (MIN_OVERLAP=10). The
ONLY changes are:
  * input is unit_segments_full_all.json (per-year scores) instead of
    storyline_data_hwcounty.json (W5 windows), so the TIME axis is 29 calendar
    years (1996-2024) instead of 25 overlapping 5-year sliding windows;
  * grids are built from segment scores[] rather than segment win[];
  * output filenames carry a _peryear tag so they never collide with the W5
    files.

This isolates the effect of temporal windowing on how well the flattened /
abstracted grid resembles the raw heatmap: everything except the time axis is
held identical to the W5 length-bucketed pipeline.

Input : unit_segments_full_all.json (full coverage of all ~1112 units, no
          MIN_SEGMENTS filter, per-year scores).
Output: unit_heatmaps_peryear_all_{fill,fill1,nofill}.json
        unit_clusters_peryear_len_{method}_Q{1..4}.json  (3 x 4 = 12 files)
        unit_clusters_peryear_len_summary.json
"""
import json
import warnings
import numpy as np
from scipy.cluster.hierarchy import linkage, fcluster
from scipy.spatial.distance import squareform

IN_FILE      = "unit_segments_full_all.json"
OUT_PATTERN  = "unit_clusters_peryear_len_{method}_Q{bucket}.json"
SUMMARY_FILE = "unit_clusters_peryear_len_summary.json"
S            = 20   # fixed number of spatial bins (build_unit_heatmaps*.py)
CUT_DIST     = 0.7  # dendrogram cut distance (1 - Pearson r), same as cluster_units.py
LINKAGE      = "complete"
MIN_OVERLAP  = 10   # nofill only: minimum shared non-null cells to trust a pair's correlation

data = json.load(open(IN_FILE, encoding="utf-8"))
n_windows = len(data["years"])   # per-year: 29 columns

# ---------------------------------------------------------------------------
# 1. Build the S x n_windows raw (unfilled) grid for EVERY unit (no
#    MIN_SEGMENTS filter). This resampling step is common to all three
#    methods -- what differs is how each fills (or doesn't fill) the gaps.
#    (Per-year: rows from segment scores[] instead of win[].)
# ---------------------------------------------------------------------------
raw_units = []
for unit in data["units"]:
    key = unit["key"]
    segs = unit["segments"]           # already sorted by begin == spatial order
    n_segments = len(segs)

    raw = np.full((n_segments, n_windows), np.nan, dtype=np.float32)
    for i, seg in enumerate(segs):
        for t, v in enumerate(seg["scores"]):
            if v is not None:
                raw[i, t] = v

    # resample space axis: split n_segments rows into S contiguous blocks,
    # nanmean each block -> S x n_windows
    bounds = np.linspace(0, n_segments, S + 1).round().astype(int)
    grid = np.full((S, n_windows), np.nan, dtype=np.float32)
    for b in range(S):
        lo, hi = bounds[b], max(bounds[b + 1], bounds[b] + 1)
        hi = min(hi, n_segments)
        block = raw[lo:hi]
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", category=RuntimeWarning)
            grid[b] = np.nanmean(block, axis=0)

    raw_units.append({"key": key, "n_segments": n_segments, "grid": grid})

# ---------------------------------------------------------------------------
# 2. Compute quartile boundaries of n_segments dynamically (no hardcoding).
#    Identical bucketing scheme, shared across all three methods.
# ---------------------------------------------------------------------------
seg_counts = np.array([u["n_segments"] for u in raw_units])
q1, q2, q3 = (int(np.floor(x)) for x in np.quantile(seg_counts, [0.25, 0.5, 0.75]))

def bucket_for(n):
    if n <= q1:
        return 1
    if n <= q2:
        return 2
    if n <= q3:
        return 3
    return 4

buckets = {1: [], 2: [], 3: [], 4: []}
for u in raw_units:
    buckets[bucket_for(u["n_segments"])].append(u)

# ---------------------------------------------------------------------------
# 3. Per-method gap-fill logic, applied to a copy of the raw S x n_windows
#    grid. Each function is ported exactly from its build_unit_heatmaps*.py.
# ---------------------------------------------------------------------------
def fill_flatmean(grid):
    """Verbatim from build_unit_heatmaps.py: fill remaining gaps with the
    unit's own overall mean."""
    grid = grid.copy()
    nan_mask = ~np.isfinite(grid)
    if nan_mask.any():
        unit_mean = np.nanmean(grid)
        if not np.isfinite(unit_mean):
            unit_mean = 0.0  # entire unit had no data at all
        grid[nan_mask] = unit_mean
    return grid

def fill_fill1(grid):
    """Verbatim from build_unit_heatmaps_fill1.py: temporal ffill/bfill per
    spatial bin, then spatial interpolation per window, then 0.0 fallback."""
    grid = grid.copy()
    S_, n_windows_ = grid.shape

    # 1. temporal ffill then bfill, per spatial bin (row)
    for b in range(S_):
        row = grid[b]
        last = np.nan
        for t in range(n_windows_):
            if np.isfinite(row[t]):
                last = row[t]
            elif np.isfinite(last):
                row[t] = last
        nxt = np.nan
        for t in range(n_windows_ - 1, -1, -1):
            if np.isfinite(row[t]):
                nxt = row[t]
            elif np.isfinite(nxt):
                row[t] = nxt

    # 2. spatial interpolation across bins, per window (column) -- only for
    # rows that had no data in ANY window (temporal fill had nothing to give)
    for t in range(n_windows_):
        col = grid[:, t]
        finite_idx = np.flatnonzero(np.isfinite(col))
        if len(finite_idx) == 0 or len(finite_idx) == S_:
            continue
        nan_idx = np.flatnonzero(~np.isfinite(col))
        col[nan_idx] = np.interp(nan_idx, finite_idx, col[finite_idx])

    # 3. rare fallback: unit had zero real data anywhere
    still_nan = ~np.isfinite(grid)
    if still_nan.any():
        grid[still_nan] = 0.0

    return grid

def fill_nofill(grid):
    """Verbatim from build_unit_heatmaps_nofill.py: no fill at all, gaps
    stay NaN."""
    return grid.copy()

# ---------------------------------------------------------------------------
# 4. Per-method clustering logic, each ported exactly from its
#    cluster_units*.py, guarded for buckets with < 2 units.
# ---------------------------------------------------------------------------
def _labels_to_clusters(labels, keys, grids, nofill):
    clusters = {}
    for label, key, g in zip(labels, keys, grids):
        clusters.setdefault(int(label), []).append((key, g))

    out_clusters = []
    for cluster_id, members in sorted(clusters.items(), key=lambda kv: -len(kv[1])):
        member_grids = np.array([g for _, g in members], dtype=np.float64)
        if nofill:
            avg = np.nanmean(member_grids, axis=0)
            avg_grid = [[None if np.isnan(v) else round(float(v), 2) for v in row] for row in avg]
        else:
            avg_grid = np.round(member_grids.mean(axis=0), 2).tolist()
        out_clusters.append({
            "cluster_id": cluster_id,
            "unit_keys": [k for k, _ in members],
            "avg_grid": avg_grid,
        })
    return out_clusters

def linkage_dense(units, grids):
    """Verbatim dense-correlation distance + linkage from cluster_units.py /
    cluster_units_fill1.py (grids already fully filled, no NaNs)."""
    X = np.array([np.ravel(g) for g in grids], dtype=np.float64)  # (n_units, S*n_windows)

    Xc = X - X.mean(axis=1, keepdims=True)
    norms = np.linalg.norm(Xc, axis=1)
    norms[norms == 0] = 1e-9  # guard against a perfectly flat (constant) unit
    corr = (Xc @ Xc.T) / np.outer(norms, norms)
    corr = np.clip(corr, -1.0, 1.0)
    dist = 1.0 - corr
    np.fill_diagonal(dist, 0.0)
    dist = (dist + dist.T) / 2  # enforce exact symmetry (float round-trip)

    condensed = squareform(dist, checks=False)
    return linkage(condensed, method=LINKAGE)

def linkage_nofill(units, grids):
    """Verbatim pairwise-complete correlation distance + linkage from
    cluster_units_nofill.py (grids may contain NaNs)."""
    n = len(units)
    X = np.array([np.ravel(g) for g in grids], dtype=np.float64)  # (n_units, S*n_windows), NaN = no data

    dist = np.zeros((n, n), dtype=np.float64)
    for i in range(n):
        xi = X[i]
        for j in range(i + 1, n):
            xj = X[j]
            mask = np.isfinite(xi) & np.isfinite(xj)
            overlap = int(mask.sum())
            if overlap < MIN_OVERLAP:
                d = 1.0
            else:
                a, b = xi[mask], xj[mask]
                a = a - a.mean()
                b = b - b.mean()
                denom = np.linalg.norm(a) * np.linalg.norm(b)
                r = 0.0 if denom == 0 else np.clip(float(np.dot(a, b) / denom), -1.0, 1.0)
                d = 1.0 - r
            dist[i, j] = dist[j, i] = d

    condensed = squareform(dist, checks=False)
    return linkage(condensed, method=LINKAGE)

def singleton_clusters(units, grids, nofill=False):
    """Too few units to correlate -- treat each as its own singleton cluster."""
    out_clusters = []
    for i, (u, g) in enumerate(zip(units, grids), start=1):
        if nofill:
            avg_grid = [[None if np.isnan(v) else round(float(v), 2) for v in row] for row in g]
        else:
            avg_grid = np.round(g, 2).tolist()
        out_clusters.append({
            "cluster_id": i,
            "unit_keys": [u["key"]],
            "avg_grid": avg_grid,
        })
    return out_clusters

# ---------------------------------------------------------------------------
# 5. METHODS config: method name -> (fill function, cluster function, nofill?)
# ---------------------------------------------------------------------------
METHODS = {
    "fill":   (fill_flatmean, linkage_dense,   False),
    "fill1":  (fill_fill1,    linkage_dense,   False),
    "nofill": (fill_nofill,   linkage_nofill,  True),
}

def cluster_bucket(units, fill_fn, linkage_fn, nofill):
    """Returns (grids, out_clusters) for a single fixed CUT_DIST. Falls back
    to singleton clusters if the bucket has <2 units to correlate."""
    grids = [fill_fn(u["grid"]) for u in units]
    if len(units) < 2:
        return grids, singleton_clusters(units, grids, nofill=nofill)

    keys = [u["key"] for u in units]
    Z = linkage_fn(units, grids)
    labels = fcluster(Z, t=CUT_DIST, criterion="distance")
    return grids, _labels_to_clusters(labels, keys, grids, nofill)

# ---------------------------------------------------------------------------
# 6. Run all methods x buckets, write per-(method,bucket) output files +
#    combined summary. Print summary table grouped by method then bucket.
# ---------------------------------------------------------------------------
summary = {}
ALL_UNITS_PATTERN = "unit_heatmaps_peryear_all_{method}.json"

for method in ("fill", "fill1", "nofill"):
    fill_fn, linkage_fn, nofill = METHODS[method]
    summary[method] = {}

    # Write per-unit flattened grids for ALL units under this method's
    # gap-fill treatment, same {S, n_windows, units:[{key, n_segments, grid}]}
    # shape as unit_heatmaps_all_{method}.json. nofill keeps nulls.
    all_units_out = []
    for u in raw_units:
        g = fill_fn(u["grid"])
        if nofill:
            grid_list = [[None if not np.isfinite(v) else round(float(v), 2) for v in row] for row in g]
        else:
            grid_list = np.round(g, 2).tolist()
        all_units_out.append({"key": u["key"], "n_segments": u["n_segments"], "grid": grid_list})

    all_units_file = ALL_UNITS_PATTERN.format(method=method)
    json.dump({"S": S, "n_windows": n_windows, "units": all_units_out}, open(all_units_file, "w"))
    print(f"wrote {all_units_file} ({len(all_units_out)} units)")
    print(f"\n=== method: {method} ===")
    print(f"{'bucket':<6}{'seg range':<14}{'units':<8}{'clusters':<10}{'singletons':<12}top-10 sizes")

    for b in (1, 2, 3, 4):
        units = buckets[b]
        grids, out_clusters = cluster_bucket(units, fill_fn, linkage_fn, nofill)

        counts = [u["n_segments"] for u in units]
        seg_min = min(counts) if counts else None
        seg_max = max(counts) if counts else None
        skipped = len(units) < 2
        range_str = f"{seg_min}-{seg_max}" if counts else "n/a"

        sizes = sorted((len(c["unit_keys"]) for c in out_clusters), reverse=True)
        n_singletons = sum(1 for s in sizes if s == 1)

        out_file = OUT_PATTERN.format(method=method, bucket=b)
        json.dump({
            "cut_distance": CUT_DIST,
            "seg_min": seg_min,
            "seg_max": seg_max,
            "n_units": len(units),
            "clusters": out_clusters,
        }, open(out_file, "w"))

        summary[method][f"Q{b}"] = {
            "cut_distance": CUT_DIST,
            "seg_min": seg_min,
            "seg_max": seg_max,
            "n_units": len(units),
            "n_clusters": len(out_clusters),
            "n_singletons": n_singletons,
            "top10_cluster_sizes": sizes[:10],
            "skipped_too_few_units": skipped,
        }

        note = "  (skipped clustering, <2 units)" if skipped else ""
        print(f"Q{b:<5}{range_str:<14}{len(units):<8}{len(out_clusters):<10}{n_singletons:<12}{sizes[:10]}{note}")

json.dump(summary, open(SUMMARY_FILE, "w"), indent=2)

print(f"\nquartile boundaries (n_segments, floor): Q1<={q1}  Q2<={q2}  Q3<={q3}  Q4>{q3}")
out_files = [
    OUT_PATTERN.format(method=m, bucket=b)
    for m in ("fill", "fill1", "nofill")
    for b in (1, 2, 3, 4)
]
all_units_files = [ALL_UNITS_PATTERN.format(method=m) for m in ("fill", "fill1", "nofill")]
print(f"wrote {len(out_files)} cluster files, {', '.join(all_units_files)}, {SUMMARY_FILE}")
