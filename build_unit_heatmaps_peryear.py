"""
PER-YEAR variant of build_unit_heatmaps.py.

Same fixed-size space x time heatmap grid per (roadbed, county) unit, but the
TIME axis is individual calendar years (29 years, 1996-2024) instead of the 25
overlapping W5 sliding windows. This isolates the effect of temporal windowing:
the spatial S=20 block-nanmean resampling and the flat-mean gap fill are
identical to the W5 build -- only the time axis changes.

Input : unit_segments_full_all.json (roads keyed by "key" == roadbed . county,
         each segment carries scores: [29 per-year condition scores, null-allowed],
         segments already sorted by begin == spatial order).
Output: unit_heatmaps_peryear.json         -- {S, n_windows, units: [{key, n_segments, grid}]}
        unit_heatmaps_peryear_dropped.json -- units with <MIN_SEGMENTS segments
        unit_heatmaps_peryear_raw.json     -- {n_windows, units: [{key, n_segments, grid}]}, grid
          is the UN-resampled n_segments x 29 matrix (real gaps as null).

This is a quick standalone sanity check mirroring how build_unit_heatmaps.py
writes unit_heatmaps.json. The 3-fill-method, all-units, per-quartile clustering
output is produced by cluster_units_peryear.py (same division of labor as the
W5 pipeline).
"""
import json
import warnings
import numpy as np

IN_FILE       = "unit_segments_full_all.json"
OUT_FILE      = "unit_heatmaps_peryear.json"
DROPPED_FILE  = "unit_heatmaps_peryear_dropped.json"
RAW_FILE      = "unit_heatmaps_peryear_raw.json"
S             = 20   # fixed number of spatial bins (same as build_unit_heatmaps.py)
MIN_SEGMENTS  = 5    # units with fewer segments than this are dropped (same as W5 build).

data = json.load(open(IN_FILE, encoding="utf-8"))
n_windows = len(data["years"])   # per-year: 29 columns instead of 25 W5 windows

units, dropped, raw_units = [], [], []
total_cells = filled_cells = 0

for unit in data["units"]:
    key = unit["key"]
    segs = unit["segments"]           # already sorted by begin == spatial order
    n_segments = len(segs)

    if n_segments < MIN_SEGMENTS:
        dropped.append({"key": key, "n_segments": n_segments})
        continue

    # per-year raw: n_segments x 29, null score -> NaN
    raw = np.full((n_segments, n_windows), np.nan, dtype=np.float32)
    for i, seg in enumerate(segs):
        for t, v in enumerate(seg["scores"]):
            if v is not None:
                raw[i, t] = v

    # true per-segment resolution, real gaps as null, no resampling/filling
    raw_units.append({
        "key": key, "n_segments": n_segments,
        "grid": [[None if np.isnan(v) else round(float(v), 2) for v in row] for row in raw],
    })

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

    # fill remaining gaps (empty bin/window) with this unit's own overall mean
    total_cells += grid.size
    nan_mask = ~np.isfinite(grid)
    n_nan = int(nan_mask.sum())
    filled_cells += n_nan
    if n_nan:
        unit_mean = np.nanmean(grid)
        if not np.isfinite(unit_mean):
            unit_mean = 0.0
        grid[nan_mask] = unit_mean

    units.append({"key": key, "n_segments": n_segments,
                  "grid": np.round(grid, 2).tolist()})

json.dump({"S": S, "n_windows": n_windows, "units": units},
          open(OUT_FILE, "w"))
json.dump({"min_segments": MIN_SEGMENTS, "dropped": dropped},
          open(DROPPED_FILE, "w"), indent=2)
json.dump({"n_windows": n_windows, "units": raw_units}, open(RAW_FILE, "w"))

print(f"units kept: {len(units)}   units dropped (<{MIN_SEGMENTS} segments): {len(dropped)}")
print(f"grid cells filled from gaps: {filled_cells:,} / {total_cells:,} "
      f"({filled_cells / total_cells:.2%})")
print(f"wrote {OUT_FILE}, {DROPPED_FILE}, {RAW_FILE}")
