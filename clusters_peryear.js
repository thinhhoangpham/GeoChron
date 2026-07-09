/* ============================================================================
 * Unit Clusters by Length browser -- PER-YEAR variant.
 *
 * Identical read-only viewer to clusters_bylength.js, but repointed at the
 * per-year pipeline outputs (cluster_units_peryear.py): clustering was run on
 * flattened grids whose TIME axis is 29 individual calendar years (1996-2024)
 * instead of the 25 overlapping W5 sliding windows. This page lets you compare,
 * side-by-side with the W5 page (clusters_bylength.html), how the choice of
 * temporal windowing affects how well the flattened/abstracted grid resembles
 * the raw heatmap.
 *
 * Selectors are unchanged: "Length class" (Q1..Q4), "Gap fill"
 * (fill/fill1/nofill), and "View" (raw segments / flattened grid).
 *
 * Data sources:
 *   - clusters:        unit_clusters_peryear_len_{method}_Q{n}.json
 *   - flattened grids: unit_heatmaps_peryear_all_{method}.json
 *   - raw segments + years: unit_segments_full_all.json (reused UNCHANGED --
 *       its scores are already per-year, so the raw view is identical to the
 *       W5 page; only the flattened view and clustering differ).
 *
 * Reuses HeatmapUtil from heatmap.js as-is. No build step, plain ES2017+.
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
  const lengthClassEl = document.getElementById("lengthClass");
  const viewModeEl = document.getElementById("viewMode");

  const METHODS = ["fill", "fill1", "nofill"];
  const BUCKETS = [1, 2, 3, 4];

  function clusterFile(method, bucket) {
    return `unit_clusters_peryear_len_${method}_Q${bucket}.json`;
  }

  function allHeatmapsFile(method) {
    return `unit_heatmaps_peryear_all_${method}.json`;
  }

  // ------------------------------------------------------------------------
  // Global state
  // ------------------------------------------------------------------------
  const state = {
    clustersData: null,   // raw unit_clusters_peryear_len_{method}_Q{n}.json for the current selection
    segmentsByKey: null,  // Map<key, unit> built from unit_segments_full_all.json
    years: null,          // real calendar years array from unit_segments_full_all.json
    selectedClusterIdx: -1,
    fillMode: "fill",
    bucket: 1,
    bucketMeta: null,     // { method: { "1": {seg_min, seg_max, n_units}, ... } }, populated lazily per method
    viewMode: "raw",       // "raw" | "flattened"
    allHeatmapsByMethod: {}, // Map<method, Map<key, {n_segments, grid}>>, populated lazily per method
  };

  // ------------------------------------------------------------------------
  // Tooltip -- identical pattern to clusters.js.
  // ------------------------------------------------------------------------
  const tooltipEl = document.createElement("div");
  tooltipEl.className = "cell-tooltip hidden";
  document.body.appendChild(tooltipEl);

  function showTooltip(event, html, color) {
    const cx = event.clientX;
    const cy = event.clientY;
    const tooltipWidth = 200;
    const tooltipHeight = 100;
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

  // Loads all 4 quartile files for a given method so the "Length class"
  // dropdown can be labeled with each bucket's real segment range and unit
  // count (read from the JSON, not hardcoded).
  function loadBucketMeta(method) {
    state.bucketMeta = state.bucketMeta || {};
    if (state.bucketMeta[method]) {
      return Promise.resolve(state.bucketMeta[method]);
    }
    return Promise.all(BUCKETS.map((b) => fetchJson(clusterFile(method, b)))).then(
      (datasets) => {
        const meta = {};
        datasets.forEach((d, i) => {
          meta[BUCKETS[i]] = { seg_min: d.seg_min, seg_max: d.seg_max, n_units: d.n_units };
        });
        state.bucketMeta[method] = meta;
        return meta;
      }
    );
  }

  function populateLengthClassOptions(meta) {
    const prevValue = lengthClassEl.value;
    for (const opt of lengthClassEl.options) {
      const b = opt.value;
      const m = meta[b];
      opt.textContent = m
        ? `Q${b} (${m.seg_min}-${m.seg_max} seg, ${m.n_units} units)`
        : `Q${b}`;
    }
    lengthClassEl.value = prevValue;
  }

  function loadClusters(method, bucket) {
    return loadBucketMeta(method).then((meta) => {
      populateLengthClassOptions(meta);
      return fetchJson(clusterFile(method, bucket)).then((clustersData) => {
        state.fillMode = method;
        state.bucket = bucket;
        state.clustersData = clustersData;
        state.selectedClusterIdx = -1;
        populateSidebar();
        gridEl.innerHTML = "";
        statusEl.textContent =
          `Q${bucket} (${clustersData.seg_min}-${clustersData.seg_max} seg): ` +
          `${clustersData.clusters.length} clusters, ${clustersData.n_units} units ` +
          `(gap fill: ${fillModeEl.options[fillModeEl.selectedIndex].textContent}; ` +
          `cut distance ${clustersData.cut_distance}).`;
      });
    });
  }

  function reload() {
    loadClusters(fillModeEl.value, Number(lengthClassEl.value)).catch((err) => {
      statusEl.textContent = "Failed to load cluster data: " + err.message;
      console.error(err);
    });
  }

  fetchJson("unit_segments_full_all.json")
    .then((segmentsFullData) => {
      state.segmentsByKey = buildUnitsMap(segmentsFullData);
      state.years = segmentsFullData.years;
      reload();
    })
    .catch((err) => {
      statusEl.textContent = "Failed to load segment data: " + err.message;
      console.error(err);
    });

  fillModeEl.addEventListener("change", reload);
  lengthClassEl.addEventListener("change", reload);

  // View toggle does NOT reload cluster data -- it just swaps how the
  // currently-selected cluster's thumbnails are rendered, using cached
  // selection state (state.selectedClusterIdx / state.clustersData).
  viewModeEl.addEventListener("change", () => {
    state.viewMode = viewModeEl.value;
    if (state.selectedClusterIdx >= 0 && state.clustersData) {
      renderCurrentSelection();
    }
  });

  function renderCurrentSelection() {
    const cluster = state.clustersData.clusters[state.selectedClusterIdx];
    if (state.viewMode === "flattened") {
      loadAllHeatmaps(state.fillMode)
        .then(() => renderThumbnails(cluster))
        .catch((err) => {
          statusEl.textContent = "Failed to load flattened grid data: " + err.message;
          console.error(err);
        });
    } else {
      renderThumbnails(cluster);
    }
  }

  // Lazily loads and caches unit_heatmaps_peryear_all_{method}.json as a
  // Map<key, {n_segments, grid}> for O(1) per-thumbnail lookups.
  function loadAllHeatmaps(method) {
    if (state.allHeatmapsByMethod[method]) {
      return Promise.resolve(state.allHeatmapsByMethod[method]);
    }
    return fetchJson(allHeatmapsFile(method)).then((data) => {
      const map = new Map();
      for (const u of data.units) map.set(u.key, u);
      state.allHeatmapsByMethod[method] = map;
      return map;
    });
  }

  // Builds a Map<unit.key, unit> once so per-click lookups against a
  // cluster's unit_keys are O(1) instead of scanning the full unit list.
  function buildUnitsMap(segmentsFullData) {
    const map = new Map();
    for (const unit of segmentsFullData.units) map.set(unit.key, unit);
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

    const items = sidebarEl.querySelectorAll(".cluster-item");
    items.forEach((el) => {
      el.classList.toggle("active", Number(el.dataset.idx) === idx);
    });

    renderCurrentSelection();
  }

  // ------------------------------------------------------------------------
  // 3. Thumbnail grid (right pane)
  // ------------------------------------------------------------------------
  function renderThumbnails(cluster) {
    gridEl.innerHTML = "";
    const flattened = state.viewMode === "flattened";
    const heatmapsMap = flattened ? state.allHeatmapsByMethod[state.fillMode] : null;
    for (const key of cluster.unit_keys) {
      const segUnit = state.segmentsByKey.get(key);
      if (flattened) {
        gridEl.appendChild(buildThumbCard(key, segUnit, heatmapsMap && heatmapsMap.get(key)));
      } else {
        gridEl.appendChild(buildThumbCard(key, segUnit, null));
      }
    }
  }

  function buildThumbCard(key, segUnit, flattenedUnit) {
    const card = document.createElement("div");
    card.className = "thumb-card";
    card.title = key;

    const title = document.createElement("div");
    title.className = "thumb-title";
    title.textContent = segUnit
      ? `${key} (n=${segUnit.n_segments} segments)`
      : `${key} (no segment data)`;
    card.appendChild(title);

    if (state.viewMode === "flattened") {
      card.appendChild(drawFlattenedHeatmap(key, flattenedUnit));
    } else {
      card.appendChild(drawSegmentHeatmap(key, segUnit));
    }

    return card;
  }

  // Renders a unit's S x n_windows flattened/resampled grid (the same
  // spatial-bin x per-year representation clustering actually correlates on),
  // looked up from unit_heatmaps_peryear_all_{method}.json for the
  // currently-selected Gap-fill method.
  function drawFlattenedHeatmap(key, flattenedUnit) {
    if (!flattenedUnit || !flattenedUnit.grid) {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 1 1");
      svg.setAttribute("preserveAspectRatio", "none");
      return svg;
    }

    return HeatmapUtil.drawGridHeatmap(flattenedUnit.grid, {
      onCellTip: (event, info) =>
        showTooltip(
          event,
          `Unit: ${key}<br>Spatial bin: ${info.row}<br>Year: ${info.col}<br>Score: ${info.score}<br>Category: ${info.category}`,
          info.color
        ),
      onCellOut: hideTooltip,
    });
  }

  // Same real-segment/real-year renderer as clusters_bylength.js, driven by
  // unit_segments_full_all.json (per-year scores, reused unchanged).
  function drawSegmentHeatmap(key, segUnit) {
    if (!segUnit || !segUnit.segments || segUnit.segments.length === 0 || !state.years) {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 1 1");
      svg.setAttribute("preserveAspectRatio", "none");
      return svg;
    }

    return HeatmapUtil.drawSegmentHeatmap(segUnit.segments, state.years, {
      onCellTip: (event, info) =>
        showTooltip(
          event,
          `Unit: ${key}<br>Year: ${info.year}<br>Segment: ${info.mileRange}<br>Score: ${info.score}<br>Category: ${info.category}`,
          info.color
        ),
      onCellOut: hideTooltip,
    });
  }
})();
