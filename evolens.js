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

    // Per-year storyline pages collapse each column to a single middle year
    // (window k has start === end === middle year), whereas window-range pages
    // keep the real 5-year span (start !== end). Detect from the data so we do
    // not depend on the HTML page setting a flag. On per-year pages the drilled
    // chart is expanded to the true 5-year correlation window [middle-2 ..
    // middle+2] behind each column, with the middle year(s) highlighted.
    const isPerYear = state.data.windows.length > 0 &&
      state.data.windows.every((w) => w.start === w.end);
    const EN_DASH = "–";

    // Subtitle range label. In per-year mode we make the expanded correlation
    // window vs. the column's focus year(s) explicit; otherwise keep the
    // original "start–end" span (window-range pages must be unchanged).
    function rangeLabel(yearStart, yearEnd, focusStart, focusEnd) {
      if (!isPerYear) return `${yearStart}${EN_DASH}${yearEnd}`;
      const focus = focusStart === focusEnd
        ? `${focusStart}`
        : `${focusStart}${EN_DASH}${focusEnd}`;
      return `correlation window ${yearStart}${EN_DASH}${yearEnd} (focus ${focus})`;
    }

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
    brushHint.textContent = "Drag a box to drill down";
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
      // Segment mode: brushing is always available (overview + filtered view).
      // Show the drill-down hint in the overview, hide it once a single road is
      // selected (the view is already focused), mirroring unit mode.
      if (state.selectedRoadIdx < 0) {
        brushHint.textContent = "Drag a box to drill down";
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
      const pitch = colPitch();
      const colW = state.colW;
      let kMin = Math.round((worldRect.x0 - MARGIN_LEFT - colW / 2) / pitch);
      let kMax = Math.round((worldRect.x1 - MARGIN_LEFT - colW / 2) / pitch);
      kMin = Math.max(0, Math.min(state.numWindows - 1, kMin));
      kMax = Math.max(0, Math.min(state.numWindows - 1, kMax));
      if (kMin > kMax) return;

      const windows = state.data.windows;
      // Focus range = the column middle year(s) (same as the pre-existing
      // yearStart/yearEnd on window-range pages).
      const focusStart = windows[kMin].start;
      const focusEnd = windows[kMax].end;
      // Expanded correlation-window range. On per-year pages each column's
      // cohort/correlation was computed over the 5-year window
      // [middle-2 .. middle+2], so widen the drilled chart to match; the chart
      // clamps to available years via the evData.years filter downstream.
      let yearStart = focusStart;
      let yearEnd = focusEnd;
      if (isPerYear) {
        yearStart = focusStart - 2;
        yearEnd = focusEnd + 2;
      }

      if (UNIT_MODE) {
        // Unit mode: select across every visible road (band; all roads in the
        // overview, or just the selected one), collecting
        // one unit key per matching segment/atom.
        const pointsCache = getPointsCache();
        const unitKeys = [];
        const seen = new Set();
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
            unitKeys.push(key);
          }
        }
        if (unitKeys.length === 0) return;

        activeSelection = { x0: worldRect.x0, y0: worldRect.y0, x1: worldRect.x1, y1: worldRect.y1 };
        selectionEl.classList.remove("hidden");
        syncSelectionOverlay();

        openUnitPanel(unitKeys, yearStart, yearEnd, focusStart, focusEnd);
        return;
      }

      // Segment mode: collect selected segments across every visible road (the
      // whole band in the overview, or just the one road in the filtered view,
      // since visibleRoadIndices() then returns a single index). One group per
      // road with at least one hit; no selection cap.
      const pointsCache = getPointsCache();
      const groups = [];
      let totalSegs = 0;
      for (const rIdx of visibleRoadIndices()) {
        const pts = pointsCache.get(rIdx);
        if (!pts) continue;
        const segIdxList = [];
        for (let segIdx = 0; segIdx < pts.length; segIdx++) {
          const segPts = pts[segIdx];
          let inside = false;
          for (const p of segPts) {
            if (p.k < kMin || p.k > kMax) continue;
            if (p.y >= worldRect.y0 && p.y <= worldRect.y1) { inside = true; break; }
          }
          if (inside) segIdxList.push(segIdx);
        }
        if (segIdxList.length === 0) continue;
        groups.push({ roadIdx: rIdx, segIdxList });
        totalSegs += segIdxList.length;
      }
      if (totalSegs === 0) return;

      activeSelection = { x0: worldRect.x0, y0: worldRect.y0, x1: worldRect.x1, y1: worldRect.y1 };
      selectionEl.classList.remove("hidden");
      syncSelectionOverlay();

      openPanel(groups, yearStart, yearEnd, focusStart, focusEnd);

      // Additionally feed the brushed segments to the map's cohort-spread (no-op
      // on non-map pages / when the bridge is absent). EvoLens panel behavior
      // above is unchanged; this only adds a map selection.
      if (window.__addMapSelectionFromGroups) {
        window.__addMapSelectionFromGroups(groups, kMin);
      }
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

    // Distinct highways (roadbeds) across all brushed groups, using the SAME
    // per-segment roadbed grouping renderChart uses to emit cards -- so the
    // title count always equals the number of cards rendered.
    function distinctRoadbeds(groups) {
      const set = new Set();
      for (const group of groups) {
        const road = state.data.roads[group.roadIdx];
        for (const segIdx of group.segIdxList) {
          const seg = road.segments[segIdx];
          set.add(seg.roadbed || road.roadbed || "?");
        }
      }
      return set;
    }

    function openPanel(groups, yearStart, yearEnd, focusStart, focusEnd) {
      const totalSegs = groups.reduce((a, g) => a + g.segIdxList.length, 0);
      // Title counts DISTINCT highways (roadbeds), matching the in-card heading
      // and the number of cards renderChart emits. A single highway reads as its
      // roadbed label (unchanged single-card wording).
      const roadbeds = distinctRoadbeds(groups);
      titleEl.textContent = roadbeds.size === 1
        ? roadbeds.values().next().value
        : `${roadbeds.size} highways selected`;
      subtitleEl.textContent =
        `${totalSegs} segment${totalSegs === 1 ? "" : "s"} selected  |  ` +
        rangeLabel(yearStart, yearEnd, focusStart, focusEnd);
      panel.classList.add("open");
      panel.classList.remove("hidden");

      chartWrapEl.innerHTML = `<div class="evolens-loading">Loading...</div>`;
      ensureEvolensData().then((d) => {
        renderChart(d, groups, yearStart, yearEnd, focusStart, focusEnd);
      }).catch((err) => {
        chartWrapEl.innerHTML = `<div class="evolens-loading">Failed to load evolens_data.json: ${err.message}</div>`;
        console.error(err);
      });
    }

    function openUnitPanel(unitKeys, yearStart, yearEnd, focusStart, focusEnd) {
      titleEl.textContent = "Unit drill-down";
      subtitleEl.textContent =
        `${unitKeys.length} unit${unitKeys.length === 1 ? "" : "s"} selected  |  ` +
        rangeLabel(yearStart, yearEnd, focusStart, focusEnd);
      panel.classList.add("open");
      panel.classList.remove("hidden");

      chartWrapEl.innerHTML = `<div class="evolens-loading">Loading...</div>`;
      ensureUnitSegments().then((d) => {
        renderUnitChart(d, unitKeys, yearStart, yearEnd, focusStart, focusEnd);
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

    // Build the focus-band descriptor for drawSvgChart. Only in per-year mode
    // do we highlight the column's middle year(s) inside the wider correlation
    // window; window-range mode returns null so no band is drawn.
    function makeFocusBand(focusStart, focusEnd) {
      if (!isPerYear || focusStart == null || focusEnd == null) return null;
      return { start: focusStart, end: focusEnd };
    }

    function renderUnitChart(unitData, unitKeys, yearStart, yearEnd, focusStart, focusEnd) {
      chartWrapEl.innerHTML = "";
      const years = unitData.years.filter((y) => y >= yearStart && y <= yearEnd);
      if (years.length === 0) {
        chartWrapEl.innerHTML = `<div class="evolens-loading">No year data in range.</div>`;
        return;
      }
      const yearIdx0 = unitData.years.indexOf(years[0]);

      const heading = document.createElement("div");
      heading.className = "evolens-heatmap-heading";
      heading.textContent = `${unitKeys.length} unit${unitKeys.length === 1 ? "" : "s"} selected`;
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
      drawSvgChart(years, allSeries, motif, makeFocusBand(focusStart, focusEnd));
    }

    function renderChart(evData, groups, yearStart, yearEnd, focusStart, focusEnd) {
      chartWrapEl.innerHTML = "";
      const years = evData.years.filter((y) => y >= yearStart && y <= yearEnd);
      if (years.length === 0) {
        chartWrapEl.innerHTML = `<div class="evolens-loading">No year data in range.</div>`;
        return;
      }
      const yearIdx0 = evData.years.indexOf(years[0]);

      // Show ONLY colored (painted) cohorts: a segment is kept iff it is present
      // in state.paint (the sectionId->hex Map set by the paint palette and the
      // Highlight-cohort menu; keyed by the raw seg.id, matched via String()).
      // Fallback: if the brush contains zero colored segments, keep the full set
      // and render exactly as before (never show an empty panel).
      const paint = state.paint;
      const isColored = (seg) => !!paint && paint.has(String(seg.id));
      const filterColored = groups.some((g) => {
        const segs = state.data.roads[g.roadIdx].segments;
        return g.segIdxList.some((si) => isColored(segs[si]));
      });

      // Split each brushed band group by (highway, county): one card per
      // (roadbed, county). On hwcounty pages a band is already a single
      // (highway, county) so this is a no-op (one card, unchanged); on
      // county/distance pages a highway crossing several counties becomes one
      // card per county. drawSegmentHeatmap positions cells by reference marker
      // (seg.begin), which resets per highway -- keying on (roadbed, county)
      // keeps each card's marker axis correct (and tighter, since a single
      // highway-county is a contiguous marker sub-range). Cards are emitted in
      // on-screen band order across groups, and within a group ordered by each
      // piece's first (lowest) begin marker so nearby pieces read top-to-bottom
      // by position; a highway's per-county pieces stay adjacent because their
      // marker ranges are consecutive.
      const allSeries = [];
      const cards = []; // { roadbed, county, label, items, firstBegin } across all groups
      for (const group of groups) {
        const road = state.data.roads[group.roadIdx];
        const byRoadCounty = new Map();
        for (const segIdx of group.segIdxList) {
          const seg = road.segments[segIdx];
          if (filterColored && !isColored(seg)) continue; // colored cohorts only
          const raw = evData.scores[seg.id];
          const values = years.map((_, i) => {
            const v = raw ? raw[yearIdx0 + i] : null;
            return (typeof v === "number" && !isNaN(v)) ? v : null;
          });
          const rb = seg.roadbed || road.roadbed || "?";
          const county = seg.county || "?";
          const key = rb + "	" + county; // composite key, tab-separated (no collision)
          let bucket = byRoadCounty.get(key);
          if (!bucket) { bucket = { roadbed: rb, county, items: [] }; byRoadCounty.set(key, bucket); }
          bucket.items.push({ seg: { id: seg.id, begin: seg.begin, end: seg.end }, values });
        }
        const groupCards = [];
        for (const bucket of byRoadCounty.values()) {
          bucket.items.sort((a, b) => a.seg.begin - b.seg.begin);
          groupCards.push({
            roadbed: bucket.roadbed,
            county: bucket.county,
            label: `${bucket.roadbed} · ${bucket.county}`, // "RB · county"
            items: bucket.items,
            firstBegin: bucket.items[0].seg.begin,
          });
        }
        groupCards.sort((a, b) => a.firstBegin - b.firstBegin);
        cards.push(...groupCards);
      }

      const totalSegs = cards.reduce((a, c) => a + c.items.length, 0);
      const heading = document.createElement("div");
      heading.className = "evolens-heatmap-heading";
      heading.textContent =
        `Selected segments by highway + county (${cards.length} card${cards.length === 1 ? "" : "s"}, ${totalSegs} segments)` +
        (filterColored ? " (colored cohorts only)" : "");
      chartWrapEl.appendChild(heading);

      for (const card of cards) {
        chartWrapEl.appendChild(buildRoadCard(card.label, card.items, years));
        for (const it of card.items) {
          allSeries.push({ id: it.seg.id, values: it.values });
        }
      }

      const motif = computeMotif(allSeries);
      drawSvgChart(years, allSeries, motif, makeFocusBand(focusStart, focusEnd));
    }

    // ------------------------------------------------------------------
    // Per-road heatmap cards -- same visual language as clusters.html's
    // thumbnail grid (real reference-marker position with big-gap collapse,
    // discrete TxDOT condition-score color buckets, edge-flipping tooltip),
    // ported directly from clusters.js. renderChart renders one card per
    // brushed road group (in on-screen band order), so a multi-road overview
    // brush yields one card per road and a single-road brush yields one card.
    // ------------------------------------------------------------------
    // Color helpers + heatmap renderer live in heatmap.js (window.HeatmapUtil),
    // shared with clusters.js.

    const cellTooltip = document.createElement("div");
    cellTooltip.className = "evolens-cell-tooltip hidden";
    document.body.appendChild(cellTooltip);
    function showCellTooltip(evt, html, color) {
      cellTooltip.innerHTML = html;
      cellTooltip.style.backgroundColor = color;
      cellTooltip.style.color = HeatmapUtil.getContrastColor(color);
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
      const segments = items.map((it) => ({
        begin: it.seg.begin,
        end: it.seg.end,
        id: it.seg.id,
        scores: it.values,
      }));

      const svg = HeatmapUtil.drawSegmentHeatmap(segments, years, {
        onCellTip: (event, info) =>
          showCellTooltip(
            event,
            `<b>${info.seg.id}</b><br>Year: ${info.year}<br>Segment: ${info.mileRange}<br>Score: ${info.score}<br>Category: ${info.category}`,
            info.color
          ),
        onCellOut: hideCellTooltip,
      });
      svg.setAttribute("class", "evolens-road-heatmap");
      return svg;
    }

    function percentile(sortedArr, p) {
      const idx = p * (sortedArr.length - 1);
      const lo = Math.floor(idx), hi = Math.ceil(idx);
      if (lo === hi) return sortedArr[lo];
      const frac = idx - lo;
      return sortedArr[lo] * (1 - frac) + sortedArr[hi] * frac;
    }

    // Shaded vertical band marking the focus (middle) year(s) of the column(s)
    // inside the wider correlation window. Appended first into the given group
    // so it sits behind the series lines. A single-year focus (start === end)
    // still renders a thin visible band via a small ± padding, clamped to the
    // plotted year domain.
    function drawFocusBand(g, x, height, focusBand, years) {
      const domLo = years[0];
      const domHi = years[years.length - 1];
      const lo = Math.max(domLo, focusBand.start - 0.5);
      const hi = Math.min(domHi, focusBand.end + 0.5);
      const xLo = x(lo);
      const xHi = x(hi);
      g.append("rect")
        .attr("class", "evolens-focus-band")
        .attr("x", xLo)
        .attr("y", 0)
        .attr("width", Math.max(2, xHi - xLo))
        .attr("height", height);
    }

    function drawSvgChart(years, series, motif, focusBand) {
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

      // Focus band first so it renders behind axes + series lines.
      if (focusBand) drawFocusBand(rawG, x, rawHeight, focusBand, years);

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

      if (focusBand) drawFocusBand(motifG, x, motifHeight, focusBand, years);

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
