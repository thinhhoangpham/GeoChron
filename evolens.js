/* ============================================================================
 * EvoLens drill-down
 *
 * Adds the GeoChron paper's brush-to-drill-down interaction on top of the
 * existing Storyline (storyline.js). Does NOT touch layout/rendering
 * internals there; it only reads a small surface exposed on
 * window.__storyline (state, colX/colPitch, pointsCache, redraw) and reads
 * from window.__storyline.state.data for windows/roads metadata.
 *
 * Flow:
 *  1. User drags a rectangle on the Storyline canvas (mousedown/move/up).
 *  2. On mouseup (if the drag exceeds a small threshold), the brushed pixel
 *     rect is mapped to: a set of window indices (k range) -> year range,
 *     and a set of selected segments (any segment whose bar/connector point
 *     falls inside the rect at one of the brushed windows).
 *  3. evolens_data.json (per-year raw scores) is fetched lazily on first use.
 *  4. A slide-in side panel renders a raw line chart (d3/SVG) + a trend-motif
 *     band (per-segment z-score, cross-segment IQR + median per year), with
 *     a toggle for the motif and a close button.
 *  5. While open, the brushed region is drawn as a semi-transparent overlay
 *     on the Storyline canvas.
 * ==========================================================================*/

(function () {
  "use strict";

  function whenStorylineReady(cb) {
    if (window.__storyline && window.__storyline.state.data) return cb();
    const iv = setInterval(() => {
      if (window.__storyline && window.__storyline.state.data) {
        clearInterval(iv);
        cb();
      }
    }, 50);
  }

  whenStorylineReady(init);

  function init() {
    const SL = window.__storyline;
    const { state, canvas, canvasWrap, colX, colPitch, MARGIN_LEFT, visibleRoadIndices, getPointsCache, redraw } = SL;
    const UNIT_MODE = window.STORYLINE_DRILLDOWN_MODE === "unit";
    const MAX_SELECTED_UNITS = 40;

    // ------------------------------------------------------------------
    // DOM: panel + brush hint, injected once
    // ------------------------------------------------------------------
    const panel = document.createElement("div");
    panel.id = "evolensPanel";
    panel.className = "evolens-panel hidden";
    panel.innerHTML = `
      <div class="evolens-header">
        <div class="evolens-title-block">
          <div class="evolens-title" id="evolensTitle"></div>
          <div class="evolens-subtitle" id="evolensSubtitle"></div>
        </div>
        <button id="evolensClose" class="evolens-close" title="Close">&times;</button>
      </div>
      <label class="evolens-toggle">
        <input type="checkbox" id="evolensMotifToggle" checked>
        <span>Show trend motif</span>
      </label>
      <div id="evolensChartWrap" class="evolens-chart-wrap"></div>
    `;
    document.body.appendChild(panel);

    const brushHint = document.createElement("div");
    brushHint.id = "evolensHint";
    brushHint.className = "evolens-hint hidden";
    brushHint.textContent = "Select a single road to drill down";
    canvasWrap.appendChild(brushHint);

    const closeBtn = panel.querySelector("#evolensClose");
    const motifToggle = panel.querySelector("#evolensMotifToggle");
    const titleEl = panel.querySelector("#evolensTitle");
    const subtitleEl = panel.querySelector("#evolensSubtitle");
    const chartWrapEl = panel.querySelector("#evolensChartWrap");

    let evolensData = null; // { years, scores } lazily fetched
    let evolensFetchPromise = null;
    function ensureEvolensData() {
      if (evolensData) return Promise.resolve(evolensData);
      if (evolensFetchPromise) return evolensFetchPromise;
      evolensFetchPromise = fetch("evolens_data.json")
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status} fetching evolens_data.json`);
          return r.json();
        })
        .then((d) => { evolensData = d; return d; });
      return evolensFetchPromise;
    }

    let unitSegmentsData = null; // { years, units, byKey: Map(key -> unit) }
    let unitSegmentsFetchPromise = null;
    function ensureUnitSegments() {
      if (unitSegmentsData) return Promise.resolve(unitSegmentsData);
      if (unitSegmentsFetchPromise) return unitSegmentsFetchPromise;
      unitSegmentsFetchPromise = fetch("unit_segments_full.json")
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status} fetching unit_segments_full.json`);
          return r.json();
        })
        .then((d) => {
          d.byKey = new Map(d.units.map((u) => [u.key, u]));
          unitSegmentsData = d;
          return d;
        });
      return unitSegmentsFetchPromise;
    }

    // ------------------------------------------------------------------
    // Brush state + overlay rectangle (drawn as part of storyline's own
    // draw() via a hook we append after; simplest robust approach is a
    // dedicated absolutely-positioned div overlay on top of the canvases,
    // since it only needs to track viewport-relative screen coords).
    // ------------------------------------------------------------------
    const overlayEl = document.createElement("div");
    overlayEl.id = "evolensBrushOverlay";
    overlayEl.className = "evolens-brush-overlay hidden";
    canvasWrap.appendChild(overlayEl);

    const selectionEl = document.createElement("div");
    selectionEl.id = "evolensSelectionOverlay";
    selectionEl.className = "evolens-selection-overlay hidden";
    canvasWrap.appendChild(selectionEl);

    let brushing = false;
    let brushStart = null; // {x, y} viewport-relative (client - rect, no scroll)
    let brushCur = null;
    const DRAG_THRESHOLD_PX = 5;

    // active (committed) selection, world-space rect (content coordinates,
    // i.e. independent of scroll) so it stays correctly placed on scroll.
    let activeSelection = null; // { x0, y0, x1, y1 } in world coords

    function clientToWorld(clientX, clientY) {
      const rect = canvasWrap.getBoundingClientRect();
      return {
        x: clientX - rect.left + state.scrollLeft,
        y: clientY - rect.top + state.scrollTop,
      };
    }

    function updateBrushHintVisibility() {
      if (UNIT_MODE) {
        if (state.selectedRoadIdx < 0) {
          brushHint.textContent = "Drag a box to select units";
          brushHint.classList.remove("hidden");
        } else {
          brushHint.classList.add("hidden");
        }
        return;
      }
      if (state.selectedRoadIdx < 0) {
        brushHint.classList.remove("hidden");
      } else {
        brushHint.classList.add("hidden");
      }
    }
    updateBrushHintVisibility();

    // Re-check hint whenever the road selection changes; storyline.js calls
    // render()/selectRoad() on its own timers, so poll cheaply on relevant
    // events instead of patching selectRoad().
    const roadSearchEl = document.getElementById("roadSearch");
    if (roadSearchEl) {
      roadSearchEl.addEventListener("input", updateBrushHintVisibility);
    }
    document.addEventListener("click", updateBrushHintVisibility, true);

    canvas.addEventListener("mousedown", (evt) => {
      if (!UNIT_MODE && state.selectedRoadIdx < 0) return; // brushing disabled in All-roads view (segment mode only)
      if (evt.button !== 0) return;
      brushing = true;
      const rect = canvasWrap.getBoundingClientRect();
      brushStart = { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
      brushCur = brushStart;
      evt.preventDefault();
    });

    window.addEventListener("mousemove", (evt) => {
      if (!brushing) return;
      const rect = canvasWrap.getBoundingClientRect();
      brushCur = { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
      drawBrushOverlay();
    });

    window.addEventListener("mouseup", (evt) => {
      if (!brushing) return;
      brushing = false;
      overlayEl.classList.add("hidden");
      const dx = brushCur.x - brushStart.x;
      const dy = brushCur.y - brushStart.y;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return; // ignore tiny drags

      const x0v = Math.min(brushStart.x, brushCur.x);
      const x1v = Math.max(brushStart.x, brushCur.x);
      const y0v = Math.min(brushStart.y, brushCur.y);
      const y1v = Math.max(brushStart.y, brushCur.y);
      // viewport -> world (content) coords
      const worldRect = {
        x0: x0v + state.scrollLeft, x1: x1v + state.scrollLeft,
        y0: y0v + state.scrollTop, y1: y1v + state.scrollTop,
      };
      handleBrushEnd(worldRect);
    });

    function drawBrushOverlay() {
      const rect = canvasWrap.getBoundingClientRect();
      const x0 = Math.min(brushStart.x, brushCur.x);
      const y0 = Math.min(brushStart.y, brushCur.y);
      const w = Math.abs(brushCur.x - brushStart.x);
      const h = Math.abs(brushCur.y - brushStart.y);
      overlayEl.style.left = (x0 + state.scrollLeft) + "px";
      overlayEl.style.top = (y0 + state.scrollTop) + "px";
      overlayEl.style.width = w + "px";
      overlayEl.style.height = h + "px";
      overlayEl.classList.remove("hidden");
    }

    // Keep the committed-selection overlay pinned to the right world-space
    // rect as the user scrolls (mirrors storyline.js's own scroll sync).
    canvasWrap.addEventListener("scroll", syncSelectionOverlay);
    window.addEventListener("resize", syncSelectionOverlay);

    function syncSelectionOverlay() {
      if (!activeSelection) return;
      const x0 = activeSelection.x0;
      const y0 = activeSelection.y0;
      const w = activeSelection.x1 - activeSelection.x0;
      const h = activeSelection.y1 - activeSelection.y0;
      selectionEl.style.left = x0 + "px";
      selectionEl.style.top = y0 + "px";
      selectionEl.style.width = w + "px";
      selectionEl.style.height = h + "px";
    }

    // ------------------------------------------------------------------
    // Brush -> window range -> segment selection
    // ------------------------------------------------------------------
    function handleBrushEnd(worldRect) {
      const roadIdx = state.selectedRoadIdx;
      if (!UNIT_MODE && roadIdx < 0) return; // simplest robust option: single-road only (v1)

      const pitch = colPitch();
      let kMin = Math.floor((worldRect.x0 - MARGIN_LEFT) / pitch);
      let kMax = Math.floor((worldRect.x1 - MARGIN_LEFT) / pitch);
      kMin = Math.max(0, Math.min(state.numWindows - 1, kMin));
      kMax = Math.max(0, Math.min(state.numWindows - 1, kMax));
      if (kMin > kMax) return;

      const windows = state.data.windows;
      const yearStart = windows[kMin].start;
      const yearEnd = windows[kMax].end;

      if (UNIT_MODE) {
        // Unit mode: select across every visible road (band; all roads in the
        // overview, or just the selected one), collecting
        // one unit key per matching segment/atom.
        const pointsCache = getPointsCache();
        const unitKeys = [];
        const seen = new Set();
        let truncated = false;
        outer:
        for (const rIdx of visibleRoadIndices()) {
          const pts = pointsCache.get(rIdx);
          if (!pts) continue;
          const road = state.data.roads[rIdx];
          for (let segIdx = 0; segIdx < pts.length; segIdx++) {
            const segPts = pts[segIdx];
            let inside = false;
            for (const p of segPts) {
              if (p.k < kMin || p.k > kMax) continue;
              if (p.y >= worldRect.y0 && p.y <= worldRect.y1) { inside = true; break; }
            }
            if (!inside) continue;
            const key = road.segments[segIdx].id;
            if (seen.has(key)) continue;
            seen.add(key);
            if (unitKeys.length >= MAX_SELECTED_UNITS) { truncated = true; break outer; }
            unitKeys.push(key);
          }
        }
        if (unitKeys.length === 0) return;

        activeSelection = { x0: worldRect.x0, y0: worldRect.y0, x1: worldRect.x1, y1: worldRect.y1 };
        selectionEl.classList.remove("hidden");
        syncSelectionOverlay();

        openUnitPanel(unitKeys, yearStart, yearEnd, truncated);
        return;
      }

      const pointsCache = getPointsCache();
      const pts = pointsCache.get(roadIdx);
      if (!pts) return;

      const selectedSegIdx = [];
      for (let segIdx = 0; segIdx < pts.length; segIdx++) {
        const segPts = pts[segIdx];
        let inside = false;
        for (const p of segPts) {
          if (p.k < kMin || p.k > kMax) continue;
          if (p.y >= worldRect.y0 && p.y <= worldRect.y1) { inside = true; break; }
        }
        if (inside) selectedSegIdx.push(segIdx);
      }
      if (selectedSegIdx.length === 0) return;

      activeSelection = { x0: worldRect.x0, y0: worldRect.y0, x1: worldRect.x1, y1: worldRect.y1 };
      selectionEl.classList.remove("hidden");
      syncSelectionOverlay();

      openPanel(roadIdx, selectedSegIdx, yearStart, yearEnd);
    }

    // ------------------------------------------------------------------
    // Panel: fetch data, render chart
    // ------------------------------------------------------------------
    function closePanel() {
      panel.classList.remove("open");
      activeSelection = null;
      selectionEl.classList.add("hidden");
    }
    closeBtn.addEventListener("click", closePanel);

    function openPanel(roadIdx, segIdxList, yearStart, yearEnd) {
      const road = state.data.roads[roadIdx];
      titleEl.textContent = road.roadbed;
      subtitleEl.textContent =
        `${segIdxList.length} segment${segIdxList.length === 1 ? "" : "s"} selected  |  ${yearStart}–${yearEnd}`;
      panel.classList.add("open");
      panel.classList.remove("hidden");

      chartWrapEl.innerHTML = `<div class="evolens-loading">Loading...</div>`;
      ensureEvolensData().then((d) => {
        renderChart(d, road, segIdxList, yearStart, yearEnd);
      }).catch((err) => {
        chartWrapEl.innerHTML = `<div class="evolens-loading">Failed to load evolens_data.json: ${err.message}</div>`;
        console.error(err);
      });
    }

    function openUnitPanel(unitKeys, yearStart, yearEnd, truncated) {
      titleEl.textContent = "Unit drill-down";
      subtitleEl.textContent =
        `${unitKeys.length} unit${unitKeys.length === 1 ? "" : "s"} selected  |  ${yearStart}–${yearEnd}` +
        (truncated ? `  |  showing first ${MAX_SELECTED_UNITS}` : "");
      panel.classList.add("open");
      panel.classList.remove("hidden");

      chartWrapEl.innerHTML = `<div class="evolens-loading">Loading...</div>`;
      ensureUnitSegments().then((d) => {
        renderUnitChart(d, unitKeys, yearStart, yearEnd, truncated);
      }).catch((err) => {
        chartWrapEl.innerHTML = `<div class="evolens-loading">Failed to load unit_segments_full.json: ${err.message}</div>`;
        console.error(err);
      });
    }

    // ------------------------------------------------------------------
    // Chart rendering (d3 / SVG). Small-scale (tens of segments), so plain
    // SVG is fine per spec - no canvas/WebGL needed here.
    // ------------------------------------------------------------------
    const CHART_COLORS = (typeof d3 !== "undefined" && d3.schemeTableau10)
      ? d3.schemeTableau10
      : ["#4e79a7", "#f28e2b", "#e15759", "#76b7b2", "#59a14f",
         "#edc948", "#b07aa1", "#ff9da7", "#9c755f", "#bab0ac"];

    // Shared z-score-per-series + per-year IQR/median motif computation, used
    // by both segment-mode renderChart and unit-mode renderUnitChart.
    function computeMotif(series) {
      const zSeries = series.map((s) => {
        const observed = s.values.filter((v) => v !== null);
        const mean = observed.length ? observed.reduce((a, b) => a + b, 0) / observed.length : 0;
        const variance = observed.length ? observed.reduce((a, b) => a + (b - mean) * (b - mean), 0) / observed.length : 0;
        const std = Math.sqrt(variance);
        const z = s.values.map((v) => (v === null ? null : (std > 0 ? (v - mean) / std : 0)));
        return { id: s.id, values: z };
      });

      const nYears = series.length ? series[0].values.length : 0;
      const motif = [];
      for (let yi = 0; yi < nYears; yi++) {
        const vals = zSeries.map((s) => s.values[yi]).filter((v) => v !== null).sort((a, b) => a - b);
        motif.push(vals.length === 0
          ? { p25: null, p50: null, p75: null }
          : { p25: percentile(vals, 0.25), p50: percentile(vals, 0.5), p75: percentile(vals, 0.75) });
      }
      return motif;
    }

    function renderUnitChart(unitData, unitKeys, yearStart, yearEnd, truncated) {
      chartWrapEl.innerHTML = "";
      const years = unitData.years.filter((y) => y >= yearStart && y <= yearEnd);
      if (years.length === 0) {
        chartWrapEl.innerHTML = `<div class="evolens-loading">No year data in range.</div>`;
        return;
      }
      const yearIdx0 = unitData.years.indexOf(years[0]);

      const heading = document.createElement("div");
      heading.className = "evolens-heatmap-heading";
      heading.textContent = `${unitKeys.length} unit${unitKeys.length === 1 ? "" : "s"} selected` +
        (truncated ? ` (showing first ${MAX_SELECTED_UNITS})` : "");
      chartWrapEl.appendChild(heading);

      const allSeries = [];
      for (const unitKey of unitKeys) {
        const unit = unitData.byKey.get(unitKey);
        if (!unit) continue;

        const items = unit.segments
          .slice()
          .sort((a, b) => a.begin - b.begin)
          .map((seg) => ({
            seg: { id: seg.id, begin: seg.begin, end: seg.end },
            values: years.map((_, i) => (seg.scores[yearIdx0 + i] ?? null)),
          }));

        chartWrapEl.appendChild(buildRoadCard(unitKey, items, years));

        for (const it of items) {
          allSeries.push({ id: it.seg.id, values: it.values });
        }
      }

      const motif = computeMotif(allSeries);
      drawSvgChart(years, allSeries, motif);
    }

    function renderChart(evData, road, segIdxList, yearStart, yearEnd) {
      chartWrapEl.innerHTML = "";
      const years = evData.years.filter((y) => y >= yearStart && y <= yearEnd);
      if (years.length === 0) {
        chartWrapEl.innerHTML = `<div class="evolens-loading">No year data in range.</div>`;
        return;
      }
      const yearIdx0 = evData.years.indexOf(years[0]);

      // Per-segment raw series over the brushed years (null preserved = gap).
      const series = [];
      for (const segIdx of segIdxList) {
        const seg = road.segments[segIdx];
        const raw = evData.scores[seg.id];
        const vals = years.map((_, i) => (raw ? raw[yearIdx0 + i] : null));
        vals.forEach((v) => { if (typeof v !== "number" || isNaN(v)) return; });
        series.push({ id: seg.id, segIdx, values: vals.map((v) => (typeof v === "number" && !isNaN(v) ? v : null)) });
      }

      // z-score per segment across its own observed values in this range.
      const zSeries = series.map((s) => {
        const observed = s.values.filter((v) => v !== null);
        const mean = observed.length ? observed.reduce((a, b) => a + b, 0) / observed.length : 0;
        const variance = observed.length ? observed.reduce((a, b) => a + (b - mean) * (b - mean), 0) / observed.length : 0;
        const std = Math.sqrt(variance);
        const z = s.values.map((v) => (v === null ? null : (std > 0 ? (v - mean) / std : 0)));
        return { id: s.id, values: z };
      });

      // per-year 25th/50th/75th percentile across selected segments' z-values.
      const motif = years.map((_, yi) => {
        const vals = zSeries.map((s) => s.values[yi]).filter((v) => v !== null).sort((a, b) => a - b);
        if (vals.length === 0) return { p25: null, p50: null, p75: null };
        return { p25: percentile(vals, 0.25), p50: percentile(vals, 0.5), p75: percentile(vals, 0.75) };
      });

      drawPerRoadHeatmaps(years, series, road);
      drawSvgChart(years, series, motif);
    }

    // ------------------------------------------------------------------
    // Per-highway heatmap cards -- same visual language as clusters.html's
    // thumbnail grid (real reference-marker position with big-gap collapse,
    // discrete TxDOT condition-score color buckets, edge-flipping tooltip),
    // ported directly from clusters.js. A county band can now mix several
    // highways (Step 8/9's proximity rule may be county-only), so the
    // brushed selection is first split by each segment's own `roadbed`
    // field and rendered as one card per highway, rather than one combined
    // heatmap that would otherwise interleave unrelated roads.
    // ------------------------------------------------------------------
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
        case "Very Poor": return "rgb(239,68,68)";
        case "Poor": return "rgb(249,115,22)";
        case "Fair": return "rgb(234,179,8)";
        case "Good": return "rgb(34,197,94)";
        case "Very Good": return "rgb(21,128,61)";
        case "Invalid": return "rgb(200,200,200)";
        default: return "rgb(75,85,99)";
      }
    }
    function conditionColor(v) {
      if (v === null || v === undefined || isNaN(v)) return "#999999";
      return getCategoryColor(getCategory(v));
    }
    // YIQ-based black/white contrast, ported verbatim from
    // HighwaySegmentChart.tsx's getContrastColor (via clusters.js).
    function getContrastColor(hexOrRgb) {
      let r = 0, g = 0, b = 0;
      if (hexOrRgb.startsWith("#")) {
        const hex = hexOrRgb.replace("#", "");
        if (hex.length === 3) {
          r = parseInt(hex[0] + hex[0], 16); g = parseInt(hex[1] + hex[1], 16); b = parseInt(hex[2] + hex[2], 16);
        } else if (hex.length === 6) {
          r = parseInt(hex.substring(0, 2), 16); g = parseInt(hex.substring(2, 4), 16); b = parseInt(hex.substring(4, 6), 16);
        }
      } else if (hexOrRgb.startsWith("rgb")) {
        const rgb = hexOrRgb.match(/\d+/g);
        if (rgb && rgb.length >= 3) { r = parseInt(rgb[0]); g = parseInt(rgb[1]); b = parseInt(rgb[2]); }
      }
      const yiq = (r * 299 + g * 587 + b * 114) / 1000;
      return yiq >= 128 ? "#000000" : "#ffffff";
    }

    const cellTooltip = document.createElement("div");
    cellTooltip.className = "evolens-cell-tooltip hidden";
    document.body.appendChild(cellTooltip);
    function showCellTooltip(evt, html, color) {
      cellTooltip.innerHTML = html;
      cellTooltip.style.backgroundColor = color;
      cellTooltip.style.color = getContrastColor(color);
      cellTooltip.classList.remove("hidden");
      const pad = 12, tw = 200, th = 100;
      let left = evt.clientX + pad;
      if (evt.clientX > window.innerWidth - tw - pad) left = evt.clientX - tw - pad;
      let top = evt.clientY + pad;
      if (evt.clientY > window.innerHeight - th - pad) top = evt.clientY - th - pad;
      cellTooltip.style.left = left + "px";
      cellTooltip.style.top = top + "px";
    }
    function hideCellTooltip() { cellTooltip.classList.add("hidden"); }

    // Reference markers reset at TxDOT control-section boundaries (e.g.
    // "634A" then "636"), which can otherwise appear as a huge false gap
    // between physically-adjacent segments. Collapse the single largest
    // real gap (if any) to a small fixed spacer instead of true scale.
    const GAP_COLLAPSE_THRESHOLD_MI = 100;
    const GAP_SPACER_FRAC = 0.10;
    function findBigGap(segments) {
      const union = [];
      const EPS = 1e-6;
      for (const seg of segments) {
        if (!union.length) { union.push({ start: seg.begin, end: seg.end }); continue; }
        const last = union[union.length - 1];
        if (seg.begin <= last.end + EPS) last.end = Math.max(last.end, seg.end);
        else union.push({ start: seg.begin, end: seg.end });
      }
      for (let i = 0; i < union.length - 1; i++) {
        const size = union[i + 1].start - union[i].end;
        if (size >= GAP_COLLAPSE_THRESHOLD_MI) return { start: union[i].end, end: union[i + 1].start, size };
      }
      return null;
    }

    function drawPerRoadHeatmaps(years, series, road) {
      // group the brushed selection by each segment's real highway
      const byRoadbed = new Map();
      for (const s of series) {
        const seg = road.segments[s.segIdx];
        const rb = (seg && seg.roadbed) || "?";
        if (!byRoadbed.has(rb)) byRoadbed.set(rb, []);
        byRoadbed.get(rb).push({ seg, values: s.values });
      }

      const heading = document.createElement("div");
      heading.className = "evolens-heatmap-heading";
      heading.textContent = `Selected segments by highway (${byRoadbed.size} highway${byRoadbed.size === 1 ? "" : "s"}, ${series.length} segments)`;
      chartWrapEl.appendChild(heading);

      const roadbeds = Array.from(byRoadbed.keys()).sort((a, b) => byRoadbed.get(b).length - byRoadbed.get(a).length);
      for (const rb of roadbeds) {
        const items = byRoadbed.get(rb).slice().sort((a, b) => a.seg.begin - b.seg.begin);
        chartWrapEl.appendChild(buildRoadCard(rb, items, years));
      }
    }

    function buildRoadCard(roadbedLabel, items, years) {
      const card = document.createElement("div");
      card.className = "evolens-road-card";

      const title = document.createElement("div");
      title.className = "evolens-road-card-title";
      title.textContent = `${roadbedLabel} (n=${items.length} segment${items.length === 1 ? "" : "s"})`;
      card.appendChild(title);

      card.appendChild(drawSegmentHeatmap(roadbedLabel, items, years));
      return card;
    }

    // One highway's segments x brushed years, real reference-marker position
    // on x (with big-gap collapse), newest year at top on y -- same
    // rendering as clusters.js's drawSegmentHeatmap, adapted to the already
    // brushed-and-fetched `values` arrays instead of a separate data file.
    function drawSegmentHeatmap(roadbedLabel, items, years) {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("class", "evolens-road-heatmap");

      if (!items.length || !years.length) {
        svg.setAttribute("viewBox", "0 0 1 1");
        svg.setAttribute("preserveAspectRatio", "none");
        return svg;
      }

      const nYears = years.length;
      let xMin = Infinity, xMax = -Infinity;
      for (const it of items) {
        if (it.seg.begin < xMin) xMin = it.seg.begin;
        if (it.seg.end > xMax) xMax = it.seg.end;
      }
      const xSpan = xMax - xMin > 0 ? xMax - xMin : 1;

      const bigGap = findBigGap(items.map((it) => it.seg));
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

      svg.setAttribute("viewBox", `0 0 1 ${nYears}`);
      svg.setAttribute("preserveAspectRatio", "none");

      for (const it of items) {
        const seg = it.seg;
        const x0 = xFrac(seg.begin);
        const x1 = xFrac(seg.end);
        const width = x1 - x0 > 0 ? x1 - x0 : 0;
        if (width <= 0) continue;

        for (let row = 0; row < nYears; row++) {
          const score = it.values[row];
          const isGap = score === null || score === undefined;
          const color = isGap ? "#bbbbbb" : conditionColor(score);

          const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
          rect.setAttribute("x", String(x0));
          rect.setAttribute("y", String(nYears - 1 - row));
          rect.setAttribute("width", String(width));
          rect.setAttribute("height", "1");
          rect.setAttribute("fill", color);
          rect.setAttribute("stroke", "#fafafa");
          rect.setAttribute("stroke-width", "1");
          rect.setAttribute("vector-effect", "non-scaling-stroke");

          const year = years[row];
          const mileRange = `mi ${seg.begin.toFixed(1)}-${seg.end.toFixed(1)}`;
          rect.addEventListener("mousemove", (event) => {
            let html;
            if (isGap) {
              html = `<b>${seg.id}</b><br>Year: ${year}<br>Segment: ${mileRange}<br>No data`;
            } else {
              const category = getCategory(score);
              html = `<b>${seg.id}</b><br>Year: ${year}<br>Segment: ${mileRange}<br>Score: ${score}<br>Category: ${category}`;
            }
            showCellTooltip(event, html, color);
          });
          rect.addEventListener("mouseout", hideCellTooltip);

          svg.appendChild(rect);
        }
      }
      return svg;
    }

    function percentile(sortedArr, p) {
      const idx = p * (sortedArr.length - 1);
      const lo = Math.floor(idx), hi = Math.ceil(idx);
      if (lo === hi) return sortedArr[lo];
      const frac = idx - lo;
      return sortedArr[lo] * (1 - frac) + sortedArr[hi] * frac;
    }

    function drawSvgChart(years, series, motif) {
      const width = chartWrapEl.clientWidth || 420;
      const rawHeight = 220;
      const motifHeight = 140;
      const margin = { top: 16, right: 16, bottom: 26, left: 36 };

      const svg = d3.select(chartWrapEl)
        .append("svg")
        .attr("width", width)
        .attr("height", rawHeight + motifHeight + margin.top + margin.bottom * 2 + 24);

      const innerW = width - margin.left - margin.right;

      const x = d3.scaleLinear()
        .domain([years[0], years[years.length - 1]])
        .range([0, innerW]);

      // --- Raw line chart -------------------------------------------------
      const rawG = svg.append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

      let allVals = [];
      for (const s of series) for (const v of s.values) if (v !== null) allVals.push(v);
      const yRawDomain = allVals.length ? [Math.min(0, d3.min(allVals)), Math.max(100, d3.max(allVals))] : [0, 100];
      const yRaw = d3.scaleLinear().domain(yRawDomain).range([rawHeight, 0]).nice();

      rawG.append("g").call(d3.axisLeft(yRaw).ticks(5));
      rawG.append("g")
        .attr("transform", `translate(0,${rawHeight})`)
        .call(d3.axisBottom(x).tickFormat(d3.format("d")).ticks(Math.min(years.length, 8)));

      rawG.append("text")
        .attr("class", "evolens-axis-label")
        .attr("x", -margin.left + 4)
        .attr("y", -4)
        .text("Condition score");

      const lineGen = d3.line()
        .defined((d) => d.v !== null)
        .x((d) => x(d.year))
        .y((d) => yRaw(d.v));

      series.forEach((s, i) => {
        const color = CHART_COLORS[i % CHART_COLORS.length];
        const pts = years.map((yr, yi) => ({ year: yr, v: s.values[yi] }));
        // defined() breaks the path at nulls automatically (no interpolation)
        rawG.append("path")
          .datum(pts)
          .attr("class", "evolens-raw-line")
          .attr("fill", "none")
          .attr("stroke", color)
          .attr("stroke-width", 1.4)
          .attr("d", lineGen);
      });

      // --- Trend motif (z-score IQR band + median), toggle-controlled -----
      const motifG = svg.append("g")
        .attr("class", "evolens-motif-group")
        .attr("transform", `translate(${margin.left},${margin.top + rawHeight + margin.bottom})`);

      let motifZVals = [];
      for (const m of motif) {
        if (m.p25 !== null) motifZVals.push(m.p25);
        if (m.p75 !== null) motifZVals.push(m.p75);
      }
      const yMotifDomain = motifZVals.length ? [d3.min(motifZVals) - 0.5, d3.max(motifZVals) + 0.5] : [-1, 1];
      const yMotif = d3.scaleLinear().domain(yMotifDomain).range([motifHeight, 0]).nice();

      motifG.append("g").call(d3.axisLeft(yMotif).ticks(4));
      motifG.append("g")
        .attr("transform", `translate(0,${motifHeight})`)
        .call(d3.axisBottom(x).tickFormat(d3.format("d")).ticks(Math.min(years.length, 8)));

      motifG.append("text")
        .attr("class", "evolens-axis-label")
        .attr("x", -margin.left + 4)
        .attr("y", -4)
        .text("Trend motif (z-score IQR + median)");

      const areaGen = d3.area()
        .defined((d) => d.p25 !== null && d.p75 !== null)
        .x((d) => x(d.year))
        .y0((d) => yMotif(d.p25))
        .y1((d) => yMotif(d.p75));

      const medianLineGen = d3.line()
        .defined((d) => d.p50 !== null)
        .x((d) => x(d.year))
        .y((d) => yMotif(d.p50));

      const motifPts = years.map((yr, yi) => ({ year: yr, p25: motif[yi].p25, p50: motif[yi].p50, p75: motif[yi].p75 }));

      motifG.append("path")
        .datum(motifPts)
        .attr("class", "evolens-motif-band")
        .attr("fill", "#4e79a7")
        .attr("fill-opacity", 0.25)
        .attr("d", areaGen);

      motifG.append("path")
        .datum(motifPts)
        .attr("class", "evolens-motif-median")
        .attr("fill", "none")
        .attr("stroke", "#2d5f8a")
        .attr("stroke-width", 2)
        .attr("d", medianLineGen);

      applyMotifVisibility();
    }

    function applyMotifVisibility() {
      const show = motifToggle.checked;
      chartWrapEl.querySelectorAll(".evolens-motif-group").forEach((g) => {
        g.style.display = show ? "" : "none";
      });
    }
    motifToggle.addEventListener("change", applyMotifVisibility);
  }
})();
