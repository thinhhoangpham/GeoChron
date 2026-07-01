# Plan: Cluster similar (roadbed, county) heatmaps

## Context
Each (roadbed, county) unit's data (from `storyline_data.json`) forms an implicit
heatmap: x = segments ordered by reference marker, y = window (time), cell = mean
condition score `v`. The goal is to find units whose heatmaps look similar — e.g.
two different highway/county pairs that deteriorate in the same spatial-temporal
pattern (uniform decline, moving wave, patchy) — as a higher-level analysis on top
of the existing per-segment cohort pipeline (Steps 1-12, already done). This is a
new analysis, not a continuation of Steps 13-16 (treatment events / validation /
run-scope / JSON emit), which are unrelated to this direction.

Chosen approach (consistent with the project's existing Pearson-based methodology,
e.g. `build_corr.py`): resample each unit's heatmap onto a fixed-size grid, flatten,
and cluster using correlation distance — the same "shape not level" philosophy
already used for segment-level correlation in Step 6.

## Approach

1. **Resample each unit to a fixed grid** (new script `build_unit_heatmaps.py`)
   - Input: `storyline_data.json` (already has per-road, per-segment, per-window `v`).
   - For each `road` (keyed by roadbed·county): build a raw matrix
     `[n_segments x n_windows]` from each segment's `win[].v`, ordered by `marker`
     (segments are already sorted this way on export).
   - Resample space axis to a fixed `S` bins (e.g. S=20) via simple block-averaging
     over `marker`-sorted segments (units have wildly different segment counts, 1 to
     ~300). Time axis (windows) is already fixed-length (25) across all units, so no
     resampling needed there.
   - **Decision: drop units with <3 segments from this analysis** — too little
     spatial structure for a 2D heatmap to mean anything. Write their keys + segment
     counts to `unit_heatmaps_dropped.json` (not silently discarded) so coverage is
     visible and they can be revisited later — e.g. clustered separately as pure
     time-series (no spatial axis), a candidate for a future pass, not this one.
   - Fill remaining NaN cells (empty bins/windows) with the unit's own mean (needed
     for correlation to be defined) — record how many cells were filled, for
     transparency.
   - Output: `unit_heatmaps.json` — `{units: [{key: "roadbed · county", n_segments,
     grid: [S x 25 floats]}]}`.
   - **Alternative (not default): yearly instead of windowed.** Swap the data source
     from `storyline_data.json`'s `win[].v` to `section_year_matrix.csv` directly
     (same raw table `build_corr.py`/`export_evolens_data.py` read), giving a
     `[n_segments x 29 years]` matrix per unit instead of `[n_segments x 25 windows]`.
     Everything downstream (resampling, correlation, clustering) is unchanged — only
     the time axis length/source differs. Tradeoff: sharper year-to-year detail
     (real treatment jumps show as one crisp row instead of smeared across 5 window
     rows) but more real gaps to fill and a noisier per-cell signal, since window
     means already cancel out single-year measurement noise. Revisit this if
     window-based clusters look too smoothed-over to be useful.

2. **Cluster by correlation distance** (new script `cluster_units.py`)
   - Load `unit_heatmaps.json`, flatten each grid to a length-(S*25) vector.
   - Compute pairwise Pearson correlation between all unit vectors (numpy, same
     vectorized approach as `build_corr.py`), convert to distance `d = 1 - r`.
   - Cluster with scipy hierarchical clustering (`scipy.cluster.hierarchy.linkage`
     with precomputed correlation-distance matrix, average linkage) — avoids having
     to pre-pick k like k-means; cut the dendrogram at a distance threshold (tune,
     start ~0.3) or inspect via silhouette score across a few cut heights.
   - Output: `unit_clusters.json` — `{clusters: [{cluster_id, unit_keys: [...],
     avg_grid}]}`, plus a summary printed to console (cluster sizes, largest few).

3. **Quick visual sanity check** (no new front-end feature yet — just enough to
   validate the clustering is finding something real)
   - Add a small script `plot_cluster_sample.py` (matplotlib) that renders a grid of
     heatmap thumbnails (e.g. 4x4) for a couple of clusters side by side, saved as PNG
     for the user to eyeball. Throwaway verification tool, not part of the shipped
     pipeline.

## Files to create
- `build_unit_heatmaps.py` — resampling/export (reads `storyline_data.json`)
- `cluster_units.py` — correlation distance + hierarchical clustering
- `plot_cluster_sample.py` — matplotlib thumbnail grid for spot-checking a few clusters

## Verification
- Run `build_unit_heatmaps.py`, confirm unit count and NaN-fill count printed are
  sane (most units should need little filling since W5 windows already carry means).
- Run `cluster_units.py`, inspect printed cluster-size histogram — expect a handful
  of large "generic decline pattern" clusters plus several small distinctive ones,
  not everything in 1 or 1,112 singleton clusters.
- Run `plot_cluster_sample.py` on the 2-3 largest clusters, visually confirm the
  heatmaps within a cluster look genuinely similar and different across clusters.
- If clustering is degenerate (one giant cluster or all singletons), the tuning lever
  is the dendrogram cut threshold in `cluster_units.py`.

## Open questions for discussion
- Fixed grid size S (spatial bins) — 20 is a guess. Should it scale with typical
  unit size, or stay fixed for comparability?
- Block-averaging vs. interpolation for resampling — averaging is simpler/matches
  existing pipeline's "no fabricated values" philosophy, but loses fine spatial
  detail for large units.
- Correlation distance treats "same shape, different level" as identical — is that
  the right notion of "similar" for this use case, or do we also care about units
  being similarly severe (absolute level), which would call for Euclidean or a
  blended metric?
- Hierarchical clustering cut threshold is a manual tuning knob — worth adding a
  silhouette-score sweep to suggest a good cut automatically, or is eyeballing fine?
- ~~Should single-segment (skipped, <3 segments) units be reported separately~~ —
  **resolved: drop them from this pass, log to `unit_heatmaps_dropped.json`, revisit
  with a separate time-series-only clustering pass later.**
