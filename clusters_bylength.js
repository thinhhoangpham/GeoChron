/* ============================================================================
 * Unit Clusters by Length browser
 *
 * Same read-only viewer pattern as clusters.js (sidebar lists clusters
 * largest-first, clicking a cluster renders a grid of heatmap thumbnails),
 * but clustering was run INDEPENDENTLY within each road-length (segment
 * count) quartile bucket -- see cluster_units_bylength.py. Selectors:
 * "Length class" (Q1..Q4), "Gap fill" (fill/fill1/nofill), and "View"
 * (raw segments / flattened grid), selecting which
 * unit_clusters_len_{method}_Q{n}.json file to load and how to render it.
 *
 * Thumbnails are keyed off unit_segments_full_all.json (NOT
 * unit_segments_full.json / unit_heatmaps.json) -- that file has full
 * coverage of all ~1112 units (built by build_unit_segments_full_all.py),
 * including the 1-2 segment Q1 units that unit_segments_full.json drops via
 * its MIN_SEGMENTS filter. No build step, plain ES2017+.
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
    return `unit_clusters_len_${method}_Q${bucket}.json`;
  }

  function allHeatmapsFile(method) {
    return `unit_heatmaps_all_${method}.json`;
  }

  // ------------------------------------------------------------------------
  // Global state
  // ------------------------------------------------------------------------
  const state = {
    clustersData: null,   // raw unit_clusters_len_{method}_Q{n}.json for the current selection
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
  // count (read from the JSON, not hardcoded). Cheap -- these files are small
  // since avg_grid is only S x n_windows per cluster.
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
    // ALL three views (raw, flattened, pattern) render members in the SAME
    // similarity-to-centroid order so switching color views never reshuffles
    // the grid. That ordering (and the flattened/pattern coloring) needs the
    // S x n_windows grids from unit_heatmaps_all_{method}.json, so every view
    // must ensure that file is loaded before rendering.
    loadAllHeatmaps(state.fillMode)
      .then(() => renderThumbnails(cluster))
      .catch((err) => {
        // Flattened/pattern can't render without the grids, but Raw view only
        // needs it for the ordering -- fall back to the raw cluster.unit_keys
        // order rather than crashing so the segment heatmaps still show.
        console.error(err);
        if (state.viewMode === "raw") {
          renderThumbnails(cluster);
        } else {
          statusEl.textContent = "Failed to load flattened grid data: " + err.message;
        }
      });
  }

  // Lazily loads and caches unit_heatmaps_all_{method}.json as a
  // Map<key, {n_segments, grid}> for O(1) per-thumbnail lookups. Re-fetched
  // once per method, not per render.
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
  // Every unit_key in the cluster is shown -- no filtering against
  // unit_heatmaps.json membership. unit_segments_full_all.json has full
  // coverage (~1112 units), so a missing key here should be rare/never; if
  // it does happen, render a placeholder card instead of silently dropping
  // the unit.
  function renderThumbnails(cluster) {
    gridEl.innerHTML = "";
    const usesGrid = state.viewMode === "flattened" || state.viewMode === "pattern";
    // The flattened grids serve both the flattened/pattern coloring AND the
    // shared member ordering used by all three views, so grab the map whenever
    // it's loaded regardless of view.
    const heatmapsMap = state.allHeatmapsByMethod[state.fillMode] || null;

    // Member ordering is CONSISTENT across all three views: sort tightest-to-
    // centroid first (descending correlation of each member's flattened grid
    // to cluster.avg_grid) so switching color views never reshuffles the grid.
    // If the heatmaps map failed to load (raw-view fallback), keep the raw
    // cluster.unit_keys order rather than crashing.
    let keys = cluster.unit_keys;
    if (heatmapsMap) {
      keys = orderKeysBySimilarity(cluster, heatmapsMap);
    }

    for (const key of keys) {
      const segUnit = state.segmentsByKey.get(key);
      if (usesGrid) {
        gridEl.appendChild(buildThumbCard(key, segUnit, heatmapsMap && heatmapsMap.get(key)));
      } else {
        gridEl.appendChild(buildThumbCard(key, segUnit, null));
      }
    }
  }

  // Pairwise-complete, mean-centered Pearson correlation between two flattened
  // grids (arrays of S rows x n_windows). Only cells finite in BOTH grids
  // count; each side is mean-centered over just those overlapping cells (the
  // same normalization the clustering uses, cluster_units_bylength.py L189-206
  // / L216-230). Returns -Infinity as a sentinel "least similar" when there is
  // too little overlap (< MIN_OVERLAP finite cells) or zero variance on either
  // side, so such members sink to the bottom of the ordering.
  const MIN_OVERLAP = 10;

  function gridCorrelation(gridA, gridB) {
    if (!gridA || !gridB || gridA.length !== gridB.length) return -Infinity;

    // Collect overlapping (both-finite) cell pairs in row-major order.
    const a = [];
    const b = [];
    for (let row = 0; row < gridA.length; row++) {
      const ra = gridA[row];
      const rb = gridB[row];
      if (!ra || !rb || ra.length !== rb.length) return -Infinity;
      for (let col = 0; col < ra.length; col++) {
        const va = ra[col];
        const vb = rb[col];
        const aOk = va !== null && va !== undefined && !Number.isNaN(va);
        const bOk = vb !== null && vb !== undefined && !Number.isNaN(vb);
        if (aOk && bOk) {
          a.push(va);
          b.push(vb);
        }
      }
    }

    if (a.length < MIN_OVERLAP) return -Infinity;

    let meanA = 0, meanB = 0;
    for (let i = 0; i < a.length; i++) { meanA += a[i]; meanB += b[i]; }
    meanA /= a.length;
    meanB /= b.length;

    let num = 0, sqA = 0, sqB = 0;
    for (let i = 0; i < a.length; i++) {
      const da = a[i] - meanA;
      const db = b[i] - meanB;
      num += da * db;
      sqA += da * da;
      sqB += db * db;
    }
    if (sqA === 0 || sqB === 0) return -Infinity; // zero variance -> undefined corr
    return num / Math.sqrt(sqA * sqB);
  }

  // Returns cluster.unit_keys sorted by descending correlation of each
  // member's flattened grid to the cluster centroid (cluster.avg_grid). Used
  // by all three views so the grid order is identical no matter which color
  // view is selected.
  // Members missing from the heatmaps file, or too dissimilar/low-overlap to
  // correlate, get -Infinity and sink to the bottom. Stable for ties (uses the
  // original index as a tiebreaker so ordering is deterministic).
  function orderKeysBySimilarity(cluster, heatmapsMap) {
    const centroid = cluster.avg_grid;
    const scored = cluster.unit_keys.map((key, idx) => {
      const unit = heatmapsMap && heatmapsMap.get(key);
      const corr = unit && unit.grid ? gridCorrelation(unit.grid, centroid) : -Infinity;
      return { key, corr, idx };
    });
    scored.sort((x, y) => (y.corr - x.corr) || (x.idx - y.idx));
    return scored.map((s) => s.key);
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
    } else if (state.viewMode === "pattern") {
      card.appendChild(drawPatternHeatmap(key, flattenedUnit));
    } else {
      card.appendChild(drawSegmentHeatmap(key, segUnit));
    }

    return card;
  }

  // Renders a unit's S x n_windows flattened/resampled grid (the same
  // spatial-bin x sliding-window representation clustering actually
  // correlates on), looked up from unit_heatmaps_all_{method}.json for the
  // currently-selected Gap-fill method. Guards for units missing from that
  // file (shouldn't happen -- it covers all units -- but render a
  // placeholder rather than crash if it does).
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
          `Unit: ${key}<br>Spatial bin: ${info.row}<br>Window: ${info.col}<br>Score: ${info.score}<br>Category: ${info.category}`,
          info.color
        ),
      onCellOut: hideTooltip,
    });
  }

  // Renders the SAME S x n_windows flattened grid as drawFlattenedHeatmap,
  // but recolored as a per-unit z-score on a diverging blue<->orange ramp
  // (see HeatmapUtil.drawNormalizedGridHeatmap) so the level-invariant pattern
  // the clustering keys on is visually explicit. Same missing-unit placeholder
  // as drawFlattenedHeatmap (units absent from unit_heatmaps_all_{method}.json
  // render an empty SVG rather than crash). Tooltip shows the unit key,
  // spatial bin, window, raw score, and z-value.
  function drawPatternHeatmap(key, flattenedUnit) {
    if (!flattenedUnit || !flattenedUnit.grid) {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 1 1");
      svg.setAttribute("preserveAspectRatio", "none");
      return svg;
    }

    return HeatmapUtil.drawNormalizedGridHeatmap(flattenedUnit.grid, {
      onCellTip: (event, info) =>
        showTooltip(
          event,
          `Unit: ${key}<br>Spatial bin: ${info.row}<br>Window: ${info.col}<br>` +
            `Score: ${info.score === null ? "n/a" : info.score}<br>` +
            `z: ${info.z === null ? "n/a" : info.z.toFixed(2)}`,
          info.color
        ),
      onCellOut: hideTooltip,
    });
  }

  // Same real-segment/real-year renderer as clusters.js's drawSegmentHeatmap,
  // driven by unit_segments_full_all.json instead of unit_segments_full.json.
  function drawSegmentHeatmap(key, segUnit) {
    if (!segUnit || !segUnit.segments || segUnit.segments.length === 0 || !state.years) {
      // No real segment data available for this unit -- render an empty
      // placeholder SVG rather than crashing. Should be rare/never given
      // unit_segments_full_all.json's full coverage.
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
