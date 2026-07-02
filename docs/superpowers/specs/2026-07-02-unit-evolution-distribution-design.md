# Unit-Level Evolution Pattern (Distribution-Aware)

**Date:** 2026-07-02
**Status:** Approved design, ready for implementation plan

## Goal

Add a new version of the evolution-pattern storyline where each **actor is a
highway-county unit** (`roadbed · county`, e.g. "SH0240 · Tarrant") instead of an
individual half-mile segment. Each unit collapses its segments into a compact
per-year summary and is drawn as one band, bundled with other units that decay in
sync.

This reduces the ~14,810 segments to the highway-county units that pass a
`>= 5` segment filter (`MIN_SEGMENTS = 5` — drop near-empty units that have no
meaningful distribution; a single- or few-segment unit has essentially no
spread). Same unit definition as `build_unit_heatmaps.py`, source
`storyline_data_hwcounty.json`.

## The core problem this solves

Collapsing a unit's segments to a **single average score per year** loses the
condition *distribution*: a uniformly-fair road and a road that is half-great /
half-failing can share the same average and look identical. A single number
cannot fix this, because the cases differ along **two independent axes** — how
bad on average, and how spread out. One number is one axis. Therefore each unit
is described by **two numbers per year**, not one.

Crucially, this does **not** require correlating multi-valued data. Each unit
produces **two separate single-value time series**; every correlation still runs
on one-number-per-year.

## Per unit, per year: two numbers

Given the bag of raw 0–100 condition scores for a unit's segments in a given
year (segments with score `< 1` — Invalid / no-data — are excluded first):

- **Level** = mean over segments of the **squared gap below 100**:
  `mean( ((100 - score))^2 )`. Bad segments weigh disproportionately more;
  smooth function of the raw score (no category bucketing).
- **Spread** = **standard deviation** of the segments' raw scores that year.
  Uniform unit → spread near 0; mixed unit → large spread.

Edge cases:
- A year in which the unit has `< 1` valid segment contributes no Level/Spread
  point for that year (a true gap, treated like other eligibility gaps).
- A year with exactly 1 valid segment: Level computed normally; Spread = 0.

Result: each unit gets a **Level line** and a **Spread line**, one value per year
across 1996–2024 (same yearly grid EvoLens uses).

## Grouping (bundling)

Reuse the existing evolution-pattern machinery (Step 6 pairwise Pearson per
window → threshold → Step 8/9 spatial filter → Step 10 communities → Step 11
session filter → Step 12 cross-window tracking), but run the correlation stage
**twice, independently**:

- correlate units on their **Level** lines (one number/year — standard Pearson),
- correlate units on their **Spread** lines (one number/year — standard Pearson).

Two units form an edge in a window only when **both** the Level and the Spread
correlations clear the threshold (logical AND). Every correlation sees exactly
one number per year; no multi-valued correlation is ever computed.

The spatial proximity gate stays as-is but now operates at the unit level
(highway-county units in the same county / adjacency rule already used).

## Rendering

Reuse `storyline.js` unchanged where possible. Each unit is one band in the
storyline:

- **position / color** from the Level value (mapped to the existing condition
  color scale; higher distress → redder),
- **band thickness** from the Spread value (thin = uniform, thick = mixed),
- bundled into cohorts by the grouping above.

Delivered as a new data file shaped like `storyline_data_hwcounty.json` plus a
host page that points `storyline.js` at it (mirrors how `index.html` /
`index_county.html` select their data file). No new front-end framework.

## Components / data flow

1. **Unit summary builder** (new Python step): reads the per-segment yearly
   scores (as `step17_evolens_data.py` / `section_year_matrix.csv` provide) plus
   the unit membership (`roadbed · county`), emits per-unit Level and Spread
   yearly series. Applies the `>= 5` segment filter (`MIN_SEGMENTS = 5`).
2. **Grouping**: feed the Level and Spread series through the Step 6–12 pipeline
   at unit granularity, with the two-correlation AND rule.
3. **Storyline data export**: assemble the storyline JSON (unit = actor, cohort
   ids per window, Level for color, Spread for thickness).
4. **Host page**: new HTML that sets the data file and loads `storyline.js`.

## Explicitly out of scope (YAGNI)

- Per-category penalty tables (kept smooth raw-score penalty; can revisit).
- County-only unit variant (this design targets highway-county only for now).
- Any change to the existing segment-level storyline or heatmap tools.

## Known limitation (accepted)

Even with Level + Spread, two numbers cannot capture every nuance of a
multi-category distribution; genuinely different mixes could occasionally share
both values. This is accepted — Level + Spread is the minimum that separates the
cases we care about (uniform-good / uniform-fair / uniform-poor / mixed).
