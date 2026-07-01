"""
Build a fixed-size space x time heatmap grid per (roadbed, county) unit, for
clustering units whose deterioration patterns look similar (space = segments
ordered by reference marker, time = the same W5 windows used everywhere else).

Input : storyline_data.json (roads keyed by "roadbed · county", each segment
         carries win: [{k, s, v}] -- v is the mean condition score for window k).
Output: unit_heatmaps.json        -- {S, n_windows, units: [{key, n_segments, grid}]}
        unit_heatmaps_dropped.json -- units with <MIN_SEGMENTS segments, not silently lost
        unit_heatmaps_raw.json     -- {n_windows, units: [{key, n_segments, grid}]}, grid
          is the UN-resampled n_segments x n_windows matrix (real gaps as null, no
          fill/averaging at all) -- for display when the true segment resolution
          matters more than cross-unit comparability.

The resampled (S x n_windows, gap-filled) grid is what clustering compares units
on -- it needs a fixed size and no NaNs. The raw grid is never resampled or
filled; it's the original per-segment, per-window data, kept only for units that
passed the same MIN_SEGMENTS filter (so raw and clustered/resampled views agree
on which units exist).
"""
import json
import warnings
import numpy as np

IN_FILE       = "storyline_data.json"
OUT_FILE      = "unit_heatmaps.json"
DROPPED_FILE  = "unit_heatmaps_dropped.json"
RAW_FILE      = "unit_heatmaps_raw.json"
S             = 20   # fixed number of spatial bins
MIN_SEGMENTS  = 15   # units with fewer segments than this are dropped (see plan).
                     # Raised from 3: with S=20 spatial bins, units with far fewer
                     # segments than S end up mostly filled with their own flat
                     # mean (confirmed artifact on SH0240 R, 6 segments -> ~65%
                     # fabricated flat cells). 15 trades coverage (775->295 units)
                     # for meaningfully less filler per heatmap (39.5%->29.4%).

data = json.load(open(IN_FILE, encoding="utf-8"))
n_windows = len(data["windows"])

units, dropped, raw_units = [], [], []
total_cells = filled_cells = 0

for road in data["roads"]:
    key = road["roadbed"]
    segs = road["segments"]           # already marker-sorted by export_storyline_data.py
    n_segments = len(segs)

    if n_segments < MIN_SEGMENTS:
        dropped.append({"key": key, "n_segments": n_segments})
        continue

    raw = np.full((n_segments, n_windows), np.nan, dtype=np.float32)
    for i, seg in enumerate(segs):
        for w in seg["win"]:
            if w["v"] is not None:
                raw[i, w["k"]] = w["v"]

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
            unit_mean = 0.0  # entire unit had no data at all (shouldn't happen post Step-4 eligibility)
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
