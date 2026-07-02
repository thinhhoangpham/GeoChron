/* ============================================================================
 * Unit Clusters browser
 *
 * Read-only viewer: sidebar lists clusters (largest-first, as given in the
 * JSON), clicking a cluster renders a grid of heatmap thumbnails for each
 * member unit. No build step, plain ES2017+. d3 used only for the RdYlGn
 * color scale (same convention as storyline.js).
 * ==========================================================================*/

(function () {
  "use strict";

  // ------------------------------------------------------------------------
  // DOM refs
  // ------------------------------------------------------------------------
  const statusEl = document.getElementById("status");
  const sidebarEl = document.getElementById("clusterSidebar");
  const gridEl = document.getElementById("thumbnailGrid");
  const fillModeEl = document.getElementById("fillMode");

  // Three gap-fill strategies compared for unit clustering (see
  // build_unit_heatmaps*.py / cluster_units*.py). All three cluster the SAME
  // 295 units and render identical real-segment heatmaps (drawSegmentHeatmap
  // always uses unit_segments_full.json, which never has fill applied) --
  // only which units land in which cluster differs.
  const CLUSTER_FILES = {
    flatmean: "unit_clusters.json",
    fill1: "unit_clusters_fill1.json",
    nofill: "unit_clusters_nofill.json",
  };

  // ------------------------------------------------------------------------
  // Global state
  // ------------------------------------------------------------------------
  const state = {
    clustersData: null,   // raw unit_clusters*.json for the selected fill mode
    unitsByKey: null,     // Map<key, unit> built from unit_heatmaps.json
    rawUnitsByKey: null,  // Map<key, unit> built from unit_heatmaps_raw.json
    segmentsByKey: null,  // Map<key, unit> built from unit_segments_full.json
    years: null,          // real calendar years array from unit_segments_full.json
    selectedClusterIdx: -1,
    fillMode: "flatmean",
  };

  // ------------------------------------------------------------------------
  // Color helpers -- discrete condition-score categorization, ported from
  // HighwaySegmentChart.tsx's getCategory/getCategoryColor (TX_CONDITION_SCORE
  // branch only -- this app only ever deals with condition scores).
  // ------------------------------------------------------------------------
  function getCategory(metric, score) {
    switch (metric) {
      case "TX_CONDITION_SCORE":
        if (score >= 90) return "Very Good";
        if (score >= 70) return "Good";
        if (score >= 50) return "Fair";
        if (score >= 35) return "Poor";
        if (score < 1) return "Invalid";
        return "Very Poor";
      default:
        return "Very Good";
    }
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
    return getCategoryColor(getCategory("TX_CONDITION_SCORE", v));
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

  // ------------------------------------------------------------------------
  // Tooltip -- floating HTML div positioned near cursor, flipped away from
  // viewport edges. Ported from HighwaySegmentChart.tsx's showTooltip/
  // hideTooltip (tooltipRef pattern), adapted to a single shared div created
  // once and reused for the whole page instead of a per-chart ref.
  // ------------------------------------------------------------------------
  const tooltipEl = document.createElement("div");
  tooltipEl.className = "cell-tooltip hidden";
  document.body.appendChild(tooltipEl);

  function showTooltip(event, html, color) {
    const cx = event.clientX;
    const cy = event.clientY;
    const tooltipWidth = 200; // approximate tooltip width
    const tooltipHeight = 100; // approximate tooltip height
    const offset = 12;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let left;
    if (cx < tooltipWidth + offset) {
      left = cx + offset;
    } else if (cx > viewportWidth - tooltipWidth - offset) {
      left = cx - tooltipWidth - offset;
    } else {
      left = cx + offset;
    }

    let top;
    if (cy > viewportHeight - tooltipHeight - offset) {
      top = cy - tooltipHeight - offset;
    } else {
      top = cy + offset;
    }

    tooltipEl.style.left = `${left}px`;
    tooltipEl.style.top = `${top}px`;
    tooltipEl.innerHTML = html;
    tooltipEl.style.backgroundColor = color;
    tooltipEl.style.color = getContrastColor(color);
    tooltipEl.classList.remove("hidden");
  }

  function hideTooltip() {
    tooltipEl.classList.add("hidden");
  }

  // ------------------------------------------------------------------------
  // 1. Load data
  // ------------------------------------------------------------------------
  function fetchJson(file) {
    return fetch(file).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status} fetching ${file}`);
      return r.json();
    });
  }

  function loadClusters(fillMode) {
    return fetchJson(CLUSTER_FILES[fillMode]).then((clustersData) => {
      state.fillMode = fillMode;
      state.clustersData = clustersData;
      state.selectedClusterIdx = -1;
      populateSidebar();
      gridEl.innerHTML = "";
      statusEl.textContent =
        `${clustersData.clusters.length} clusters, ${state.segmentsByKey.size} units loaded ` +
        `(gap fill: ${fillModeEl.options[fillModeEl.selectedIndex].textContent}).`;
    });
  }

  Promise.all([
    fetchJson("unit_heatmaps.json"),
    fetchJson("unit_heatmaps_raw.json"),
    fetchJson("unit_segments_full.json"),
  ])
    .then(([heatmapsData, rawHeatmapsData, segmentsFullData]) => {
      state.unitsByKey = buildUnitsMap(heatmapsData);
      state.rawUnitsByKey = buildUnitsMap(rawHeatmapsData);
      state.segmentsByKey = buildUnitsMap(segmentsFullData);
      state.years = segmentsFullData.years;
      return loadClusters(state.fillMode);
    })
    .catch((err) => {
      statusEl.textContent = "Failed to load cluster data: " + err.message;
      console.error(err);
    });

  fillModeEl.addEventListener("change", () => {
    loadClusters(fillModeEl.value).catch((err) => {
      statusEl.textContent = "Failed to load cluster data: " + err.message;
      console.error(err);
    });
  });

  // Builds a Map<unit.key, unit> once so per-click lookups against a
  // cluster's unit_keys are O(1) instead of scanning the full unit list.
  function buildUnitsMap(heatmapsData) {
    const map = new Map();
    for (const unit of heatmapsData.units) map.set(unit.key, unit);
    return map;
  }

  // ------------------------------------------------------------------------
  // 2. Sidebar (cluster list)
  // ------------------------------------------------------------------------
  function populateSidebar() {
    sidebarEl.innerHTML = "";
    const clusters = state.clustersData.clusters;
    for (let i = 0; i < clusters.length; i++) {
      const cluster = clusters[i];
      const item = document.createElement("div");
      item.className = "cluster-item";
      item.dataset.idx = String(i);
      item.innerHTML =
        `<span class="cluster-id">Cluster ${cluster.cluster_id}</span> ` +
        `<span class="cluster-count">(${cluster.unit_keys.length} members)</span>`;
      item.addEventListener("click", () => selectCluster(i));
      sidebarEl.appendChild(item);
    }
  }

  function selectCluster(idx) {
    state.selectedClusterIdx = idx;

    // Single-select active-state toggle in the sidebar.
    const items = sidebarEl.querySelectorAll(".cluster-item");
    items.forEach((el) => {
      el.classList.toggle("active", Number(el.dataset.idx) === idx);
    });

    renderThumbnails(state.clustersData.clusters[idx]);
  }

  // ------------------------------------------------------------------------
  // 3. Thumbnail grid (right pane)
  // ------------------------------------------------------------------------
  function renderThumbnails(cluster) {
    gridEl.innerHTML = "";
    for (const key of cluster.unit_keys) {
      const unit = state.unitsByKey.get(key);
      if (!unit) continue; // guard against any key mismatch between the two files
      const rawUnit = state.rawUnitsByKey.get(key);
      gridEl.appendChild(buildThumbCard(unit, rawUnit));
    }
  }

  function buildThumbCard(unit, rawUnit) {
    const card = document.createElement("div");
    card.className = "thumb-card";
    card.title = unit.key;

    const title = document.createElement("div");
    title.className = "thumb-title";
    title.textContent = `${unit.key} (n=${unit.n_segments} segments)`;
    card.appendChild(title);

    // Real segments+years data (unit_segments_full.json) drives the actual
    // x/y encoding; unit/rawUnit (unit_heatmaps*.json) are only kept around
    // for the title text above.
    const segUnit = state.segmentsByKey.get(unit.key);
    const svg = drawSegmentHeatmap(unit, segUnit);
    card.appendChild(svg);

    return card;
  }

  // Renders a unit's real segments against real axes: x is real
  // reference-marker mile position (linear scale over [xMin, xMax] of that
  // unit's own segments, NOT a shared/global scale), y is one row per real
  // calendar year (state.years). Each segment draws a rect per year row
  // spanning its true begin/end mileage -- no rect is drawn across real
  // mileage gaps between segments, so those render as plain card background.
  // Cells with a `null` score for a given segment+year are true gaps (no
  // observation) and render as a distinct gray fill rather than being
  // bucketed into the score color scale. Each cell reports the real year and
  // the segment's mile range, plus raw score/category (or "no data" for
  // gaps), in a floating tooltip on hover.
  // Reference markers reset at TxDOT control-section boundaries, so two
  // segments can be numbered e.g. 1.9 and 636.0 while physically adjacent --
  // a false multi-hundred-mile "gap" that squeezes every real segment into a
  // sub-pixel sliver. Ported from HighwaySegmentChart.tsx's big-gap collapse:
  // find the single largest true gap between this unit's segments and, if it
  // exceeds GAP_COLLAPSE_THRESHOLD, render it as a fixed small spacer instead
  // of to true scale (same GAP_SPACER_PCT convention as the reference).
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

  function drawSegmentHeatmap(unit, segUnit) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");

    if (!segUnit || !segUnit.segments || segUnit.segments.length === 0 || !state.years) {
      // No real segment data available for this unit -- render an empty
      // placeholder SVG rather than crashing.
      svg.setAttribute("viewBox", "0 0 1 1");
      svg.setAttribute("preserveAspectRatio", "none");
      return svg;
    }

    const years = state.years;
    const nYears = years.length;
    const segments = segUnit.segments.slice().sort((a, b) => a.begin - b.begin);

    let xMin = Infinity, xMax = -Infinity;
    for (const seg of segments) {
      if (seg.begin < xMin) xMin = seg.begin;
      if (seg.end > xMax) xMax = seg.end;
    }
    const xSpan = xMax - xMin > 0 ? xMax - xMin : 1;

    const bigGap = findBigGap(segments);
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

    for (const seg of segments) {
      const x0 = xFrac(seg.begin);
      const x1 = xFrac(seg.end);
      const width = x1 - x0 > 0 ? x1 - x0 : 0;
      if (width <= 0) continue;

      for (let row = 0; row < nYears; row++) {
        const score = seg.scores[row];
        const isGap = score === null || score === undefined;
        const color = isGap ? "#bbbbbb" : conditionColor(score);

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

        const year = years[row];
        const mileRange = `mi ${seg.begin.toFixed(1)}-${seg.end.toFixed(1)}`;
        rect.addEventListener("mousemove", (event) => {
          let html;
          if (isGap) {
            html =
              `Unit: ${unit.key}<br>` +
              `Year: ${year}<br>` +
              `Segment: ${mileRange}<br>` +
              `No data`;
          } else {
            const category = getCategory("TX_CONDITION_SCORE", score);
            const scoreText = isNaN(score) ? "N/A" : score;
            html =
              `Unit: ${unit.key}<br>` +
              `Year: ${year}<br>` +
              `Segment: ${mileRange}<br>` +
              `Score: ${scoreText}<br>` +
              `Category: ${category}`;
          }
          showTooltip(event, html, color);
        });
        rect.addEventListener("mouseout", hideTooltip);

        svg.appendChild(rect);
      }
    }

    return svg;
  }
})();
