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

---

# Unit-Level Distribution-Aware Variant

The base pipeline above treats each half-mile **segment** as an entity. The
unit-level variant treats a **(roadbed, county) unit** (a highway within a county,
keyed `"{roadbed} · {county}"`) as the entity, so ~14,810 segments collapse to a
few hundred units. Because a unit bundles many segments, we cannot describe it with
a single number per year without throwing away its condition *distribution*: a
uniformly-fair road and a road that is half-excellent / half-failing can share the
same average and look identical. A single scalar cannot separate those cases —
they differ along two independent axes (how bad on average, and how spread out) —
so each unit carries **two** one-number-per-year series, and the grouping
correlates each series independently.

Filtering: a unit is kept only if it has at least `MIN_SEGMENTS = 5` segments (a
single/few-segment unit has no meaningful distribution). Implemented in
`build_unit_series.py` → `build_unit_sessions.py` → `build_unit_storyline_data.py`.

## U1 — Per-unit, per-year Level and Spread

For a unit in a given year, take the raw 0–100 condition scores of its segments
observed that year. Drop any segment scoring `< 1` (Invalid / no-data). From the
remaining valid scores:

- **Level** — mean of the **squared gap below 100**:
  `Level = mean( (100 − score)² )`.
  A perfect segment contributes 0; the *squaring* makes bad segments count
  disproportionately, so a bad tail cannot be masked by good segments averaging it
  out. (Example: all-fair `[60×10]` → Level 1600; mixed `[80×5, 20×5]`, same mean
  score, → Level 3400.)
- **Spread** — the **population standard deviation** of that year's valid scores
  (`sqrt(mean((score − mean)²))`): "how far, on average, is a segment from the
  unit's own mean that year." Uniform unit → ≈ 0; mixed unit → large.

Edge cases: a year with **no** valid segment is a genuine gap (`null`, no
Level/Spread point — treated like any eligibility gap); a year with exactly **one**
valid segment gets Level normally and **Spread = 0**. Doing this for every year
(1996–2024) yields, per unit, a **Level line** and a **Spread line** — two ordinary
one-value-per-year series. (`level_of` / `spread_of` in `build_unit_series.py`.)

## U2 — Two independent correlations, AND-combined

Correlation is only defined on a single value per year, so the two Spread/Level
values never enter one correlation together. Instead, per window, the base Step
6/7 machinery is run **twice**:

1. Pairwise-complete Pearson on the units' **Level** lines (≥ `MIN_OVERLAP = 4`
   common observed years), thresholded at `r > THR = 0.7` → Level edges.
2. The same, independently, on the units' **Spread** lines → Spread edges.

A pair of units keeps an edge only where it appears in **both** sets — a logical
**AND** (set intersection, `and_edges`). Two units are thus linked only when their
typical condition *and* their internal heterogeneity rise and fall together over
time. Every correlation still sees exactly one number per year; the "two values"
live in two separate single-value streams, not inside one correlation.
(`pairwise_edges`, `and_edges` in `build_unit_sessions.py`.)

## U3 — Gate, cluster, filter, emit (unchanged from the base pipeline)

The AND-combined edges then go through the same later steps at unit granularity:
county spatial gate (Step 8/9 — keep an edge only if both units share a county) →
Louvain communities per window (Step 10, `SEED = 42`) → small-session filter
(Step 11, `THS = 5`, with the neighbor-window rescue rule) → cross-window tracking
by membership overlap (Step 12, done in the front end). Output is
`unit_sessions.json` (per-window cohorts of unit indices).

## U4 — Storyline serialization and color

`build_unit_storyline_data.py` emits `storyline_data_units.json` in the standard
Storyline contract, with **county** as the band and each **unit** as an atom. For
coloring, the distribution-aware Level is mapped back onto the existing 0–100
condition color scale via an *effective* condition score:
`v = round(max(0, 100 − sqrt(Level)), 1)` (i.e. `100 − RMS gap`, which already
penalizes bad tails). Unaffiliated units (no cohort in a window, `s = null`) are
rendered faded in the storyline so packed singleton piles read distinct from real
cohorts.

> **Known limitation:** two numbers still cannot fully encode a multi-category
> distribution — genuinely different segment mixes can occasionally share both
> Level and Spread. Level + Spread is the minimum that separates the cases we care
> about (uniform-good / uniform-fair / uniform-poor / mixed); it is not lossless.
