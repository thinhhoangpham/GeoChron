"""
Variant of build_unit_heatmaps.py using NO gap fill ("option 2"), for
comparison against the flat-mean fill and the fill1 (ffill/bfill + spatial
interpolation) variant.

Input : storyline_data.json (same as build_unit_heatmaps.py)
Output: unit_heatmaps_nofill.json -- {S, n_windows, units: [{key, n_segments, grid}]}
  grid cells with no real data after space-resampling stay `null`. Resampling
  itself is unavoidable (units have different segment counts, so raw
  per-segment vectors aren't directly comparable length) but no value is
  invented for an empty bin/window -- cluster_units_nofill.py must handle the
  resulting NaNs (pairwise-complete correlation) rather than this script.
"""
import json
import warnings
import numpy as np

IN_FILE      = "storyline_data_hwcounty.json"
OUT_FILE     = "unit_heatmaps_nofill.json"
DROPPED_FILE = "unit_heatmaps_nofill_dropped.json"
S            = 20
MIN_SEGMENTS = 5  # same threshold as build_unit_heatmaps.py, for a fair comparison

data = json.load(open(IN_FILE, encoding="utf-8"))
n_windows = len(data["windows"])

units, dropped = [], []
total_cells = nan_cells = 0

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
    nan_cells += int((~np.isfinite(grid)).sum())

    units.append({
        "key": key, "n_segments": n_segments,
        "grid": [[None if not np.isfinite(v) else round(float(v), 2) for v in row] for row in grid],
    })

json.dump({"S": S, "n_windows": n_windows, "units": units}, open(OUT_FILE, "w"))
json.dump({"min_segments": MIN_SEGMENTS, "dropped": dropped}, open(DROPPED_FILE, "w"), indent=2)

print(f"units kept: {len(units)}   units dropped (<{MIN_SEGMENTS} segments): {len(dropped)}")
print(f"grid cells left null (no fill): {nan_cells:,} / {total_cells:,} ({nan_cells/total_cells:.2%})")
print(f"wrote {OUT_FILE}")
