/* ============================================================================
 * HeatmapUtil -- shared segment-heatmap renderer + condition-score color
 * helpers, extracted from clusters.js and evolens.js (each carried a
 * near-identical copy). Plain IIFE exposing window.HeatmapUtil since these
 * pages load scripts via <script src>, no ES modules.
 * ==========================================================================*/

(function () {
  "use strict";

  // ------------------------------------------------------------------------
  // Color helpers -- discrete condition-score categorization, ported from
  // HighwaySegmentChart.tsx's getCategory/getCategoryColor.
  // ------------------------------------------------------------------------
  function getCategory(score) {
    if (score >= 90) return "Very Good";
    if (score >= 70) return "Good";
    if (score >= 50) return "Fair";
    if (score >= 35) return "Poor";
    if (score < 1) return "Invalid";
    return "Very Poor";
  }

  function getCategoryColor(category) {
    switch (category) {
      case "Very Poor":
        return "rgb(239,68,68)";
      case "Poor":
        return "rgb(249,115,22)";
      case "Fair":
        return "rgb(234,179,8)";
      case "Good":
        return "rgb(34,197,94)";
      case "Very Good":
        return "rgb(21,128,61)";
      case "Invalid":
        return "rgb(200,200,200)";
      default:
        return "rgb(75,85,99)";
    }
  }

  function conditionColor(v) {
    if (v === null || v === undefined || isNaN(v)) return "#999999";
    return getCategoryColor(getCategory(v));
  }

  // YIQ-based black/white contrast formula, ported verbatim from
  // HighwaySegmentChart.tsx's getContrastColor.
  function getContrastColor(hexOrRgb) {
    let r = 0, g = 0, b = 0;
    if (hexOrRgb.startsWith("#")) {
      const hex = hexOrRgb.replace("#", "");
      if (hex.length === 3) {
        r = parseInt(hex[0] + hex[0], 16);
        g = parseInt(hex[1] + hex[1], 16);
        b = parseInt(hex[2] + hex[2], 16);
      } else if (hex.length === 6) {
        r = parseInt(hex.substring(0, 2), 16);
        g = parseInt(hex.substring(2, 4), 16);
        b = parseInt(hex.substring(4, 6), 16);
      }
    } else if (hexOrRgb.startsWith("rgb")) {
      const rgb = hexOrRgb.match(/\d+/g);
      if (rgb && rgb.length >= 3) {
        r = parseInt(rgb[0]);
        g = parseInt(rgb[1]);
        b = parseInt(rgb[2]);
      }
    }
    const yiq = (r * 299 + g * 587 + b * 114) / 1000;
    return yiq >= 128 ? "#000000" : "#ffffff";
  }

  // Reference markers reset at TxDOT control-section boundaries, so two
  // segments can be numbered e.g. 1.9 and 636.0 while physically adjacent --
  // a false multi-hundred-mile "gap" that squeezes every real segment into a
  // sub-pixel sliver. Find the single largest true gap between this unit's
  // segments and, if it exceeds GAP_COLLAPSE_THRESHOLD_MI, render it as a
  // fixed small spacer instead of to true scale.
  const GAP_COLLAPSE_THRESHOLD_MI = 100;
  const GAP_SPACER_FRAC = 0.10;

  function findBigGap(segments) {
    // union of [begin, end] intervals (segments are already begin-sorted)
    const union = [];
    const EPS = 1e-6;
    for (const seg of segments) {
      if (!union.length) {
        union.push({ start: seg.begin, end: seg.end });
        continue;
      }
      const last = union[union.length - 1];
      if (seg.begin <= last.end + EPS) last.end = Math.max(last.end, seg.end);
      else union.push({ start: seg.begin, end: seg.end });
    }
    for (let i = 0; i < union.length - 1; i++) {
      const size = union[i + 1].start - union[i].end;
      if (size >= GAP_COLLAPSE_THRESHOLD_MI) {
        return { start: union[i].end, end: union[i + 1].start, size };
      }
    }
    return null;
  }

  // Renders segments x years as an <svg>: x is real reference-marker mile
  // position (linear scale over [xMin, xMax] of the given segments, with the
  // big-gap collapse applied), y is one row per year, newest year at top.
  //
  // segments: array of { begin, end, scores: [per-year value|null], ... }
  // years: array (length = number of rows)
  // opts (optional): { onCellTip(event, info), onCellOut() }
  //   info = { seg, year, score, category, color, mileRange }
  //
  // No-data cells (score null/undefined/NaN) draw nothing -- blank cell.
  // Score < 1 renders "Invalid" grey (rgb(200,200,200)) -- the only grey.
  function drawSegmentHeatmap(segments, years, opts) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");

    if (!segments || segments.length === 0 || !years || years.length === 0) {
      // No data available -- render an empty placeholder SVG rather than
      // crashing.
      svg.setAttribute("viewBox", "0 0 1 1");
      svg.setAttribute("preserveAspectRatio", "none");
      return svg;
    }

    const nYears = years.length;
    const sortedSegments = segments.slice().sort((a, b) => a.begin - b.begin);

    let xMin = Infinity, xMax = -Infinity;
    for (const seg of sortedSegments) {
      if (seg.begin < xMin) xMin = seg.begin;
      if (seg.end > xMax) xMax = seg.end;
    }
    const xSpan = xMax - xMin > 0 ? xMax - xMin : 1;

    const bigGap = findBigGap(sortedSegments);
    // xFrac maps a real mile position to [0, 1] across the drawn width --
    // linear normally, or with the single big gap collapsed to a small fixed
    // spacer (GAP_SPACER_FRAC) when one was found.
    function xFrac(x) {
      if (!bigGap) return (x - xMin) / xSpan;
      const drawable = 1 - GAP_SPACER_FRAC;
      const baseVisibleMiles = xSpan - bigGap.size;
      let cut = 0;
      if (x > bigGap.end) cut = bigGap.size;
      else if (x > bigGap.start) cut = x - bigGap.start;
      const miles = (x - xMin) - cut;
      const noSpacer = (miles / Math.max(1e-9, baseVisibleMiles)) * drawable;
      const offset = x >= bigGap.end ? GAP_SPACER_FRAC : 0;
      return noSpacer + offset;
    }

    // viewBox width fixed at 1.0; x positions are fractions in [0, 1] via xFrac
    svg.setAttribute("viewBox", `0 0 1 ${nYears}`);
    svg.setAttribute("preserveAspectRatio", "none");

    const onCellTip = opts && opts.onCellTip;
    const onCellOut = opts && opts.onCellOut;

    for (const seg of sortedSegments) {
      const x0 = xFrac(seg.begin);
      const x1 = xFrac(seg.end);
      const width = x1 - x0 > 0 ? x1 - x0 : 0;
      if (width <= 0) continue;

      for (let row = 0; row < nYears; row++) {
        const score = seg.scores[row];
        const isNoData = score === null || score === undefined || Number.isNaN(score);
        if (isNoData) continue; // no data -- draw nothing (blank cell)

        const category = getCategory(score);
        const color = conditionColor(score);

        // rows are flipped so the newest year renders at the top (row 0 in
        // `years` is the oldest year, but SVG y grows downward) -- matches
        // the reference chart's newest-on-top convention.
        const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        rect.setAttribute("x", String(x0));
        rect.setAttribute("y", String(nYears - 1 - row));
        rect.setAttribute("width", String(width));
        rect.setAttribute("height", "1");
        rect.setAttribute("fill", color);
        // thin cell-separator stroke, fixed screen-pixel width regardless of
        // the per-unit viewBox scale (mile/year units vary a lot unit-to-unit)
        rect.setAttribute("stroke", "#fafafa");
        rect.setAttribute("stroke-width", "1");
        rect.setAttribute("vector-effect", "non-scaling-stroke");

        if (onCellTip) {
          const year = years[row];
          const mileRange = `mi ${seg.begin.toFixed(1)}-${seg.end.toFixed(1)}`;
          const info = { seg, year, score, category, color, mileRange };
          rect.addEventListener("mousemove", (event) => onCellTip(event, info));
          if (onCellOut) rect.addEventListener("mouseout", onCellOut);
        }

        svg.appendChild(rect);
      }
    }

    return svg;
  }

  // Renders a resampled S x n_windows grid (as produced by
  // build_unit_heatmaps*.py / cluster_units_bylength.py's unit_heatmaps_all_*
  // files) as an <svg>, oriented to MATCH drawSegmentHeatmap: X axis = SPACE
  // (spatial bin, row 0 = first/southernmost bin drawn at LEFT), Y axis = TIME
  // (col 0 = earliest, newest window/year drawn at TOP via the same
  // newest-on-top flip as drawSegmentHeatmap). The input grid stays indexed
  // grid[spaceBin][time]; only the placement is transposed and time-flipped.
  // Uses the same discrete condition-score color convention as
  // drawSegmentHeatmap (getCategory/conditionColor), including the same gray
  // "no data" fill for null/NaN cells (drawn as filled cells here, since every
  // grid cell is a real position -- unlike drawSegmentHeatmap's blank no-data
  // cells over irregular mile spans).
  //
  // grid: array of S rows (spatial bins), each an array of n_windows time
  //   values (number|null|NaN)
  // opts (optional): { onCellTip(event, info), onCellOut() }
  //   info = { row, col, score, category, color } -- row = spatial bin index,
  //   col = time (window/year) index; keys kept stable for callers.
  function drawGridHeatmap(grid, opts) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");

    if (!grid || grid.length === 0 || !grid[0] || grid[0].length === 0) {
      svg.setAttribute("viewBox", "0 0 1 1");
      svg.setAttribute("preserveAspectRatio", "none");
      return svg;
    }

    const nRows = grid.length;   // spatial bins (horizontal axis)
    const nCols = grid[0].length; // time steps (vertical axis)
    // Transposed vs. the grid indexing: width = spatial bins, height = time.
    svg.setAttribute("viewBox", `0 0 ${nRows} ${nCols}`);
    svg.setAttribute("preserveAspectRatio", "none");

    const onCellTip = opts && opts.onCellTip;
    const onCellOut = opts && opts.onCellOut;

    for (let row = 0; row < nRows; row++) {
      for (let col = 0; col < nCols; col++) {
        const score = grid[row][col];
        const isNoData = score === null || score === undefined || Number.isNaN(score);
        const category = isNoData ? "Invalid" : getCategory(score);
        const color = isNoData ? "#999999" : getCategoryColor(category);

        const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        // X = spatial bin (row, bin 0 at left); Y = time flipped so the newest
        // window/year (last col) renders at the top -- matches drawSegmentHeatmap.
        rect.setAttribute("x", String(row));
        rect.setAttribute("y", String(nCols - 1 - col));
        rect.setAttribute("width", "1");
        rect.setAttribute("height", "1");
        rect.setAttribute("fill", color);
        rect.setAttribute("stroke", "#fafafa");
        rect.setAttribute("stroke-width", "1");
        rect.setAttribute("vector-effect", "non-scaling-stroke");

        if (onCellTip) {
          const info = { row, col, score: isNoData ? null : score, category, color };
          rect.addEventListener("mousemove", (event) => onCellTip(event, info));
          if (onCellOut) rect.addEventListener("mouseout", onCellOut);
        }

        svg.appendChild(rect);
      }
    }

    return svg;
  }

  // ------------------------------------------------------------------------
  // Diverging (per-unit z-score) palette. The by-length clustering groups
  // units by Pearson correlation of their mean-centered flattened grids
  // (cluster_units_bylength.py L189-206) -- i.e. it is LEVEL-INVARIANT: only
  // the *shape* of a unit's space x time pattern relative to its own average
  // matters, not its absolute condition scores. The category palette above
  // colors by absolute score, which hides that shape. This diverging ramp
  // instead colors each cell by how far it sits above/below the unit's own
  // mean, in std units (z-score), so the visual directly reflects what was
  // clustered.
  //
  // Colorblind-safe blue<->orange diverging scheme ( colorbrewer RdYlBu-style
  // endpoints, but blue/orange to stay distinguishable for the common
  // deuteranopia/protanopia cases where red/green collapse). Blue = below the
  // unit's own average, near-white = at the average, orange = above.
  const DIVERGING_NEG = [33, 102, 172];   // blue  (z <= -clamp)
  const DIVERGING_MID = [247, 247, 247];  // near-white (z ~ 0)
  const DIVERGING_POS = [230, 97, 1];     // orange (z >= +clamp)
  const Z_CLAMP = 2.0;                    // clamp z to +/- 2 sigma before mapping

  function lerp(a, b, t) {
    return Math.round(a + (b - a) * t);
  }

  // Maps a z-score (already clamped to +/- Z_CLAMP) to an "rgb(r,g,b)" string
  // by linearly interpolating MID->NEG for negatives and MID->POS for
  // positives. t is the fraction of the clamp reached, so |z|=Z_CLAMP hits the
  // full endpoint color and z=0 is exactly the neutral midpoint.
  function divergingColor(z) {
    const t = Math.min(Math.abs(z) / Z_CLAMP, 1);
    const end = z < 0 ? DIVERGING_NEG : DIVERGING_POS;
    const r = lerp(DIVERGING_MID[0], end[0], t);
    const g = lerp(DIVERGING_MID[1], end[1], t);
    const b = lerp(DIVERGING_MID[2], end[2], t);
    return `rgb(${r},${g},${b})`;
  }

  // Renders a resampled S x n_windows grid as a per-unit z-score diverging
  // heatmap. Same orientation/placement as drawGridHeatmap (X = spatial bin,
  // bin 0 at left; Y = time flipped so newest window is at top), but each
  // cell is colored by (v - mean) / std over THIS unit's finite cells only,
  // through the blue<->orange diverging ramp above. This makes the level-
  // invariant "pattern" the clustering keys on visually explicit.
  //
  // Edge cases:
  //   - null/undefined/NaN cells: rendered with the same gray "no data" fill
  //     as drawGridHeatmap ("#999999") -- NOT colored on the diverging ramp.
  //   - std == 0 (a unit whose finite cells are all identical, i.e. perfectly
  //     flat): every finite cell is treated as z = 0 (the neutral midpoint),
  //     since there is no above/below-average signal to show.
  //   - a grid with no finite cells at all: also falls back to z = 0 for any
  //     (non-existent) finite cell; null cells stay gray.
  //
  // grid: array of S rows (spatial bins), each an array of n_windows time
  //   values (number|null|NaN)
  // opts (optional): { onCellTip(event, info), onCellOut() }
  //   info = { row, col, score, z, color } -- row = spatial bin index,
  //   col = time (window/year) index; score = raw value (null if no data),
  //   z = clamped z-score (null if no data).
  function drawNormalizedGridHeatmap(grid, opts) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");

    if (!grid || grid.length === 0 || !grid[0] || grid[0].length === 0) {
      svg.setAttribute("viewBox", "0 0 1 1");
      svg.setAttribute("preserveAspectRatio", "none");
      return svg;
    }

    // First pass: mean/std over finite cells only (population std, matching the
    // mean-centered normalization the clustering uses).
    let sum = 0, count = 0;
    for (let row = 0; row < grid.length; row++) {
      const gridRow = grid[row];
      for (let col = 0; col < gridRow.length; col++) {
        const v = gridRow[col];
        if (v !== null && v !== undefined && !Number.isNaN(v)) {
          sum += v;
          count += 1;
        }
      }
    }
    const mean = count > 0 ? sum / count : 0;
    let sqSum = 0;
    for (let row = 0; row < grid.length; row++) {
      const gridRow = grid[row];
      for (let col = 0; col < gridRow.length; col++) {
        const v = gridRow[col];
        if (v !== null && v !== undefined && !Number.isNaN(v)) {
          sqSum += (v - mean) * (v - mean);
        }
      }
    }
    const std = count > 0 ? Math.sqrt(sqSum / count) : 0;

    const nRows = grid.length;    // spatial bins (horizontal axis)
    const nCols = grid[0].length; // time steps (vertical axis)
    svg.setAttribute("viewBox", `0 0 ${nRows} ${nCols}`);
    svg.setAttribute("preserveAspectRatio", "none");

    const onCellTip = opts && opts.onCellTip;
    const onCellOut = opts && opts.onCellOut;

    for (let row = 0; row < nRows; row++) {
      for (let col = 0; col < nCols; col++) {
        const score = grid[row][col];
        const isNoData = score === null || score === undefined || Number.isNaN(score);

        let z = null;
        let color;
        if (isNoData) {
          color = "#999999"; // same "no data" gray as drawGridHeatmap
        } else {
          // std == 0 -> every finite cell is z = 0 (neutral); otherwise clamp
          // to +/- Z_CLAMP before mapping so outliers don't dominate the ramp.
          const rawZ = std === 0 ? 0 : (score - mean) / std;
          z = Math.max(-Z_CLAMP, Math.min(Z_CLAMP, rawZ));
          color = divergingColor(z);
        }

        const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        // X = spatial bin (row, bin 0 at left); Y = time flipped so the newest
        // window/year (last col) renders at the top -- matches drawGridHeatmap.
        rect.setAttribute("x", String(row));
        rect.setAttribute("y", String(nCols - 1 - col));
        rect.setAttribute("width", "1");
        rect.setAttribute("height", "1");
        rect.setAttribute("fill", color);
        rect.setAttribute("stroke", "#fafafa");
        rect.setAttribute("stroke-width", "1");
        rect.setAttribute("vector-effect", "non-scaling-stroke");

        if (onCellTip) {
          const info = { row, col, score: isNoData ? null : score, z, color };
          rect.addEventListener("mousemove", (event) => onCellTip(event, info));
          if (onCellOut) rect.addEventListener("mouseout", onCellOut);
        }

        svg.appendChild(rect);
      }
    }

    return svg;
  }

  window.HeatmapUtil = {
    getCategory,
    getCategoryColor,
    conditionColor,
    getContrastColor,
    findBigGap,
    drawSegmentHeatmap,
    drawGridHeatmap,
    drawNormalizedGridHeatmap,
  };
})();
