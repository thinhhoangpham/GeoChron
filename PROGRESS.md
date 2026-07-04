# GeoChron Pipeline — Progress

Building the cohort-based pavement trajectory analysis in `procedure.md` (17 steps),
adapting the GeoChron paper (`paper.txt`) to Texas PMIS pavement data (`PMIS_merged.csv`).
**Goal:** a Storyline visualization of road segments that deteriorate together over time.

**Chosen window width: W = 5** (5-year sliding windows, step 1 year, 1996–2024 → 25 windows).

## Glossary (plain terms)
- **Segment** — one half-mile piece of road (e.g. `BI0020EK|299|0.0`). ~14,810 of them.
- **Session / cohort / bundle** — a *group* of segments deteriorating together in one window.
- **Loner / singleton** — a session of size 1 (no qualifying partners that window).
- **Window** — one 5-year span = one Storyline time slice (windows overlap by 4 years).
- **Track** — a session followed across consecutive windows (mutual-best-overlap union-find);
  one track = one horizontal bundle in the Storyline.

## Data pipeline — Steps 1–12 (all DONE)
| Step | Script | Outputs | Key params / notes |
|------|--------|---------|--------------------|
| 1–3 | `build_matrix.py` | `section_year_matrix.csv`, `sections_meta.csv` | 14,812 sections kept of 41,314 (≥10 yrs); gaps NOT interpolated. |
| 4 | `build_windows.py` | `windows_W5.json` (+W6,W7), `step4_summary.json` | MIN_OBS=4 to join a window. |
| 5 | **SKIPPED** (user choice) | (`build_normalize.py` unused for this) | Pearson is z-norm-invariant → identical correlation result either way; matches paper's raw-value approach. Normalization is used later, on-demand, in the EvoLens trend motif instead. |
| 6+7 | `build_corr.py` | `step6_edges_W5/win*.npz` | All-pairs pairwise-complete Pearson (numpy). THR=0.7, MIN_OVERLAP=4 → 82,574,973 edges. |
| 8+9 | `build_network.py` | `step9_network_W5/win*.npz` | Proximity = **same roadbed AND county** (1,112 groups; true geographic-distance proximity, per the paper, isn't possible — `begin_dfo`/`end_dfo` are empty in the metadata). 82.5M → 506,905 edges (0.61%). |
| 10 | `build_communities.py` | `step10_communities_W5.json` | Louvain (networkx `louvain_communities`, seed=42), run on the graph AFTER the proximity filter — Louvain itself is location-blind, communities end up location-confined only because cross-location edges don't exist by this point. |
| 11 | `build_filter.py` | `step11_sessions_W5.json` | Paper-faithful filter, ths=5: drop a session iff size<5 AND no member is in a ≥5 session in either neighbor window. 118,675 → 24,408 sessions. |
| 12 | `build_track.py` | `step12_transitions_W5.json` | Link each session to the next-window session with largest membership overlap. 18,717 forward links. |

## Step 17 Level 1 — Storyline (DONE, current architecture)
- `export_storyline_data.py` → `storyline_data.json`. **Bands are keyed by (roadbed, county)**,
  not roadbed alone — 1,112 bands / 14,810 segments. (Sessions were always scoped to one
  roadbed+county pair; this just made the *display* grouping match that, so no band mixes
  counties a highway passes through.)
- `storyline.html` + `storyline.js` + `storyline.css` — real static app (no Python-generated HTML).
  Loads `storyline_data.json` via fetch. In-browser: per-window barycenter-sweep grouping/
  ordering → stacked into y-positions → each window drawn as a full-width bar, consecutive
  windows joined by a thin Bezier connector (no anchors/interpolation/dot hacks). Rendering
  is WebGL (batched, chunked draw calls) with a 2D canvas overlay for labels/hover/highlight.
  Controls: road search/filter, color mode (condition RdYlGn / cohort categorical hue), 4
  spacing sliders (row height, lane gap, road gap, column width).
- Serve: `cd C:\Users\Owner\Documents\GeoChron && python -m http.server 3000` →
  `http://localhost:3000/storyline.html`.
- Fixed bugs (see git-less history below): hover hit-testing missing scroll offset; WebGL
  single draw call silently failing above ~millions of vertices (now chunked); single-road
  view using the wrong (world-stacked) y-offset, rendering blank.
- Coding on this app is delegated to the `senior-fullstack-dev` subagent (standing preference);
  data-export scripts are written directly.

## Step 17 Level 2 — EvoLens drill-down (DONE)
- `export_evolens_data.py` → `evolens_data.json` (raw per-year scores, 14,812 segments × 29 years).
- `evolens.js` (new file) + a small read-only hook in `storyline.js`: **brush-select** a
  rectangle on a single-road Storyline view (the paper's actual interaction — not a click) →
  slide-in side panel with a per-year "sawtooth" line chart (real yearly values, not the
  5-year window means) plus a toggleable trend motif (z-score IQR band + median).
- Only works in single-road view by design; "All roads" shows a hint instead.

## NOT yet done
- **Step 13** — treatment-event detection (year-over-year jumps ~ rehab/overlay); would also
  explain observed cohort-fragmentation events (e.g. windows 5, 13→14, 22→23).
- **Step 14** — validation (ARI/purity vs. known construction/district/pavement-type ground
  truth; cohort stability across overlapping windows).
- **Step 15** — formal run-scope decision (informally we already view per-road/county; a
  written decision + any statewide cross-district pass is still open).
- **Paper's linked map** (G4) — click/color a session, see it highlighted on a geographic map.
  Not started; also blocked on the same missing-coordinates issue as Step 8/9's proximity rule.
- **Color-direction confirmation** — still assumes higher PMIS score = better pavement; not
  independently verified against PMIS documentation.

## Known limitations / deliberate simplifications
- No real coordinates → proximity is (roadbed, county) rather than a true geographic radius.
  This is coarser than the paper and is the most likely thing to revisit if real lat/long
  becomes available (would let cohorts span nearby *different* roads, which they can't now).
- Step 5 (normalization) is skipped for the correlation math (provably equivalent for Pearson)
  but used live in the EvoLens trend motif, where it's actually needed.

## Tuning levers
- Too many/cluttered bands → raise `ths` (5 → 8/10) in `build_filter.py`.
- Too-dense correlation → raise `THR` (0.7 → 0.8) or `MIN_OVERLAP` (4 → 5) in `build_corr.py`.
