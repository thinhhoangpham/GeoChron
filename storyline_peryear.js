/* ============================================================================
 * Storyline visualization
 *
 * Renders a GeoChron-style "Storyline" (Fig 5D) for pavement-condition
 * segment cohorts across time windows. Each road is laid out independently
 * using a per-window grouping + Sugiyama-style barycenter-sweep ordering,
 * then stacked top-to-bottom each window (groups with a gap between them,
 * members packed with zero gap within a group). Lines between consecutive
 * windows simply connect each segment's real per-window position -- there
 * is no anchor/interpolation/big-jump logic; every segment has a genuine
 * stacked position in every window it has data for.
 *
 * No build step. Plain ES2017+. d3 is used only for color scales/categorical
 * palettes (loaded from CDN in storyline_peryear.html).
 * ==========================================================================*/

(function () {
  "use strict";

  // ------------------------------------------------------------------------
  // Constants / DOM refs
  // ------------------------------------------------------------------------
  const MARGIN_LEFT = 24;   // left margin before window column 0
  const MARGIN_TOP = 10;    // top margin before first road
  const HOVER_HIT_PX = 7;   // hover hit-test tolerance in px
  const BARYCENTER_SWEEPS = 6; // number of full forward/backward sweeps

  // Browsers silently produce a BLANK canvas (no error) once a backing-store
  // dimension exceeds roughly 32767px (Chrome/Firefox limit; area-capped too).
  // The full layout can be tens of thousands of px tall, so the canvas
  // backing store must stay capped to the viewport and the data is instead
  // represented by a normal-flow spacer div that drives native scrollbars;
  // on scroll we redraw the canvas translated to show the right slice.
  const MAX_CANVAS_DIM = 8000;

  const canvas = document.getElementById("storylineCanvas");
  const ctx = canvas.getContext("2d");
  const glCanvas = document.getElementById("storylineGLCanvas");
  const canvasWrap = document.getElementById("canvasWrap");
  const canvasSpacerEl = document.getElementById("canvasSpacer");
  const axisEl = document.getElementById("axis");
  const axisInnerEl = document.getElementById("axisInner");
  const tooltipEl = document.getElementById("tooltip");
  const statusEl = document.getElementById("status");

  const roadSearchEl = document.getElementById("roadSearch");
  const roadDropdownEl = document.getElementById("roadDropdown");
  const colorModeEl = document.getElementById("colorMode");
  const IS_GEO = !!window.STORYLINE_BROWSER_FILTER;
  const colorLegendEl = document.getElementById("colorLegend");
  const rowPxEl = document.getElementById("rowPx");
  const laneGapEl = document.getElementById("laneGap");
  const roadGapEl = document.getElementById("roadGap");
  const colWEl = document.getElementById("colW");
  const colGapEl = document.getElementById("colGap");

  // ------------------------------------------------------------------------
  // Global state
  // ------------------------------------------------------------------------
  const state = {
    data: null,           // raw fetched data { windows, roads }
    numWindows: 0,
    structures: null,     // per-road static structure (window groups, color track ids) - independent of sliders
    geometry: null,       // per-road geometry (y offsets etc) - depends on sliders
    selectedRoadIdx: -1,  // -1 = all roads
    colorMode: (colorModeEl && colorModeEl.value) || "condition",
    ths: 5,               // session-filter threshold (paper §6.2); only applied when window.STORYLINE_BROWSER_FILTER
    rowPx: 4,
    laneGap: 48,
    roadGap: 28,
    colW: 62,
    colGap: 24,
    hover: null,          // { roadIdx, segIdx }
    enforcedAlign: null,  // { roadIdx, k, s } | null - active click-to-align cohort
    dpr: window.devicePixelRatio || 1,
    scrollLeft: 0,        // canvasWrap.scrollLeft mirror, used to translate drawing
    scrollTop: 0,         // canvasWrap.scrollTop mirror
    glActive: false,      // true once a WebGL context was successfully created
    paint: new Map(),     // sectionId(string) -> hex color; paper §6.3.1 click-to-color (entity-anchored, persists across windows)
    activePaintColor: null, // currently armed swatch hex, "__erase__", or null
  };
  updateColorLegend(); // default mode is "condition"

  // Created once; null if WebGL is unavailable (old browser / no GPU), in
  // which case we fall back to the original Canvas-2D bar/connector path.
  const glRenderer = createGLRenderer(glCanvas);
  state.glActive = !!glRenderer;
  if (!glRenderer) {
    glCanvas.style.display = "none";
  }

  // ------------------------------------------------------------------------
  // Tiny union-find (disjoint set) helper, keyed by string
  // ------------------------------------------------------------------------
  class UnionFind {
    constructor() {
      this.parent = new Map();
    }
    find(x) {
      if (!this.parent.has(x)) this.parent.set(x, x);
      let root = x;
      while (this.parent.get(root) !== root) root = this.parent.get(root);
      // path compression
      let cur = x;
      while (this.parent.get(cur) !== root) {
        const next = this.parent.get(cur);
        this.parent.set(cur, root);
        cur = next;
      }
      return root;
    }
    union(a, b) {
      const ra = this.find(a);
      const rb = this.find(b);
      if (ra !== rb) this.parent.set(ra, rb);
    }
  }

  // ------------------------------------------------------------------------
  // Color helpers
  // ------------------------------------------------------------------------
  const hasD3 = typeof d3 !== "undefined";

  // Per-page bar encoding for condition color mode. Default "cells" keeps the
  // discrete per-year PMIS category cells; "gradient" (units page) shades each
  // window bar with a continuous light->dark blue condition gradient.
  const BAR_ENCODING = window.STORYLINE_BAR_ENCODING || "cells";

  // Fallback RdYlGn-ish interpolator if d3 failed to load (offline safety).
  function fallbackRdYlGn(t) {
    t = Math.max(0, Math.min(1, t));
    // simple 3-stop red -> yellow -> green
    let r, g, b;
    if (t < 0.5) {
      const u = t / 0.5;
      r = 215 + u * (255 - 215);
      g = 48 + u * (255 - 48);
      b = 39 + u * (191 - 39);
    } else {
      const u = (t - 0.5) / 0.5;
      r = 255 + u * (26 - 255);
      g = 255 + u * (152 - 255);
      b = 191 + u * (80 - 191);
    }
    return `rgb(${r | 0},${g | 0},${b | 0})`;
  }

  function conditionColor(v) {
    if (v === null || v === undefined || isNaN(v)) return "#999999";
    const t = Math.max(0, Math.min(100, v)) / 100;
    return hasD3 ? d3.interpolateRdYlGn(t) : fallbackRdYlGn(t);
  }

  // Per-year PMIS condition palette, copied verbatim from heatmap.js so the
  // Storyline year-cells match the heatmap view. Used only in condition mode.
  function pmisCategoryColor(score) {
    if (score === null || score === undefined || isNaN(score)) return "#999999";
    if (score >= 90) return "rgb(21,128,61)";   // Very Good
    if (score >= 70) return "rgb(34,197,94)";   // Good
    if (score >= 50) return "rgb(234,179,8)";   // Fair
    if (score >= 35) return "rgb(249,115,22)";  // Poor
    if (score < 1)   return "rgb(200,200,200)"; // Invalid
    return "rgb(239,68,68)";                     // Very Poor
  }

  const CATEGORICAL = hasD3 && d3.schemeTableau10
    ? d3.schemeTableau10
    : ["#4e79a7", "#f28e2b", "#e15759", "#76b7b2", "#59a14f",
       "#edc948", "#b07aa1", "#ff9da7", "#9c755f", "#bab0ac"];

  // Single-hue blue gradient shade for a per-year condition score. Darker =
  // worse condition (light blue = good ~100, dark blue = poor ~0). Used only
  // on pages that opt into the "gradient" bar encoding (units page).
  function shadeBlue(score) {
    if (score === null || score === undefined || isNaN(score)) return "#999999";
    const t = Math.max(0, Math.min(1, (100 - score) / 100)); // 0 good -> 1 poor
    if (hasD3) return d3.interpolateBlues(t);
    // Non-d3 fallback: linear interpolate light blue -> dark blue.
    const lo = [198, 219, 239], hi = [8, 48, 107];
    const r = lo[0] + t * (hi[0] - lo[0]);
    const g = lo[1] + t * (hi[1] - lo[1]);
    const b = lo[2] + t * (hi[2] - lo[2]);
    return `rgb(${r | 0},${g | 0},${b | 0})`;
  }

  const UNAFF_GRAY = "#bbbbbb"; // neutral hue when a segment has no persistent color-track
  const FADE_ALPHA = 0.5; // opacity for unaffiliated (no-cohort) units, both render paths

  function cohortColor(trackId, v) {
    if (trackId < 0) return shadeGray(v); // unaffiliated: no cohort hue
    const base = CATEGORICAL[trackId % CATEGORICAL.length];
    if (v === null || v === undefined || isNaN(v)) return base;
    // shade the categorical hue by condition: poor -> darker/desaturated, good -> lighter
    const t = Math.max(0, Math.min(100, v)) / 100;
    if (!hasD3) return base;
    const c = d3.hsl(base);
    c.l = 0.30 + t * 0.45; // darker for low v, lighter for high v
    return c.toString();
  }

  // Paper §6.3.1 paint color: shade the user-picked hex base by condition v,
  // reusing the exact light->dark ramp cohortColor uses so a painted entity's
  // trend shading matches the rest of the storyline.
  function paintColor(hex, v) {
    if (v === null || v === undefined || isNaN(v)) return hex;
    if (!hasD3) return hex;
    const t = Math.max(0, Math.min(100, v)) / 100;
    const c = d3.hsl(hex);
    c.l = 0.30 + t * 0.45;
    return c.toString();
  }

  // "#rgb"/"#rrggbb" -> [r,g,b] for the ArcGIS map paint API.
  function hexToRgbArray(hex) {
    const h = String(hex).replace("#", "");
    const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
    const num = parseInt(n, 16);
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
  }

  function highwayColor(roadbed, v) {
    if (!roadbed) return shadeGray(v); // no roadbed: no highway hue
    let hash = 0;
    for (let i = 0; i < roadbed.length; i++) hash = (hash * 31 + roadbed.charCodeAt(i)) | 0;
    const base = CATEGORICAL[Math.abs(hash) % CATEGORICAL.length];
    if (v === null || v === undefined || isNaN(v)) return base;
    const t = Math.max(0, Math.min(100, v)) / 100;
    if (!hasD3) return base;
    const c = d3.hsl(base);
    c.l = 0.30 + t * 0.45;
    return c.toString();
  }

  const PAVTYPE_COLORS = {
    "A - ASPHALTIC CONCRETE PAVEMENT (ACP)": "#4a4a4a",
    "C - CONTINUOUSLY REINFORCED CONCRETE PAVEMENT (CRCP)": "#6b8caf",
    "J - JOINTED CONCRETE PAVEMENT (JCP)": "#c9a66b",
  };

  function pavTypeColor(pavtype, v) {
    const base = PAVTYPE_COLORS[pavtype];
    if (!base) return shadeGray(v); // blank/unknown/unrecognized: no pavtype hue
    if (v === null || v === undefined || isNaN(v)) return base;
    const t = Math.max(0, Math.min(100, v)) / 100;
    if (!hasD3) return base;
    const c = d3.hsl(base);
    c.l = 0.30 + t * 0.45;
    return c.toString();
  }

  function shadeGray(v) {
    if (v === null || v === undefined || isNaN(v)) return UNAFF_GRAY;
    if (!hasD3) return UNAFF_GRAY;
    const t = Math.max(0, Math.min(100, v)) / 100;
    const c = d3.hsl(UNAFF_GRAY);
    c.l = 0.45 + t * 0.35;
    return c.toString();
  }

  // Cache of parsed CSS color -> [r,g,b,a] (0..1 floats), since bars/
  // connectors reuse the same handful of color strings heavily.
  const colorFloatCache = new Map();
  let colorParseCanvas = null, colorParseCtx = null;
  function colorToFloats(colorStr, alpha) {
    const cacheKey = colorStr;
    let rgb = colorFloatCache.get(cacheKey);
    if (!rgb) {
      if (!colorParseCtx) {
        colorParseCanvas = document.createElement("canvas");
        colorParseCanvas.width = 1;
        colorParseCanvas.height = 1;
        colorParseCtx = colorParseCanvas.getContext("2d", { willReadFrequently: true });
      }
      colorParseCtx.clearRect(0, 0, 1, 1);
      colorParseCtx.fillStyle = colorStr;
      colorParseCtx.fillRect(0, 0, 1, 1);
      const d = colorParseCtx.getImageData(0, 0, 1, 1).data;
      rgb = [d[0] / 255, d[1] / 255, d[2] / 255];
      colorFloatCache.set(cacheKey, rgb);
    }
    return [rgb[0], rgb[1], rgb[2], alpha];
  }

  // ------------------------------------------------------------------------
  // WebGL bar/connector renderer
  //
  // Builds flat vertex buffers ONCE whenever the underlying geometry changes
  // (data load, slider change, road filter change, color mode change, hover
  // dim state change) - never per-scroll-frame. Scroll is a pure GPU-side
  // translation via a uniform, so scrolling does no CPU rebuild work at all.
  // Falls back gracefully (return null) if WebGL isn't available; callers
  // must then use the original Canvas-2D bar/connector drawing path.
  // ------------------------------------------------------------------------
  function createGLRenderer(glCanvasEl) {
    const gl = glCanvasEl.getContext("webgl") || glCanvasEl.getContext("experimental-webgl");
    if (!gl) return null;

    const vsSource = `
      attribute vec2 aPosition;
      attribute vec4 aColor;
      uniform vec2 uResolution; // viewport size in CSS px
      uniform vec2 uScroll;     // scrollLeft, scrollTop in CSS px
      uniform float uAlphaMul;
      varying vec4 vColor;
      void main() {
        vec2 p = aPosition - uScroll;
        // map (0,0)-(uResolution) CSS-px space, y-down, to clip space
        vec2 clip = (p / uResolution) * 2.0 - 1.0;
        clip.y = -clip.y;
        gl_Position = vec4(clip, 0.0, 1.0);
        vColor = vec4(aColor.rgb, aColor.a * uAlphaMul);
      }
    `;
    const fsSource = `
      precision mediump float;
      varying vec4 vColor;
      void main() {
        gl_FragColor = vColor;
      }
    `;

    function compile(type, src) {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.error("Shader compile error:", gl.getShaderInfoLog(sh));
        gl.deleteShader(sh);
        return null;
      }
      return sh;
    }

    const vs = compile(gl.VERTEX_SHADER, vsSource);
    const fs = compile(gl.FRAGMENT_SHADER, fsSource);
    if (!vs || !fs) return null;

    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error("Program link error:", gl.getProgramInfoLog(program));
      return null;
    }

    const aPositionLoc = gl.getAttribLocation(program, "aPosition");
    const aColorLoc = gl.getAttribLocation(program, "aColor");
    const uResolutionLoc = gl.getUniformLocation(program, "uResolution");
    const uScrollLoc = gl.getUniformLocation(program, "uScroll");
    const uAlphaMulLoc = gl.getUniformLocation(program, "uAlphaMul");

    const positionBuf = gl.createBuffer();
    const colorBuf = gl.createBuffer();

    // vertexCount for bars and connectors are tracked separately so each can
    // be drawn with its own alpha multiplier (connectors are drawn dimmer),
    // but both are packed into ONE pair of buffers (bars first, then
    // connectors) to minimize buffer uploads.
    let barVertexCount = 0;
    let connectorVertexCount = 0;

    // Build a quad (2 triangles = 6 vertices) for a thin horizontal segment
    // from (x0,y) to (x1,y) with the given pixel thickness, pushed into the
    // flat position/color arrays.
    function pushQuad(positions, colors, x0, y0, x1, y1, thickness, rgba) {
      const dx = x1 - x0, dy = y1 - y0;
      const len = Math.hypot(dx, dy) || 1;
      // perpendicular unit vector, scaled to half-thickness
      const nx = (-dy / len) * (thickness / 2);
      const ny = (dx / len) * (thickness / 2);

      const ax = x0 + nx, ay = y0 + ny;
      const bx = x0 - nx, by = y0 - ny;
      const cx = x1 + nx, cy = y1 + ny;
      const dxp = x1 - nx, dyp = y1 - ny;

      // two triangles: (a,b,c) and (b,d,c)
      positions.push(ax, ay, bx, by, cx, cy, bx, by, dxp, dyp, cx, cy);
      for (let i = 0; i < 6; i++) colors.push(rgba[0], rgba[1], rgba[2], rgba[3]);
    }

    // Like pushQuad, but assigns per-vertex colors so a horizontal bar shows a
    // left->right gradient. The 6 pushed vertices (in pushQuad's order) are:
    //   a(x0), b(x0), c(x1), b(x0), d(x1), c(x1)  => L,L,R,L,R,R
    // so the two x0-end vertices get rgbaLeft and the x1-end vertices rgbaRight.
    function pushQuadGradient(positions, colors, x0, y0, x1, y1, thickness, rgbaLeft, rgbaRight) {
      const dx = x1 - x0, dy = y1 - y0;
      const len = Math.hypot(dx, dy) || 1;
      const nx = (-dy / len) * (thickness / 2);
      const ny = (dx / len) * (thickness / 2);

      const ax = x0 + nx, ay = y0 + ny;
      const bx = x0 - nx, by = y0 - ny;
      const cx = x1 + nx, cy = y1 + ny;
      const dxp = x1 - nx, dyp = y1 - ny;

      positions.push(ax, ay, bx, by, cx, cy, bx, by, dxp, dyp, cx, cy);
      const L = rgbaLeft, R = rgbaRight;
      const seq = [L, L, R, L, R, R];
      for (const c of seq) colors.push(c[0], c[1], c[2], c[3]);
    }

    // Sample a cubic bezier (matching the existing connector math in
    // appendLines: control points at (midX, ay) and (midX, by)) into a short
    // line strip of straight segments, each expanded to a quad.
    const BEZIER_SEGMENTS = 12;
    function pushBezierAsQuads(positions, colors, ax, ay, bx, by, thickness, rgba) {
      const midX = (ax + bx) / 2;
      let px = ax, py = ay;
      for (let i = 1; i <= BEZIER_SEGMENTS; i++) {
        const t = i / BEZIER_SEGMENTS;
        const u = 1 - t;
        // cubic bezier with p0=(ax,ay), p1=(midX,ay), p2=(midX,by), p3=(bx,by)
        const x = u * u * u * ax + 3 * u * u * t * midX + 3 * u * t * t * midX + t * t * t * bx;
        const y = u * u * u * ay + 3 * u * u * t * ay + 3 * u * t * t * by + t * t * t * by;
        pushQuad(positions, colors, px, py, x, y, thickness, rgba);
        px = x; py = y;
      }
    }

    // geometry = { bars: [{x0,y0,x1,y1,rgba}], connectors: [{ax,ay,bx,by,rgba}] }
    function setGeometry(bars, connectors, barThickness, connectorThickness) {
      const positions = [];
      const colors = [];
      for (const b of bars) {
        if (b.rgba2) {
          pushQuadGradient(positions, colors, b.x0, b.y, b.x1, b.y, barThickness, b.rgba, b.rgba2);
        } else {
          pushQuad(positions, colors, b.x0, b.y, b.x1, b.y, barThickness, b.rgba);
        }
      }
      barVertexCount = positions.length / 2;
      for (const c of connectors) {
        pushBezierAsQuads(positions, colors, c.ax, c.ay, c.bx, c.by, connectorThickness, c.rgba);
      }
      connectorVertexCount = positions.length / 2 - barVertexCount;

      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, colorBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(colors), gl.STATIC_DRAW);
    }

    function resize(viewportW, viewportH, dpr) {
      glCanvasEl.width = Math.ceil(viewportW * dpr);
      glCanvasEl.height = Math.ceil(viewportH * dpr);
      glCanvasEl.style.width = viewportW + "px";
      glCanvasEl.style.height = viewportH + "px";
      gl.viewport(0, 0, glCanvasEl.width, glCanvasEl.height);
    }

    function draw(viewportW, viewportH, scrollX, scrollY, barAlpha, connectorAlpha) {
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      if (barVertexCount === 0 && connectorVertexCount === 0) return;

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(program);

      gl.uniform2f(uResolutionLoc, viewportW, viewportH);
      gl.uniform2f(uScrollLoc, scrollX, scrollY);

      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuf);
      gl.enableVertexAttribArray(aPositionLoc);
      gl.vertexAttribPointer(aPositionLoc, 2, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, colorBuf);
      gl.enableVertexAttribArray(aColorLoc);
      gl.vertexAttribPointer(aColorLoc, 4, gl.FLOAT, false, 0, 0);

      if (barVertexCount > 0) {
        gl.uniform1f(uAlphaMulLoc, barAlpha);
        drawArraysChunked(0, barVertexCount);
      }
      if (connectorVertexCount > 0) {
        gl.uniform1f(uAlphaMulLoc, connectorAlpha);
        drawArraysChunked(barVertexCount, connectorVertexCount);
      }
    }

    // A single gl.drawArrays() call with several million vertices silently
    // fails on some GPU/driver combinations (observed: ~17.8M vertices in one
    // call raises a GL error and renders nothing at all, with no visible
    // exception in app code; splitting the exact same buffer into ~8.9M-vertex
    // calls renders correctly). Chunk large draws into safe-sized batches so
    // this never depends on the driver's undocumented per-call vertex limit.
    // Must stay a multiple of 3 (whole triangles) at every chunk boundary.
    const MAX_VERTICES_PER_DRAW = 60000 - (60000 % 3);
    function drawArraysChunked(first, count) {
      for (let offset = 0; offset < count; offset += MAX_VERTICES_PER_DRAW) {
        const n = Math.min(MAX_VERTICES_PER_DRAW, count - offset);
        gl.drawArrays(gl.TRIANGLES, first + offset, n);
      }
    }

    return { gl, setGeometry, resize, draw };
  }

  // ------------------------------------------------------------------------
  // 1. Load data
  // ------------------------------------------------------------------------
  // Data file is configurable per host page (set window.STORYLINE_DATA_FILE
  // in an inline <script> before this file loads) so two pages can compare
  // different proximity-rule datasets without duplicating this whole file.
  const BASE_DATA_FILE = window.STORYLINE_DATA_FILE || "storyline_data_peryear_hwcounty.json";
  // Correlation-threshold selector. THR=0.7 is the original lineage (empty
  // filename tag -> BASE_DATA_FILE unchanged); THR=0.8 is a stricter additive
  // dataset whose files carry a "_thr80" tag inserted before ".json". The
  // active threshold is read from the URL (?thr=0.8) so it survives reloads
  // and can be carried across the compare-page links.
  function readThr() {
    return new URLSearchParams(location.search).get("thr") === "0.8" ? "0.8" : "0.7";
  }
  function dataFileFor(thr) {
    return thr === "0.8" ? BASE_DATA_FILE.replace(/\.json$/, "_thr80.json") : BASE_DATA_FILE;
  }

  // no-store + a cache-busting query: this app is served by a plain
  // http.server with no cache headers, and the data files get regenerated
  // frequently during development -- default fetch caching (and even
  // no-store alone, against some browser disk caches) was serving stale
  // JSON after pipeline re-runs.
  function loadData(file) {
    statusEl.textContent = `Loading ${file}...`;
    fetch(`${file}?t=${Date.now()}`, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status} fetching ${file}`);
        return r.json();
      })
      .then((data) => {
        state.data = data;
        state.numWindows = (data.windows || []).length;
        statusEl.textContent = `Loaded ${data.roads.length} roads. Building layout...`;
        // Defer heavy work a tick so the status text paints first.
        setTimeout(() => {
          state.enforcedAlign = null;
          buildAllStructures();
          buildGeometry();
          populateRoadDropdown();
          buildAxis();
          render();
          statusEl.textContent =
            `${data.roads.length} roads, ${countSegments(data)} segments, ${state.numWindows} windows. ` +
            `Hover a line for details.`;
        }, 0);
      })
      .catch((err) => {
        statusEl.textContent = `Failed to load ${file}: ` + err.message;
        console.error(err);
      });
  }

  // Rewrite the header "compare:" links so the current threshold persists when
  // navigating to the sibling storyline pages. Idempotent: strips any existing
  // ?thr before (re)appending, so toggling live keeps the links in sync.
  function updateCompareLinks(thr) {
    document.querySelectorAll("#toolbar a[href$='.html'], #toolbar a[href*='.html?']").forEach((a) => {
      const href = a.getAttribute("href").split("?")[0];
      a.setAttribute("href", thr === "0.8" ? `${href}?thr=0.8` : href);
    });
  }

  // Segmented control injected into the header (no per-page HTML edits needed).
  function setupThresholdToggle() {
    let thr = readThr();
    const firstRow = document.querySelector("#toolbar .toolbar-row");
    const ctl = document.createElement("div");
    ctl.className = "ctl";
    const label = document.createElement("span");
    label.textContent = "Threshold";
    const seg = document.createElement("div");
    seg.className = "thr-seg";
    const buttons = {};
    ["0.7", "0.8"].forEach((val) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "thr-btn" + (val === thr ? " active" : "");
      b.textContent = val;
      b.addEventListener("click", () => {
        if (val === thr) return;
        thr = val;
        buttons["0.7"].classList.toggle("active", thr === "0.7");
        buttons["0.8"].classList.toggle("active", thr === "0.8");
        const params = new URLSearchParams(location.search);
        if (thr === "0.8") params.set("thr", "0.8");
        else params.delete("thr");
        const qs = params.toString();
        history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
        updateCompareLinks(thr);
        loadData(dataFileFor(thr));
      });
      buttons[val] = b;
      seg.appendChild(b);
    });
    ctl.appendChild(label);
    ctl.appendChild(seg);
    firstRow.appendChild(ctl);
    updateCompareLinks(thr);
    return thr;
  }

  const initialThr = setupThresholdToggle();
  loadData(dataFileFor(initialThr));

  function countSegments(data) {
    let n = 0;
    for (const road of data.roads) n += road.segments.length;
    return n;
  }

  // ------------------------------------------------------------------------
  // 2. STRUCTURE
  //
  // For each road, independent of slider geometry, computes:
  //  - segKMap[i]: Map<k, {s, v}> per segment, for quick per-window lookup.
  //  - groupsAtK[k]: array of groups for window k, each
  //      { key, members: [segIdx...] }
  //    where a group is either all segments sharing the same session id `s`
  //    at window k, or (for segments with s === null at k) a singleton group.
  //  - order[k]: array of group indices into groupsAtK[k], giving the final
  //    top-to-bottom order after barycenter sweeps.
  //  - memberOrder[k]: Map<segIdx, indexWithinGroup> giving the final
  //    top-to-bottom order of members WITHIN their group at window k.
  //  - nodeColorTrack: Map("k:s" -> colorTrackId) for stable cohort-color hue
  //    across windows (derived via the old mutual-best-overlap union-find;
  //    this informs COLOR ONLY, not position).
  // ------------------------------------------------------------------------
  function buildRoadStructure(road, roadIdx) {
    const segments = road.segments;
    const n = segments.length;
    const numWindows = state.numWindows;

    const segKMap = new Array(n);
    for (let i = 0; i < n; i++) segKMap[i] = new Map();

    // Browser-side Session Filtering (paper §6.2), gated on a page flag so the
    // main (non-geo) pages are byte-for-byte unchanged. The pipeline now emits
    // UNFILTERED session data (every eligible window keeps every segment's
    // session id), so when the flag is set we reproduce the paper's rule live:
    // for window k, a session is KEPT iff its size >= ths, OR at least one of
    // its member segments belongs to a session of size >= ths in window k-1 or
    // k+1 (the "bridge" clause). Dropped sessions' segments are simply not added
    // to any group at k, so they get no position and the layout collapses
    // vertically (paper Fig. 4 B2->B3) rather than being grayed out.
    const browserFilter = !!(typeof window !== "undefined" && window.STORYLINE_BROWSER_FILTER);
    const ths = browserFilter ? Math.max(1, state.ths | 0) : 1;

    // Pre-pass: populate segKMap for EVERY segment/window (independent of
    // filtering, so downstream cell lookups by (segIdx, k) always resolve), and
    // record each real session's member segments per window (sessions only;
    // w.s == null "singletons" are handled separately and never filtered).
    const sessionMembersAtK = new Array(numWindows);
    for (let k = 0; k < numWindows; k++) sessionMembersAtK[k] = new Map();
    for (let i = 0; i < n; i++) {
      const win = segments[i].win || [];
      for (const w of win) {
        if (w == null || w.k == null || w.k < 0 || w.k >= numWindows) continue;
        segKMap[i].set(w.k, { s: w.s, v: w.v });
        if (w.s != null) {
          let arr = sessionMembersAtK[w.k].get(w.s);
          if (!arr) { arr = []; sessionMembersAtK[w.k].set(w.s, arr); }
          arr.push(i);
        }
      }
    }

    // largeMembers[k]: Set of segIdx whose session at window k has size >= ths.
    // Only needed for the bridge clause, so only built when filtering.
    let largeMembers = null;
    if (browserFilter) {
      largeMembers = new Array(numWindows);
      for (let k = 0; k < numWindows; k++) {
        const set = new Set();
        for (const arr of sessionMembersAtK[k].values()) {
          if (arr.length >= ths) for (const segIdx of arr) set.add(segIdx);
        }
        largeMembers[k] = set;
      }
    }

    // groupsAtK[k]: array of { key, members: [segIdx...] }
    const groupsAtK = new Array(numWindows);
    for (let k = 0; k < numWindows; k++) {
      const bySession = new Map(); // s -> group
      const groups = [];
      groupsAtK[k] = groups;

      // Kept-session set at window k (only when filtering).
      let keptSessions = null;
      if (browserFilter) {
        keptSessions = new Set();
        for (const [s, arr] of sessionMembersAtK[k]) {
          if (arr.length >= ths) { keptSessions.add(s); continue; }
          let bridge = false;
          for (const segIdx of arr) {
            if ((k > 0 && largeMembers[k - 1].has(segIdx)) ||
                (k < numWindows - 1 && largeMembers[k + 1].has(segIdx))) {
              bridge = true;
              break;
            }
          }
          if (bridge) keptSessions.add(s);
        }
      }

      for (let i = 0; i < n; i++) {
        const win = segments[i].win || [];
        for (const w of win) {
          if (w == null || w.k !== k) continue;
          if (w.s == null) {
            groups.push({ key: `singleton:${i}`, members: [i] });
          } else {
            // When filtering, skip segments whose session at k was dropped:
            // they get no group -> no position -> removed from the layout.
            if (browserFilter && !keptSessions.has(w.s)) continue;
            let g = bySession.get(w.s);
            if (!g) {
              g = { key: `s:${w.s}`, members: [] };
              bySession.set(w.s, g);
              groups.push(g);
            }
            g.members.push(i);
          }
        }
      }
    }

    // --- Stable color-track ids via mutual-best-overlap union-find on
    // sessions only (singletons never union into a colored track). This is
    // purely cosmetic (cohort color-mode hue stability) and does not affect
    // position at all.
    const cohortsAtK = new Array(numWindows);
    for (let k = 0; k < numWindows; k++) {
      const m = new Map();
      for (const g of groupsAtK[k]) {
        if (g.key.startsWith("s:")) m.set(g.key, g.members);
      }
      cohortsAtK[k] = m;
    }
    const uf = new UnionFind();
    for (let k = 0; k < numWindows; k++) {
      for (const key of cohortsAtK[k].keys()) uf.find(`${k}:${key}`);
    }
    for (let k = 0; k < numWindows - 1; k++) {
      const mapA = cohortsAtK[k];
      const mapB = cohortsAtK[k + 1];
      if (mapA.size === 0 || mapB.size === 0) continue;

      const bestOfA = new Map();
      for (const [keyA, idxArr] of mapA) {
        const counts = new Map();
        for (const segIdx of idxArr) {
          const next = segKMap[segIdx].get(k + 1);
          if (!next || next.s == null) continue;
          const keyB = `s:${next.s}`;
          counts.set(keyB, (counts.get(keyB) || 0) + 1);
        }
        let bestB = null, bestCount = 0;
        for (const [keyB, c] of counts) if (c > bestCount) { bestCount = c; bestB = keyB; }
        if (bestB !== null) bestOfA.set(keyA, { keyB: bestB, count: bestCount });
      }
      const bestOfB = new Map();
      for (const [keyB, idxArr] of mapB) {
        const counts = new Map();
        for (const segIdx of idxArr) {
          const prev = segKMap[segIdx].get(k);
          if (!prev || prev.s == null) continue;
          const keyA = `s:${prev.s}`;
          counts.set(keyA, (counts.get(keyA) || 0) + 1);
        }
        let bestA = null, bestCount = 0;
        for (const [keyA, c] of counts) if (c > bestCount) { bestCount = c; bestA = keyA; }
        if (bestA !== null) bestOfB.set(keyB, { keyA: bestA, count: bestCount });
      }
      for (const [keyA, { keyB, count }] of bestOfA) {
        if (count <= 0) continue;
        const back = bestOfB.get(keyB);
        if (back && back.keyA === keyA) uf.union(`${k}:${keyA}`, `${k + 1}:${keyB}`);
      }
    }
    const rootToColorTrack = new Map();
    const nodeColorTrack = new Map(); // "k:s" -> colorTrackId (dense int)
    let nextColorTrack = 0;
    for (let k = 0; k < numWindows; k++) {
      for (const key of cohortsAtK[k].keys()) {
        const root = uf.find(`${k}:${key}`);
        let id = rootToColorTrack.get(root);
        if (id === undefined) { id = nextColorTrack++; rootToColorTrack.set(root, id); }
        nodeColorTrack.set(`${k}:${key}`, id);
      }
    }

    // --- Barycenter-sweep ordering ---------------------------------------
    // prevY[i] = this segment's y-position (relative, in rows) in the most
    // recently processed window, used as the barycenter input for the next.
    // order[k] = array of group objects (groupsAtK[k]) in final top-to-bottom
    // order. memberOrderArr[k] = Map(segIdx -> array position within group).
    const order = new Array(numWindows);
    const memberWithinGroupOrder = new Array(numWindows);

    function markerOf(i) { return segments[i].marker || 0; }
    function roadbedOf(i) { return segments[i].roadbed || ""; }

    function orderWindowByMarker(k) {
      const groups = groupsAtK[k];
      // order members within each group by (roadbed, marker) -- bands can now
      // mix several highways within one county, and marker numbers reset per
      // highway, so sorting by marker alone would interleave unrelated
      // highways in the initial seed order.
      const memOrder = new Map();
      for (const g of groups) {
        const sorted = g.members.slice().sort((a, b) => {
          const rb = roadbedOf(a) < roadbedOf(b) ? -1 : roadbedOf(a) > roadbedOf(b) ? 1 : 0;
          return rb !== 0 ? rb : markerOf(a) - markerOf(b);
        });
        sorted.forEach((segIdx, pos) => memOrder.set(segIdx, pos));
        g._sortedMembers = sorted;
        g._meanMarker = sorted.reduce((s, i) => s + markerOf(i), 0) / sorted.length;
      }
      const ordered = groups.slice().sort((a, b) => a._meanMarker - b._meanMarker);
      order[k] = ordered;
      memberWithinGroupOrder[k] = memOrder;
    }

    // y-row (relative, just an ordering proxy - not pixels) of each segment
    // in a given window's finalized order, used as next window's barycenter.
    function rowsForWindow(k) {
      const rows = new Map();
      let r = 0;
      for (const g of order[k]) {
        for (const segIdx of g._sortedMembers) {
          rows.set(segIdx, r);
          r++;
        }
        r += 1; // gap placeholder between groups, keeps groups from merging in barycenter math
      }
      return rows;
    }

    function orderWindowByPrev(k, prevRows) {
      const groups = groupsAtK[k];
      const memOrder = new Map();
      for (const g of groups) {
        const sorted = g.members.slice().sort((a, b) => {
          const ra = prevRows.has(a) ? prevRows.get(a) : markerToFallback(a, prevRows);
          const rb = prevRows.has(b) ? prevRows.get(b) : markerToFallback(b, prevRows);
          if (ra !== rb) return ra - rb;
          return markerOf(a) - markerOf(b);
        });
        sorted.forEach((segIdx, pos) => memOrder.set(segIdx, pos));
        g._sortedMembers = sorted;
        let sum = 0, cnt = 0;
        for (const segIdx of sorted) {
          if (prevRows.has(segIdx)) { sum += prevRows.get(segIdx); cnt++; }
        }
        // groups with no previously-positioned members fall back to marker
        // order, but still need a comparable scalar: use a marker-derived
        // pseudo-row so they interleave sensibly relative to positioned groups.
        g._meanMarker = cnt > 0 ? sum / cnt : markerFallbackScalar(g._sortedMembers);
        g._hasPrev = cnt > 0;
      }
      const ordered = groups.slice().sort((a, b) => a._meanMarker - b._meanMarker);
      order[k] = ordered;
      memberWithinGroupOrder[k] = memOrder;
    }

    // Highway color mode: keep same-roadbed segments contiguous within each
    // group across all windows. Clusters (one per roadbed) are ordered by mean
    // previous-window row; members within a cluster stay in marker order.
    function orderWindowByPrevHighway(k, prevRows) {
      const groups = groupsAtK[k];
      const memOrder = new Map();
      for (const g of groups) {
        const clusters = new Map();
        for (const segIdx of g.members) {
          const rb = roadbedOf(segIdx);
          if (!clusters.has(rb)) clusters.set(rb, []);
          clusters.get(rb).push(segIdx);
        }
        const clusterList = [];
        for (const members of clusters.values()) {
          members.sort((a, b) => markerOf(a) - markerOf(b));
          let sum = 0, cnt = 0;
          for (const segIdx of members) {
            if (prevRows.has(segIdx)) { sum += prevRows.get(segIdx); cnt++; }
          }
          const meanRow = cnt > 0 ? sum / cnt : markerFallbackScalar(members);
          clusterList.push({ members, meanRow });
        }
        clusterList.sort((a, b) => a.meanRow - b.meanRow);
        const sorted = [];
        for (const c of clusterList) for (const segIdx of c.members) sorted.push(segIdx);
        sorted.forEach((segIdx, pos) => memOrder.set(segIdx, pos));
        g._sortedMembers = sorted;
        let sum = 0, cnt = 0;
        for (const segIdx of sorted) {
          if (prevRows.has(segIdx)) { sum += prevRows.get(segIdx); cnt++; }
        }
        g._meanMarker = cnt > 0 ? sum / cnt : markerFallbackScalar(g._sortedMembers);
        g._hasPrev = cnt > 0;
      }
      const ordered = groups.slice().sort((a, b) => a._meanMarker - b._meanMarker);
      order[k] = ordered;
      memberWithinGroupOrder[k] = memOrder;
    }

    // Fallback scalar for groups/members with no previous-window position:
    // map marker into the same numeric range as prevRows by marker rank
    // among ALL segments on the road, scaled to roughly [0, maxPrevRow].
    let markerRankCache = null;
    function markerRank(i) {
      if (!markerRankCache) {
        const byMarker = Array.from({ length: n }, (_, idx) => idx)
          .sort((a, b) => markerOf(a) - markerOf(b));
        markerRankCache = new Map();
        byMarker.forEach((idx, rank) => markerRankCache.set(idx, rank));
      }
      return markerRankCache.get(i);
    }
    function markerToFallback(i, prevRows) {
      // scale marker rank into the observed prevRows numeric range so it
      // interleaves plausibly with real positions instead of always sorting
      // to one extreme.
      let maxRow = 0;
      for (const v of prevRows.values()) if (v > maxRow) maxRow = v;
      const denom = Math.max(n - 1, 1);
      return (markerRank(i) / denom) * maxRow;
    }
    function markerFallbackScalar(members) {
      const denom = Math.max(n - 1, 1);
      const meanRank = members.reduce((s, i) => s + markerRank(i), 0) / members.length;
      return meanRank / denom; // small scalar; fine as relative ordering key among similar groups
    }

    // In highway color mode, later windows cluster same-roadbed members;
    // otherwise pure barycenter continuity. (window 0 is already roadbed-clustered)
    const orderFn = state.colorMode === "highway" ? orderWindowByPrevHighway : orderWindowByPrev;

    // Initial pass: window 0 by marker, then forward by barycenter of prev.
    orderWindowByMarker(0);
    for (let k = 1; k < numWindows; k++) {
      const prevRows = rowsForWindow(k - 1);
      orderFn(k, prevRows);
    }

    // Additional sweeps, alternating direction, refining using whichever
    // neighbor window is "previous" in the current sweep direction.
    for (let sweep = 1; sweep < BARYCENTER_SWEEPS; sweep++) {
      const forward = sweep % 2 === 1; // sweep1=backward, sweep2=forward, ... (continues after initial forward pass)
      if (forward) {
        for (let k = 1; k < numWindows; k++) {
          const prevRows = rowsForWindow(k - 1);
          orderFn(k, prevRows);
        }
      } else {
        for (let k = numWindows - 2; k >= 0; k--) {
          const nextRows = rowsForWindow(k + 1);
          orderFn(k, nextRows);
        }
      }
    }

    let finalOrder = order;
    let finalMemOrder = memberWithinGroupOrder;
    let enforceTargetKey = null;
    const ea = state.enforcedAlign;
    if (ea && ea.roadIdx === roadIdx) {
      const res = StorylineAlign.enforceAlignOrder(
        { order, memberWithinGroupOrder },
        { groupsAtK, numWindows, clicked: { k: ea.k, s: ea.s }, thc: 1 }
      );
      finalOrder = res.order;
      finalMemOrder = res.memberWithinGroupOrder;
      enforceTargetKey = res.targetKeyByWindow;
    }
    return {
      segKMap, groupsAtK,
      order: finalOrder,
      memberWithinGroupOrder: finalMemOrder,
      nodeColorTrack, segCount: n, enforceTargetKey,
    };
  }

  function buildAllStructures() {
    state.structures = state.data.roads.map(buildRoadStructure);
  }

  // ------------------------------------------------------------------------
  // 3. GEOMETRY: slider-dependent y-offsets, road stacking, x positions
  // ------------------------------------------------------------------------
  function buildGeometry() {
    const { rowPx, laneGap, roadGap } = state;
    const roads = state.data.roads;
    const structures = state.structures;
    const geometry = [];
    let yCursor = MARGIN_TOP;

    for (let r = 0; r < roads.length; r++) {
      const struct = structures[r];
      // Per-window y0 (top, in px, relative to road top) for each group,
      // and a per-segment y (relative to road top) per window.
      const windowY0 = new Array(state.numWindows); // [k] -> array parallel to struct.order[k], group top y
      const segY = new Array(struct.segCount);      // [segIdx] -> Map(k -> y relative to road top)
      for (let i = 0; i < struct.segCount; i++) segY[i] = new Map();

      let roadHeight = 0;
      // Enforce-align straightening: make the target cohort start at a constant
      // y across windows by equalizing each window's true target start-y
      // (replaying buildGeometry's own group-gap + singleton-zero-gap rule).
      let targetPad = null;
      if (struct.enforceTargetKey) {
        const targetStarts = new Array(state.numWindows).fill(null);
        for (let k = 0; k < state.numWindows; k++) {
          const tk = struct.enforceTargetKey[k];
          if (!tk) continue;
          let yy = 0, lastSingleton = false, emitted = false;
          for (const g of struct.order[k]) {
            const isSingleton = g.key.startsWith("singleton:");
            if (emitted) yy += (isSingleton && lastSingleton) ? 0 : laneGap;
            if (g.key === tk) { targetStarts[k] = yy; break; }
            yy += g._sortedMembers.length * rowPx;
            lastSingleton = isSingleton; emitted = true;
          }
        }
        targetPad = StorylineAlign.targetTopPad(targetStarts);
      }
      for (let k = 0; k < state.numWindows; k++) {
        const groups = struct.order[k];
        const memOrder = struct.memberWithinGroupOrder[k];
        let y = targetPad ? targetPad[k] : 0;
        const tops = new Array(groups.length);
        let lastWasSingleton = false;
        let anyEmitted = false;
        for (let gi = 0; gi < groups.length; gi++) {
          const g = groups[gi];
          const isSingleton = g.key.startsWith("singleton:");
          // Real session-cohort groups (the meaningful "evolution pattern"
          // bundles) always get a full laneGap before them (except the very
          // first group in the column). Singleton/unaffiliated entries pack
          // tightly against a PRECEDING singleton (zero gap, same as the
          // zero-gap packing used within a normal group) so their count
          // window-to-window doesn't balloon/shrink the column height -- but
          // still get a full laneGap when transitioning in from/out of a
          // real group, since they remain a visually distinct block.
          if (anyEmitted) {
            y += isSingleton && lastWasSingleton ? 0 : laneGap;
          }
          tops[gi] = y;
          const members = g._sortedMembers;
          for (const segIdx of members) {
            const rowInGroup = memOrder.get(segIdx);
            const segYpos = y + rowInGroup * rowPx + rowPx / 2;
            segY[segIdx].set(k, segYpos);
          }
          y += members.length * rowPx;
          lastWasSingleton = isSingleton;
          anyEmitted = true;
        }
        windowY0[k] = tops;
        const colHeight = anyEmitted ? y : 0;
        if (colHeight > roadHeight) roadHeight = colHeight;
      }
      roadHeight = Math.max(roadHeight, rowPx);

      geometry.push({
        yOffset: yCursor,
        roadHeight,
        label: roads[r].roadbed,
        segCount: struct.segCount,
        segY, // Map per segIdx of k -> relative y (added to yOffset when drawing)
      });
      yCursor += roadHeight + roadGap;
    }
    state.geometry = geometry;
    state.totalHeight = yCursor;
  }

  // Extra horizontal space inserted between consecutive window columns (on
  // top of colW) purely so the S-curve connector has visible room to bow
  // through between one bar's right edge and the next bar's left edge. Bars
  // themselves still span the FULL colW - this space is genuinely additional,
  // not carved out of the bar width. Controlled live by the "Window gap"
  // slider via state.colGap.
  function colPitch() {
    return state.colW + state.colGap;
  }

  function colX(k) {
    return MARGIN_LEFT + k * colPitch() + state.colW / 2;
  }

  // ------------------------------------------------------------------------
  // 4. Per-segment rendered point list
  //
  // A segment's polyline is just its real per-window stacked position
  // (computed in buildGeometry) for every window it has data in. No anchors,
  // no interpolation, no big-jump classification: every eligible window
  // already has a genuine stacked y, so consecutive-window pairs are simply
  // connected with a straight line; non-consecutive (a true eligibility gap)
  // pairs are not connected at all.
  // ------------------------------------------------------------------------
  // geometry[].yOffset is each road's cumulative world-stacked position
  // across ALL roads (built once by buildGeometry(), used by "All roads"
  // view). When a single road is selected, that road is drawn on its OWN
  // dedicated canvas starting at the top -- using its full-stack yOffset
  // there would place every point far below the single-road canvas's much
  // shorter contentHeight (off-screen, rendering as blank). Rebase to
  // MARGIN_TOP in that case instead.
  function effectiveYOffset(roadIdx) {
    return state.selectedRoadIdx >= 0 ? MARGIN_TOP : state.geometry[roadIdx].yOffset;
  }

  function segmentPoints(roadIdx) {
    const road = state.data.roads[roadIdx];
    const struct = state.structures[roadIdx];
    const geo = state.geometry[roadIdx];
    const yOffset = effectiveYOffset(roadIdx);
    const segments = road.segments;
    const n = segments.length;
    const out = new Array(n);

    for (let i = 0; i < n; i++) {
      const win = segments[i].win || [];
      const sorted = win.filter((w) => w != null && w.k != null).slice().sort((a, b) => a.k - b.k);
      const pts = [];
      for (const w of sorted) {
        const relY = geo.segY[i].get(w.k);
        if (relY === undefined) continue; // shouldn't happen, but guard
        const colorTrackId = w.s == null ? -1 : (struct.nodeColorTrack.get(`${w.k}:s:${w.s}`) ?? -1);
        pts.push({ k: w.k, v: w.v, yv: w.yv, trackId: colorTrackId, id: segments[i].id, roadbed: segments[i].roadbed || "", pavtype: segments[i].pavtype || "", y: yOffset + relY });
      }
      out[i] = pts;
    }
    return out;
  }

  // ------------------------------------------------------------------------
  // 5. Rendering
  // ------------------------------------------------------------------------
  function visibleRoadIndices() {
    if (state.selectedRoadIdx >= 0) return [state.selectedRoadIdx];
    const out = [];
    for (let i = 0; i < state.data.roads.length; i++) out.push(i);
    return out;
  }

  function resizeCanvas() {
    if (!state.data) return;

    // Full data extent (can be tens of thousands of px tall for "All roads").
    const contentHeight = state.selectedRoadIdx >= 0
      ? state.geometry[state.selectedRoadIdx].roadHeight + MARGIN_TOP * 2
      : state.totalHeight;
    const contentWidth = MARGIN_LEFT * 2 + state.numWindows * colPitch();
    state.contentHeight = Math.max(contentHeight, 100);
    state.contentWidth = Math.max(contentWidth, 100);

    // The spacer establishes canvasWrap's scrollWidth/scrollHeight at the
    // FULL data extent so native scrollbars behave normally.
    canvasSpacerEl.style.width = state.contentWidth + "px";
    canvasSpacerEl.style.height = state.contentHeight + "px";
    axisInnerEl.style.width = state.contentWidth + "px";

    // canvasWrap's own box is sized to the available viewport (below the
    // sticky toolbar/axis), independent of the data extent.
    const wrapTop = canvasWrap.getBoundingClientRect().top;
    const wrapAvailH = Math.max(window.innerHeight - wrapTop, 200);
    canvasWrap.style.height = wrapAvailH + "px";

    // The canvas backing store is capped well under the browser's limit.
    const viewportW = Math.min(state.contentWidth, canvasWrap.clientWidth || state.contentWidth, MAX_CANVAS_DIM);
    const viewportH = Math.min(state.contentHeight, wrapAvailH, MAX_CANVAS_DIM);
    state.viewportW = viewportW;
    state.viewportH = viewportH;

    const dpr = state.dpr;
    canvas.width = Math.ceil(viewportW * dpr);
    canvas.height = Math.ceil(viewportH * dpr);
    canvas.style.width = viewportW + "px";
    canvas.style.height = viewportH + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (glRenderer) glRenderer.resize(viewportW, viewportH, dpr);

    syncCanvasToScroll();
  }

  // Keeps the (viewport-sized) canvases visually pinned to whatever slice of
  // canvasWrap is currently scrolled into view, and keeps the axis labels
  // tracking horizontal scroll. The 2D canvas content is drawn in draw()
  // using a matching ctx.translate(-scrollLeft,-scrollTop); the WebGL canvas
  // instead gets scroll passed as a uniform in drawGL() (pure GPU-side
  // transform, no buffer rebuild) so on screen everything lines up as if
  // the canvases were the full (huge) data extent.
  function syncCanvasToScroll() {
    const sl = canvasWrap.scrollLeft;
    const st = canvasWrap.scrollTop;
    canvas.style.transform = `translate(${sl}px, ${st}px)`;
    glCanvas.style.transform = `translate(${sl}px, ${st}px)`;
    axisInnerEl.style.transform = `translateX(${-sl}px)`;
    state.scrollLeft = sl;
    state.scrollTop = st;
  }

  function buildAxis() {
    axisInnerEl.innerHTML = "";
    const windows = state.data.windows;
    for (let k = 0; k < windows.length; k++) {
      const div = document.createElement("div");
      div.className = "axis-label";
      div.style.left = colX(k) + "px";
      div.textContent = windows[k].label;
      axisInnerEl.appendChild(div);
    }
  }

  // Cache point lists per visible road so hover/redraw doesn't recompute every frame.
  let pointsCache = new Map(); // roadIdx -> points array

  function rebuildPointsCache() {
    pointsCache = new Map();
    for (const r of visibleRoadIndices()) pointsCache.set(r, segmentPoints(r));
  }

  // hit-test index: per window k, sorted array of {y, roadIdx, segIdx}
  let hitIndex = null;

  function buildHitIndex() {
    hitIndex = new Array(state.numWindows);
    for (let k = 0; k < state.numWindows; k++) hitIndex[k] = [];
    for (const [roadIdx, pts] of pointsCache) {
      for (let segIdx = 0; segIdx < pts.length; segIdx++) {
        for (const p of pts[segIdx]) {
          hitIndex[p.k].push({ y: p.y, roadIdx, segIdx });
        }
      }
    }
    for (let k = 0; k < state.numWindows; k++) hitIndex[k].sort((a, b) => a.y - b.y);
  }

  function render() {
    if (!state.data) return;
    resizeCanvas();
    rebuildPointsCache();
    buildHitIndex();
    if (glRenderer) rebuildGLGeometry();
    draw();
  }

  function draw() {
    const w = canvas.width / state.dpr;
    const h = canvas.height / state.dpr;
    ctx.save();
    ctx.clearRect(0, 0, w, h);
    if (!glRenderer) {
      // No WebGL background layer to show through, so paint the page
      // background directly onto the 2D canvas (matches old behavior).
      ctx.fillStyle = "#fafafa";
      ctx.fillRect(0, 0, w, h);
    }

    // Everything below is drawn in absolute content coordinates; shifting
    // the context by the current scroll offset makes the (viewport-sized)
    // canvas show the correct slice without recomputing any coordinates.
    ctx.translate(-state.scrollLeft, -state.scrollTop);

    drawRoadLabels();

    const hoverActive = !!state.hover;

    if (!glRenderer) {
      // --- Fallback: original Canvas-2D bar/connector rendering ---------
      const dimAlpha = hoverActive ? 0.6 : 1;
      const buckets = new Map(); // colorStr -> Path2D
      const gradientBars = []; // units page: per-bar linear-gradient strokes
      for (const [roadIdx, pts] of pointsCache) {
        for (let segIdx = 0; segIdx < pts.length; segIdx++) {
          if (hoverActive && state.hover.roadIdx === roadIdx && state.hover.segIdx === segIdx) continue;
          appendLines(roadIdx, pts[segIdx], buckets, gradientBars);
        }
      }
      const barWidth = Math.max(1.4, state.rowPx * 0.7);
      const connectorWidth = Math.max(0.7, barWidth * 0.5);
      for (const bucket of buckets.values()) {
        ctx.strokeStyle = bucket.color;
        ctx.globalAlpha = dimAlpha * (bucket.faded ? FADE_ALPHA : 1);
        ctx.lineWidth = barWidth;
        ctx.lineCap = "butt";           // hard edges between per-year cells
        ctx.stroke(bucket.bars);
        ctx.globalAlpha = dimAlpha * 0.8 * (bucket.faded ? FADE_ALPHA : 1);
        ctx.lineWidth = connectorWidth;
        ctx.lineCap = "round";          // smooth bezier connector ends
        ctx.stroke(bucket.connectors);
      }
      // Units gradient bars: each drawn as its own light->dark blue gradient
      // stroke with a color stop at every year fraction.
      ctx.lineWidth = barWidth;
      ctx.lineCap = "butt";
      for (const gb of gradientBars) {
        const grad = ctx.createLinearGradient(gb.x0, 0, gb.x1, 0);
        const N = gb.yv.length;
        for (let j = 0; j < N; j++) {
          const stop = N === 1 ? 0 : j / (N - 1);
          grad.addColorStop(stop, shadeBlue(gb.yv[j]));
        }
        ctx.strokeStyle = grad;
        ctx.globalAlpha = dimAlpha * (gb.faded ? FADE_ALPHA : 1);
        ctx.beginPath();
        ctx.moveTo(gb.x0, gb.y);
        ctx.lineTo(gb.x1, gb.y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // --- highlighted segment on top, full prominence (both paths) -------
    if (hoverActive) drawHighlighted(state.hover.roadIdx, state.hover.segIdx);

    ctx.restore();

    if (glRenderer) drawGL();
  }

  // ------------------------------------------------------------------------
  // WebGL geometry build + draw (bars + connectors). Rebuilt only when the
  // underlying geometry changes (render()); scrolling only calls drawGL(),
  // which just re-issues the draw call with an updated scroll uniform - no
  // CPU-side rebuild.
  // ------------------------------------------------------------------------
  function rebuildGLGeometry() {
    const halfBar = state.colW / 2;
    const bars = [];
    const connectors = [];
    for (const [roadIdx, pts] of pointsCache) {
      for (let segIdx = 0; segIdx < pts.length; segIdx++) {
        const segPts = pts[segIdx];
        for (let i = 0; i < segPts.length; i++) {
          const p = segPts[i];
          const x0 = colX(p.k) - halfBar;
          if (!state.paint.has(p.id) && state.colorMode === "condition" && p.yv && p.yv.length) {
            const N = p.yv.length;
            const cw = (2 * halfBar) / N;
            const alpha = p.trackId < 0 ? FADE_ALPHA : 1;
            if (BAR_ENCODING === "gradient") {
              // Units page: continuous light->dark blue gradient. Each year
              // sub-quad's left color = shadeBlue(yv[j]), right = shadeBlue(yv[j+1]);
              // matching boundary colors make the whole bar a smooth gradient.
              for (let j = 0; j < N; j++) {
                const left = colorToFloats(shadeBlue(p.yv[j]), alpha);
                const right = j < N - 1 ? colorToFloats(shadeBlue(p.yv[j + 1]), alpha) : left;
                bars.push({ x0: x0 + j * cw, x1: x0 + (j + 1) * cw, y: p.y, rgba: left, rgba2: right });
              }
            } else {
              // Condition mode: one hard-edged cell per year in the window.
              for (let j = 0; j < N; j++) {
                const rgba = colorToFloats(pmisCategoryColor(p.yv[j]), alpha);
                bars.push({ x0: x0 + j * cw, x1: x0 + (j + 1) * cw, y: p.y, rgba });
              }
            }
          } else {
            // Painted (paper §6.3.1) overrides colorMode; else cohort mode or
            // data without per-year yv: single flat bar.
            const painted = state.paint.has(p.id);
            const color = painted ? paintColor(state.paint.get(p.id), p.v) : state.colorMode === "cohort" ? (IS_GEO ? shadeGray(p.v) : cohortColor(p.trackId, p.v)) : state.colorMode === "highway" ? highwayColor(p.roadbed, p.v) : state.colorMode === "pavtype" ? pavTypeColor(p.pavtype, p.v) : state.colorMode === "condition" ? pmisCategoryColor(p.v) : shadeGray(p.v);
            const rgba = colorToFloats(color, (!painted && p.trackId < 0) ? FADE_ALPHA : 1);
            bars.push({ x0, x1: colX(p.k) + halfBar, y: p.y, rgba });
          }
        }
        for (let i = 0; i < segPts.length - 1; i++) {
          const a = segPts[i], b = segPts[i + 1];
          if (b.k - a.k !== 1) continue; // gap, no connector
          const color = edgeColor(roadIdx, a, b);
          const rgba = colorToFloats(color, (!state.paint.has(a.id) && a.trackId < 0 && b.trackId < 0) ? FADE_ALPHA : 1);
          connectors.push({
            ax: colX(a.k) + halfBar, ay: a.y,
            bx: colX(b.k) - halfBar, by: b.y,
            rgba,
          });
        }
      }
    }
    const barWidth = Math.max(1.4, state.rowPx * 0.7);
    const connectorWidth = Math.max(0.7, barWidth * 0.5);
    glRenderer.setGeometry(bars, connectors, barWidth, connectorWidth);
  }

  function drawGL() {
    const hoverActive = !!state.hover;
    const barAlpha = hoverActive ? 0.6 : 1;
    const connectorAlpha = barAlpha * 0.8;
    glRenderer.draw(state.viewportW, state.viewportH, state.scrollLeft, state.scrollTop, barAlpha, connectorAlpha);
  }

  // Each window membership is drawn as a flat horizontal bar spanning the
  // full width of that window's column (so a segment present in only one
  // window still reads as a visible bar, not a dot). Consecutive windows
  // are joined by a thin, lighter S-shaped bezier connecting the bar's
  // right edge to the next bar's left edge. A true eligibility gap
  // (segment missing the next window entirely) breaks the connector, no
  // interpolation across it.
  function bucketFor(buckets, color, faded) {
    const key = `${color}|${faded ? 'f' : 's'}`;
    let b = buckets.get(key);
    if (!b) { b = { bars: new Path2D(), connectors: new Path2D(), color, faded }; buckets.set(key, b); }
    return b;
  }

  function appendLines(roadIdx, pts, buckets, gradientBars) {
    const halfBar = state.colW / 2;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const faded = p.trackId < 0;
      const x0 = colX(p.k) - halfBar;
      if (!state.paint.has(p.id) && state.colorMode === "condition" && p.yv && p.yv.length) {
        if (BAR_ENCODING === "gradient" && gradientBars) {
          // Units page: collect for a per-bar linear-gradient stroke (drawn
          // outside the solid-color Path2D buckets). Skips batching, which is
          // fine for the units page's segment count.
          gradientBars.push({ x0, x1: colX(p.k) + halfBar, y: p.y, yv: p.yv, faded });
          continue;
        }
        const cw = (2 * halfBar) / p.yv.length;
        for (let j = 0; j < p.yv.length; j++) {
          const { bars } = bucketFor(buckets, pmisCategoryColor(p.yv[j]), faded);
          bars.moveTo(x0 + j * cw, p.y);
          bars.lineTo(x0 + (j + 1) * cw, p.y);
        }
      } else {
        const color = state.paint.has(p.id) ? paintColor(state.paint.get(p.id), p.v) : state.colorMode === "cohort" ? (IS_GEO ? shadeGray(p.v) : cohortColor(p.trackId, p.v)) : state.colorMode === "highway" ? highwayColor(p.roadbed, p.v) : state.colorMode === "pavtype" ? pavTypeColor(p.pavtype, p.v) : state.colorMode === "condition" ? pmisCategoryColor(p.v) : shadeGray(p.v);
        const { bars } = bucketFor(buckets, color, state.paint.has(p.id) ? false : faded);
        bars.moveTo(x0, p.y);
        bars.lineTo(colX(p.k) + halfBar, p.y);
      }
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      if (b.k - a.k !== 1) continue; // gap, no connector
      const color = edgeColor(roadIdx, a, b);
      const faded = (!state.paint.has(a.id) && a.trackId < 0 && b.trackId < 0);
      const { connectors } = bucketFor(buckets, color, faded);
      const ax = colX(a.k) + halfBar, ay = a.y;
      const bx = colX(b.k) - halfBar, by = b.y;
      const midX = (ax + bx) / 2;
      connectors.moveTo(ax, ay);
      connectors.bezierCurveTo(midX, ay, midX, by, bx, by);
    }
  }

  function edgeColor(roadIdx, a, b) {
    const v = avgV(a.v, b.v);
    // Connector joins two windows of the SAME entity (same id), so paint on
    // that entity colors the connector too (paper §6.3.1).
    if (state.paint.has(a.id)) return paintColor(state.paint.get(a.id), v);
    if (state.colorMode === "cohort") return IS_GEO ? shadeGray(v) : cohortColor(a.trackId, v);
    if (state.colorMode === "highway") return highwayColor(a.roadbed, v);
    if (state.colorMode === "pavtype") return pavTypeColor(a.pavtype, v);
    if (state.colorMode !== "condition") return shadeGray(v);
    if (BAR_ENCODING === "gradient") return shadeBlue(v); // units page: match blue bars
    return pmisCategoryColor(v);
  }

  function avgV(v1, v2) {
    const has1 = v1 !== null && v1 !== undefined && !isNaN(v1);
    const has2 = v2 !== null && v2 !== undefined && !isNaN(v2);
    if (has1 && has2) return (v1 + v2) / 2;
    if (has1) return v1;
    if (has2) return v2;
    return null;
  }

  function drawHighlighted(roadIdx, segIdx) {
    const pts = pointsCache.get(roadIdx)[segIdx];
    if (!pts) return;
    const halfBar = state.colW / 2;
    const barWidth = Math.max(3, state.rowPx * 1.4);
    const connectorWidth = Math.max(1.5, barWidth * 0.5);
    ctx.lineCap = "round";

    ctx.lineWidth = barWidth;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const x0 = colX(p.k) - halfBar, x1 = colX(p.k) + halfBar;
      if (!state.paint.has(p.id) && BAR_ENCODING === "gradient" && state.colorMode === "condition" && p.yv && p.yv.length) {
        // Units page: match the normal per-year blue gradient bars.
        const grad = ctx.createLinearGradient(x0, 0, x1, 0);
        const N = p.yv.length;
        for (let j = 0; j < N; j++) {
          const stop = N === 1 ? 0 : j / (N - 1);
          grad.addColorStop(stop, shadeBlue(p.yv[j]));
        }
        ctx.strokeStyle = grad;
      } else {
        ctx.strokeStyle = state.paint.has(p.id) ? paintColor(state.paint.get(p.id), p.v) : state.colorMode === "cohort" ? (IS_GEO ? shadeGray(p.v) : cohortColor(p.trackId, p.v)) : state.colorMode === "highway" ? highwayColor(p.roadbed, p.v) : state.colorMode === "pavtype" ? pavTypeColor(p.pavtype, p.v) : state.colorMode === "condition" ? pmisCategoryColor(p.v) : shadeGray(p.v);
      }
      ctx.beginPath();
      ctx.moveTo(x0, p.y);
      ctx.lineTo(x1, p.y);
      ctx.stroke();
    }

    ctx.lineWidth = connectorWidth;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      if (b.k - a.k !== 1) continue;
      ctx.strokeStyle = edgeColor(roadIdx, a, b);
      const ax = colX(a.k) + halfBar, ay = a.y;
      const bx = colX(b.k) - halfBar, by = b.y;
      const midX = (ax + bx) / 2;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.bezierCurveTo(midX, ay, midX, by, bx, by);
      ctx.stroke();
    }
  }

  function drawRoadLabels() {
    if (state.selectedRoadIdx >= 0) {
      const geo = state.geometry[state.selectedRoadIdx];
      paintLabel(geo, effectiveYOffset(state.selectedRoadIdx));
      return;
    }
    for (let r = 0; r < state.geometry.length; r++) paintLabel(state.geometry[r], state.geometry[r].yOffset);
  }

  function paintLabel(geo, yOffset) {
    ctx.fillStyle = "#444";
    ctx.font = "11px -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(`${geo.label}  (${geo.segCount} segments)`, MARGIN_LEFT, yOffset - 2);
  }

  // ------------------------------------------------------------------------
  // 6. Hover / hit-testing
  // ------------------------------------------------------------------------
  canvas.addEventListener("mousemove", onCanvasMouseMove);
  canvas.addEventListener("mouseleave", () => {
    if (state.hover) { state.hover = null; draw(); }
    tooltipEl.classList.add("hidden");
  });

  canvas.addEventListener("click", onCanvasClick);

  // Suppress the trailing `click` the browser fires after a brush drag: the
  // EvoLens brush is a left-button drag on this same canvas, and its release
  // synthesizes a click at the up-point. Without this guard a shift-drag brush
  // would spuriously toggle enforce-align (and a plain brush would fire paint).
  // We record the mousedown point and, if the pointer moved more than
  // CLICK_DRAG_SLOP_PX before the click, treat it as a drag and ignore the
  // click. mousedown and click both fire on `canvas`, so clientX/Y are
  // comparable (EvoLens's own mousedown only calls preventDefault, not
  // stopPropagation, so this listener still runs).
  const CLICK_DRAG_SLOP_PX = 5;
  let clickDownX = 0, clickDownY = 0;
  canvas.addEventListener("mousedown", (e) => {
    clickDownX = e.clientX;
    clickDownY = e.clientY;
  });

  // Resolve the point at (k, y) to its cohort and toggle enforce-align on it:
  // out-of-range / no-hit / singleton -> clearEnforce(); same cohort already
  // enforced -> clearEnforce() (toggle off); otherwise set state.enforcedAlign
  // and recomputeEnforce().
  function enforceAlignAtPoint(k, y) {
    // Click outside any column, or on empty space -> clear enforcement.
    if (k < 0 || k >= state.numWindows) return clearEnforce();
    const hit = nearestInSortedY(hitIndex[k], y, HOVER_HIT_PX);
    if (!hit) return clearEnforce();

    // Resolve the clicked segment to its cohort (session id) at window k.
    const struct = state.structures[hit.roadIdx];
    const cell = struct.segKMap[hit.segIdx].get(k);
    if (!cell || cell.s == null) return clearEnforce(); // singleton: no session

    const cur = state.enforcedAlign;
    const sameCohort =
      cur && cur.roadIdx === hit.roadIdx && cur.k === k && cur.s === cell.s;
    if (sameCohort) return clearEnforce(); // toggle off

    state.enforcedAlign = { roadIdx: hit.roadIdx, k, s: cell.s };
    recomputeEnforce();
  }

  function onCanvasClick(evt) {
    if (!hitIndex) return;
    // Ignore clicks that conclude a drag (brush): decouples brushing from
    // click / shift-click / paint. See CLICK_DRAG_SLOP_PX above.
    if (Math.hypot(evt.clientX - clickDownX, evt.clientY - clickDownY) > CLICK_DRAG_SLOP_PX) return;
    const rect = canvasWrap.getBoundingClientRect();
    const x = evt.clientX - rect.left + state.scrollLeft;
    const y = evt.clientY - rect.top + state.scrollTop;
    const k = Math.round((x - MARGIN_LEFT - state.colW / 2) / colPitch());

    // Shift-click enforce-aligns the clicked cohort on ANY page (including the
    // geo/distance page where the map is present and plain click is reserved for
    // brushing/paint). Takes precedence over the paint branch and mapMode no-op.
    if (evt.shiftKey) {
      enforceAlignAtPoint(k, y);
      return;
    }

    // Paper §6.3.1: when a palette swatch is armed, a click paints the clicked
    // session's entities instead of enforce-aligning.
    if (state.activePaintColor) {
      if (k < 0 || k >= state.numWindows) return;
      const hitP = nearestInSortedY(hitIndex[k], y, HOVER_HIT_PX);
      if (!hitP) return;
      applyPaintAt(hitP.roadIdx, hitP.segIdx, k);
      return;
    }

    // On the map (geo/distance) page, map selection comes from BRUSHING only, so
    // a plain canvas click does nothing. Pages without a map keep enforce-align.
    const mapMode = !!(window.StorylineMap && window.StorylineMap.showHulls);
    if (mapMode) return;

    enforceAlignAtPoint(k, y);
  }

  // --- Paper §6.3.1 click-to-color -----------------------------------------
  //
  // Paint (or erase) every entity comprised by the clicked session at window k.
  // Color is anchored to the entity id, so it persists across ALL windows the
  // entity appears in (never flips on cohort split/merge). No map on these
  // per-year geo pages, so paint is storyline-only.
  function applyPaintAt(roadIdx, segIdx, k) {
    const struct = state.structures[roadIdx];
    const cell = struct.segKMap[segIdx].get(k);
    if (!cell || cell.s == null) return; // singleton / no session: nothing to color
    const road = state.data.roads[roadIdx];
    const memberIds = [];
    for (let i = 0; i < road.segments.length; i++) {
      const c = struct.segKMap[i].get(k);
      if (c && c.s === cell.s) memberIds.push(road.segments[i].id);
    }
    if (!memberIds.length) return;

    const armed = state.activePaintColor;
    if (armed === "__erase__") {
      for (const id of memberIds) state.paint.delete(id);
      syncMapPaint();
    } else {
      for (const id of memberIds) state.paint.set(id, armed);
      if (window.StorylineMap && window.StorylineMap.paint) {
        window.StorylineMap.paint(memberIds.map(String), hexToRgbArray(armed));
      }
    }
    render();
  }

  // Rebuild the map's persistent paint from state.paint (no-op when no map).
  function syncMapPaint() {
    if (!(window.StorylineMap && window.StorylineMap.paint)) return;
    if (window.StorylineMap.clearPaint) window.StorylineMap.clearPaint();
    const byColor = new Map();
    for (const [id, hex] of state.paint) {
      let arr = byColor.get(hex);
      if (!arr) { arr = []; byColor.set(hex, arr); }
      arr.push(String(id));
    }
    for (const [hex, ids] of byColor) window.StorylineMap.paint(ids, hexToRgbArray(hex));
  }

  // Wire the paint palette toolbar (only present on geo pages via #paintPalette).
  function setupPaintPalette() {
    const palette = document.getElementById("paintPalette");
    const picker = document.getElementById("paintColor");
    if (!palette || !picker) return;
    const toggle = document.getElementById("paintToggle");
    let armed = false;
    function setArmed(on) {
      armed = on;
      state.activePaintColor = on ? picker.value : null;
      if (toggle) toggle.classList.toggle("active", on);
    }
    if (toggle) toggle.addEventListener("click", () => setArmed(!armed));
    function onPick() {
      if (armed) state.activePaintColor = picker.value; // live-update while armed
    }
    picker.addEventListener("input", onPick);
    picker.addEventListener("change", onPick);
    const eraser = document.getElementById("paintEraser");
    if (eraser) eraser.addEventListener("click", () => {
      armed = false;
      state.activePaintColor = "__erase__";
      if (toggle) toggle.classList.remove("active");
    });
    const clearBtn = document.getElementById("paintClear");
    if (clearBtn) clearBtn.addEventListener("click", () => {
      state.paint.clear();
      armed = false;
      state.activePaintColor = null;
      if (toggle) toggle.classList.remove("active");
      if (window.StorylineMap && window.StorylineMap.clearPaint) window.StorylineMap.clearPaint();
      if (state.data) render();
    });
  }
  setupPaintPalette();

  // --- Cohort-spread map selections (ported from storyline.js) --------------
  //
  // Each "selection" is one brushed cohort set, tracked across ALL windows
  // (per-year: each window k is a single year). A module-level `mapWindow`
  // selects which year's slice is rendered as segment-highlight groups on the
  // map. EvoLens brushing feeds selections in via __addMapSelectionFromGroups.
  const mapSelections = [];
  let mapWindow = 0;

  // Partition a selection's member segments by their cohort session id at each
  // window, producing sub-groups of section ids per window. Segments with no
  // data at a window are dropped; singletons (s == null) are pooled into one
  // neutral sub-group.
  function buildTimelineByWindow(memberSegs) {
    const byWindow = new Map();
    for (let k = 0; k < state.numWindows; k++) {
      const bySession = new Map();
      const singletons = [];
      for (const m of memberSegs) {
        const struct = state.structures[m.roadIdx];
        const cell = struct && struct.segKMap[m.segIdx].get(k);
        if (!cell) continue; // no data at this window
        if (cell.s == null) {
          singletons.push(m.id);
        } else {
          const key = m.roadIdx + ":" + cell.s;
          let g = bySession.get(key);
          if (!g) {
            g = { sectionIds: [], roadIdx: m.roadIdx, s: cell.s, v: cell.v };
            bySession.set(key, g);
          }
          g.sectionIds.push(m.id);
        }
      }
      const groups = [];
      for (const g of bySession.values()) groups.push(g);
      if (singletons.length) {
        groups.push({ sectionIds: singletons, roadIdx: null, s: null, v: null });
      }
      byWindow.set(k, groups);
    }
    return byWindow;
  }

  // Shared selection-commit path: build the per-window timeline, append the
  // selection, optionally jump the current window to `k`, and re-render.
  function commitMapSelection(memberSegs, k) {
    mapSelections.push({
      memberSegs,
      timelineByWindow: buildTimelineByWindow(memberSegs),
    });
    if (k != null) {
      mapWindow = Math.max(0, Math.min(state.numWindows - 1, k | 0));
      if (typeof window.__onMapWindowChange === "function") {
        window.__onMapWindowChange(mapWindow);
      }
    }
    refreshMapHulls();
  }

  // Rebuild the map's segment highlights for the current `mapWindow`. The group
  // color mirrors the USER'S PAINT (paint palette or Highlight-cohort menu): if
  // any of a sub-group's sections are painted, the group takes that paint hex;
  // otherwise it falls back to neutral UNAFF_GRAY. Painted sections are also
  // drawn on the map's paint layer in the same hex, so the two layers agree (no
  // conflict). The automatic CATEGORICAL cohort palette is intentionally unused.
  function refreshMapHulls() {
    if (!(window.StorylineMap && window.StorylineMap.showHulls)) return;
    const hullGroups = [];
    for (const sel of mapSelections) {
      const subGroups = sel.timelineByWindow.get(mapWindow) || [];
      for (const sg of subGroups) {
        const sectionIds = sg.sectionIds;
        if (!(sectionIds && sectionIds.length)) continue;
        let color = UNAFF_GRAY; // uncolored cohort: neutral hue
        for (const id of sectionIds) {
          const hex = state.paint.get(id);
          if (hex) { color = hex; break; } // painted cohort: use the paint color
        }
        hullGroups.push({ sectionIds, color });
      }
    }
    window.StorylineMap.showHulls(hullGroups);
  }

  // --- Bridge globals for the map's year slider ----------------------------
  window.__setMapWindow = function (k) {
    if (!state.numWindows) return;
    k = Math.max(0, Math.min(state.numWindows - 1, k | 0));
    mapWindow = k;
    refreshMapHulls();
  };
  window.__getMapWindow = function () { return mapWindow; };
  window.__getNumWindows = function () { return state.numWindows || 0; };
  window.__getWindowLabel = function (k) {
    const w = state.data && state.data.windows && state.data.windows[k];
    if (!w) return "";
    if (w.label) return w.label;
    if (w.start != null && w.end != null) return w.start + "–" + w.end;
    return String(k);
  };
  // Add a cohort-spread selection from EvoLens brushed segments. `groups` is
  // [{ roadIdx, segIdxList:[segIdx...] }, ...]. No-op unless the map is present.
  window.__addMapSelectionFromGroups = function (groups, kStart) {
    if (!(window.StorylineMap && window.StorylineMap.showHulls)) return;
    if (!Array.isArray(groups) || !groups.length) return;
    const memberSegs = [];
    for (const group of groups) {
      const roadIdx = group.roadIdx;
      const road = state.data.roads[roadIdx];
      if (!road) continue;
      for (const segIdx of group.segIdxList || []) {
        const seg = road.segments[segIdx];
        const id = seg && seg.id;
        if (id != null) memberSegs.push({ roadIdx, segIdx, id: String(id) });
      }
    }
    if (!memberSegs.length) return;
    commitMapSelection(memberSegs, kStart);
  };

  // Empty all cohort-spread selections and clear the blobs.
  window.__clearMapSelections = function () {
    mapSelections.length = 0;
    if (window.StorylineMap && window.StorylineMap.clearHulls) {
      window.StorylineMap.clearHulls();
    }
  };

  function clearEnforce() {
    if (!state.enforcedAlign) return;
    state.enforcedAlign = null;
    recomputeEnforce();
  }

  function recomputeEnforce() {
    buildAllStructures();
    buildGeometry();
    render();
  }

  function onCanvasMouseMove(evt) {
    if (!hitIndex) return;
    // The canvas element is pinned to the top-left of canvasWrap's CURRENTLY
    // VISIBLE viewport via a CSS transform of (scrollLeft, scrollTop), while
    // the content drawn inside its drawing buffer is placed at world
    // coordinates minus that same scroll offset (screen = world - scroll).
    // So a mouse position measured against canvasWrap's box is VIEWPORT-
    // relative, not world/content-space - it must be shifted back by the
    // current scroll offset (world = viewport + scroll) to compare against
    // hitIndex, which stores absolute world-space y (and colX(k), which is
    // absolute world-space x). Omitting this made hover match whatever
    // segment sits `scrollTop` px above the true world position under the
    // cursor - i.e. it highlighted lines "up there" whenever the page was
    // scrolled down at all.
    const rect = canvasWrap.getBoundingClientRect();
    const x = evt.clientX - rect.left + state.scrollLeft;
    const y = evt.clientY - rect.top + state.scrollTop;
    const k = Math.round((x - MARGIN_LEFT - state.colW / 2) / colPitch());
    if (k < 0 || k >= state.numWindows) {
      if (state.hover) { state.hover = null; draw(); }
      tooltipEl.classList.add("hidden");
      return;
    }
    const arr = hitIndex[k];
    const hit = nearestInSortedY(arr, y, HOVER_HIT_PX);

    if (!hit) {
      if (state.hover) { state.hover = null; draw(); }
      tooltipEl.classList.add("hidden");
      return;
    }
    if (!state.hover || state.hover.roadIdx !== hit.roadIdx || state.hover.segIdx !== hit.segIdx) {
      state.hover = { roadIdx: hit.roadIdx, segIdx: hit.segIdx };
      draw();
    }
    showTooltip(evt, hit.roadIdx, hit.segIdx);
  }

  function nearestInSortedY(arr, y, tol) {
    if (!arr || arr.length === 0) return null;
    let lo = 0, hi = arr.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid].y < y) lo = mid + 1; else hi = mid;
    }
    // check neighbors around lo for the closest within tolerance
    let best = null, bestDist = Infinity;
    for (let i = Math.max(0, lo - 2); i <= Math.min(arr.length - 1, lo + 2); i++) {
      const d = Math.abs(arr[i].y - y);
      if (d < bestDist) { bestDist = d; best = arr[i]; }
    }
    return bestDist <= tol ? best : null;
  }

  function showTooltip(evt, roadIdx, segIdx) {
    const road = state.data.roads[roadIdx];
    const seg = road.segments[segIdx];
    const winCount = (seg.win || []).length;
    tooltipEl.innerHTML =
      `<b>${escapeHtml(seg.id)}</b><br>` +
      `Highway: ${escapeHtml(seg.roadbed || "")}<br>` +
      `County: ${escapeHtml(seg.county || road.roadbed || "")}<br>` +
      `Marker: ${seg.marker}<br>` +
      `Windows present: ${winCount}`;
    tooltipEl.classList.remove("hidden");
    const pad = 14;
    let left = evt.clientX + pad;
    let top = evt.clientY + pad;
    const tw = tooltipEl.offsetWidth, th = tooltipEl.offsetHeight;
    if (left + tw > window.innerWidth) left = evt.clientX - tw - pad;
    if (top + th > window.innerHeight) top = evt.clientY - th - pad;
    tooltipEl.style.left = left + "px";
    tooltipEl.style.top = top + "px";
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  // ------------------------------------------------------------------------
  // 7. Controls
  // ------------------------------------------------------------------------
  function populateRoadDropdown() {
    renderDropdown("");
  }

  function renderDropdown(filterText) {
    const roads = state.data.roads;
    const ft = filterText.trim().toLowerCase();
    roadDropdownEl.innerHTML = "";

    const allItem = document.createElement("div");
    allItem.className = "dropdown-item";
    allItem.textContent = "All roads";
    allItem.addEventListener("click", () => selectRoad(-1));
    roadDropdownEl.appendChild(allItem);

    let shown = 0;
    for (let i = 0; i < roads.length && shown < 200; i++) {
      const name = roads[i].roadbed;
      if (ft && name.toLowerCase().indexOf(ft) === -1) continue;
      const item = document.createElement("div");
      item.className = "dropdown-item";
      item.textContent = `${name} (${roads[i].segments.length})`;
      item.addEventListener("click", () => selectRoad(i));
      roadDropdownEl.appendChild(item);
      shown++;
    }
  }

  function selectRoad(idx) {
    state.selectedRoadIdx = idx;
    roadSearchEl.value = idx === -1 ? "" : state.data.roads[idx].roadbed;
    roadDropdownEl.classList.add("hidden");
    state.hover = null;
    render();
  }

  roadSearchEl.addEventListener("input", () => {
    if (roadSearchEl.value.trim() === "" && state.selectedRoadIdx !== -1) {
      state.selectedRoadIdx = -1;
      state.hover = null;
      render();
    }
    renderDropdown(roadSearchEl.value);
    roadDropdownEl.classList.remove("hidden");
  });
  roadSearchEl.addEventListener("focus", () => {
    renderDropdown(roadSearchEl.value);
    roadDropdownEl.classList.remove("hidden");
  });
  document.addEventListener("click", (e) => {
    if (!roadDropdownEl.contains(e.target) && e.target !== roadSearchEl) {
      roadDropdownEl.classList.add("hidden");
    }
  });

  // Floating color legend. Only "condition" (gradient) and "pavtype" (fixed
  // categories) have a meaningful legend; "cohort"/"highway" use arbitrary
  // per-track hues, so the panel is hidden there.
  function updateColorLegend() {
    const mode = state.colorMode;
    if (mode === "condition") {
      const rows = [
        ["rgb(21,128,61)", "Very Good"],
        ["rgb(34,197,94)", "Good"],
        ["rgb(234,179,8)", "Fair"],
        ["rgb(249,115,22)", "Poor"],
        ["rgb(239,68,68)", "Very Poor"],
        ["rgb(200,200,200)", "Invalid"],
        ["#999999", "No data"],
      ];
      colorLegendEl.innerHTML = rows.map(([color, label]) =>
        `<div class="legend-swatch-row"><span class="legend-swatch" style="background:${color}"></span>${label}</div>`
      ).join("");
      colorLegendEl.classList.remove("hidden");
    } else if (mode === "pavtype") {
      const rows = [
        ["A - ASPHALTIC CONCRETE PAVEMENT (ACP)", "Asphalt (ACP)"],
        ["C - CONTINUOUSLY REINFORCED CONCRETE PAVEMENT (CRCP)", "Concrete, continuous (CRCP)"],
        ["J - JOINTED CONCRETE PAVEMENT (JCP)", "Concrete, jointed (JCP)"],
      ];
      let html = rows.map(([key, label]) =>
        `<div class="legend-swatch-row"><span class="legend-swatch" style="background:${PAVTYPE_COLORS[key]}"></span>${label}</div>`
      ).join("");
      html += `<div class="legend-swatch-row"><span class="legend-swatch" style="background:${UNAFF_GRAY}"></span>Unknown</div>`;
      colorLegendEl.innerHTML = html;
      colorLegendEl.classList.remove("hidden");
    } else {
      colorLegendEl.classList.add("hidden");
    }
  }

  colorModeEl.addEventListener("change", () => {
    const oldMode = state.colorMode;
    const newMode = colorModeEl.value;
    state.colorMode = newMode;
    updateColorLegend();
    // Highway mode changes segment ordering within groups, so structures must
    // be rebuilt when toggling into or out of it; other mode switches only
    // affect baked-in vertex colors.
    if ((oldMode === "highway") !== (newMode === "highway") && state.data) {
      buildAllStructures();
      buildGeometry();
      render();
    } else {
      if (glRenderer) rebuildGLGeometry(); // colors baked into GL vertex buffer
      draw();
    }
  });

  function bindSlider(el, outId, key, isInt) {
    const out = document.getElementById(outId);
    el.addEventListener("input", () => {
      const val = isInt ? parseInt(el.value, 10) : parseFloat(el.value);
      state[key] = val;
      out.textContent = val;
    });
    el.addEventListener("change", () => {
      if (key === "rowPx" || key === "laneGap" || key === "roadGap") {
        buildGeometry();
      }
      if (!state.data) return;
      render();
      buildAxis();
    });
  }
  bindSlider(rowPxEl, "rowPxOut", "rowPx", true);
  bindSlider(laneGapEl, "laneGapOut", "laneGap", true);
  bindSlider(roadGapEl, "roadGapOut", "roadGap", true);
  bindSlider(colWEl, "colWOut", "colW", true);
  bindSlider(colGapEl, "colGapOut", "colGap", true);

  // Session-filter (ths) slider: only active on geo pages that opt in via
  // window.STORYLINE_BROWSER_FILTER and that actually include the #ths control.
  // Changing ths re-runs the structure build (which does the filtering), so we
  // rebuild structures -> geometry -> render, mirroring recomputeEnforce().
  const thsEl = document.getElementById("ths");
  if (thsEl && window.STORYLINE_BROWSER_FILTER) {
    const thsOut = document.getElementById("thsOut");
    thsEl.addEventListener("input", () => {
      state.ths = Math.max(1, parseInt(thsEl.value, 10) || 1);
      if (thsOut) thsOut.textContent = state.ths;
      if (!state.data) return;
      buildAllStructures();
      buildGeometry();
      render();
    });
  }

  window.addEventListener("resize", () => {
    if (state.data) render();
  });

  // Scrolling canvasWrap just re-syncs the pinned canvas position and
  // redraws translated content - no need to rebuild the points cache or
  // hit index, so this stays cheap even for the huge "All roads" extent.
  canvasWrap.addEventListener("scroll", () => {
    if (!state.data) return;
    syncCanvasToScroll();
    draw();
  });

  // ------------------------------------------------------------------------
  // EvoLens hook: expose the minimal read-only surface evolens.js needs to
  // brush-select segments and draw a selection overlay, without touching
  // the layout/rendering internals above. See evolens.js for the feature.
  // ------------------------------------------------------------------------

  // Enforce-align the cohort that the given section ids belong to at window k.
  // Mirrors onCanvasClick's resolution: find the FIRST id that maps to a
  // non-null cohort cell at k, set state.enforcedAlign, and rebuild via the
  // private recomputeEnforce() (structures -> geometry -> render). Returns true
  // if a cohort was enforced (and rendered), false otherwise (and clears).
  function enforceCohortByIds(k, ids) {
    if (!state.data || !Array.isArray(ids) || k == null) { clearEnforce(); return false; }
    const idIndex = new Map();
    for (let r = 0; r < state.data.roads.length; r++) {
      const segs = state.data.roads[r].segments;
      for (let i = 0; i < segs.length; i++) idIndex.set(String(segs[i].id), { roadIdx: r, segIdx: i });
    }
    for (const id of ids) {
      const loc = idIndex.get(String(id));
      if (!loc) continue;
      const struct = state.structures[loc.roadIdx];
      const cell = struct && struct.segKMap[loc.segIdx].get(k);
      if (cell && cell.s != null) {
        state.enforcedAlign = { roadIdx: loc.roadIdx, k, s: cell.s };
        recomputeEnforce();
        return true;
      }
    }
    clearEnforce();
    return false;
  }

  window.__storyline = {
    state,
    enforceCohort: enforceCohortByIds,
    clearEnforceAlign: () => { if (state.data) clearEnforce(); },
    canvas,
    canvasWrap,
    colX,
    colPitch,
    MARGIN_LEFT,
    visibleRoadIndices,
    getPointsCache: () => pointsCache,
    redraw: draw,
  };
})();
