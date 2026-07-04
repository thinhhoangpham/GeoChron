# Storyline per-year columns (paper-faithful window→slice assignment)

**Date:** 2026-07-04
**Status:** Approved design, pending implementation plan

## Problem

The current Storyline (`step17_storyline_data.py` + `storyline.js` + `index.html`/
`index_county.html`) lays out one column per **sliding 5-year window** (`windows_W5.json`,
W=5, step 1 year → 25 windows), each labeled with a `"start-end"` range (e.g. `1996-2000`).

The GeoChron paper's Step 2 ("Determining Correlation in a Time Slice") computes
correlation over a window that *wraps* a single focus time slice plus its neighbors, then
assigns the result back to that one focus slice — not to the window as a whole. Applied to
this project (annual PMIS data, W=5 windows already centered: window `k` spans
`years[k]..years[k+4]`, so its middle year is `start+2`), this means each window's
correlation/session result should be attributed to its single **middle year**, and the
Storyline should show **one column per year**, not per window.

We want a second, parallel version of the Storyline that does this, so it can be compared
side by side with the existing window-range version.

## Decisions (locked)

- **New parallel files** — nothing in the existing pipeline (`step17_storyline_data.py`,
  `storyline.js`, `index.html`, `index_county.html`) is modified. This is purely additive,
  matching the project's existing pattern of coexisting experiment variants.
- **No upstream recomputation.** `windows_W5.json` / `step6_corr.py` / `step8_network.py` /
  `step10_communities.py` / `step11_filter.py` are reused exactly as they are today. Window
  `k`'s correlation/network/community/session-filtering result is simply **relabeled** to
  `middle_year = start + 2` — it is a 1:1 relabeling of the 25 existing windows, not a new
  correlation computation.
- **Edge years are dropped.** The first 2 and last 2 years of the dataset have no centered
  5-year window and therefore never appear as a `middle_year` of any window — they are
  absent from the per-year output with no special-casing required. The per-year Storyline's
  time range is `years[2] .. years[-3]`.
- **Column value = the year's own raw score**, not the window mean. Each segment's
  per-year entry carries the segment's actual observed score in that specific year
  (`null` if unobserved that year), replacing the current window-mean `v`.
- **Both proximity rules** (`hwcounty` and `county`) are supported, matching the existing
  dual-output convention.
- **Layout style unchanged from `storyline.js`**: per-segment stacked-bar columns with
  barycenter-sweep ordering, canvas/WebGL rendering, connectors between columns, tooltips,
  road search. No StoryFlow-style tracked/bundled-cohort lanes (that's the separate,
  single-corridor-only `build_paper_storyline.py` prototype — out of scope here). Condition
  coloring reuses the PMIS categorical palette already in `storyline.js`
  (`pmisCategoryColor`, per `heatmap.js`'s thresholds).
- **Two separate HTML pages per rule**, mirroring `index.html`/`index_county.html`:
  `storyline_peryear.html` (hwcounty) and `storyline_peryear_county.html` (county).

## Changes

### 1. Data — new script `step17_storyline_peryear.py`

- Inputs (unchanged, same as `step17_storyline_data.py`): `windows_W5.json`,
  `step11_sessions_W5_{RULE}.json`, `section_year_matrix.csv`, `sections_meta.csv`.
- For each window `k` in `windows_W5.json`: `middle_year = w["start"] + 2`.
- Per segment, per window it was eligible for (same eligibility as today —
  membership in `windows_W5.json`'s `section_idx`), emit one entry:
  ```python
  {"year": middle_year, "s": seg_session[m].get(k), "v": year_score(m, middle_year)}
  ```
  where `year_score(seg, year)` looks up `SCORES[seg, yidx[year]]`, rounded, or `None` if
  NaN — i.e. the segment's own value at that single year, not `wscore`'s window mean.
- Output shape mirrors `step17_storyline_data.py`'s `roads`/`segments` structure, with
  `"windows"` renamed to `"years"` (sorted list of middle years present) and each
  segment's per-column entries keyed by `"year"` instead of `"k"`/`"s"`/`"v"` derived from
  a range:
  ```json
  {
    "years": [1998, 1999, ..., 2022],
    "roads": [
      { "roadbed": "76 - FAYETTE",
        "segments": [
          { "id": "...", "marker": ..., "begin": ..., "end": ..., "roadbed": ...,
            "county": ..., "pavtype": ...,
            "win": [ {"year": 1998, "s": 2, "v": 78.0}, ... ] } ] } ]
  }
  ```
- Same `roadbed`/`county` band-keying logic as today (`hwcounty` vs `county` rule), same
  `clean_and_round` handling for `begin_marker`/`begin_disp`.
- CLI: `python step17_storyline_peryear.py [county|hwcounty]` (default `hwcounty`), run
  once per rule to produce both outputs — same convention as `step17_storyline_data.py`.
- Output files: `storyline_data_peryear_hwcounty.json`, `storyline_data_peryear_county.json`.

### 2. Front-end — new files

- **`storyline_peryear.js`**: adapted from `storyline.js`'s existing layout/render engine
  (per-column stacked segments, barycenter-sweep ordering, WebGL-with-Canvas-2D-fallback
  rendering, connectors, tooltips, road search/dropdown, sliders). Column axis label is the
  single year (e.g. `1998`) instead of a `start-end` range. Condition color for a column
  uses that column's `v` (the year's own raw score) through the same `pmisCategoryColor`
  logic already in `storyline.js`. Cohort coloring (`s`) unchanged in spirit — colors by
  session/cohort id per column.
- **`storyline_peryear.html`**: loads `storyline_data_peryear_hwcounty.json` via
  `storyline_peryear.js`, page shell mirrors `index.html`.
- **`storyline_peryear_county.html`**: loads `storyline_data_peryear_county.json`, page
  shell mirrors `index_county.html`.

## Affected files

- New: `step17_storyline_peryear.py`.
- New: `storyline_peryear.js`, `storyline_peryear.html`, `storyline_peryear_county.html`.
- New generated data: `storyline_data_peryear_hwcounty.json`,
  `storyline_data_peryear_county.json`.
- Unmodified: `step17_storyline_data.py`, `storyline.js`, `index.html`, `index_county.html`,
  `windows_W5.json`, `step6_corr.py`, `step8_network.py`, `step10_communities.py`,
  `step11_filter.py`, `heatmap.js`.

## Testing / verification

- Generate both outputs: `python step17_storyline_peryear.py hwcounty` and
  `python step17_storyline_peryear.py county`.
- Confirm `years` = `windows_W5.json`'s middle years (`start+2` for each of the 25 windows,
  25 distinct consecutive years) and that the first/last 2 years of
  `section_year_matrix.csv` never appear.
- Spot-check a known segment: its `v` at year Y in the new output equals its raw
  `section_year_matrix.csv` value at year Y (not a window mean).
- Load `storyline_peryear.html` and `storyline_peryear_county.html`: columns are labeled by
  single years, condition coloring shows the PMIS categorical palette per column, cohort
  coloring/tooltips/road search behave as in the existing pages.
- Confirm `index.html`, `index_county.html`, `storyline.js`, `step17_storyline_data.py` are
  untouched and still work as before.
