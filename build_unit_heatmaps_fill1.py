"""
Variant of build_unit_heatmaps.py using a different gap-fill strategy
("option 1"), for comparison against the original flat-mean fill.

Input : storyline_data.json (same as build_unit_heatmaps.py)
Output: unit_heatmaps_fill1.json -- {S, n_windows, units: [{key, n_segments, grid}]}

Fill strategy (applied to the S x n_windows resampled grid, same resampling
as build_unit_heatmaps.py -- block-average n_segments into S spatial bins):

  1. Temporal fill (primary): for each spatial bin (row), forward-fill from
     the most recent real/previously-filled window; any leading gap (bin has
     no data yet at window 0) is then backward-filled from the first window
     that does have data. This preserves the unit's own trend near a gap
     instead of collapsing it to a flat mean.
  2. Spatial interpolation (secondary, for bins with NO data in ANY window --
     step 1 has nothing to propagate): for each window column, linearly
     interpolate between the nearest bins (by bin index) that do have a
     value; edge bins with no bin on one side fall back to nearest-neighbor.
  3. Rare final fallback (a unit with literally zero real data anywhere,
     should not happen post Step-4 eligibility): 0.0.

Both fill passes only ever touch cells that were NaN after resampling --
cells backed by a real observation are never overwritten.
"""
import json
import warnings
import numpy as np

IN_FILE      = "storyline_data_hwcounty.json"
OUT_FILE     = "unit_heatmaps_fill1.json"
DROPPED_FILE = "unit_heatmaps_fill1_dropped.json"
S            = 20
MIN_SEGMENTS = 15  # same threshold as build_unit_heatmaps.py, for a fair comparison

data = json.load(open(IN_FILE, encoding="utf-8"))
n_windows = len(data["windows"])

units, dropped = [], []
total_cells = temporal_filled = spatial_filled = fallback_filled = 0

for road in data["roads"]:
    key = road["roadbed"]
    segs = road["segments"]
    n_segments = len(segs)

    if n_segments < MIN_SEGMENTS:
        dropped.append({"key": key, "n_segments": n_segments})
        continue

    raw = np.full((n_segments, n_windows), np.nan, dtype=np.float32)
    for i, seg in enumerate(segs):
        for w in seg["win"]:
            if w["v"] is not None:
                raw[i, w["k"]] = w["v"]

    bounds = np.linspace(0, n_segments, S + 1).round().astype(int)
    grid = np.full((S, n_windows), np.nan, dtype=np.float32)
    for b in range(S):
        lo, hi = bounds[b], max(bounds[b + 1], bounds[b] + 1)
        hi = min(hi, n_segments)
        block = raw[lo:hi]
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", category=RuntimeWarning)
            grid[b] = np.nanmean(block, axis=0)

    total_cells += grid.size
    had_data_before = np.isfinite(grid)

    # 1. temporal ffill then bfill, per spatial bin (row)
    for b in range(S):
        row = grid[b]
        last = np.nan
        for t in range(n_windows):
            if np.isfinite(row[t]):
                last = row[t]
            elif np.isfinite(last):
                row[t] = last
        nxt = np.nan
        for t in range(n_windows - 1, -1, -1):
            if np.isfinite(row[t]):
                nxt = row[t]
            elif np.isfinite(nxt):
                row[t] = nxt

    temporal_filled += int((~had_data_before & np.isfinite(grid)).sum())
    after_temporal = np.isfinite(grid).copy()

    # 2. spatial interpolation across bins, per window (column) -- only for
    # rows that had no data in ANY window (temporal fill had nothing to give)
    for t in range(n_windows):
        col = grid[:, t]
        finite_idx = np.flatnonzero(np.isfinite(col))
        if len(finite_idx) == 0 or len(finite_idx) == S:
            continue
        nan_idx = np.flatnonzero(~np.isfinite(col))
        col[nan_idx] = np.interp(nan_idx, finite_idx, col[finite_idx])

    spatial_filled += int((~after_temporal & np.isfinite(grid)).sum())

    # 3. rare fallback: unit had zero real data anywhere
    still_nan = ~np.isfinite(grid)
    fallback_filled += int(still_nan.sum())
    if still_nan.any():
        grid[still_nan] = 0.0

    units.append({"key": key, "n_segments": n_segments,
                  "grid": np.round(grid, 2).tolist()})

json.dump({"S": S, "n_windows": n_windows, "units": units}, open(OUT_FILE, "w"))
json.dump({"min_segments": MIN_SEGMENTS, "dropped": dropped}, open(DROPPED_FILE, "w"), indent=2)

print(f"units kept: {len(units)}   units dropped (<{MIN_SEGMENTS} segments): {len(dropped)}")
print(f"grid cells: {total_cells:,}")
print(f"  temporal-filled (ffill/bfill): {temporal_filled:,} ({temporal_filled/total_cells:.2%})")
print(f"  spatial-filled (interpolation): {spatial_filled:,} ({spatial_filled/total_cells:.2%})")
print(f"  fallback-filled (0.0, unit had no data at all): {fallback_filled:,}")
print(f"wrote {OUT_FILE}")
