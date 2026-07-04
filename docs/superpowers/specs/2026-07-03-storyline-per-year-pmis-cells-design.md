# Storyline per-year PMIS-colored cells

**Date:** 2026-07-03
**Status:** Approved design, pending implementation plan

## Problem

In the first-level Storyline (`storyline.js`), each segment's window bar is drawn as
**one flat color** derived from the *mean* condition score over the window's 5 years
(`v = nanmean` in `step17_storyline_data.py`, mapped via `conditionColor` /
`d3.interpolateRdYlGn`). The within-window trend is lost — a window that decayed from
Good to Poor looks identical to a steady Fair.

The GeoChron paper instead encodes the whole time series along each curve (gradient
stroke). We want the analogous fidelity here: show **each year** in the window with its
own condition color, using the project's existing **PMIS categorical palette**.

## Decisions (locked)

- **Layout:** subdivide each window bar into per-year cells. Windows slide by 1 year
  (W=5, 25 windows over 1996–2024), so calendar years repeat across overlapping bars —
  accepted intentionally.
- **Cell style:** discrete, hard-edged cells (N equal cells per window, N = years in that
  window's column). Not a smooth gradient.
- **Color scale:** the **PMIS categorical palette** from `heatmap.js:15-37`, reused verbatim.
- **Scope:** applies to **condition** color mode only. **Cohort** mode unchanged
  (it encodes group hue, not per-year condition).
- **Connectors** between windows unchanged — still colored by the window mean `v`.
- **No per-year hover** — tooltip stays window-level. Easy follow-up if wanted later.
- **No-data years** (unobserved / NaN) render as full-width grey cells (`#999999`), no gaps.

## PMIS palette (from `heatmap.js`, reproduced exactly)

| Category  | Threshold | Color             |
|-----------|-----------|-------------------|
| Very Good | score ≥ 90 | `rgb(21,128,61)`  |
| Good      | score ≥ 70 | `rgb(34,197,94)`  |
| Fair      | score ≥ 50 | `rgb(234,179,8)`  |
| Poor      | score ≥ 35 | `rgb(249,115,22)` |
| Very Poor | score < 35 | `rgb(239,68,68)`  |
| Invalid   | score < 1  | `rgb(200,200,200)`|
| No data   | null/NaN   | `#999999`         |

## Changes

### 1. Data — `step17_storyline_data.py`

- Each per-window entry today: `{"k", "s", "v"}` (line ~118), where `v = wscore(seg,k)`
  is the `nanmean` over `wcols[k]` (line ~85-87).
- **Add** a per-year array `yv` = raw yearly scores for that window's columns:
  ```python
  def yvals(seg, k):
      return [round(float(SCORES[seg, c]), 1) if np.isfinite(SCORES[seg, c]) else None
              for c in wcols[k]]
  ...
  seg_win[m] = [{"k": k, "s": seg_session[m].get(k), "v": wscore(m, k), "yv": yvals(m, k)}
                for k in ks]
  ```
- Keep `v` (connectors + cohort mode still use it).
- Regenerate both variants the front-end loads:
  `python step17_storyline_data.py hwcounty` and `python step17_storyline_data.py county`.
- `export_storyline_data.py` is a near-duplicate; if it is still used to (re)generate any
  loaded file, apply the same change there. Otherwise leave it.
- **Not in scope:** `storyline_data_units.json` (different generator). The units page keeps
  working via the fallback below.

### 2. Color helper — `storyline.js`

- Add `pmisCategoryColor(score)` replicating `heatmap.js` thresholds → colors above.
  `null`/`NaN`/`< 1` handled per the table.

### 3. Rendering — `storyline.js` (both paths)

- Carry `yv` through the `pts` array (built ~line 803) alongside `v` and `trackId`.
- **WebGL path** (~line 992) and **Canvas-2D fallback** (~line 1039): in
  `colorMode === "condition"`, replace the single bar quad spanning
  `[colX(k)-halfBar, colX(k)+halfBar]` with **N equal cells** across that x-extent,
  cell `i` colored `pmisCategoryColor(yv[i])`. WebGL pushes N quads; Canvas draws N rects.
- **Fallback rule:** if `yv` is absent/empty on a point, draw the single-`v` bar exactly as
  today. Keeps `index_units.html` working unchanged.
- Cohort mode (`colorMode === "cohort"`) path is untouched.
- Connector geometry/color untouched.

## Affected files

- `step17_storyline_data.py` (data emit) — and `export_storyline_data.py` if still live.
- `storyline.js` (color helper + both render paths).
- Regenerated: `storyline_data_hwcounty.json`, `storyline_data_county.json`.
- Consumers unchanged but verified: `index.html`, `index_county.html`, `index_units.html`
  all load `storyline.js` (units relies on the fallback).

## Testing / verification

- Regenerate the two JSONs; confirm each window entry has a `yv` array of the right length
  and that `mean(yv non-null) ≈ v`.
- Load `index.html`: window bars show 5 hard-edged cells in PMIS colors; a known
  decaying segment shows green→red left-to-right within a window.
- Toggle to cohort mode: bars revert to single-hue (unchanged).
- Load `index_units.html` (no `yv`): bars still render as single-color (fallback).
- Connectors visually unchanged.
