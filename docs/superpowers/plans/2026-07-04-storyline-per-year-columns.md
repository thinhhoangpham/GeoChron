# Storyline Per-Year Columns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second, parallel Storyline view where each column is a single calendar year (not a 5-year window range), with each year's correlation/cohort membership taken from the existing centered 5-year window whose middle year it is, and each year's condition color taken from that segment's own raw score in that year.

**Architecture:** A new data script (`step17_storyline_peryear.py`) reuses the existing `windows_W5.json` / `step11_sessions_W5_{RULE}.json` outputs unchanged, relabeling each window to its middle year and emitting output in the exact same wire schema as `storyline_data_{RULE}.json` (so no schema-translation code is needed downstream). A new front-end (`storyline_peryear.js`, copied from `storyline.js`) renders it, with three targeted edits so condition coloring uses the categorical PMIS palette instead of the continuous RdYlGn scale. Two new HTML pages (`storyline_peryear.html`, `storyline_peryear_county.html`) mirror `index.html`/`index_county.html`, including the EvoLens (`evolens.js`) drill-down. Nothing in the existing pipeline is modified.

**Tech Stack:** Python 3 + numpy (data script), vanilla ES2017+ JS + D3 (color scales only) + Canvas2D/WebGL (front-end), `unittest` (Python tests, subprocess-based integration style matching `tests/test_storyline_yv.py`).

## Global Constraints

- Do not modify `step17_storyline_data.py`, `storyline.js`, `index.html`, `index_county.html`, `windows_W5.json`, `step6_corr.py`, `step8_network.py`, `step10_communities.py`, `step11_filter.py`, `heatmap.js`, or `evolens.js`. This feature is purely additive.
- Output wire schema for the new data files must exactly match `storyline_data_{RULE}.json`'s field names (`windows`: `{k, start, end, label}`; segment `win` entries: `{k, s, v}`) — no `"years"`/`"year"` naming, no `"yv"` field.
- Every window entry in the new output has `start === end === label` (as an int for `start`/`end`, `str(...)` for `label`) — the middle year of the original 5-year window.
- `k` in the new output is the same 0-based index `windows_W5.json` already uses (its windows are already sorted ascending by `start`, so the original index doubles as the contiguous per-year column index — no remapping needed).
- Both proximity rules (`hwcounty`, `county`) must be supported via the same CLI convention as `step17_storyline_data.py`: `python step17_storyline_peryear.py [county|hwcounty]` (default `hwcounty`).
- Condition-mode coloring (bars, connectors, legend) in the new front-end must use the categorical PMIS palette (`pmisCategoryColor`), not the continuous `conditionColor`/RdYlGn scale.

---

## Task 1: Per-year data script + test

**Files:**
- Create: `step17_storyline_peryear.py`
- Create: `tests/test_storyline_peryear.py`

**Interfaces:**
- Consumes: `windows_W5.json`, `step11_sessions_W5_{RULE}.json`, `section_year_matrix.csv`, `sections_meta.csv` (all pre-existing, unchanged).
- Produces: `storyline_data_peryear_hwcounty.json`, `storyline_data_peryear_county.json`, each shaped `{"windows": [{"k","start","end","label"}], "roads": [{"roadbed","segments": [{"id","marker","begin","end","roadbed","county","pavtype","win": [{"k","s","v"}]}]}]}`. Task 3/4 (front-end) consume these two files by name.

- [ ] **Step 1: Write the failing test**

Create `tests/test_storyline_peryear.py`:

```python
"""Integration test: the per-year storyline generator relabels each of
windows_W5.json's centered 5-year windows to its middle year, assigns each
segment its OWN raw score at that year (not the window mean), and matches
the exact wire schema storyline_peryear.js/evolens.js expect (no "yv",
start == end == label == the middle year)."""
import csv, json, os, subprocess, sys, unittest
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def regenerate(rule):
    subprocess.run([sys.executable, "step17_storyline_peryear.py", rule],
                    cwd=ROOT, check=True)
    with open(os.path.join(ROOT, f"storyline_data_peryear_{rule}.json"), encoding="utf-8") as f:
        return json.load(f)


def load_windows_w5():
    with open(os.path.join(ROOT, "windows_W5.json"), encoding="utf-8") as f:
        return json.load(f)


def load_matrix():
    with open(os.path.join(ROOT, "section_year_matrix.csv"), encoding="utf-8") as f:
        r = csv.reader(f)
        header = next(r)
        years = [int(y) for y in header[1:]]
        sections, rows = [], []
        for row in r:
            sections.append(row[0])
            rows.append([float(v) if v != "" else float("nan") for v in row[1:]])
    return sections, years, rows


class TestPerYear(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = regenerate("hwcounty")
        cls.win5 = load_windows_w5()
        cls.sections, cls.years, cls.rows = load_matrix()
        cls.yidx = {y: i for i, y in enumerate(cls.years)}
        cls.pos = {s: i for i, s in enumerate(cls.sections)}

    def test_windows_relabeled_to_middle_year_start_eq_end(self):
        w5 = self.win5["windows"]
        self.assertEqual(len(self.data["windows"]), len(w5))
        for k, w in enumerate(self.data["windows"]):
            expected_year = w5[k]["start"] + 2
            self.assertEqual(w["k"], k)
            self.assertEqual(w["start"], expected_year)
            self.assertEqual(w["end"], expected_year)
            self.assertEqual(w["label"], str(expected_year))

    def test_edge_years_never_appear(self):
        middle_years = {w["end"] for w in self.data["windows"]}
        self.assertNotIn(self.years[0], middle_years)
        self.assertNotIn(self.years[1], middle_years)
        self.assertNotIn(self.years[-1], middle_years)
        self.assertNotIn(self.years[-2], middle_years)

    def test_v_matches_segment_own_year_value_not_window_mean(self):
        checked = 0
        for road in self.data["roads"]:
            for seg in road["segments"]:
                p = self.pos.get(seg["id"])
                if p is None:
                    continue
                for w in seg["win"]:
                    year = self.data["windows"][w["k"]]["end"]
                    raw = self.rows[p][self.yidx[year]]
                    if np.isnan(raw):
                        self.assertIsNone(w["v"])
                    else:
                        self.assertAlmostEqual(w["v"], round(raw, 1), places=1)
                    checked += 1
        self.assertGreater(checked, 0)

    def test_no_yv_field_present(self):
        checked = 0
        for road in self.data["roads"]:
            for seg in road["segments"]:
                for w in seg["win"]:
                    self.assertNotIn("yv", w)
                    checked += 1
        self.assertGreater(checked, 0)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_storyline_peryear.py -v` (from repo root)
Expected: `FileNotFoundError` / `subprocess` failure — `step17_storyline_peryear.py` does not exist yet.

- [ ] **Step 3: Write the data script**

Create `step17_storyline_peryear.py`:

```python
"""
Step 17 (per-year variant): Data export for the paper-faithful per-year Storyline.

Same inputs and eligibility/cohort logic as step17_storyline_data.py -- reuses
windows_W5.json's centered 5-year windows (window k spans years[k]..years[k+4]) and
step11_sessions_W5_{RULE}.json's filtered cohorts UNCHANGED -- but relabels each
window's result to its middle year (paper Step 2: a wrapping window's correlation is
assigned back to its one focus time slice), producing one column per YEAR instead of
one column per WINDOW.

Output wire schema intentionally matches storyline_data_{RULE}.json's shape exactly
(same "windows"/"roads"/"segments"/"win" field names, no "yv") so storyline_peryear.js
and evolens.js can reuse storyline.js's logic without any schema translation:
  "windows": [{"k", "start", "end", "label"}]   # start == end == middle year
  "roads": [{"roadbed", "segments": [{"id","marker","roadbed","county","pavtype",
                                       "begin","end","win": [{"k","s","v"}]}]}]
  - "k" is windows_W5.json's own window index (already a contiguous 0-based index
    over the sorted middle years, since windows_W5.json's windows are sorted
    ascending by start).
  - "v" is the segment's OWN raw score AT that middle year (None if unobserved that
    year), NOT the window mean step17_storyline_data.py's wscore() computes.
  - Edge years (the first/last 2 years of section_year_matrix.csv) never appear as a
    middle year of any window and are therefore absent -- no special-casing needed.

Usage: python step17_storyline_peryear.py [county|hwcounty]  (default: hwcounty)
"""
import csv, json, collections, re, sys
import numpy as np

RULE = sys.argv[1] if len(sys.argv) > 1 else "hwcounty"
assert RULE in ("county", "hwcounty")

SEGMENT_LENGTH_MI = 0.5

def clean_and_round(value):
    cleaned = re.sub(r"[^0-9.]", "", value or "")
    if cleaned in ("", "."):
        return 0.0
    return round(float(cleaned), 3)

r = csv.reader(open("section_year_matrix.csv", encoding="utf-8"))
next(r); SCORES, sections = [], []
for row in r:
    sections.append(row[0])
    SCORES.append([float(v) if v != "" else np.nan for v in row[1:]])
SCORES = np.array(SCORES, dtype=np.float32)

win = json.load(open("windows_W5.json", encoding="utf-8"))
years = win["years"]; yidx = {y: i for i, y in enumerate(years)}
pos = {s: i for i, s in enumerate(sections)}
win_meta = win["windows"]

# windows_W5.json's windows are already sorted ascending by start, so window k's
# own index already IS the contiguous per-year column index we need.
middle_years = [w["start"] + 2 for w in win_meta]
assert middle_years == sorted(middle_years) and len(set(middle_years)) == len(middle_years)

def year_score(seg, year):
    v = SCORES[seg, yidx[year]]
    return round(float(v), 1) if np.isfinite(v) else None

roadbed = {}; county = {}; marker = {}; begin_pos = {}; pavtype = {}
for row in csv.DictReader(open("sections_meta.csv", encoding="utf-8")):
    p = pos.get(row["section_id"])
    if p is not None:
        roadbed[p] = row["roadbed"]; county[p] = row["county"]
        pavtype[p] = row["pavtype"]
        bm = clean_and_round(row["begin_marker"])
        bd = clean_and_round(row["begin_disp"])
        marker[p] = bm
        begin_pos[p] = bm + bd

# step11_sessions_W5_<rule>.json gives the KEPT cohort id (s) for segments that
# survived filtering; build seg -> {k: s} for fast lookup (k = windows_W5.json index).
sess = json.load(open(f"step11_sessions_W5_{RULE}.json"))["windows"]; sess.sort(key=lambda w: w["k"])
seg_session = collections.defaultdict(dict)  # seg -> {k: s}
for k, w in enumerate(sess):
    for s, members in enumerate(w["sessions"]):
        for m in members:
            seg_session[m][k] = s

# windows_W5.json's section_idx per window = Step-4 eligibility (>=MIN_OBS real
# observations). Build seg -> sorted list of eligible window indices.
seg_eligible = collections.defaultdict(list)
for k, w in enumerate(win_meta):
    for m in w["section_idx"]:
        seg_eligible[m].append(k)

# per segment: one entry per eligible window, keyed by that window's OWN index k
# (== the per-year column index), s = kept session id or None, v = the segment's
# own raw score at that window's middle year.
seg_win = {}
for m, ks in seg_eligible.items():
    seg_win[m] = [{"k": k, "s": seg_session[m].get(k), "v": year_score(m, middle_years[k])}
                  for k in ks]

roads = collections.defaultdict(list)
if RULE == "county":
    sort_key = lambda m: (roadbed.get(m, "?"), marker.get(m, 0))
    band_key = lambda m: county.get(m, "?")
else:
    sort_key = lambda m: marker.get(m, 0)
    band_key = lambda m: (roadbed.get(m, "?"), county.get(m, "?"))

for m in sorted(seg_win, key=sort_key):
    b = begin_pos.get(m, 0.0)
    roads[band_key(m)].append({
        "id": sections[m], "marker": marker.get(m, 0.0),
        "begin": b, "end": b + SEGMENT_LENGTH_MI,
        "roadbed": roadbed.get(m, ""), "county": county.get(m, ""),
        "pavtype": pavtype.get(m, ""),
        "win": seg_win[m]})

if RULE == "county":
    road_entries = [{"roadbed": cty, "segments": segs}
                    for cty, segs in sorted(roads.items(), key=lambda kv: -len(kv[1]))]
else:
    road_entries = [{"roadbed": f"{rb} · {cty}", "segments": segs}
                    for (rb, cty), segs in sorted(roads.items(), key=lambda kv: -len(kv[1]))]

out = {
    "windows": [{"k": k, "start": y, "end": y, "label": str(y)} for k, y in enumerate(middle_years)],
    "roads": road_entries,
}
out_file = f"storyline_data_peryear_{RULE}.json"
json.dump(out, open(out_file, "w"))
n_single = sum(1 for _, segs in roads.items() if len(segs) == 1)
print(f"[peryear/{RULE}] years: {middle_years[0]}-{middle_years[-1]} ({len(middle_years)})   "
      f"roads: {len(out['roads'])}   segments: {sum(len(r['segments']) for r in out['roads']):,}")
print(f"single-segment bands: {n_single}")
print(f"wrote {out_file}")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_storyline_peryear.py -v`
Expected: 4 tests PASS (`test_windows_relabeled_to_middle_year_start_eq_end`, `test_edge_years_never_appear`, `test_v_matches_segment_own_year_value_not_window_mean`, `test_no_yv_field_present`).

- [ ] **Step 5: Generate the county-rule output too (test only regenerates hwcounty)**

Run: `python step17_storyline_peryear.py county`
Expected: prints `[peryear/county] ...` summary and writes `storyline_data_peryear_county.json`.

- [ ] **Step 6: Commit**

```bash
git add step17_storyline_peryear.py tests/test_storyline_peryear.py storyline_data_peryear_hwcounty.json storyline_data_peryear_county.json
git commit -m "feat(data): emit per-year storyline data (window correlation assigned to middle year)"
```

---

## Task 2: Front-end renderer — `storyline_peryear.js`

**Files:**
- Create: `storyline_peryear.js` (copied from `storyline.js`, then edited)

**Interfaces:**
- Consumes: `storyline_data_peryear_{hwcounty,county}.json` (Task 1's output; via `window.STORYLINE_DATA_FILE`, same convention as `storyline.js`).
- Produces: `window.__storyline` (same shape `storyline.js` exposes: `state`, `canvas`, `colX`, `colPitch`, `MARGIN_LEFT`, `visibleRoadIndices`, `getPointsCache`, `redraw`) for `evolens.js` to consume in Task 3. Reads/writes the same DOM element IDs `storyline.js` does (`storylineCanvas`, `storylineGLCanvas`, `axis`, `axisInner`, `tooltip`, `status`, `roadSearch`, `roadDropdown`, `colorMode`, `colorLegend`, `rowPx`, `laneGap`, `roadGap`, `colW`, `colGap`) — Task 4's HTML must provide all of them.

- [ ] **Step 1: Copy the file**

```bash
cp storyline.js storyline_peryear.js
```

- [ ] **Step 2: Change the default data-file fallback**

In `storyline_peryear.js`, find (originally around line 483):

```javascript
  const DATA_FILE = window.STORYLINE_DATA_FILE || "storyline_data_hwcounty.json";
```

Replace with:

```javascript
  const DATA_FILE = window.STORYLINE_DATA_FILE || "storyline_data_peryear_hwcounty.json";
```

- [ ] **Step 3: Switch the flat-bar condition color to the categorical PMIS palette**

In `storyline_peryear.js`, this exact line appears twice (in `rebuildGLGeometry` and in `appendLines`, originally around lines 1169 and 1234):

```javascript
            const color = state.colorMode === "cohort" ? cohortColor(p.trackId, p.v) : state.colorMode === "highway" ? highwayColor(p.roadbed, p.v) : state.colorMode === "pavtype" ? pavTypeColor(p.pavtype, p.v) : conditionColor(p.v);
```

Using an editor/tool that supports "replace all occurrences of this exact string in the file", replace `conditionColor(p.v)` with `pmisCategoryColor(p.v)` everywhere it appears in `storyline_peryear.js` (this hits exactly 3 places: the two lines above, plus the identical ternary inside `drawHighlighted`, originally around line 1294, where the surrounding statement is `ctx.strokeStyle = state.colorMode === "cohort" ? ... : conditionColor(p.v);`). Do not touch the `conditionColor` function definition itself (originally around line 143) — only the call sites.

- [ ] **Step 4: Switch the connector color to the categorical PMIS palette**

In `storyline_peryear.js`, find (inside `edgeColor`, originally around line 1260):

```javascript
    return conditionColor(v);
```

Replace with:

```javascript
    return pmisCategoryColor(v);
```

(This is a unique line in the file — the `edgeColor` function's default branch — so a normal single-occurrence find/replace is sufficient here, no "replace all" needed.)

- [ ] **Step 5: Switch the condition-mode legend to discrete PMIS swatches**

In `storyline_peryear.js`, find (inside `updateColorLegend`, originally around lines 1486-1491):

```javascript
    if (mode === "condition") {
      const stops = [0, 25, 50, 75, 100].map((v) => conditionColor(v));
      colorLegendEl.innerHTML =
        `<div class="legend-gradient-bar" style="background:linear-gradient(to right,${stops.join(",")})"></div>` +
        `<div class="legend-gradient-labels"><span>Poor</span><span>Good</span></div>`;
      colorLegendEl.classList.remove("hidden");
    } else if (mode === "pavtype") {
```

Replace with:

```javascript
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
```

(Reuses the `legend-swatch-row`/`legend-swatch` CSS classes already defined in `storyline.css` for the `pavtype` branch immediately below — no CSS changes needed.)

- [ ] **Step 6: Verify no remaining unwanted `conditionColor` call sites**

Run: `grep -n "conditionColor(" storyline_peryear.js`
Expected output: exactly 2 lines — the `function conditionColor(v) {` definition, and nothing else calling it (all former call sites now say `pmisCategoryColor`). If any call site other than the definition still says `conditionColor(`, repeat Step 3 or 4 for that line.

- [ ] **Step 7: Commit**

```bash
git add storyline_peryear.js
git commit -m "feat(storyline): add per-year renderer with categorical PMIS condition coloring"
```

---

## Task 3: New HTML pages

**Files:**
- Create: `storyline_peryear.html`
- Create: `storyline_peryear_county.html`

**Interfaces:**
- Consumes: `storyline_peryear.js` (Task 2), `heatmap.js`, `evolens.js` (both unmodified, existing), `storyline.css` (unmodified, existing), `storyline_data_peryear_hwcounty.json` / `storyline_data_peryear_county.json` (Task 1).
- Produces: two browsable pages, no other code depends on these.

- [ ] **Step 1: Create `storyline_peryear.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Storyline Visualization — per-year, by highway + county</title>
<link rel="stylesheet" href="storyline.css">
<script src="https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"></script>
<script>window.STORYLINE_DATA_FILE = "storyline_data_peryear_hwcounty.json";</script>
</head>
<body>
  <header id="toolbar">
    <div class="toolbar-row">
      <div class="ctl">
        <span>Dataset</span>
        <div style="font-size:13px; padding:4px 0;">
          Per-year, by highway + county — <a href="storyline_peryear_county.html">compare: by county only</a>
          · <a href="index.html">compare: window-range view</a>
        </div>
      </div>
      <label class="ctl">
        <span>Road</span>
        <input id="roadSearch" type="text" placeholder="Type to filter... (All roads)" autocomplete="off">
        <div id="roadDropdown" class="dropdown hidden"></div>
      </label>

      <label class="ctl">
        <span>Color mode</span>
        <select id="colorMode">
          <option value="condition" selected>Condition (PMIS categories)</option>
          <option value="cohort">Cohort hue</option>
          <option value="pavtype">Pavement type</option>
        </select>
      </label>
    </div>

    <div class="toolbar-row sliders">
      <label class="ctl slider">
        <span>Row height <output id="rowPxOut">4</output>px</span>
        <input id="rowPx" type="range" min="1" max="16" step="1" value="4">
      </label>
      <label class="ctl slider">
        <span>Lane gap <output id="laneGapOut">48</output>px</span>
        <input id="laneGap" type="range" min="0" max="160" step="2" value="48">
      </label>
      <label class="ctl slider">
        <span>Road gap <output id="roadGapOut">28</output>px</span>
        <input id="roadGap" type="range" min="0" max="120" step="2" value="28">
      </label>
      <label class="ctl slider">
        <span>Column width <output id="colWOut">62</output>px</span>
        <input id="colW" type="range" min="20" max="160" step="2" value="62">
      </label>
      <label class="ctl slider">
        <span>Year gap <output id="colGapOut">24</output>px</span>
        <input id="colGap" type="range" min="0" max="160" step="2" value="24">
      </label>
    </div>
    <div id="status" class="status">Loading storyline_data_peryear_hwcounty.json...</div>
  </header>

  <div id="scrollArea">
    <div id="axis"><div id="axisInner"></div></div>
    <div id="canvasWrap">
      <div id="canvasSpacer"></div>
      <canvas id="storylineGLCanvas"></canvas>
      <canvas id="storylineCanvas"></canvas>
    </div>
  </div>

  <div id="tooltip" class="hidden"></div>
  <div id="colorLegend" class="hidden"></div>

  <script src="storyline_peryear.js"></script>
  <script src="heatmap.js"></script>
  <script src="evolens.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `storyline_peryear_county.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Storyline Visualization — per-year, by county only</title>
<link rel="stylesheet" href="storyline.css">
<script src="https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"></script>
<script>window.STORYLINE_DATA_FILE = "storyline_data_peryear_county.json";</script>
</head>
<body>
  <header id="toolbar">
    <div class="toolbar-row">
      <div class="ctl">
        <span>Dataset</span>
        <div style="font-size:13px; padding:4px 0;">
          Per-year, by county only — <a href="storyline_peryear.html">compare: by highway + county</a>
          · <a href="index_county.html">compare: window-range view</a>
        </div>
      </div>
      <label class="ctl">
        <span>Road</span>
        <input id="roadSearch" type="text" placeholder="Type to filter... (All roads)" autocomplete="off">
        <div id="roadDropdown" class="dropdown hidden"></div>
      </label>

      <label class="ctl">
        <span>Color mode</span>
        <select id="colorMode">
          <option value="condition" selected>Condition (PMIS categories)</option>
          <option value="cohort">Cohort hue</option>
          <option value="highway">Highway hue</option>
          <option value="pavtype">Pavement type</option>
        </select>
      </label>
    </div>

    <div class="toolbar-row sliders">
      <label class="ctl slider">
        <span>Row height <output id="rowPxOut">4</output>px</span>
        <input id="rowPx" type="range" min="1" max="16" step="1" value="4">
      </label>
      <label class="ctl slider">
        <span>Lane gap <output id="laneGapOut">48</output>px</span>
        <input id="laneGap" type="range" min="0" max="160" step="2" value="48">
      </label>
      <label class="ctl slider">
        <span>Road gap <output id="roadGapOut">28</output>px</span>
        <input id="roadGap" type="range" min="0" max="120" step="2" value="28">
      </label>
      <label class="ctl slider">
        <span>Column width <output id="colWOut">62</output>px</span>
        <input id="colW" type="range" min="20" max="160" step="2" value="62">
      </label>
      <label class="ctl slider">
        <span>Year gap <output id="colGapOut">24</output>px</span>
        <input id="colGap" type="range" min="0" max="160" step="2" value="24">
      </label>
    </div>
    <div id="status" class="status">Loading storyline_data_peryear_county.json...</div>
  </header>

  <div id="scrollArea">
    <div id="axis"><div id="axisInner"></div></div>
    <div id="canvasWrap">
      <div id="canvasSpacer"></div>
      <canvas id="storylineGLCanvas"></canvas>
      <canvas id="storylineCanvas"></canvas>
    </div>
  </div>

  <div id="tooltip" class="hidden"></div>
  <div id="colorLegend" class="hidden"></div>

  <script src="storyline_peryear.js"></script>
  <script src="heatmap.js"></script>
  <script src="evolens.js"></script>
</body>
</html>
```

- [ ] **Step 3: Commit**

```bash
git add storyline_peryear.html storyline_peryear_county.html
git commit -m "feat(storyline): add per-year HTML pages (hwcounty + county rule)"
```

---

## Task 4: Manual verification

**Files:** none created — this task only runs and inspects the artifacts from Tasks 1-3.

- [ ] **Step 1: Run the full Python test suite to confirm nothing else broke**

Run: `python -m pytest tests/ -v`
Expected: all tests pass, including the 4 new ones from Task 1 and the pre-existing ones (`test_storyline_yv.py`, `test_unit_series.py`, `test_unit_sessions.py`, `test_unit_storyline_data.py`).

- [ ] **Step 2: Start a local static server**

Run (from repo root): `python -m http.server 3000`

- [ ] **Step 3: Load and visually check `storyline_peryear.html`**

Open `http://localhost:3000/storyline_peryear.html` in a browser.
Expected:
- Status line shows a road/segment count with no fetch errors; browser console has no errors.
- Axis labels along the top are single 4-digit years (e.g. `1998`, `1999`, ...), not `start-end` ranges.
- Bars are colored in one of the 5 PMIS category colors (or grey for no-data), matching `heatmap.js`'s categorical view — not a smooth red-to-green gradient.
- The color legend (Condition mode) shows 7 discrete swatch rows (Very Good/Good/Fair/Poor/Very Poor/Invalid/No data), not a gradient bar.
- Road search, color-mode dropdown, and the 5 sliders all work as in `index.html`.
- Brushing a rectangle (EvoLens) on a single selected road opens the drill-down panel without console errors.

- [ ] **Step 4: Load and visually check `storyline_peryear_county.html`**

Open `http://localhost:3000/storyline_peryear_county.html` in a browser.
Expected: same checks as Step 3, plus the "Highway hue" color mode option is present and works, matching `index_county.html`'s feature set.

- [ ] **Step 5: Confirm the existing pages are untouched**

Open `http://localhost:3000/index.html` and `http://localhost:3000/index_county.html`.
Expected: both still show `start-end` range axis labels and the continuous RdYlGn condition gradient exactly as before — no regressions.

- [ ] **Step 6: Commit (only if Steps 1-5 surfaced fixes; otherwise nothing to commit)**

If any fixes were needed during verification, commit them individually with a message describing the specific fix. If verification passed cleanly with no changes, skip this step — there is nothing to commit.
