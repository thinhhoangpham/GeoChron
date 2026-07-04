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
  single-corridor-only `build_paper_storyline.py` prototype — out of scope here).
- **Condition coloring uses the categorical PMIS palette everywhere**, not the continuous
  RdYlGn scale: bars, connectors, *and* the condition-mode legend all use
  `pmisCategoryColor`/its thresholds (Very Good/Good/Fair/Poor/Very Poor/Invalid/No data,
  per `heatmap.js`). This is a deliberate deviation from `storyline.js`'s default flat-bar
  behavior (which falls back to the continuous `conditionColor`/RdYlGn when a point has no
  `yv` array — which is always true here, since each column already is one year).
- **EvoLens drill-down is included.** `storyline_peryear.js` exposes the same
  `window.__storyline` read-only hook (`state`, `canvas`, `colX`, `colPitch`,
  `MARGIN_LEFT`, `visibleRoadIndices`, `getPointsCache`, `redraw`) that `evolens.js`
  consumes, and both new HTML pages load `evolens.js` alongside `heatmap.js`, matching
  `index.html`'s script set.
- **Two separate HTML pages per rule**, mirroring `index.html`/`index_county.html`:
  `storyline_peryear.html` (hwcounty) and `storyline_peryear_county.html` (county).
- **Wire schema matches the existing `storyline_data_*.json` shape exactly** (not a new
  `"years"`/`"year"` shape), so `storyline_peryear.js` and `evolens.js` need no
  schema-translation logic:
  - `"windows"`: `[{"k": 0, "start": middle_year, "end": middle_year, "label": str(middle_year)}, ...]`
    — `start === end === middle_year` for every entry (each window/column now spans exactly
    one year), `k` is a contiguous 0-based index over the sorted middle years (**not** the
    original `windows_W5.json` window index).
  - Each segment's per-column entries: `{"k": <contiguous index above>, "s": <session id
    or null>, "v": <the segment's own raw score at that middle year, or null>}` — no `"yv"`
    field (there is nothing to subdivide; each column is already one year).

## Changes

### 1. Data — new script `step17_storyline_peryear.py`

- Inputs (unchanged, same as `step17_storyline_data.py`): `windows_W5.json`,
  `step11_sessions_W5_{RULE}.json`, `section_year_matrix.csv`, `sections_meta.csv`.
- For each window `k` in `windows_W5.json` (sorted by `start`): `middle_year = w["start"] + 2`.
  Assign a new contiguous 0-based column index `k2` (position in this sorted list) — this
  is what gets written out as `"k"`, distinct from the original `windows_W5.json` index.
- Per segment, per window it was eligible for (same eligibility as today —
  membership in `windows_W5.json`'s `section_idx`), emit one entry:
  ```python
  {"k": k2, "s": seg_session[m].get(k), "v": year_score(m, middle_year)}
  ```
  where `year_score(seg, year)` looks up `SCORES[seg, yidx[year]]`, rounded, or `None` if
  NaN — i.e. the segment's own value at that single year, not `wscore`'s window mean.
- Output shape matches `step17_storyline_data.py`'s `roads`/`segments`/`windows` structure
  exactly (same field names, so `storyline_peryear.js`/`evolens.js` need no translation),
  with every window entry's `start`/`end` collapsed to the same single `middle_year` and
  `label` set to the plain year string:
  ```json
  {
    "windows": [
      {"k": 0, "start": 1998, "end": 1998, "label": "1998"},
      {"k": 1, "start": 1999, "end": 1999, "label": "1999"},
      ...
    ],
    "roads": [
      { "roadbed": "76 - FAYETTE",
        "segments": [
          { "id": "...", "marker": ..., "begin": ..., "end": ..., "roadbed": ...,
            "county": ..., "pavtype": ...,
            "win": [ {"k": 0, "s": 2, "v": 78.0}, ... ] } ] } ]
  }
  ```
- Same `roadbed`/`county` band-keying logic as today (`hwcounty` vs `county` rule), same
  `clean_and_round` handling for `begin_marker`/`begin_disp`.
- CLI: `python step17_storyline_peryear.py [county|hwcounty]` (default `hwcounty`), run
  once per rule to produce both outputs — same convention as `step17_storyline_data.py`.
- Output files: `storyline_data_peryear_hwcounty.json`, `storyline_data_peryear_county.json`.

### 2. Front-end — new files

- **`storyline_peryear.js`**: copied from `storyline.js`'s existing layout/render engine
  (per-column stacked segments, barycenter-sweep ordering, WebGL-with-Canvas-2D-fallback
  rendering, connectors, tooltips, road search/dropdown, sliders, the `window.__storyline`
  EvoLens hook), then edited so that in condition mode:
  - flat bars use `pmisCategoryColor(p.v)` instead of `conditionColor(p.v)`;
  - connectors (`edgeColor`) use `pmisCategoryColor` instead of `conditionColor` for the
    default (non-cohort/highway/pavtype, non-gradient) branch;
  - the condition-mode legend (`updateColorLegend`) renders discrete PMIS swatches (Very
    Good/Good/Fair/Poor/Very Poor/Invalid/No data with their fixed colors) instead of a
    sampled RdYlGn gradient bar.
  No other logic changes: since the new data never includes `yv`, the existing per-year
  sub-cell code paths are simply never taken (dead code for this page, left in place to
  keep the copy mechanical rather than selectively stripped).
- **`storyline_peryear.html`**: loads `storyline_data_peryear_hwcounty.json` via
  `storyline_peryear.js` + `heatmap.js` + `evolens.js`, page shell mirrors `index.html`.
- **`storyline_peryear_county.html`**: loads `storyline_data_peryear_county.json`, page
  shell mirrors `index_county.html`.

## Affected files

- New: `step17_storyline_peryear.py`.
- New: `storyline_peryear.js`, `storyline_peryear.html`, `storyline_peryear_county.html`.
- New generated data: `storyline_data_peryear_hwcounty.json`,
  `storyline_data_peryear_county.json`.
- Unmodified: `step17_storyline_data.py`, `storyline.js`, `index.html`, `index_county.html`,
  `windows_W5.json`, `step6_corr.py`, `step8_network.py`, `step10_communities.py`,
  `step11_filter.py`, `heatmap.js`, `evolens.js` (loaded by the new pages as-is, unmodified).

## Testing / verification

- Generate both outputs: `python step17_storyline_peryear.py hwcounty` and
  `python step17_storyline_peryear.py county`.
- Confirm the output `windows` list's `label`s = `windows_W5.json`'s middle years
  (`start+2` for each of the 25 windows, 25 distinct consecutive years, each with
  `start === end === label`) and that the first/last 2 years of `section_year_matrix.csv`
  never appear.
- Spot-check a known segment: its `v` at year Y in the new output equals its raw
  `section_year_matrix.csv` value at year Y (not a window mean).
- Load `storyline_peryear.html` and `storyline_peryear_county.html`: columns are labeled by
  single years, condition coloring shows the PMIS categorical palette per column, cohort
  coloring/tooltips/road search behave as in the existing pages.
- Confirm `index.html`, `index_county.html`, `storyline.js`, `step17_storyline_data.py` are
  untouched and still work as before.
