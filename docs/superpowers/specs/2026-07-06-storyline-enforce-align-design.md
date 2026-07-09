# Storyline — Interactive "Enforce Alignment of Sessions" (click-to-align)

**Date:** 2026-07-06
**Status:** Design approved, pending spec review
**Scope:** Interactive JS renderers only (`storyline.js`, `storyline_peryear.js`)

## 1. Motivation

The GeoChron paper (IEEE TVCG Vol. 30 No. 1, Sec. 6.2, "Layout Refinement")
describes an interactive **Enforce Alignment of Sessions** feature:

> "After a user clicks a session, for each time slice, the session with the
> largest intersection with the clicked session is called the target session.
> Then, Step 2: Aligning will be re-run..."

Aligning is re-run by aligning the target sessions across adjacent slices
(gated by the loose-alignment constraint), splitting each slice into a top
part and a bottom part by the target session, and LCS-aligning each part.

This codebase implements the *layout mechanics* (Sugiyama-style barycenter
ordering, straightening, curve hiding, `d_in`/`d_out` spacing) but **not** the
interactive click-to-align. The layout is computed at runtime in the JS
(`buildRoadStructure`, barycenter sweep) — the Python builders only supply raw
per-window cohort/session data as `storyline_data_*.json`. Therefore this
feature lives entirely in the JS renderers; no Python builder changes.

The codebase uses barycenter ordering and has **no LCS**. Per the design
decision, this feature implements the paper's Step 2 **faithfully** (weighted
LCS with top/bottom split around the target session), not a barycenter
approximation.

## 2. Terminology mapping

| Paper term        | This codebase                                             |
|-------------------|-----------------------------------------------------------|
| session           | cohort (a group of segments sharing a session id `w.s` at a window) |
| entity            | segment (`segIdx`, stable across windows)                 |
| time slice        | window `k`                                                |
| click a session   | click a segment → resolve to the cohort it belongs to at that window |
| target session    | per-window cohort with largest intersection with clicked session |

## 3. Architecture

### 3.1 Shared module — `storyline_align.js`

A new **classic script** exposing a global `window.StorylineAlign`, loaded via
`<script src>` **before** `storyline.js` and `storyline_peryear.js` in both HTML
pages. Matches the existing no-build, IIFE + CDN-d3 setup (no ES-module import,
no bundler). The module is **pure** — no DOM, no canvas — so it is unit-testable
in Node.

Public surface:

- `weightedLCS(a, b, weightFn) -> alignedPairs` — the alignment primitive the
  codebase currently lacks. Weighted Longest-Common-Subsequence over two ordered
  lists, using `weightFn(itemA, itemB)` for match weight.
- `enforceAlignOrder(road, clickedCohort, opts) -> { order, memberWithinGroupOrder }`
  — returns new per-window `order[k]` and `memberWithinGroupOrder[k]`, in the
  **same shape** that `buildRoadStructure`'s barycenter sweep produces today, so
  it drops into the existing geometry step unchanged.

### 3.2 Integration point

`buildRoadStructure(road)` gains an optional argument, e.g.
`buildRoadStructure(road, { enforceCohort })`. When `enforceCohort` is set for
that road, the barycenter ordering pass is replaced by
`StorylineAlign.enforceAlignOrder(...)`; everything downstream (geometry, hit
index) is unchanged. When unset, behavior is identical to today.

## 4. Algorithm (faithful paper Step 2 re-run)

Entities = segments; `segIdx` is stable across windows, so a session's entity
set is `members` (segIdx list) and session intersections are well-defined.

Given the clicked session `S0` = the cohort containing the clicked segment at
the clicked window, with member set `M0`:

1. **Target session per window.** For each window `k`, `target[k]` = the cohort
   maximizing `|members(cohort) ∩ M0|`. At the click window this is `S0`. This
   propagates the clicked session across all slices by max overlap (the paper's
   "largest intersection"). The existing overlap-count machinery
   (`storyline.js:656-703`, mutual-best-overlap) is reused.

2. **Loose-alignment gate.** Align `target[k]` and `target[k+1]` across a pair
   only if their shared-entity count `>= thc`. The JS has no `thc`; **default
   `thc = 1`** (any shared entity) for v1. (Future: could expose as a slider like
   the other thresholds — deferred, YAGNI.)

3. **Top/bottom split + LCS.** For each adjacent window pair, split each slice
   into a top part and bottom part by `target[k]`. Run `weightedLCS` on the two
   top parts and on the two bottom parts to order them; the target block is
   pinned between top and bottom. This is the paper's exact re-run.

Output: new `order[k]` / `memberWithinGroupOrder[k]` with the clicked cohort's
members at a constant sub-row across the windows it spans (straightened), and
the top/bottom partition preserved.

## 5. Interaction & state (single-click toggle — "Option 1")

- Add a `canvas` **click** handler reusing `onCanvasMouseMove`'s hit-test
  (`hitIndex` + `nearestInSortedY`, `storyline.js:1432-1433`) to resolve a click
  to `{ roadIdx, segIdx }` and then to the cohort at that window.
- New state: `state.enforcedAlign = { roadIdx, cohortKey } | null`.
- **Click a segment** → set `enforcedAlign` to its cohort, recompute **that
  road's** geometry via `enforceAlignOrder`, redraw.
- **Toggle off** when: the same cohort is clicked again, empty space is clicked,
  or a no-cohort singleton (`w.s == null`) is clicked → clear back to barycenter.
- Enforce is **per-road** (a click belongs to one road); other roads untouched.
- **Clear on data reload** (threshold toggle `thr=0.7/0.8`) since cohort ids
  change across datasets.

## 6. Rendering / recompute

Reuse the existing recompute path. `selectRoad()` already rebuilds geometry +
`hitIndex` and redraws (`storyline.js:1522`). Enforce follows the same flow:
mutate state → rebuild the affected road's structure (with `enforceCohort`) →
rebuild `hitIndex` → `draw()`. No new render pipeline. Per-road recompute is
small; synchronous recompute on click is acceptable (the paper notes full
layouts compute "within seconds"; per-road here is far smaller).

## 7. Error handling / edge cases

- **Clicked unit has no cohort** (`w.s == null`, singleton): clicking it clears
  any active enforcement (there is no session to align).
- **Data reload** (threshold toggle): clear `enforcedAlign` because cohort ids
  are not stable across datasets.
- **Clicked cohort spans a single window**: `enforceAlignOrder` still runs;
  with no adjacent pair to align, it degenerates to placing that cohort's block
  and ordering the rest — no crash.
- **Loose-alignment gate fails for a pair** (`< thc` shared entities): that pair
  is not force-aligned; ordering falls back to the LCS result without a pinned
  target link, matching the paper's conditional alignment.

## 8. Testing

- **Unit (Node):** `weightedLCS` and `enforceAlignOrder` against small synthetic
  road fixtures. Assert: (a) the clicked cohort's members occupy a constant
  sub-row across the windows it spans; (b) the top/bottom partition around the
  target is preserved; (c) `weightedLCS` returns the maximum-weight common
  subsequence on known inputs.
- **Manual/browser:** load `storyline.html` via the `/run` or browser tools,
  click a cohort, confirm it straightens and that a second click toggles back.
- **Test runner:** confirm the JS test setup during planning. Existing repo tests
  appear to be Python (per git log). If there is no JS runner, propose a minimal
  `node --test` harness for the pure module.

## 9. Out of scope

- Python builder changes (data builders stay as-is; static-figure builders
  `build_paper/segment/all_storyline.py` are unrelated to the interactive app).
- Exposing `thc`/`ths`/`thw` as interactive sliders in the JS.
- Any change to the barycenter behavior when no cohort is enforced.

## 10. Open items to resolve in the implementation plan

- Exact JS test runner / harness.
- Whether `storyline_peryear.js`'s data shape differs enough from `storyline.js`
  to need adapter logic in the shared module (both claim identical wire schema,
  to be verified).
