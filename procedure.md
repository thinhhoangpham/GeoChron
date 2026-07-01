# Procedure: Cohort-Based Pavement Trajectory Analysis

## Step 1 — Define entities

Each highway section (half-mile segment) is one entity. Build a stable section ID from highway + begin reference marker so it's consistent across years and across your CSV and GeoJSON.

## Step 2 — Build the section × year matrix

Pivot your data so rows are sections, columns are years, cells are the condition score. Where a section has multiple records in one year, collapse them by length-weighted average. Keep only sections observed in at least N years (e.g. 10) so trajectories are long enough to be meaningful.

## Step 3 — Preserve gaps (do not interpolate)

Leave missing years empty — keep the matrix 100% real observations. Interpolation would fabricate values, and with sparse annual sampling each invented point is a large fraction of the signal and can manufacture a trend the pavement never had. Instead, handle gaps where they belong: at the correlation step (Step 6), compute similarity only over the years both sections were actually observed (pairwise-complete), and require a minimum number of real overlapping years for a pair to count. A section with a missing year simply contributes to fewer windows rather than a guessed value. Downstream line charts (Step 17) should render true gaps as broken lines, not smoothed through.

## Step 4 — Choose the time slice as a sliding multi-year window

Pick a window width W (start with 5–7 years) and step it forward by 1 year. Window 1 = years [t, t+W−1], window 2 = [t+1, t+W], and so on. Each window is one Storyline slice. This replaces both the single-year slice and the separate 3-slice wrapping window from the paper — the window overlap gives you the cross-slice smoothing for free.

## Step 5 — Normalize trajectories within each window

For each section's W-year sub-trajectory, either z-normalize (or min/max normalize) it, or convert to year-over-year first differences. This makes "correlated" mean *same deterioration rhythm* rather than *same absolute score*, so a section at 90 and a section at 50 can still be in the same cohort if they're both dropping at the same pace.

## Step 6 — Compute pairwise trend similarity inside each window

For every pair of sections in the window, compute Pearson correlation on the normalized trajectories, using only the years both sections were actually observed (pairwise-complete — no interpolated points). Require a minimum number of real overlapping years (`MIN_OVERLAP`, e.g. 4 of a W=5–7 window); pairs below that get no edge this window. DTW is an alternative if you prefer. This is genuinely pairwise, done independently for each window.

## Step 7 — Threshold the similarity to binary

A pair is "trend-correlated" if its correlation exceeds thr (start at 0.7, tune later). Don't keep it as a graded weight for the clustering decision — reduce it to yes/no, exactly as the paper does.

## Step 8 — Build the spatial proximity rule, also binary

Two sections are "close" if either: (a) they're on the same highway and within some reference-marker distance along the route, or (b) they're in the same district / within a haversine radius for cross-route corridor effects. Union these into one yes/no "spatially close" relation.

## Step 9 — Build the relation network per window

Nodes are sections. Draw an edge between two sections only if they are *both* trend-correlated (Step 7) *and* spatially close (Step 8). Keep the two filters separate and intersect them — do not sum them into a single distance.

## Step 10 — Detect communities with Louvain

Run Louvain on each window's network. Each community is one evolution pattern (session) for that window. Louvain needs no preset number of clusters.

## Step 11 — Filter small sessions

Drop sessions below a minimum size ths (and, following the paper, keep a small one only if its members feed into a large session in a neighboring window). This controls clutter.

## Step 12 — Track sessions across windows

For each consecutive window pair, link each session to the session in the next window with the largest membership overlap. These links are the curves passing between bundles — the Storyline's continuity.

## Step 13 — Detect treatment events (your addition)

Flag year-over-year jumps consistent with a rehab/overlay. These explain why a cohort splits — a subset gets treated, jumps up, and leaves the bundle. Carry these as annotations on the sections.

## Step 14 — Validate

Use ARI/purity against natural ground truth — do cohorts align with known construction projects, district maintenance programs, or pavement type? Also check cohort stability across overlapping windows (cohorts should persist and break mainly at treatment events).

## Step 15 — Decide run scope

Run per district or per corridor group rather than statewide, so the network is dense enough to be interesting and the map stays legible. Do a statewide pass only for cross-district comparison.

## Step 16 — Emit output for the front end

Write the entities (with coordinates and full time series), the per-window sessions (with size, mean score, centroid), and the cross-window transitions to JSON — the structure your existing assemble step already produces.

## Step 17 — Two-level visualization

- **Level 1:** Storyline with sections as curves bundled by cohort, gradient shade encoding score, linked to a map by session coloring.
- **Level 2:** EvoLens drill-down showing the actual sawtooth trajectories plus a trend motif (quartile band of the normalized cohort).

---

> **Note:** The one step that is non-negotiable for your data is **Step 4 plus Step 5** — windowing into multi-year slices and normalizing to trend — because annual sampling can't support the paper's original single-day-slice correlation.
