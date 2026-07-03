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
  // Color helpers + heatmap renderer live in heatmap.js (window.HeatmapUtil),
  // shared with evolens.js.
  // ------------------------------------------------------------------------

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
    tooltipEl.style.color = HeatmapUtil.getContrastColor(color);
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
  function drawSegmentHeatmap(unit, segUnit) {
    if (!segUnit || !segUnit.segments || segUnit.segments.length === 0 || !state.years) {
      // No real segment data available for this unit -- render an empty
      // placeholder SVG rather than crashing.
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 1 1");
      svg.setAttribute("preserveAspectRatio", "none");
      return svg;
    }

    return HeatmapUtil.drawSegmentHeatmap(segUnit.segments, state.years, {
      onCellTip: (event, info) =>
        showTooltip(
          event,
          `Unit: ${unit.key}<br>Year: ${info.year}<br>Segment: ${info.mileRange}<br>Score: ${info.score}<br>Category: ${info.category}`,
          info.color
        ),
      onCellOut: hideTooltip,
    });
  }
})();
