# Map: year-slider condition-colored selected segments

**Date:** 2026-07-10
**Status:** Approved design, pending spec review

## Problem

On the geographic-map storyline pages, drilling/brushing a selection today draws it as
**convex-hull blobs** over a flat neutral-gray base layer, and the map's slider steps through
5-year **windows**. There is no way to see the actual selected segments on the map, colored by
their pavement condition, year by year.

We want: the selected segments themselves drawn on the map, colored by their **PMIS condition
category** for a **year** chosen by the map's slider, filtered so only segments surveyed in that
year appear. This must work on **every page that uses the map**, from **one shared code path**
(no duplicated `storyline.js` / `storyline_peryear.js`).

## Requirements (decided)

1. **Selected segments on the map.** A drilled/brushed selection renders as its real segment
   geometries on the map, not hull blobs. The hull-blob rendering for selections is **removed**.
2. **Year slider.** The map's existing slider (`#mapWindowSlider`, currently 0..25 windows)
   becomes a **year** slider spanning the data's observed year range (step = 1 year). Its label
   shows the year.
3. **Condition colors, not RdYlGn.** Segments are colored by `pmisCategoryColor` — the 5 discrete
   PMIS categories (Very Good / Good / Fair / Poor / Very Poor, `#999999` for invalid) — never the
   continuous RdYlGn gradient.
4. **Filter = temporal.** At year Y, a selected segment with **no** condition survey in Y is
   **not drawn** (shows nothing) until a year it has data.
5. **One code, no duplicate.** The shared logic in `storyline.js` and its 93%-identical near-copy
   `storyline_peryear.js` is refactored into a single shared module; the duplicate is removed.
6. **All map pages.** Behaves identically on `storyline_dist_geo.html`, `storyline_geo.html`,
   `storyline_county_geo.html` (window) and `storyline_peryear_dist_geo.html` (per-year).

## Non-goals

- No change to session formation or the pipeline (step6/8/10/11/17) or the data JSONs.
- No change to the storyline canvas rendering except the condition-color unification (below).
- No new coloring on pages without a map beyond what the refactor implies.

## Current state (verified)

- **Pages with a map** (load `storyline_map.js`): `storyline_dist_geo.html`, `storyline_geo.html`,
  `storyline_county_geo.html` (all `storyline.js`), and `storyline_peryear_dist_geo.html`
  (`storyline_peryear.js`).
- **`storyline_map.js`** holds a `baseLayer` (GeoJSONLayer of all segment geometries, flat gray
  `simple` renderer, ~L406), plus GraphicsLayers `paintLayer`, `hullLayer`, `highlightLayer`. It
  already has a "draw a section's line by id with a fill" primitive (`makeHighlightGraphic`, ~L214)
  and exposes `window.StorylineMap` (paint/clearPaint/showHulls/clearHulls/...).
- **The slider** `#mapWindowSlider` (0..25) lives in the map HTML pages; it calls
  `window.__setMapWindow(k)` → `mapWindow` → `refreshMapHulls()` (`storyline.js:~1785,1846,1878`),
  which draws hull blobs per window colored by user paint / gray.
- **The duplication.** `storyline.js` (2230 L) vs `storyline_peryear.js` (2184 L) differ by 148
  lines across 33 hunks, almost all: reworded comments, the default data filename, some map code
  the per-year file stubbed as "no map", and — materially — the `conditionColor()` function:
  `storyline.js` returns `pmisCategoryColor(v)`; `storyline_peryear.js` returns
  `d3.interpolateRdYlGn(t)`. Neither file references an `IS_PERYEAR` flag today.

## Design

### Part 1 — Shared-code refactor

Extract the shared implementation into a single module **`storyline_core.js`**, loaded by all 10
storyline pages. The window/per-year differences collapse to one page flag:

- Pages set `window.IS_PERYEAR = true|false` (a small inline `<script>`, alongside the existing
  `window.STORYLINE_DATA_FILE` flag) before loading `storyline_core.js`.
- The material behavioral fork (`conditionColor`) is **unified to `pmisCategoryColor`** for all
  pages (satisfies requirement 3). The RdYlGn path is dropped unless found to be used elsewhere;
  if a genuinely per-year-only visual difference survives, it is gated on `IS_PERYEAR`.
- The map-related code that `storyline_peryear.js` stubbed is kept in full — all map calls are
  already guarded by `if (window.StorylineMap ...)`, so they are safe no-ops on map-less pages.

Then: repoint the 5 `storyline_peryear*.html` and the 5 window pages to load `storyline_core.js`;
**delete `storyline_peryear.js`**. The base `storyline.js` filename may be retained as a thin
re-export or removed in favor of `storyline_core.js` — decided in the implementation plan to
minimize churn to the window HTML pages.

### Part 2 — Map API (`storyline_map.js`)

Add to the `StorylineMap` public object:

- `showSelectedByCondition(idToColor)` — `idToColor` is `Map<sectionId(string), cssColor>`. Clears
  the previous selection graphics and draws one polyline per id using the existing
  section-line-by-id primitive, with the given color. Lives on a new dedicated GraphicsLayer
  (`selectedLayer`) added **below** `paintLayer`/`hullLayer`/`highlightLayer` so user paint and
  highlights still sit on top.
- `clearSelected()` — removes all selected-segment graphics.

The old `showHulls`/`clearHulls` path is no longer called for selections (requirement 1). Leave
the hull functions in place but unused, or remove them — decided in the plan.

### Part 3 — Year slider + wiring (`storyline_core.js`)

**Year lookup.** Build once per load: `condByYear: Map<sectionId, Map<year, score>>`.
Confirmed against the map-page JSONs:
- Per-year pages (`IS_PERYEAR`): windows are **single-year** (`windows[k].start == end`, e.g.
  `1998`), and `win[k].v` is that year's score. So year = `windows[k].start`, score = `win[k].v`.
- Window pages: `win[k].yv` **is present** (verified in `storyline_data_dist10_geo.json` /
  `storyline_data_hwcounty_geo.json`) and holds the per-year raw scores for `windows[k].start..end`.
  Windows overlap, so the same year appears in up to 5 windows with the same raw value; dedupe to
  one score per (segment, year).
- `null`/missing scores are simply absent from the inner map (→ segment "not surveyed that year").

**Year axis.** `yearMin`/`yearMax` = min/max year present across `condByYear`. The slider spans
`[yearMin, yearMax]`, step 1.

**Slider conversion.** Replace the window→`__setMapWindow` binding. The map slider now sets a
`mapYear`. On change:
1. For the current selection's member ids, look up `condByYear.get(id)?.get(mapYear)`.
2. Keep only ids with a score (requirement 4).
3. Build `idToColor = Map(id → pmisCategoryColor(score))`.
4. `window.StorylineMap.showSelectedByCondition(idToColor)`.
The slider `<output>` shows the year.

**Selection source.** Reuse the existing selection plumbing (brush/drill commit that today feeds
`mapSelections` / `refreshMapHulls`). The member ids are the same; only the per-year color/filter
and the render target (`showSelectedByCondition` instead of `showHulls`) change.

## Data flow

```
brush/drill selection ─► member section ids
                              │
   map year slider (mapYear) ─┤
                              ▼
   condByYear[id][mapYear] ──► keep surveyed ──► pmisCategoryColor(score)
                              ▼
   StorylineMap.showSelectedByCondition(idToColor) ──► polyline per segment on map
```

Slider drag → recompute steps 1–4 → redraw. Changing/clearing the selection → recompute or
`clearSelected()`.

## Edge cases

- **No selection:** `clearSelected()`; slider still movable (no-op render).
- **Segment surveyed no year in range:** never drawn.
- **Map-less pages:** all `StorylineMap` calls guard on presence → no-ops; the year lookup is
  built but unused. No error.
- **`yv` availability (resolved):** all window map-page JSONs carry `yv`, and per-year map-page
  JSONs use single-year windows with `v`. So the year lookup is well-defined on every map page; no
  fallback is required. (If a future map page lacks `yv`, disable the year slider on it.)

## Testing / verification (no browser automation unless necessary)

- `node --check` on `storyline_core.js` and `storyline_map.js`.
- Refactor equivalence: for a window page and its per-year sibling, confirm the shared module +
  flag reproduces prior behavior (condition cells now `pmisCategoryColor` on both — the intended
  change — and everything else unchanged). Diff the generated behavior via code trace.
- Year-lookup unit check: on one window-page JSON and one per-year JSON, assert `condByYear` yields
  the same score for a year present in multiple overlapping windows, and omits unsurveyed years.
- Trace: selection → slider year → only surveyed segments colored by `pmisCategoryColor` → drawn;
  drag year → recolor/refilter; paint/highlight still layered above.
- Confirm the 4 map pages load `storyline_core.js` + `storyline_map.js` and the slider is a year
  slider; confirm the 6 non-map pages are unaffected apart from the condition-color unification.

## Risks

- **Refactor regression across 10 pages.** Mitigated by the small, mostly-cosmetic diff and by
  keeping the superset (full map code + `pmisCategoryColor`) as the shared base.
- **`yv` availability on window map pages** (see edge case) — resolved during planning.
- **Slider semantics change** (window→year) alters existing muscle memory on window map pages;
  intended per requirement 2.
