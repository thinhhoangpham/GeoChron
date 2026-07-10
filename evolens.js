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
      <div class="evolens-coherence hidden" id="evolensCoherence">
        <label class="evolens-coherence-label" for="evolensCoherenceSlider">Min coherence to cohort</label>
        <div class="evolens-coherence-row">
          <input type="range" id="evolensCoherenceSlider" min="-1" max="1" step="0.05" value="-1">
          <span class="evolens-coherence-readout" id="evolensCoherenceReadout"></span>
          <button id="evolensCoherenceBtn" class="evolens-coherence-btn" disabled>Remove 0 segments</button>
        </div>
      </div>
      <div id="evolensChartRow" class="evolens-chart-row"></div>
      <div id="evolensChartBody" class="evolens-chart-body"></div>
      <div class="evolens-resize-handle" title="Resize"></div>
    `;
    document.body.appendChild(panel);

    // Floating-window position/size, remembered across drill-down opens for the
    // life of the page (module state; no persistence across reloads).
    const PANEL_DEFAULT_W = 1000, PANEL_DEFAULT_H = 700;
    const PANEL_MIN_W = 420, PANEL_MIN_H = 320;
    let panelPos = null;  // { left, top } in px, once dragged
    let panelSize = null; // { w, h } in px, once resized

    function positionPanel() {
      if (!panelSize) {
        // Clamp the default to the viewport (minus 16px insets) so a screen
        // smaller than 1000x700 never opens the panel partially off-screen,
        // but never shrink below the min-size constants.
        const maxW = Math.max(PANEL_MIN_W, window.innerWidth - 32);
        const maxH = Math.max(PANEL_MIN_H, window.innerHeight - 32);
        panelSize = {
          w: Math.min(PANEL_DEFAULT_W, maxW),
          h: Math.min(PANEL_DEFAULT_H, maxH),
        };
      }
      if (!panelPos) panelPos = { left: Math.max(0, window.innerWidth - panelSize.w - 16), top: 16 };
      panel.style.width = panelSize.w + "px";
      panel.style.height = panelSize.h + "px";
      panel.style.left = panelPos.left + "px";
      panel.style.top = panelPos.top + "px";
    }

    const brushHint = document.createElement("div");
    brushHint.id = "evolensHint";
    brushHint.className = "evolens-hint hidden";
    brushHint.textContent = "Drag a box to drill down";
    canvasWrap.appendChild(brushHint);

    const closeBtn = panel.querySelector("#evolensClose");
    const titleEl = panel.querySelector("#evolensTitle");
    const subtitleEl = panel.querySelector("#evolensSubtitle");
    // Pinned chart row (two side-by-side charts) + scrollable heatmap body.
    const chartRowEl = panel.querySelector("#evolensChartRow");
    const chartBodyEl = panel.querySelector("#evolensChartBody");

    // ------------------------------------------------------------------
    // Floating window: drag by the header, resize by the corner grip.
    // ------------------------------------------------------------------
    const headerEl = panel.querySelector(".evolens-header");
    let dragOff = null; // { x, y } cursor-to-panel offset while dragging
    headerEl.addEventListener("mousedown", (evt) => {
      if (evt.button !== 0 || evt.target.closest(".evolens-close")) return;
      dragOff = { x: evt.clientX - panel.offsetLeft, y: evt.clientY - panel.offsetTop };
      evt.preventDefault();
    });

    const resizeHandle = panel.querySelector(".evolens-resize-handle");
    let resizeOff = null; // { x, y, w, h } at resize start
    resizeHandle.addEventListener("mousedown", (evt) => {
      if (evt.button !== 0) return;
      resizeOff = { x: evt.clientX, y: evt.clientY, w: panel.offsetWidth, h: panel.offsetHeight };
      evt.preventDefault();
      evt.stopPropagation();
    });

    window.addEventListener("mousemove", (evt) => {
      if (dragOff) {
        let left = Math.max(0, Math.min(window.innerWidth - 60, evt.clientX - dragOff.x));
        let top = Math.max(0, Math.min(window.innerHeight - 40, evt.clientY - dragOff.y));
        panel.style.left = left + "px";
        panel.style.top = top + "px";
        panelPos = { left, top };
      } else if (resizeOff) {
        const w = Math.max(PANEL_MIN_W, resizeOff.w + (evt.clientX - resizeOff.x));
        const h = Math.max(PANEL_MIN_H, resizeOff.h + (evt.clientY - resizeOff.y));
        panel.style.width = w + "px";
        panel.style.height = h + "px";
        panelSize = { w, h };
      }
    });
    window.addEventListener("mouseup", () => { dragOff = null; resizeOff = null; });

    // Coherence filter (segment mode only): dims/removes painted segments that
    // poorly follow the cohort's shared trend. Hidden in unit mode entirely.
    const coherenceWrap = panel.querySelector("#evolensCoherence");
    const coherenceSlider = panel.querySelector("#evolensCoherenceSlider");
    const coherenceReadout = panel.querySelector("#evolensCoherenceReadout");
    const coherenceBtn = panel.querySelector("#evolensCoherenceBtn");
    // Per-render descriptor for the coherence filter, rebuilt each renderChart:
    // { evData, groups, yearStart, yearEnd, focusStart, focusEnd,
    //   segs: [{ id, coh, rects: [SVGRect] }] }.
    let coherenceState = null;
    // Segment ids removed via the coherence filter during the CURRENT drill-down
    // session. Reset on each new segment-mode brush (openPanel), NOT on re-render,
    // so exclusions accumulate across successive "Remove segments" clicks. This is
    // the only removal mechanism in fallback mode (no paint state to persist
    // against); in painted-cohort mode it works alongside unpaintSegments.
    let excludedSegIds = new Set();
    if (UNIT_MODE) coherenceWrap.classList.add("hidden");

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
    // Resize handles on the committed selection box. 4 corners + 4 edge
    // midpoints; anchored (via CSS %) as children of selectionEl so they
    // move for free on scroll/resize. Dragging updates activeSelection live
    // and re-runs the drill-down once on release.
    // ------------------------------------------------------------------
    // ax/ay in {0, 0.5, 1}: anchor position along width/height. edgeX/edgeY
    // name which world edge that axis moves ("x0"/"x1"/null, "y0"/"y1"/null).
    const HANDLE_SPECS = [
      { ax: 0,   ay: 0,   edgeX: "x0", edgeY: "y0", cursor: "nwse-resize" },
      { ax: 0.5, ay: 0,   edgeX: null, edgeY: "y0", cursor: "ns-resize"   },
      { ax: 1,   ay: 0,   edgeX: "x1", edgeY: "y0", cursor: "nesw-resize" },
      { ax: 1,   ay: 0.5, edgeX: "x1", edgeY: null, cursor: "ew-resize"   },
      { ax: 1,   ay: 1,   edgeX: "x1", edgeY: "y1", cursor: "nwse-resize" },
      { ax: 0.5, ay: 1,   edgeX: null, edgeY: "y1", cursor: "ns-resize"   },
      { ax: 0,   ay: 1,   edgeX: "x0", edgeY: "y1", cursor: "nesw-resize" },
      { ax: 0,   ay: 0.5, edgeX: "x0", edgeY: null, cursor: "ew-resize"   },
    ];

    let resizeSpec = null; // active handle spec while dragging, else null

    for (const spec of HANDLE_SPECS) {
      const handle = document.createElement("div");
      handle.className = "evolens-selection-handle";
      handle.style.left = (spec.ax * 100) + "%";
      handle.style.top = (spec.ay * 100) + "%";
      handle.style.cursor = spec.cursor;
      handle.addEventListener("mousedown", (evt) => {
        if (evt.button !== 0 || !activeSelection) return;
        // Do not let this start a fresh canvas brush.
        evt.preventDefault();
        evt.stopPropagation();
        resizeSpec = spec;
      });
      selectionEl.appendChild(handle);
    }

    window.addEventListener("mousemove", (evt) => {
      if (!resizeSpec || !activeSelection) return;
      const world = clientToWorld(evt.clientX, evt.clientY);
      if (resizeSpec.edgeX) activeSelection[resizeSpec.edgeX] = world.x;
      if (resizeSpec.edgeY) activeSelection[resizeSpec.edgeY] = world.y;
      syncSelectionOverlay();
    });

    window.addEventListener("mouseup", () => {
      if (!resizeSpec) return;
      resizeSpec = null;
      if (!activeSelection) return;
      // Normalize (x0<x1, y0<y1) and clamp to a small minimum so a collapsed
      // box never fires an empty selection.
      let { x0, y0, x1, y1 } = activeSelection;
      if (x0 > x1) [x0, x1] = [x1, x0];
      if (y0 > y1) [y0, y1] = [y1, y0];
      if (x1 - x0 < DRAG_THRESHOLD_PX) x1 = x0 + DRAG_THRESHOLD_PX;
      if (y1 - y0 < DRAG_THRESHOLD_PX) y1 = y0 + DRAG_THRESHOLD_PX;
      handleBrushEnd({ x0, y0, x1, y1 });
    });

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
      coherenceState = null;
      coherenceWrap.classList.add("hidden");
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
      excludedSegIds = new Set(); // fresh brush -> clear prior session's exclusions
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
      positionPanel();
      panel.classList.add("open");
      panel.classList.remove("hidden");

      chartRowEl.innerHTML = "";
      chartBodyEl.innerHTML = `<div class="evolens-loading">Loading...</div>`;
      ensureEvolensData().then((d) => {
        renderChart(d, groups, yearStart, yearEnd, focusStart, focusEnd);
      }).catch((err) => {
        chartBodyEl.innerHTML = `<div class="evolens-loading">Failed to load evolens_data.json: ${err.message}</div>`;
        console.error(err);
      });
    }

    function openUnitPanel(unitKeys, yearStart, yearEnd, focusStart, focusEnd) {
      titleEl.textContent = "Unit drill-down";
      subtitleEl.textContent =
        `${unitKeys.length} unit${unitKeys.length === 1 ? "" : "s"} selected  |  ` +
        rangeLabel(yearStart, yearEnd, focusStart, focusEnd);
      positionPanel();
      panel.classList.add("open");
      panel.classList.remove("hidden");

      chartRowEl.innerHTML = "";
      chartBodyEl.innerHTML = `<div class="evolens-loading">Loading...</div>`;
      ensureUnitSegments().then((d) => {
        renderUnitChart(d, unitKeys, yearStart, yearEnd, focusStart, focusEnd);
      }).catch((err) => {
        chartBodyEl.innerHTML = `<div class="evolens-loading">Failed to load unit_segments_full.json: ${err.message}</div>`;
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
      coherenceWrap.classList.add("hidden"); // control is segment-mode only
      coherenceState = null;
      chartRowEl.innerHTML = "";
      chartBodyEl.innerHTML = "";
      const years = unitData.years.filter((y) => y >= yearStart && y <= yearEnd);
      if (years.length === 0) {
        chartBodyEl.innerHTML = `<div class="evolens-loading">No year data in range.</div>`;
        return;
      }
      const yearIdx0 = unitData.years.indexOf(years[0]);

      const heading = document.createElement("div");
      heading.className = "evolens-heatmap-heading";
      heading.textContent = `${unitKeys.length} unit${unitKeys.length === 1 ? "" : "s"} selected`;
      chartBodyEl.appendChild(heading);

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

        chartBodyEl.appendChild(buildRoadCard(unitKey, items, years));

        for (const it of items) {
          allSeries.push({ id: it.seg.id, values: it.values });
        }
      }

      const motif = computeMotif(allSeries);
      drawSvgChart(years, allSeries, motif, makeFocusBand(focusStart, focusEnd));
    }

    function renderChart(evData, groups, yearStart, yearEnd, focusStart, focusEnd) {
      chartRowEl.innerHTML = "";
      chartBodyEl.innerHTML = "";
      const years = evData.years.filter((y) => y >= yearStart && y <= yearEnd);
      if (years.length === 0) {
        chartBodyEl.innerHTML = `<div class="evolens-loading">No year data in range.</div>`;
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
          if (excludedSegIds.has(String(seg.id))) continue; // removed via coherence filter this session
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
      chartBodyEl.appendChild(heading);

      for (const card of cards) {
        chartBodyEl.appendChild(buildRoadCard(card.label, card.items, years));
        for (const it of card.items) {
          allSeries.push({ id: it.seg.id, values: it.values });
        }
      }

      const motif = computeMotif(allSeries);
      const chart = drawSvgChart(years, allSeries, motif, makeFocusBand(focusStart, focusEnd));

      setupCoherenceFilter(evData, groups, years, allSeries, motif, chart,
        yearStart, yearEnd, focusStart, focusEnd, filterColored);
    }

    // ------------------------------------------------------------------
    // Coherence filter: correlate each shown segment to the cohort MEDOID (the
    // most-central segment under pairwise correlation) over the focus window,
    // then let the user dim/remove the segments that follow the shared trend
    // least. Segment mode only, and only when a painted cohort is actually shown
    // (filterColored). The displayed trend motif still uses the median band
    // (computeMotif); only this coherence metric uses the medoid.
    // ------------------------------------------------------------------
    function setupCoherenceFilter(evData, groups, years, allSeries, motif, chart,
                                  yearStart, yearEnd, focusStart, focusEnd, filterColored) {
      if (UNIT_MODE || allSeries.length === 0) {
        coherenceState = null;
        coherenceWrap.classList.add("hidden");
        return;
      }

      // Focus-window year indices into `years` (same length/order as motif).
      const focusIdx = [];
      for (let i = 0; i < years.length; i++) {
        if (years[i] >= focusStart && years[i] <= focusEnd) focusIdx.push(i);
      }

      // Focus-window Pearson correlation between two per-year value arrays,
      // using only indices where BOTH are non-null. -Infinity for <3 overlapping
      // points / zero variance (via the shared pearson helper).
      function corrFocus(av, bv) {
        const xs = [], ys = [];
        for (const i of focusIdx) {
          const a = av[i], b = bv[i];
          if (a == null || b == null) continue; // need both non-null
          xs.push(a); ys.push(b);
        }
        return pearson(xs, ys);
      }

      // Medoid = segment with the highest MEAN pairwise correlation to the other
      // shown segments (argmax_i avg_{j != i} r(i,j)). Build the symmetric
      // pairwise matrix once (O(n^2), r(i,j)=r(j,i)); undefined/-Infinity pairs
      // count as 0 in the mean so an incomparable segment neither inflates nor
      // -Inf-poisons a candidate's centrality.
      const n = allSeries.length;
      let medoidValues = allSeries[0].values;
      if (n >= 2) {
        const R = Array.from({ length: n }, () => new Float64Array(n));
        for (let i = 0; i < n; i++) {
          for (let j = i + 1; j < n; j++) {
            let r = corrFocus(allSeries[i].values, allSeries[j].values);
            if (!isFinite(r)) r = 0; // treat incomparable pairs as 0 when averaging
            R[i][j] = r; R[j][i] = r;
          }
        }
        let bestIdx = 0, bestMean = -Infinity;
        for (let i = 0; i < n; i++) {
          let sum = 0;
          for (let j = 0; j < n; j++) if (j !== i) sum += R[i][j];
          const mean = sum / (n - 1);
          if (mean > bestMean) { bestMean = mean; bestIdx = i; }
        }
        medoidValues = allSeries[bestIdx].values;
      }

      // Each segment's coherence = its focus-window correlation to the medoid.
      // The medoid self-correlates to 1; segments with <3 overlapping focus
      // points vs the medoid stay -Infinity (always eligible for removal).
      function coherenceOf(values) {
        return corrFocus(values, medoidValues);
      }

      // Map each shown segment id to its rendered heatmap rects (tagged above).
      const rectsById = new Map();
      chartBodyEl.querySelectorAll("[data-seg-id]").forEach((r) => {
        const id = r.getAttribute("data-seg-id");
        let arr = rectsById.get(id);
        if (!arr) { arr = []; rectsById.set(id, arr); }
        arr.push(r);
      });

      const segs = allSeries.map((s) => {
        const id = String(s.id);
        return { id, coh: coherenceOf(s.values), rects: rectsById.get(id) || [] };
      });

      // Stash the full (unmutated) series + chart handle so each preview pass
      // recomputes the motif from scratch over the surviving subset -- keeping
      // the preview non-destructive when the threshold slides back up.
      coherenceState = {
        evData, groups, yearStart, yearEnd, focusStart, focusEnd,
        segs, allSeries, chart, filterColored,
      };

      coherenceSlider.value = "-1"; // reset to "nothing filtered" on each render
      coherenceWrap.classList.remove("hidden");
      updateCoherencePreview();
    }

    // Recompute below-threshold segments, dim their rows, update the readout and
    // the button. View-only preview -- does not touch paint or re-render.
    function updateCoherencePreview() {
      if (!coherenceState) return;
      const t = parseFloat(coherenceSlider.value);
      const chart = coherenceState.chart;
      let below = 0;
      const visibleSeries = [];
      coherenceState.segs.forEach((s, i) => {
        const dim = s.coh < t;
        if (dim) below++; else visibleSeries.push(coherenceState.allSeries[i]);
        // Dim the segment's heatmap cells...
        for (const r of s.rects) r.classList.toggle("evolens-row-dimmed", dim);
        // ...and hide (not delete) its raw line so raising the threshold restores it.
        if (chart && chart.rawLines[i]) {
          chart.rawLines[i].classList.toggle("evolens-line-hidden", dim);
        }
      });

      // Live-recompute the trend motif from ONLY the surviving series, reusing
      // the original generators + fixed yMotif scale (via the stashed d/paths).
      // Correct even while the motif toggle is off, so it looks right when shown.
      if (chart) {
        const m = computeMotif(visibleSeries);
        const pts = chart.years.map((yr, yi) => ({
          year: yr,
          p25: m.length ? m[yi].p25 : null,
          p50: m.length ? m[yi].p50 : null,
          p75: m.length ? m[yi].p75 : null,
        }));
        chart.bandPath.datum(pts).attr("d", chart.areaGen);
        chart.medianPath.datum(pts).attr("d", chart.medianLineGen);
      }

      const total = coherenceState.segs.length;
      coherenceReadout.textContent = `${below} of ${total} below ${t.toFixed(2)}`;
      coherenceBtn.disabled = below === 0;
      coherenceBtn.textContent = `Remove ${below} segment${below === 1 ? "" : "s"}`;
    }

    // Persistently drop the below-threshold segments from the cohort (paint +
    // map), then re-render the drill-down for whatever painted segments survive.
    function commitCoherenceFilter() {
      if (!coherenceState) return;
      const t = parseFloat(coherenceSlider.value);
      const ids = coherenceState.segs.filter((s) => s.coh < t).map((s) => s.id);
      if (ids.length === 0) return;

      // Painted-cohort mode: drop the ids from the paint palette + map. No-op in
      // fallback mode (these ids were never in state.paint), which is harmless.
      if (window.__storyline && window.__storyline.unpaintSegments) {
        window.__storyline.unpaintSegments(ids);
      }

      // Also record the removal in the session exclusion set so renderChart drops
      // these segments regardless of paint state. This is what makes "Remove
      // segments" work in fallback mode (no paint to persist against), and it is
      // consistent with — not a replacement for — the paint-based filtering.
      for (const id of ids) excludedSegIds.add(id);

      const cs = coherenceState;

      // Painted-cohort mode (unchanged behavior): the panel shows a painted
      // cohort. If, after unpainting, no painted segment survives among the
      // brushed groups, close the panel rather than falling back to the
      // "show everything" path -- this is the pre-existing, correct behavior.
      if (cs.filterColored) {
        const paint = state.paint;
        const stillColored = cs.groups.some((g) => {
          const segs = state.data.roads[g.roadIdx].segments;
          return g.segIdxList.some((si) => paint && paint.has(String(segs[si].id)));
        });
        if (!stillColored) { closePanel(); return; }
      }

      // Re-render. renderChart applies BOTH the paint filter (filterColored) and
      // the exclusion set, so it shows exactly the surviving segments and keeps
      // the panel open. In fallback mode (no paint) this removes the
      // below-threshold segments and keeps the panel open on the remainder; it
      // renders a "0 segments" heading (no auto-close) only if nothing remains.
      renderChart(cs.evData, cs.groups, cs.yearStart, cs.yearEnd, cs.focusStart, cs.focusEnd);
    }

    coherenceSlider.addEventListener("input", updateCoherencePreview);
    coherenceBtn.addEventListener("click", commitCoherenceFilter);

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
      tagHeatmapRows(svg, items);
      return svg;
    }

    // Tag each heatmap rect with data-seg-id so the coherence filter can dim a
    // segment's cells by id. HeatmapUtil draws one vertical strip of year-rects
    // per segment, all sharing the same `x` attribute (= xFrac(seg.begin),
    // monotonic in begin). Group rects by x, sort the distinct x ascending, and
    // zip against the segments that actually rendered (>=1 non-null value),
    // ordered by begin -- the i-th smallest x is the i-th rendered segment.
    function tagHeatmapRows(svg, items) {
      const byX = new Map();
      svg.querySelectorAll("rect").forEach((r) => {
        const xk = r.getAttribute("x");
        let arr = byX.get(xk);
        if (!arr) { arr = []; byX.set(xk, arr); }
        arr.push(r);
      });
      const xKeys = Array.from(byX.keys()).sort((a, b) => parseFloat(a) - parseFloat(b));
      const rendered = items
        .filter((it) => it.values.some((v) => v !== null))
        .slice()
        .sort((a, b) => a.seg.begin - b.seg.begin);
      const n = Math.min(xKeys.length, rendered.length);
      for (let i = 0; i < n; i++) {
        const id = String(rendered[i].seg.id);
        for (const r of byX.get(xKeys[i])) r.setAttribute("data-seg-id", id);
      }
    }

    function percentile(sortedArr, p) {
      const idx = p * (sortedArr.length - 1);
      const lo = Math.floor(idx), hi = Math.ceil(idx);
      if (lo === hi) return sortedArr[lo];
      const frac = idx - lo;
      return sortedArr[lo] * (1 - frac) + sortedArr[hi] * frac;
    }

    // Pearson correlation of two equal-length numeric arrays. Returns
    // -Infinity when it cannot be defined (fewer than 3 points or zero variance
    // on either side), so such a segment always counts as poorly-following.
    function pearson(xs, ys) {
      const n = xs.length;
      if (n < 3) return -Infinity;
      let sx = 0, sy = 0;
      for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; }
      const mx = sx / n, my = sy / n;
      let num = 0, dx2 = 0, dy2 = 0;
      for (let i = 0; i < n; i++) {
        const a = xs[i] - mx, b = ys[i] - my;
        num += a * b; dx2 += a * a; dy2 += b * b;
      }
      const den = Math.sqrt(dx2 * dy2);
      return den > 0 ? num / den : -Infinity;
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

    // Two separate fixed-size charts placed side by side in the pinned chart
    // row: the raw segments line chart (left) and the trend motif chart (right).
    // Each is a fixed CHART_W x CHART_H so they never stretch when the panel
    // resizes; if the pair overflows the panel width, the chart row scrolls
    // horizontally (see .evolens-chart-row in storyline.css).
    const CHART_W = 420, CHART_H = 240;
    const CHART_MARGIN = { top: 16, right: 16, bottom: 26, left: 36 };

    function drawSvgChart(years, series, motif, focusBand) {
      const margin = CHART_MARGIN;
      const innerW = CHART_W - margin.left - margin.right;
      const innerH = CHART_H - margin.top - margin.bottom;

      const x = d3.scaleLinear()
        .domain([years[0], years[years.length - 1]])
        .range([0, innerW]);

      // --- Raw line chart (left) ------------------------------------------
      const rawSvg = d3.select(chartRowEl)
        .append("svg")
        .attr("class", "evolens-chart")
        .attr("width", CHART_W)
        .attr("height", CHART_H);

      const rawG = rawSvg.append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

      // Focus band first so it renders behind axes + series lines.
      if (focusBand) drawFocusBand(rawG, x, innerH, focusBand, years);

      let allVals = [];
      for (const s of series) for (const v of s.values) if (v !== null) allVals.push(v);
      const yRawDomain = allVals.length ? [Math.min(0, d3.min(allVals)), Math.max(100, d3.max(allVals))] : [0, 100];
      const yRaw = d3.scaleLinear().domain(yRawDomain).range([innerH, 0]).nice();

      rawG.append("g").call(d3.axisLeft(yRaw).ticks(5));
      rawG.append("g")
        .attr("transform", `translate(0,${innerH})`)
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

      // Keep each raw line node (aligned to `series` order) so the coherence
      // preview can hide/show a segment's line by index without a redraw.
      const rawLines = [];
      series.forEach((s, i) => {
        const color = CHART_COLORS[i % CHART_COLORS.length];
        const pts = years.map((yr, yi) => ({ year: yr, v: s.values[yi] }));
        // defined() breaks the path at nulls automatically (no interpolation)
        const path = rawG.append("path")
          .datum(pts)
          .attr("class", "evolens-raw-line")
          .attr("data-seg-id", String(s.id))
          .attr("fill", "none")
          .attr("stroke", color)
          .attr("stroke-width", 1.4)
          .attr("d", lineGen);
        rawLines.push(path.node());
      });

      // --- Trend motif chart (right, z-score IQR band + median) -----------
      const motifSvg = d3.select(chartRowEl)
        .append("svg")
        .attr("class", "evolens-chart")
        .attr("width", CHART_W)
        .attr("height", CHART_H);

      const motifG = motifSvg.append("g")
        .attr("class", "evolens-motif-group")
        .attr("transform", `translate(${margin.left},${margin.top})`);

      if (focusBand) drawFocusBand(motifG, x, innerH, focusBand, years);

      let motifZVals = [];
      for (const m of motif) {
        if (m.p25 !== null) motifZVals.push(m.p25);
        if (m.p75 !== null) motifZVals.push(m.p75);
      }
      const yMotifDomain = motifZVals.length ? [d3.min(motifZVals) - 0.5, d3.max(motifZVals) + 0.5] : [-1, 1];
      const yMotif = d3.scaleLinear().domain(yMotifDomain).range([innerH, 0]).nice();

      motifG.append("g").call(d3.axisLeft(yMotif).ticks(4));
      motifG.append("g")
        .attr("transform", `translate(0,${innerH})`)
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

      const bandPath = motifG.append("path")
        .datum(motifPts)
        .attr("class", "evolens-motif-band")
        .attr("fill", "#4e79a7")
        .attr("fill-opacity", 0.25)
        .attr("d", areaGen);

      const medianPath = motifG.append("path")
        .datum(motifPts)
        .attr("class", "evolens-motif-median")
        .attr("fill", "none")
        .attr("stroke", "#2d5f8a")
        .attr("stroke-width", 2)
        .attr("d", medianLineGen);

      // Handle returned so the coherence preview can live-refine the chart:
      // hide below-threshold raw lines (rawLines) and recompute the motif band +
      // median from the surviving series, reusing these generators/scales. The
      // motif y-scale (yMotif) domain stays fixed at the full-cohort range so
      // the band does not jump scale while dragging.
      return { rawLines, bandPath, medianPath, areaGen, medianLineGen, years };
    }
  }
})();
