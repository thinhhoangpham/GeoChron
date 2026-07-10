/**
 * storyline_map.js — no-build ArcGIS map module for the GeoChron storyline app.
 *
 * Loads ArcGIS JS 4.28 from the CDN via the classic AMD `require([...])` pattern
 * (NOT the npm @arcgis/core build), so it works in a plain <script src> page with
 * no bundler. Displays the road-segment polylines from section_lines_geo.geojson
 * and highlights a cohort's sections on demand.
 *
 * Public API (window.StorylineMap):
 *   init(containerId)          -> Promise, resolves when view + layers are ready
 *   highlight(sectionIds,color)-> draw thick highlight lines for the given ids
 *   clear()                    -> remove all highlight graphics
 *   zoomTo(sectionIds)         -> fit view to the given sections' extent
 *   ready                      -> Promise that resolves on init completion
 *
 * Modeled on RPDBv3.8 apps/mobile/utils/mapHtml.ts + PMISMapComponent.tsx
 * (proven CDN-from-AMD setup, TxDOT vector basemap, GraphicsLayer highlight pattern).
 */
(function () {
  "use strict";

  var ARCGIS_VERSION = "4.28";
  var ARCGIS_CSS = "https://js.arcgis.com/" + ARCGIS_VERSION + "/esri/themes/light/main.css";
  var ARCGIS_JS = "https://js.arcgis.com/" + ARCGIS_VERSION + "/";
  var API_KEY = "AAPKdec314cf645a408e8d7fefaad73d1b04D_VHPN-eK0x0Mqx9tLkfn-4f0Hb3BJBNfuzVUvqkNkTdkmZfB_vmkJUcqrSkdNE_";
  var BASEMAP_URL = "https://tiles.arcgis.com/tiles/KTcxiTD9dsQw4r7Z/arcgis/rest/services/TxDOT_Vector_Tile_Basemap/VectorTileServer";
  var GEOJSON_URL = "section_lines_geo.geojson";

  // Internal state ----------------------------------------------------------
  var initStarted = false;
  var initialized = false;

  var esri = {};              // captured ArcGIS constructors
  var view = null;            // MapView
  var map = null;             // Map
  var baseLayer = null;       // GeoJSONLayer (all segments, neutral)
  var highlightLayer = null;  // GraphicsLayer (transient highlights on top)
  var hullLayer = null;       // GraphicsLayer (cohort-spread convex-hull blobs)
  var selectedLayer = null;   // GraphicsLayer (year condition-colored selection)
  var paintLayer = null;      // GraphicsLayer (persistent click-to-color paint)
  var paintedGraphics = null; // Map<sectionId, Graphic> currently painted
  var geomLookup = null;      // Map<sectionId, coordinates[][]> (WGS84 lon/lat)

  // Queue of highlight/zoom calls issued before init resolves.
  var pendingOps = [];

  // A resolvable promise that settles when the map is ready (or fails).
  var readyResolve = null;
  var readyReject = null;
  var readyPromise = new Promise(function (resolve, reject) {
    readyResolve = resolve;
    readyReject = reject;
  });
  // Never let an unhandled rejection escape if nobody awaits `ready`.
  readyPromise.catch(function () {});

  function warn(msg, err) {
    if (err) {
      console.warn("[StorylineMap] " + msg, err);
    } else {
      console.warn("[StorylineMap] " + msg);
    }
  }

  // --- CDN loading ---------------------------------------------------------

  function ensureCss() {
    var existing = document.querySelector('link[data-storyline-arcgis]');
    if (existing) return;
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = ARCGIS_CSS;
    link.setAttribute("data-storyline-arcgis", "1");
    document.head.appendChild(link);
  }

  // Loads the ArcGIS AMD bundle, then resolves once window.require exists.
  function loadArcgisScript() {
    return new Promise(function (resolve, reject) {
      if (window.require && typeof window.require === "function") {
        resolve();
        return;
      }
      var existing = document.querySelector('script[data-storyline-arcgis]');
      if (existing) {
        existing.addEventListener("load", function () { resolve(); });
        existing.addEventListener("error", function () {
          reject(new Error("ArcGIS script failed to load"));
        });
        return;
      }
      var script = document.createElement("script");
      script.src = ARCGIS_JS;
      script.async = true;
      script.setAttribute("data-storyline-arcgis", "1");
      script.onload = function () { resolve(); };
      script.onerror = function () {
        reject(new Error("ArcGIS script failed to load from " + ARCGIS_JS));
      };
      document.head.appendChild(script);
    });
  }

  // Wraps the AMD require() call in a promise that yields the modules.
  function requireModules() {
    return new Promise(function (resolve, reject) {
      var amdRequire = window.require;
      if (!amdRequire || typeof amdRequire !== "function") {
        reject(new Error("ArcGIS AMD loader (window.require) not available"));
        return;
      }
      try {
        amdRequire([
          "esri/Map",
          "esri/views/MapView",
          "esri/Basemap",
          "esri/layers/VectorTileLayer",
          "esri/layers/GeoJSONLayer",
          "esri/layers/GraphicsLayer",
          "esri/Graphic",
          "esri/geometry/Polyline",
          "esri/geometry/Polygon",
          "esri/geometry/Point",
          "esri/geometry/Multipoint",
          "esri/geometry/geometryEngine",
          "esri/geometry/Extent",
          "esri/config"
        ], function (Map, MapView, Basemap, VectorTileLayer, GeoJSONLayer,
                     GraphicsLayer, Graphic, Polyline, Polygon, Point,
                     Multipoint, geometryEngine, Extent, esriConfig) {
          resolve({
            Map: Map,
            MapView: MapView,
            Basemap: Basemap,
            VectorTileLayer: VectorTileLayer,
            GeoJSONLayer: GeoJSONLayer,
            GraphicsLayer: GraphicsLayer,
            Graphic: Graphic,
            Polyline: Polyline,
            Polygon: Polygon,
            Point: Point,
            Multipoint: Multipoint,
            geometryEngine: geometryEngine,
            Extent: Extent,
            esriConfig: esriConfig
          });
        }, function (err) {
          // AMD errback
          reject(err || new Error("ArcGIS require() failed"));
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  // --- Data ----------------------------------------------------------------

  // Fetch geojson once; build id -> coordinates lookup for instant highlights.
  function fetchGeojson() {
    return fetch(GEOJSON_URL).then(function (resp) {
      if (!resp.ok) {
        throw new Error("Failed to fetch " + GEOJSON_URL + " (HTTP " + resp.status + ")");
      }
      return resp.json();
    }).then(function (fc) {
      var lookup = new Map(); // note: native Map, esri.Map is separate
      var feats = (fc && fc.features) || [];
      for (var i = 0; i < feats.length; i++) {
        var f = feats[i];
        if (!f || !f.properties || !f.geometry) continue;
        var id = f.properties.id;
        var geom = f.geometry;
        if (id == null) continue;
        // Store paths in the multi-path form ArcGIS Polyline expects.
        if (geom.type === "LineString") {
          lookup.set(String(id), [geom.coordinates]);
        } else if (geom.type === "MultiLineString") {
          lookup.set(String(id), geom.coordinates);
        }
      }
      return { featureCollection: fc, lookup: lookup };
    });
  }

  // --- Highlight helpers ---------------------------------------------------

  function makeHighlightGraphic(sectionId, color) {
    var paths = geomLookup.get(String(sectionId));
    if (!paths) return null; // missing id: silently skip
    var geometry = new esri.Polyline({
      paths: paths,
      spatialReference: { wkid: 4326 } // WGS84 lon/lat; SDK reprojects to view SR
    });
    return new esri.Graphic({
      geometry: geometry,
      symbol: {
        type: "simple-line",
        color: color,
        width: 3,
        cap: "round",
        join: "round"
      },
      attributes: { id: String(sectionId) }
    });
  }

  function doHighlight(sectionIds, color) {
    if (!highlightLayer) return;
    highlightLayer.removeAll();
    if (!sectionIds || !sectionIds.length) return;
    var fill = color || "#ff6d00";
    var graphics = [];
    for (var i = 0; i < sectionIds.length; i++) {
      var g = makeHighlightGraphic(sectionIds[i], fill);
      if (g) graphics.push(g);
    }
    if (graphics.length) highlightLayer.addMany(graphics);
  }

  function doClear() {
    if (highlightLayer) highlightLayer.removeAll();
  }

  // --- Persistent paint helpers (click-to-color) ---------------------------

  function makePaintGraphic(sectionId, color) {
    var paths = geomLookup.get(String(sectionId));
    if (!paths) return null; // missing id: silently skip
    var geometry = new esri.Polyline({
      paths: paths,
      spatialReference: { wkid: 4326 }
    });
    return new esri.Graphic({
      geometry: geometry,
      symbol: {
        type: "simple-line",
        color: color,
        width: 3,
        cap: "round",
        join: "round"
      },
      attributes: { id: String(sectionId) }
    });
  }

  function doPaint(sectionIds, color) {
    if (!paintLayer) return;
    if (!sectionIds || !sectionIds.length) return;
    var fill = color || "#7b3ff2";
    for (var i = 0; i < sectionIds.length; i++) {
      var key = String(sectionIds[i]);
      // Repainting a section replaces its prior color.
      var prev = paintedGraphics.get(key);
      if (prev) paintLayer.remove(prev);
      var g = makePaintGraphic(key, fill);
      if (g) {
        paintLayer.add(g);
        paintedGraphics.set(key, g);
      } else {
        paintedGraphics.delete(key);
      }
    }
  }

  function doClearPaint() {
    if (paintLayer) paintLayer.removeAll();
    if (paintedGraphics) paintedGraphics.clear();
  }

  // --- Cohort-spread segment-highlight helpers -----------------------------

  // Thick highlight line for a group's member section, in the group color.
  function makeGroupSegmentLine(sectionId, color) {
    var paths = geomLookup.get(String(sectionId));
    if (!paths) return null;
    return new esri.Graphic({
      geometry: new esri.Polyline({ paths: paths, spatialReference: { wkid: 4326 } }),
      symbol: {
        type: "simple-line",
        color: color,
        width: 4,
        cap: "round",
        join: "round"
      },
      attributes: { id: String(sectionId) }
    });
  }

  // Draw one group's actual road segments as thick colored polylines (no hull).
  function drawSegmentGroup(group) {
    if (!group || !group.sectionIds || !group.sectionIds.length) return;
    var color = group.color || "#7b3ff2";
    for (var i = 0; i < group.sectionIds.length; i++) {
      var line = makeGroupSegmentLine(group.sectionIds[i], color);
      if (line) hullLayer.add(line);
    }
  }

  function doShowHulls(groups) {
    if (!hullLayer) return;
    hullLayer.removeAll();
    if (!groups || !groups.length) return;
    var ordered = groups.slice().sort(function (a, b) {
      return b.sectionIds.length - a.sectionIds.length; // large first, small last (on top)
    });
    for (var i = 0; i < ordered.length; i++) {
      try {
        drawSegmentGroup(ordered[i]);
      } catch (e) {
        warn("failed drawing segment group", e);
      }
    }
  }

  function doClearHulls() {
    if (hullLayer) hullLayer.removeAll();
  }

  // --- Condition-colored selection (year slider) ---------------------------
  //
  // Draw the current selection's real segment polylines, each in the color the
  // caller assigns for the chosen year (idToColor = Map<sectionId, cssColor>).
  // Lives on selectedLayer, which sits BELOW paint/hull/highlight so user paint
  // and transient highlights still draw on top. Replaces the hull-blob path for
  // selections. Ids not present in idToColor (unsurveyed in the chosen year)
  // are simply not drawn.
  function doShowSelectedByCondition(idToColor) {
    if (!selectedLayer) return;
    selectedLayer.removeAll();
    if (!idToColor || typeof idToColor.forEach !== "function") return;
    var graphics = [];
    idToColor.forEach(function (color, sectionId) {
      var g = makeHighlightGraphic(sectionId, color);
      if (g) graphics.push(g);
    });
    if (graphics.length) selectedLayer.addMany(graphics);
  }

  function doClearSelected() {
    if (selectedLayer) selectedLayer.removeAll();
  }

  // Fit the view to the union extent of the given section ids' coordinates.
  function doZoomTo(sectionIds) {
    if (!view || !sectionIds || !sectionIds.length) return;
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    var found = false;
    for (var i = 0; i < sectionIds.length; i++) {
      var paths = geomLookup.get(String(sectionIds[i]));
      if (!paths) continue;
      for (var p = 0; p < paths.length; p++) {
        var coords = paths[p];
        for (var c = 0; c < coords.length; c++) {
          var x = coords[c][0], y = coords[c][1];
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
          found = true;
        }
      }
    }
    if (!found) return;
    // Guard against a zero-area extent (single point / identical coords).
    if (minX === maxX) { minX -= 0.01; maxX += 0.01; }
    if (minY === maxY) { minY -= 0.01; maxY += 0.01; }
    var extent = new esri.Extent({
      xmin: minX, ymin: minY, xmax: maxX, ymax: maxY,
      spatialReference: { wkid: 4326 }
    });
    view.goTo(extent.expand(1.2)).catch(function (err) {
      // goTo rejects if interrupted by another navigation; not fatal.
      warn("zoomTo navigation was interrupted", err);
    });
  }

  // Replay any highlight/zoom calls queued before init completed.
  function flushPending() {
    var ops = pendingOps;
    pendingOps = [];
    for (var i = 0; i < ops.length; i++) {
      var op = ops[i];
      try {
        if (op.type === "highlight") doHighlight(op.sectionIds, op.color);
        else if (op.type === "clear") doClear();
        else if (op.type === "paint") doPaint(op.sectionIds, op.color);
        else if (op.type === "clearPaint") doClearPaint();
        else if (op.type === "showHulls") doShowHulls(op.groups);
        else if (op.type === "clearHulls") doClearHulls();
        else if (op.type === "showSelectedByCondition") doShowSelectedByCondition(op.idToColor);
        else if (op.type === "clearSelected") doClearSelected();
        else if (op.type === "zoomTo") doZoomTo(op.sectionIds);
      } catch (e) {
        warn("failed replaying queued " + op.type, e);
      }
    }
  }

  // --- init ----------------------------------------------------------------

  function init(containerId) {
    // Idempotent: repeated calls return the same ready promise.
    if (initStarted) return readyPromise;
    initStarted = true;

    var container = document.getElementById(containerId);
    if (!container) {
      var e = new Error('init: container element #' + containerId + ' not found');
      warn(e.message);
      readyReject(e);
      return readyPromise;
    }

    ensureCss();

    Promise.all([
      loadArcgisScript().then(requireModules),
      fetchGeojson()
    ]).then(function (results) {
      esri = results[0];
      var data = results[1];
      geomLookup = data.lookup;

      esri.esriConfig.apiKey = API_KEY;

      // Base display layer: all segments, thin neutral gray.
      var blob = new Blob(
        [JSON.stringify(data.featureCollection)],
        { type: "application/json" }
      );
      var blobUrl = URL.createObjectURL(blob);
      baseLayer = new esri.GeoJSONLayer({
        id: "section-lines-base",
        url: blobUrl,
        title: "Road sections",
        popupEnabled: false,
        renderer: {
          type: "simple",
          symbol: {
            type: "simple-line",
            color: [120, 120, 120, 0.35],
            width: 1
          }
        }
      });

      selectedLayer = new esri.GraphicsLayer({ id: "storyline-selected" });
      paintLayer = new esri.GraphicsLayer({ id: "storyline-paint" });
      paintedGraphics = new Map();
      hullLayer = new esri.GraphicsLayer({ id: "storyline-hulls" });
      highlightLayer = new esri.GraphicsLayer({ id: "storyline-highlight" });

      map = new esri.Map({ basemap: "gray-vector" });
      map.add(baseLayer);
      map.add(selectedLayer);  // year condition-colored selection (below paint)
      map.add(paintLayer);     // persistent colors above base
      map.add(hullLayer);      // cohort-spread convex-hull blobs
      map.add(highlightLayer); // transient highlights on top

      view = new esri.MapView({
        container: container,
        map: map,
        center: [-99.5, 31.2], // Texas
        zoom: 6,
        constraints: { minZoom: 4, maxZoom: 18 },
        ui: { components: ["zoom"] },
        popup: { dockEnabled: false, collapseEnabled: true }
      });

      // Expose for debugging / advanced callers.
      window.StorylineMap._view = view;
      window.StorylineMap._map = map;

      return view.when().then(function () {
        initialized = true;
        flushPending();
        readyResolve(view);
      });
    }).catch(function (err) {
      warn("initialization failed", err);
      readyReject(err);
    });

    return readyPromise;
  }

  // --- Public API (queue-aware wrappers) ----------------------------------

  function highlight(sectionIds, color) {
    if (!initialized) {
      pendingOps.push({ type: "highlight", sectionIds: sectionIds, color: color });
      return;
    }
    try {
      doHighlight(sectionIds, color);
    } catch (e) {
      warn("highlight failed", e);
    }
  }

  function clear() {
    if (!initialized) {
      pendingOps.push({ type: "clear" });
      return;
    }
    try {
      doClear();
    } catch (e) {
      warn("clear failed", e);
    }
  }

  function paint(sectionIds, color) {
    if (!initialized) {
      pendingOps.push({ type: "paint", sectionIds: sectionIds, color: color });
      return;
    }
    try {
      doPaint(sectionIds, color);
    } catch (e) {
      warn("paint failed", e);
    }
  }

  function clearPaint() {
    if (!initialized) {
      pendingOps.push({ type: "clearPaint" });
      return;
    }
    try {
      doClearPaint();
    } catch (e) {
      warn("clearPaint failed", e);
    }
  }

  function showHulls(groups) {
    if (!initialized) {
      pendingOps.push({ type: "showHulls", groups: groups });
      return;
    }
    try {
      doShowHulls(groups);
    } catch (e) {
      warn("showHulls failed", e);
    }
  }

  function clearHulls() {
    if (!initialized) {
      pendingOps.push({ type: "clearHulls" });
      return;
    }
    try {
      doClearHulls();
    } catch (e) {
      warn("clearHulls failed", e);
    }
  }

  function showSelectedByCondition(idToColor) {
    if (!initialized) {
      pendingOps.push({ type: "showSelectedByCondition", idToColor: idToColor });
      return;
    }
    try {
      doShowSelectedByCondition(idToColor);
    } catch (e) {
      warn("showSelectedByCondition failed", e);
    }
  }

  function clearSelected() {
    if (!initialized) {
      pendingOps.push({ type: "clearSelected" });
      return;
    }
    try {
      doClearSelected();
    } catch (e) {
      warn("clearSelected failed", e);
    }
  }

  // Returns an array of the section ids currently painted (may be empty).
  function paintedSectionIds() {
    if (!paintedGraphics) return [];
    var out = [];
    paintedGraphics.forEach(function (_g, id) { out.push(id); });
    return out;
  }

  function zoomTo(sectionIds) {
    if (!initialized) {
      pendingOps.push({ type: "zoomTo", sectionIds: sectionIds });
      return;
    }
    try {
      doZoomTo(sectionIds);
    } catch (e) {
      warn("zoomTo failed", e);
    }
  }

  window.StorylineMap = {
    init: init,
    highlight: highlight,
    clear: clear,
    paint: paint,
    clearPaint: clearPaint,
    showHulls: showHulls,
    clearHulls: clearHulls,
    showSelectedByCondition: showSelectedByCondition,
    clearSelected: clearSelected,
    paintedSectionIds: paintedSectionIds,
    zoomTo: zoomTo,
    get ready() { return readyPromise; },
    get initialized() { return initialized; }
  };
})();
