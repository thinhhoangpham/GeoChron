# Unit-Level Evolution Pattern (Distribution-Aware) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a separate storyline page whose actors are highway-county units (not segments), where each unit is summarized per year by a distribution-aware **Level** and **Spread**, grouped by two independent correlations combined with AND, and rendered through the existing `storyline.js`.

**Architecture:** Three new Python scripts build the data (per-unit yearly series → unit grouping pipeline → storyline JSON), reusing the existing Step 6–11 logic (pairwise Pearson per window → county spatial gate → Louvain → session filter) but at unit granularity and run twice (Level + Spread, AND-combined). A new host page points the unchanged `storyline.js` at the new data file; a final task adds optional spread-as-thickness rendering, backward-compatible with the two existing pages.

**Tech Stack:** Python 3 (numpy, networkx), existing static front-end (vanilla JS canvas/WebGL), Python `unittest` for tests.

## Global Constraints

- Unit definition: `(roadbed, county)` pair, keyed/displayed as `"{roadbed} · {county}"` — identical to `build_unit_heatmaps.py` and the `hwcounty` rule in `step17_storyline_data.py`.
- Unit inclusion filter: a unit must have `>= 5` segments (`MIN_SEGMENTS = 5`) — drop near-empty units with no meaningful distribution.
- Invalid / no-data segment scores are `< 1` — excluded from every per-year computation.
- Years: 1996–2024 (29 years) from `windows_W5.json["years"]`. Windows: 25 sliding W=5 windows from `windows_W5.json["windows"]` (each has `start`, `end`, `section_idx`).
- Correlation params (match `step6_corr.py`): Pearson threshold `THR = 0.7`, minimum overlapping real years `MIN_OVERLAP = 4`.
- Session filter threshold (match `step11_filter.py`): `THS = 5`.
- Louvain seed (match `step10_communities.py`): `SEED = 42`.
- Source data files (already present, read-only): `section_year_matrix.csv` (section × year scores, blank = gap), `sections_meta.csv` (columns include `section_id, roadbed, county`), `windows_W5.json`.
- Do NOT modify the existing segment-level pipeline, `index.html`, or `index_county.html` behavior. `storyline.js` may only be changed in a backward-compatible way (new optional field ignored when absent).

## File Structure

- Create `build_unit_series.py` — reads sources, emits `unit_series.json`: per-unit Level & Spread yearly series + unit meta + per-window membership. **Owns:** the distribution-aware per-year math.
- Create `build_unit_sessions.py` — reads `unit_series.json`, runs the two-correlation AND pipeline + county gate + Louvain + session filter, emits `unit_sessions.json`. **Owns:** unit grouping.
- Create `build_unit_storyline_data.py` — joins `unit_series.json` + `unit_sessions.json`, emits `storyline_data_units.json` in the storyline contract. **Owns:** storyline serialization + Level→color mapping.
- Create `index_units.html` — host page setting `window.STORYLINE_DATA_FILE = "storyline_data_units.json"`, loading the existing `storyline.js` / `storyline.css`.
- Create `tests/test_unit_series.py`, `tests/test_unit_sessions.py`, `tests/test_unit_storyline_data.py` — unit tests over the pure functions.
- Modify `storyline.js` — optional per-window `sp` (spread) field → line thickness (Task 6 only; backward-compatible).

Data-flow: `sources → build_unit_series.py → unit_series.json → build_unit_sessions.py → unit_sessions.json`; then `unit_series.json + unit_sessions.json → build_unit_storyline_data.py → storyline_data_units.json → index_units.html + storyline.js`.

---

### Task 1: Per-unit yearly Level & Spread math (pure functions)

**Files:**
- Create: `build_unit_series.py`
- Test: `tests/test_unit_series.py`

**Interfaces:**
- Produces:
  - `level_of(scores: list[float]) -> float` — mean of squared gap below 100 over valid scores (`>= 1`); returns `float('nan')` if no valid score.
  - `spread_of(scores: list[float]) -> float` — population standard deviation of valid scores; `0.0` if exactly one valid score; `nan` if none.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_unit_series.py
import math, unittest
from build_unit_series import level_of, spread_of

class TestUnitSeriesMath(unittest.TestCase):
    def test_level_penalizes_bad_segments_harder(self):
        # all-fair (60) vs mixed good(80)+very-poor(20), same mean score
        all_fair = level_of([60.0] * 10)
        mixed = level_of([80.0] * 5 + [20.0] * 5)
        self.assertAlmostEqual(all_fair, 1600.0, places=6)   # (100-60)^2
        self.assertAlmostEqual(mixed, 3400.0, places=6)      # (400*5+6400*5)/10
        self.assertGreater(mixed, all_fair)

    def test_level_excludes_invalid_and_handles_empty(self):
        self.assertAlmostEqual(level_of([90.0, 0.5, 90.0]), 100.0, places=6)  # 0.5 dropped
        self.assertTrue(math.isnan(level_of([0.5, 0.0])))

    def test_spread_uniform_vs_mixed(self):
        self.assertAlmostEqual(spread_of([85.0] * 6), 0.0, places=6)
        self.assertGreater(spread_of([95, 95, 95, 75, 75, 75]), 9.0)

    def test_spread_single_is_zero_empty_is_nan(self):
        self.assertEqual(spread_of([70.0]), 0.0)
        self.assertTrue(math.isnan(spread_of([])))

if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_unit_series.py -v`
Expected: FAIL with `ImportError`/`cannot import name 'level_of'`.

- [ ] **Step 3: Write minimal implementation**

```python
# build_unit_series.py  (top of file)
"""
Build per-unit (roadbed · county) distribution-aware yearly series for the
unit-level evolution pattern:

  Level  = mean over the unit's valid segments that year of the squared gap
           below 100 -- bad segments weigh disproportionately more.
  Spread = population std of the unit's valid segment scores that year --
           uniform unit ~ 0, mixed unit large.

See docs/superpowers/specs/2026-07-02-unit-evolution-distribution-design.md.
"""
import math

def level_of(scores):
    valid = [s for s in scores if s is not None and s >= 1]
    if not valid:
        return float("nan")
    return sum((100.0 - s) ** 2 for s in valid) / len(valid)

def spread_of(scores):
    valid = [s for s in scores if s is not None and s >= 1]
    if not valid:
        return float("nan")
    if len(valid) == 1:
        return 0.0
    mean = sum(valid) / len(valid)
    var = sum((s - mean) ** 2 for s in valid) / len(valid)
    return math.sqrt(var)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_unit_series.py -v`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add build_unit_series.py tests/test_unit_series.py
git commit -m "feat: per-unit yearly Level & Spread math"
```

---

### Task 2: Assemble unit series from source files

**Files:**
- Modify: `build_unit_series.py` (append loader + main)
- Test: `tests/test_unit_series.py` (add cases)

**Interfaces:**
- Consumes: `level_of`, `spread_of` (Task 1).
- Produces:
  - `build_units(matrix_rows, sections, years, meta) -> dict` returning
    `{"years": [...], "units": [ {"key","roadbed","county","n_segments",
    "level":[per-year float|None], "spread":[per-year float|None]} ... ]}`.
    Only units with `>= 5` segments are included. `None` marks a year with no
    valid segment for that unit.
  - `main()` writing `unit_series.json` with the same structure plus
    `"windows"` copied from `windows_W5.json` (`k,start,end,label`) and, per
    unit, `"member_windows": [k ...]` = windows in which the unit has `>= 1`
    finite level value.
  - Signature detail for the test: `matrix_rows` is `dict[section_id -> list[float|None]]` (one value per year), `meta` is `dict[section_id -> (roadbed, county)]`.

- [ ] **Step 1: Write the failing test**

```python
# add to tests/test_unit_series.py
from build_unit_series import build_units

class TestBuildUnits(unittest.TestCase):
    def _meta(self, n, roadbed, county):
        return {f"s{i}": (roadbed, county) for i in range(n)}

    def test_small_unit_dropped_and_key_format(self):
        # MIN_SEGMENTS = 5: a 5-segment unit is kept, a 4-segment unit dropped.
        years = [2000, 2001]
        rows = {f"s{i}": [80.0, 70.0] for i in range(5)}
        meta = self._meta(5, "SH0240", "Tarrant")
        out = build_units(rows, list(rows), years, meta)
        self.assertEqual(len(out["units"]), 1)
        self.assertEqual(out["units"][0]["key"], "SH0240 · Tarrant")
        self.assertEqual(out["units"][0]["n_segments"], 5)
        # a 4-segment unit is dropped
        rows4 = {f"s{i}": [80.0, 70.0] for i in range(4)}
        out4 = build_units(rows4, list(rows4), years, self._meta(4, "X", "Y"))
        self.assertEqual(out4["units"], [])

    def test_year_gap_is_none(self):
        years = [2000, 2001]
        rows = {f"s{i}": [80.0, None] for i in range(15)}   # nobody observed 2001
        meta = self._meta(15, "SH0240", "Tarrant")
        u = build_units(rows, list(rows), years, meta)["units"][0]
        self.assertIsNotNone(u["level"][0])
        self.assertIsNone(u["level"][1])
        self.assertIsNone(u["spread"][1])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_unit_series.py::TestBuildUnits -v`
Expected: FAIL with `cannot import name 'build_units'`.

- [ ] **Step 3: Write minimal implementation**

```python
# append to build_unit_series.py
import csv, json, collections

MIN_SEGMENTS = 5

def build_units(matrix_rows, sections, years, meta):
    by_unit = collections.defaultdict(list)          # (roadbed,county) -> [section_id]
    for sid in sections:
        rc = meta.get(sid)
        if rc is not None:
            by_unit[rc].append(sid)

    n_years = len(years)
    units = []
    for (roadbed, county), sids in by_unit.items():
        if len(sids) < MIN_SEGMENTS:
            continue
        level, spread = [], []
        for yi in range(n_years):
            col = [matrix_rows[sid][yi] for sid in sids]
            lv = level_of(col); sp = spread_of(col)
            level.append(None if math.isnan(lv) else lv)
            spread.append(None if math.isnan(sp) else sp)
        units.append({"key": f"{roadbed} · {county}", "roadbed": roadbed,
                      "county": county, "n_segments": len(sids),
                      "level": level, "spread": spread})
    units.sort(key=lambda u: -u["n_segments"])
    return {"years": list(years), "units": units}

def _load_sources():
    r = csv.reader(open("section_year_matrix.csv", encoding="utf-8"))
    hdr = next(r); years = [int(y) for y in hdr[1:]]
    rows, sections = {}, []
    for row in r:
        sections.append(row[0])
        rows[row[0]] = [float(v) if v != "" else None for v in row[1:]]
    meta = {}
    for m in csv.DictReader(open("sections_meta.csv", encoding="utf-8")):
        meta[m["section_id"]] = (m["roadbed"], m["county"])
    win = json.load(open("windows_W5.json", encoding="utf-8"))
    return rows, sections, years, meta, win

def main():
    rows, sections, years, meta, win = _load_sources()
    out = build_units(rows, sections, years, meta)
    yidx = {y: i for i, y in enumerate(years)}
    out["windows"] = [{"k": k, "start": w["start"], "end": w["end"],
                       "label": f'{w["start"]}-{w["end"]}'}
                      for k, w in enumerate(win["windows"])]
    wyears = [[yi for y in range(w["start"], w["end"] + 1)
               if (yi := yidx.get(y)) is not None] for w in win["windows"]]
    for u in out["units"]:
        u["member_windows"] = [k for k, cols in enumerate(wyears)
                               if any(u["level"][c] is not None for c in cols)]
    json.dump(out, open("unit_series.json", "w"))
    print(f"units: {len(out['units'])}  years: {years[0]}-{years[-1]}")
    print("wrote unit_series.json")

if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run tests + generate real output**

Run: `python -m pytest tests/test_unit_series.py -v && python build_unit_series.py`
Expected: tests PASS; script prints `units: <N>` (more than 295 now that the filter is `>= 5`) and writes `unit_series.json`.

- [ ] **Step 5: Commit**

```bash
git add build_unit_series.py tests/test_unit_series.py unit_series.json
git commit -m "feat: assemble per-unit Level/Spread series into unit_series.json"
```

---

### Task 3: Two-correlation AND edges (pure function)

**Files:**
- Create: `build_unit_sessions.py`
- Test: `tests/test_unit_sessions.py`

**Interfaces:**
- Produces:
  - `pairwise_edges(series: list[list[float|None]], cols: list[int], thr=0.7, min_overlap=4) -> set[tuple[int,int]]` — all pairs `(i,j)`, `i<j`, whose Pearson correlation over the years in `cols` where BOTH are observed (`>= min_overlap` such years) exceeds `thr`.
  - `and_edges(a: set, b: set) -> set` — set intersection (thin wrapper, kept named for clarity/testing).

- [ ] **Step 1: Write the failing test**

```python
# tests/test_unit_sessions.py
import unittest
from build_unit_sessions import pairwise_edges, and_edges

class TestEdges(unittest.TestCase):
    def test_correlated_pair_only(self):
        rising  = [10.0, 20, 30, 40, 50]
        rising2 = [12.0, 19, 33, 38, 51]     # tracks rising
        falling = [50.0, 40, 30, 20, 10]     # anti-correlated
        series = [rising, rising2, falling]
        e = pairwise_edges(series, cols=[0, 1, 2, 3, 4], thr=0.7, min_overlap=4)
        self.assertIn((0, 1), e)
        self.assertNotIn((0, 2), e)
        self.assertNotIn((1, 2), e)

    def test_insufficient_overlap_excluded(self):
        a = [1.0, 2, None, None, None]
        b = [1.0, 2, None, None, None]       # only 2 common years < min_overlap
        self.assertEqual(pairwise_edges([a, b], [0,1,2,3,4]), set())

    def test_and_edges_intersects(self):
        self.assertEqual(and_edges({(0,1),(1,2)}, {(1,2),(2,3)}), {(1,2)})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_unit_sessions.py -v`
Expected: FAIL with `cannot import name 'pairwise_edges'`.

- [ ] **Step 3: Write minimal implementation**

```python
# build_unit_sessions.py (top)
"""
Unit-level grouping for the distribution-aware evolution pattern.

Per window: correlate units on their Level series and (independently) on their
Spread series; keep an edge only where BOTH clear THR (logical AND). Intersect
with the county spatial gate, Louvain-partition, then apply the step-11 session
filter. Mirrors step6->step11 at unit granularity.
"""
import json, math

def _pearson(x, y):
    n = len(x)
    if n == 0:
        return 0.0
    mx, my = sum(x) / n, sum(y) / n
    sxy = sum((a - mx) * (b - my) for a, b in zip(x, y))
    sxx = sum((a - mx) ** 2 for a in x)
    syy = sum((b - my) ** 2 for b in y)
    den = math.sqrt(sxx * syy)
    return sxy / den if den > 0 else 0.0

def pairwise_edges(series, cols, thr=0.7, min_overlap=4):
    edges = set()
    m = len(series)
    for i in range(m):
        for j in range(i + 1, m):
            xi, xj = [], []
            for c in cols:
                a, b = series[i][c], series[j][c]
                if a is not None and b is not None:
                    xi.append(a); xj.append(b)
            if len(xi) >= min_overlap and _pearson(xi, xj) > thr:
                edges.add((i, j))
    return edges

def and_edges(a, b):
    return a & b
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_unit_sessions.py -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add build_unit_sessions.py tests/test_unit_sessions.py
git commit -m "feat: unit-level pairwise Pearson edges + AND intersection"
```

---

### Task 4: Full unit grouping pipeline → `unit_sessions.json`

**Files:**
- Modify: `build_unit_sessions.py` (append gate + Louvain + filter + main)
- Test: `tests/test_unit_sessions.py` (add filter case)

**Interfaces:**
- Consumes: `pairwise_edges`, `and_edges` (Task 3); `unit_series.json` (Task 2).
- Produces:
  - `county_gate(edges: set, counties: list[str]) -> set` — keep `(i,j)` iff `counties[i] == counties[j]`.
  - `louvain_sessions(members: list[int], edges: set, seed=42) -> list[list[int]]` — Louvain communities over a graph with `members` as nodes and `edges`; each community a sorted list, communities sorted by size desc.
  - `filter_sessions(windows: list[list[list[int]]], ths=5) -> list[list[list[int]]]` — the step-11 rule (drop a session iff size `< ths` AND no member is in a `>= ths` session in either neighbor window).
  - `main()` writing `unit_sessions.json`: `{"windows": [{"k","sessions": [[unit_idx...]...]} ...]}` where `unit_idx` indexes `unit_series.json["units"]`.

- [ ] **Step 1: Write the failing test**

```python
# add to tests/test_unit_sessions.py
from build_unit_sessions import county_gate, filter_sessions, louvain_sessions

class TestGateAndFilter(unittest.TestCase):
    def test_county_gate(self):
        e = {(0, 1), (0, 2)}
        counties = ["A", "A", "B"]
        self.assertEqual(county_gate(e, counties), {(0, 1)})

    def test_louvain_two_cliques(self):
        edges = {(0, 1), (1, 2), (0, 2), (3, 4)}
        sess = louvain_sessions([0, 1, 2, 3, 4, 5], edges, seed=42)
        # 5 is edgeless -> its own singleton; {0,1,2} and {3,4} stay together
        as_sets = [set(s) for s in sess]
        self.assertIn({0, 1, 2}, as_sets)
        self.assertIn({3, 4}, as_sets)
        self.assertIn({5}, as_sets)

    def test_filter_drops_isolated_small_session(self):
        # window 1 has a singleton [9] with no neighbor support -> dropped
        windows = [[[0, 1, 2, 3, 4]], [[0, 1, 2, 3, 4], [9]], [[0, 1, 2, 3, 4]]]
        out = filter_sessions(windows, ths=5)
        self.assertNotIn([9], out[1])
        self.assertIn([0, 1, 2, 3, 4], out[1])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_unit_sessions.py::TestGateAndFilter -v`
Expected: FAIL with `cannot import name 'county_gate'`.

- [ ] **Step 3: Write minimal implementation**

```python
# append to build_unit_sessions.py
import networkx as nx

THR = 0.7
MIN_OVERLAP = 4
THS = 5
SEED = 42

def county_gate(edges, counties):
    return {(i, j) for (i, j) in edges if counties[i] == counties[j]}

def louvain_sessions(members, edges, seed=SEED):
    G = nx.Graph()
    G.add_nodes_from(members)
    G.add_edges_from(edges)
    comms = nx.community.louvain_communities(G, seed=seed)
    sessions = [sorted(int(x) for x in c) for c in comms]
    sessions.sort(key=len, reverse=True)
    return sessions

def filter_sessions(windows, ths=THS):
    n = len(windows)
    large = []
    for sess in windows:
        s = set()
        for members in sess:
            if len(members) >= ths:
                s.update(members)
        large.append(s)
    out = []
    for idx, sess in enumerate(windows):
        prev_large = large[idx - 1] if idx > 0 else set()
        next_large = large[idx + 1] if idx < n - 1 else set()
        neighbor = prev_large | next_large
        kept = [m for m in sess
                if len(m) >= ths or any(x in neighbor for x in m)]
        kept.sort(key=len, reverse=True)
        out.append(kept)
    return out

def main():
    data = json.load(open("unit_series.json", encoding="utf-8"))
    units = data["units"]
    counties = [u["county"] for u in units]
    level = [u["level"] for u in units]
    spread = [u["spread"] for u in units]
    years = data["years"]
    yidx = {y: i for i, y in enumerate(years)}
    wins = data["windows"]

    raw_windows = []
    for w in wins:
        cols = [yidx[y] for y in range(w["start"], w["end"] + 1) if y in yidx]
        members = [i for i, u in enumerate(units) if w["k"] in u["member_windows"]]
        # restrict series to members for edge indices, then map back
        lvl_e = pairwise_edges([level[i] for i in members], cols, THR, MIN_OVERLAP)
        spr_e = pairwise_edges([spread[i] for i in members], cols, THR, MIN_OVERLAP)
        both = and_edges(lvl_e, spr_e)
        # map local member indices back to global unit indices
        gmap = {li: members[li] for li in range(len(members))}
        gedges = {(gmap[i], gmap[j]) for (i, j) in both}
        gedges = county_gate(gedges, counties)
        sess = louvain_sessions(members, gedges, SEED)
        raw_windows.append(sess)

    kept = filter_sessions(raw_windows, THS)
    out = {"windows": [{"k": wins[k]["k"], "sessions": kept[k]}
                       for k in range(len(wins))]}
    json.dump(out, open("unit_sessions.json", "w"))
    print(f"windows: {len(out['windows'])}  "
          f"largest session: {max((len(s) for w in kept for s in w), default=0)}")
    print("wrote unit_sessions.json")

if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run tests + generate real output**

Run: `python -m pytest tests/test_unit_sessions.py -v && python build_unit_sessions.py`
Expected: tests PASS; script writes `unit_sessions.json` and prints a nonzero largest session.

- [ ] **Step 5: Commit**

```bash
git add build_unit_sessions.py tests/test_unit_sessions.py unit_sessions.json
git commit -m "feat: unit grouping pipeline (county gate + Louvain + session filter)"
```

---

### Task 5: Storyline data export + working separate page

**Files:**
- Create: `build_unit_storyline_data.py`
- Create: `index_units.html`
- Test: `tests/test_unit_storyline_data.py`

**Interfaces:**
- Consumes: `unit_series.json`, `unit_sessions.json`.
- Produces:
  - `level_to_color_score(level: float|None) -> float|None` — maps Level to a 0–100 condition-equivalent for the existing color scale: `round(max(0.0, 100.0 - sqrt(level)), 1)`; `None` passes through. (sqrt(mean squared gap) = RMS gap, so this is an effective condition score that already penalizes bad tails.)
  - `build_storyline(series: dict, sessions: dict) -> dict` — storyline contract: `{"windows":[...], "roads":[{"roadbed": <county>, "segments":[{"id","marker","roadbed","county","win":[{"k","s","v","sp"}...]}]}]}`. Bands are grouped by **county**; each unit is one atom; `s` = index of the unit's session within window `k` (or `None`); `v` = `level_to_color_score` of the unit's Level that window-year-set's… (use per-window mean of the unit's yearly Level over that window's years, then map); `sp` = per-window mean of the unit's Spread (raw, for thickness in Task 6).

- [ ] **Step 1: Write the failing test**

```python
# tests/test_unit_storyline_data.py
import math, unittest
from build_unit_storyline_data import level_to_color_score, build_storyline

class TestColor(unittest.TestCase):
    def test_level_to_color(self):
        self.assertEqual(level_to_color_score(0.0), 100.0)      # perfect
        self.assertEqual(level_to_color_score(1600.0), 60.0)    # RMS gap 40 -> 60
        self.assertIsNone(level_to_color_score(None))

class TestBuild(unittest.TestCase):
    def _series(self):
        return {"years": [2000, 2001, 2002, 2003, 2004],
                "windows": [{"k": 0, "start": 2000, "end": 2004, "label": "2000-2004"}],
                "units": [
                    {"key": "A · X", "roadbed": "A", "county": "X", "n_segments": 15,
                     "level": [1600.0]*5, "spread": [2.0]*5, "member_windows": [0]},
                    {"key": "B · X", "roadbed": "B", "county": "X", "n_segments": 15,
                     "level": [0.0]*5, "spread": [10.0]*5, "member_windows": [0]}]}

    def test_band_grouped_by_county_and_fields(self):
        sessions = {"windows": [{"k": 0, "sessions": [[0, 1]]}]}
        out = build_storyline(self._series(), sessions)
        self.assertEqual(len(out["roads"]), 1)                 # one county band X
        self.assertEqual(out["roads"][0]["roadbed"], "X")
        segs = out["roads"][0]["segments"]
        self.assertEqual(len(segs), 2)
        w0 = segs[0]["win"][0]
        self.assertEqual(w0["s"], 0)                           # both in session 0
        self.assertEqual(w0["v"], 60.0)                        # unit A: level 1600 -> 60
        self.assertAlmostEqual(w0["sp"], 2.0, places=6)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_unit_storyline_data.py -v`
Expected: FAIL with `cannot import name 'level_to_color_score'`.

- [ ] **Step 3: Write minimal implementation**

```python
# build_unit_storyline_data.py
"""
Join unit_series.json + unit_sessions.json into storyline_data_units.json,
consumed by index_units.html + storyline.js. Bands = counties; atoms = units.
v colors by an effective (distribution-aware) condition score; sp carries the
window's spread for optional thickness rendering.
"""
import json, math, collections

def level_to_color_score(level):
    if level is None:
        return None
    return round(max(0.0, 100.0 - math.sqrt(level)), 1)

def _win_mean(series, cols):
    vals = [series[c] for c in cols if series[c] is not None]
    return sum(vals) / len(vals) if vals else None

def build_storyline(series, sessions):
    years = series["years"]
    yidx = {y: i for i, y in enumerate(years)}
    wins = series["windows"]
    wcols = [[yidx[y] for y in range(w["start"], w["end"] + 1) if y in yidx]
             for w in wins]
    # per-window unit -> session index
    sess_of = [dict() for _ in wins]
    for wk, sw in enumerate(sessions["windows"]):
        for s, members in enumerate(sw["sessions"]):
            for u in members:
                sess_of[wk][u] = s

    bands = collections.defaultdict(list)     # county -> [segment dict]
    for ui, u in enumerate(series["units"]):
        win = []
        for wk in u["member_windows"]:
            cols = wcols[wk]
            lvl = _win_mean(u["level"], cols)
            spv = _win_mean(u["spread"], cols)
            win.append({"k": wk, "s": sess_of[wk].get(ui),
                        "v": level_to_color_score(lvl),
                        "sp": round(spv, 3) if spv is not None else None})
        bands[u["county"]].append({"id": u["key"], "marker": 0.0,
                                   "roadbed": u["roadbed"], "county": u["county"],
                                   "win": win})
    for segs in bands.values():
        segs.sort(key=lambda s: s["roadbed"])
    roads = [{"roadbed": cty, "segments": segs}
             for cty, segs in sorted(bands.items(), key=lambda kv: -len(kv[1]))]
    return {"windows": wins, "roads": roads}

def main():
    series = json.load(open("unit_series.json", encoding="utf-8"))
    sessions = json.load(open("unit_sessions.json", encoding="utf-8"))
    out = build_storyline(series, sessions)
    json.dump(out, open("storyline_data_units.json", "w"))
    print(f"county bands: {len(out['roads'])}  "
          f"units: {sum(len(r['segments']) for r in out['roads'])}")
    print("wrote storyline_data_units.json")

if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run tests + generate real output**

Run: `python -m pytest tests/test_unit_storyline_data.py -v && python build_unit_storyline_data.py`
Expected: tests PASS; writes `storyline_data_units.json`.

- [ ] **Step 5: Create the host page**

Copy `index.html` to `index_units.html` and change ONLY the data-file line and the page title. Read `index.html` first; the one line to change matches `index.html:8`:

```html
<script>window.STORYLINE_DATA_FILE = "storyline_data_units.json";</script>
```

Update the `<title>` (and any visible heading) to indicate "Unit-level (distribution-aware) evolution pattern". Leave all `<script src="storyline.js">` / `<link ... storyline.css>` references identical.

- [ ] **Step 6: Verify the page renders**

Run: `python -m http.server 8000` then open `http://localhost:8000/index_units.html`.
Expected: the storyline renders with county bands, unit lines colored by effective condition, bundled into cohorts. No console errors (check with the browser-console-debugger agent if needed).

- [ ] **Step 7: Commit**

```bash
git add build_unit_storyline_data.py tests/test_unit_storyline_data.py index_units.html storyline_data_units.json
git commit -m "feat: unit-level storyline data export + index_units.html page"
```

---

### Task 6: Spread-as-thickness rendering (backward-compatible)

**Files:**
- Modify: `storyline.js` (`segmentPoints` to carry `sp`; the stroke width in the 2D/WebGL line draw)

**Interfaces:**
- Consumes: per-window `sp` field in `storyline_data_units.json` (Task 5). Absent in `storyline_data_hwcounty.json` / `storyline_data_county.json` → default width, existing pages unchanged.

- [ ] **Step 1: Read the render path**

Read `storyline.js` around `segmentPoints` (`storyline.js:785-807`) and the `draw()` function plus any WebGL line renderer (`glRenderer`, search `lineWidth` / stroke). Identify where each segment polyline's stroke width is set. Confirm both the 2D canvas path and the WebGL path (the code has both).

- [ ] **Step 2: Plumb `sp` into the point objects**

In `segmentPoints`, add `sp` to each pushed point (near `storyline.js:802`):

```javascript
pts.push({ k: w.k, v: w.v, sp: w.sp, trackId: colorTrackId, y: yOffset + relY });
```

- [ ] **Step 3: Map `sp` to a stroke width and apply it**

Add a small helper near the other rendering helpers, and use it where the per-segment stroke width is currently a constant. Backward-compatible: `sp == null` → base width.

```javascript
// Spread -> line thickness. sp is the window's mean segment std (0..~40).
// Uniform unit (sp~0) -> base width; mixed unit -> up to ~4x base.
function widthFromSpread(sp, base) {
  if (sp == null) return base;
  return base * (1 + Math.min(sp / 12, 3));   // cap at 4x
}
```

Apply `widthFromSpread(pt.sp, BASE_WIDTH)` at the stroke-width assignment found in Step 1 (per-segment segment where the point's `sp` is available). If the WebGL renderer cannot vary per-vertex width easily, apply thickness in the 2D path only and leave WebGL at base width (document this in a code comment); the 2D path is the correctness-critical view.

- [ ] **Step 4: Verify both old and new pages**

Run: `python -m http.server 8000`.
- Open `index_units.html`: mixed-condition units (thick) visibly differ from uniform units (thin).
- Open `index.html` and `index_county.html`: unchanged from before (no `sp` field → base width, no regression).
Expected: no console errors on any page.

- [ ] **Step 5: Commit**

```bash
git add storyline.js
git commit -m "feat: optional spread-as-thickness in storyline (backward-compatible)"
```

---

### Task 7: One-shot orchestration + graph update

**Files:**
- Create: `build_unit_evolution.py` (thin runner)

- [ ] **Step 1: Write the runner**

```python
# build_unit_evolution.py
"""Run the full unit-level evolution-pattern data build end to end."""
import build_unit_series, build_unit_sessions, build_unit_storyline_data

if __name__ == "__main__":
    build_unit_series.main()
    build_unit_sessions.main()
    build_unit_storyline_data.main()
    print("done: storyline_data_units.json ready for index_units.html")
```

- [ ] **Step 2: Run it clean**

Run: `python build_unit_evolution.py`
Expected: prints each step's summary and `done: ...`.

- [ ] **Step 3: Update the knowledge graph (per CLAUDE.md)**

Run: `graphify update .`
Expected: AST-only refresh, no errors.

- [ ] **Step 4: Commit**

```bash
git add build_unit_evolution.py graphify-out
git commit -m "chore: unit-evolution orchestrator + graphify update"
```

---

## Self-Review

**Spec coverage:**
- Highway-county unit actors, ≥5-segment filter → Tasks 1–2 (`MIN_SEGMENTS`, unit key). ✅
- Two numbers/year (Level squared-gap, Spread std), invalid `<1` excluded, 1-segment spread=0 → Task 1. ✅
- Two independent single-value correlations combined with AND → Tasks 3–4 (`pairwise_edges` run twice, `and_edges`). ✅
- County spatial gate, Louvain, step-11 filter reused at unit level → Task 4. ✅
- Render via existing `storyline.js`; Level→color, Spread→thickness; new data file + host page → Tasks 5–6. ✅
- Separate page based on current storyline (user instruction) → `index_units.html`, no change to existing pages. ✅
- Known limitation (two numbers can't fully separate every mix) — accepted, no task needed. ✅

**Placeholder scan:** No TBD/TODO; every code step shows code. Task 6 Step 3 intentionally defers to the implementer's read of the WebGL renderer but gives the exact helper + fallback rule (2D path authoritative) — concrete, not a placeholder.

**Type consistency:** `level_of`/`spread_of` (Task 1) → used by `build_units` (Task 2). `pairwise_edges`/`and_edges` (Task 3) → used in Task 4 `main`. `unit_series.json` fields (`units[].level/spread/member_windows/county/roadbed/key`, `windows`) produced in Task 2 are exactly the fields consumed in Tasks 4–5. `sp`/`v`/`s` fields in `storyline_data_units.json` (Task 5) match the `w.sp`/`w.v`/`w.s` reads in `segmentPoints` (Task 6). ✅
