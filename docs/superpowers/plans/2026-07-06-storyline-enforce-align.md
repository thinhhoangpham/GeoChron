# Storyline Enforce-Alignment (click-to-align) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the GeoChron paper's interactive "Enforce Alignment of Sessions" — click a cohort in the Storyline and its evolution is straightened by re-running Step 2 (Aligning) with a faithful weighted-LCS top/bottom split around the target session.

**Architecture:** A new pure, dependency-free module `storyline_align.js` (dual-exposed as `window.StorylineAlign` for the browser and `module.exports` for Node tests) holds the weighted-LCS primitive and the enforce-align ordering transform. The two interactive renderers (`storyline.js`, `storyline_peryear.js`) call it from `buildRoadStructure` when a cohort is enforced on that road, add a canvas click handler to set/toggle enforcement, and pad the target's top-y in `buildGeometry` so the cohort is truly straightened. No Python or data-format changes.

**Tech Stack:** Plain ES2017+ classic scripts (no bundler, no build step), d3 from CDN (unrelated to this feature), Node 22 `node:test` for unit tests, pytest is the repo's existing (Python-only) suite and is not used here.

## Global Constraints

- No build step. `storyline_align.js` MUST be a classic script (no ES `import`/`export`), loaded via `<script src>`. Dual-expose via `if (typeof module !== "undefined" && module.exports) module.exports = StorylineAlign; if (typeof window !== "undefined") window.StorylineAlign = StorylineAlign;`.
- The module MUST be pure: no DOM, no canvas, no `window`/`document` access inside functions.
- `enforceAlignOrder` MUST return the exact same shape the barycenter sweep produces today: `{ order, memberWithinGroupOrder }` where `order[k]` is an array of the same group objects from `groupsAtK[k]` (each carrying `.key`, `.members`, and a freshly-set `._sortedMembers`), and `memberWithinGroupOrder[k]` is a `Map<segIdx, positionWithinGroup>`.
- Group `.key` strings: real cohorts start with `"s:"`, unaffiliated units start with `"singleton:"`. Only `"s:"` groups are eligible to be a target session (paper aligns sessions, not singletons).
- `segIdx` is stable across windows; a cohort's entity set is its `members` array of `segIdx`.
- Default loose-alignment threshold `thc = 1` (any shared entity). Not user-configurable in v1.
- Changes to `storyline.js` MUST be mirrored in `storyline_peryear.js` (near-identical files); the shared logic lives only in `storyline_align.js`.

---

## Task 1: Weighted-LCS primitive in the shared module

**Files:**
- Create: `storyline_align.js`
- Test: `tests/js/storyline_align.test.js`

**Interfaces:**
- Produces: `StorylineAlign.weightedLCS(a, b, weight) -> Array<[i, j]>` — `a`, `b` are arrays; `weight(a[i], b[j]) -> number >= 0` (0 means "not matchable"). Returns an order-preserving list of index pairs (strictly increasing in both `i` and `j`) maximizing the summed weight of matched pairs.

- [ ] **Step 1: Write the failing test**

Create `tests/js/storyline_align.test.js`:

```javascript
const test = require("node:test");
const assert = require("node:assert");
const StorylineAlign = require("../../storyline_align.js");

test("weightedLCS matches identical sequences fully in order", () => {
  const a = ["x", "y", "z"];
  const b = ["x", "y", "z"];
  const w = (p, q) => (p === q ? 1 : 0);
  const pairs = StorylineAlign.weightedLCS(a, b, w);
  assert.deepStrictEqual(pairs, [[0, 0], [1, 1], [2, 2]]);
});

test("weightedLCS skips non-matchable items and stays order-preserving", () => {
  const a = ["x", "q", "z"];
  const b = ["x", "z"];
  const w = (p, q) => (p === q ? 1 : 0);
  const pairs = StorylineAlign.weightedLCS(a, b, w);
  assert.deepStrictEqual(pairs, [[0, 0], [2, 1]]);
});

test("weightedLCS prefers the higher total weight over more pairs", () => {
  // one heavy match (weight 10) beats two light matches (weight 1 each)
  const a = ["A", "B"];
  const b = ["B", "A"]; // order conflict: can only keep one
  const w = (p, q) => (p !== q ? 0 : p === "A" ? 10 : 1);
  const pairs = StorylineAlign.weightedLCS(a, b, w);
  assert.deepStrictEqual(pairs, [[0, 1]]); // A<->A (weight 10)
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/js/storyline_align.test.js`
Expected: FAIL — `Cannot find module '../../storyline_align.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `storyline_align.js`:

```javascript
/* ============================================================================
 * Storyline enforce-alignment (pure, no DOM). Implements the GeoChron paper's
 * "Enforce Alignment of Sessions": weighted-LCS re-run of Step 2 with a
 * top/bottom split around the target session. Dual-exposed for browser
 * (window.StorylineAlign) and Node tests (module.exports).
 * ==========================================================================*/
(function () {
  "use strict";

  // Order-preserving max-weight common subsequence between arrays a and b.
  // weight(a[i], b[j]) >= 0; 0 means the pair cannot be matched. Returns
  // [[i, j], ...] strictly increasing in both indices.
  function weightedLCS(a, b, weight) {
    const n = a.length, m = b.length;
    // dp[i][j] = best total weight using a[0..i-1], b[0..j-1]
    const dp = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= m; j++) {
        const w = weight(a[i - 1], b[j - 1]);
        const diag = w > 0 ? dp[i - 1][j - 1] + w : -Infinity;
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1], diag);
      }
    }
    const pairs = [];
    let i = n, j = m;
    while (i > 0 && j > 0) {
      const w = weight(a[i - 1], b[j - 1]);
      if (w > 0 && dp[i][j] === dp[i - 1][j - 1] + w) {
        pairs.push([i - 1, j - 1]);
        i--; j--;
      } else if (dp[i - 1][j] >= dp[i][j - 1]) {
        i--;
      } else {
        j--;
      }
    }
    pairs.reverse();
    return pairs;
  }

  const StorylineAlign = { weightedLCS };

  if (typeof module !== "undefined" && module.exports) module.exports = StorylineAlign;
  if (typeof window !== "undefined") window.StorylineAlign = StorylineAlign;
})();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/js/storyline_align.test.js`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add storyline_align.js tests/js/storyline_align.test.js
git commit -m "feat(storyline): add weighted-LCS primitive in shared align module"
```

---

## Task 2: `enforceAlignOrder` transform

**Files:**
- Modify: `storyline_align.js`
- Test: `tests/js/storyline_align.test.js`

**Interfaces:**
- Consumes: `weightedLCS` (Task 1).
- Produces: `StorylineAlign.enforceAlignOrder(base, ctx) -> { order, memberWithinGroupOrder, targetKeyByWindow }`
  - `base`: `{ order: Array<Group[]>, memberWithinGroupOrder: Array<Map<segIdx,int>> }` — the barycenter result to post-process. `Group = { key: string, members: number[], _sortedMembers: number[] }`.
  - `ctx`: `{ groupsAtK: Array<Group[]>, numWindows: number, clicked: { k: number, s: (string|number) }, thc: number }`.
  - Returns the same `order`/`memberWithinGroupOrder` shape plus `targetKeyByWindow: Array<string|null>` (the chosen target group `.key` per window, for geometry padding in Task 4).
  - `enforceAlignOrder` reuses `base.memberWithinGroupOrder` unchanged and reuses each group's existing `._sortedMembers`; it only reorders the group arrays in `order[k]`.

- [ ] **Step 1: Write the failing test**

Append to `tests/js/storyline_align.test.js`:

```javascript
// Build a 3-window fixture. Cohort "s:C" persists across all windows and
// shares members; two other cohorts flank it. base order deliberately puts
// the flankers in a window-varying order so LCS re-alignment is observable.
function group(key, members) {
  return { key, members, _sortedMembers: members.slice() };
}
function fixture() {
  // window 0: [top:A(1,2), target:C(3,4), bottom:B(5,6)]
  // window 1: [top:A(1,2), bottom:B(5,6), target:C(3,4)]  <- C drifted down
  // window 2: [target:C(3,4), top:A(1,2), bottom:B(5,6)]  <- C drifted up
  const w0 = [group("s:A", [1, 2]), group("s:C", [3, 4]), group("s:B", [5, 6])];
  const w1 = [group("s:A", [1, 2]), group("s:B", [5, 6]), group("s:C", [3, 4])];
  const w2 = [group("s:C", [3, 4]), group("s:A", [1, 2]), group("s:B", [5, 6])];
  const order = [w0, w1, w2];
  const mwgo = order.map((gs) => {
    const m = new Map();
    for (const g of gs) g._sortedMembers.forEach((seg, pos) => m.set(seg, pos));
    return m;
  });
  const groupsAtK = order.map((gs) => gs.slice());
  return { base: { order, memberWithinGroupOrder: mwgo }, groupsAtK };
}

test("enforceAlignOrder keeps the clicked cohort contiguous with a stable partition", () => {
  const { base, groupsAtK } = fixture();
  const res = StorylineAlign.enforceAlignOrder(base, {
    groupsAtK,
    numWindows: 3,
    clicked: { k: 0, s: "C" },
    thc: 1,
  });
  // target is s:C in every window (shares members 3,4 with clicked M0)
  assert.deepStrictEqual(res.targetKeyByWindow, ["s:C", "s:C", "s:C"]);
  // In every window, the cohorts above the target are the SAME set as below is
  // the SAME set across windows -> the partition is stable (A always on the
  // same side of C, B always on the other).
  const sideOf = (gs, memberSet) => {
    const ti = gs.findIndex((g) => g.key === "s:C");
    const ai = gs.findIndex((g) => g.key === memberSet);
    return ai < ti ? "top" : "bottom";
  };
  const aSides = res.order.map((gs) => sideOf(gs, "s:A"));
  const bSides = res.order.map((gs) => sideOf(gs, "s:B"));
  assert.deepStrictEqual(aSides, ["top", "top", "top"]);
  assert.deepStrictEqual(bSides, ["bottom", "bottom", "bottom"]);
});

test("enforceAlignOrder returns base order untouched for windows with no target overlap", () => {
  const { base, groupsAtK } = fixture();
  // clicked cohort has members that exist in NO window -> no target anywhere
  const res = StorylineAlign.enforceAlignOrder(base, {
    groupsAtK,
    numWindows: 3,
    clicked: { k: 0, s: "ZZZ" },
    thc: 1,
  });
  assert.deepStrictEqual(res.targetKeyByWindow, [null, null, null]);
  // order unchanged from base
  res.order.forEach((gs, k) =>
    assert.deepStrictEqual(gs.map((g) => g.key), base.order[k].map((g) => g.key))
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/js/storyline_align.test.js`
Expected: FAIL — `enforceAlignOrder is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `storyline_align.js`, inside the IIFE and before the `StorylineAlign` object literal, add:

```javascript
  function intersectionSize(membersA, membersB) {
    const set = new Set(membersA);
    let c = 0;
    for (const x of membersB) if (set.has(x)) c++;
    return c;
  }

  // Reorder `curr` (array of Group) so groups matched (by member overlap) to
  // `prev` follow prev's order; unmatched groups keep their relative position
  // near their base neighbours. Deterministic; returns a new array.
  function alignListToPrev(curr, prev) {
    if (prev.length === 0 || curr.length === 0) return curr.slice();
    const weight = (g, p) => intersectionSize(g.members, p.members);
    const pairs = weightedLCS(curr, prev, weight); // [[currIdx, prevIdx], ...]
    const matchRank = new Map(); // currIdx -> prevIdx
    for (const [ci, pi] of pairs) matchRank.set(ci, pi);
    // Assign each curr group a sortable rank: matched -> prevIdx; unmatched ->
    // last matched prevIdx seen while walking curr in base order, plus a small
    // increment so it lands just after its preceding matched neighbour.
    const ranks = new Array(curr.length);
    let lastRank = -1, tie = 0;
    for (let i = 0; i < curr.length; i++) {
      if (matchRank.has(i)) { lastRank = matchRank.get(i); tie = 0; ranks[i] = lastRank; }
      else { tie += 1; ranks[i] = lastRank + tie / (curr.length + 1); }
    }
    const idx = curr.map((_, i) => i);
    idx.sort((x, y) => (ranks[x] - ranks[y]) || (x - y)); // stable on ties
    return idx.map((i) => curr[i]);
  }

  // base: { order, memberWithinGroupOrder }; ctx: { groupsAtK, numWindows,
  // clicked:{k,s}, thc }. Returns { order, memberWithinGroupOrder,
  // targetKeyByWindow }.
  function enforceAlignOrder(base, ctx) {
    const { groupsAtK, numWindows, clicked, thc } = ctx;
    const clickedKey = "s:" + clicked.s;
    const clickedGroup = (groupsAtK[clicked.k] || []).find((g) => g.key === clickedKey);
    const M0 = clickedGroup ? clickedGroup.members : [];

    // Target session per window = "s:"-group with the largest intersection
    // with M0 (>0). Null if none overlaps.
    const targetKeyByWindow = new Array(numWindows).fill(null);
    const targetGroupByWindow = new Array(numWindows).fill(null);
    for (let k = 0; k < numWindows; k++) {
      let best = null, bestC = 0;
      for (const g of base.order[k]) {
        if (!g.key.startsWith("s:")) continue;
        const c = intersectionSize(g.members, M0);
        if (c > bestC) { bestC = c; best = g; }
      }
      if (best) { targetKeyByWindow[k] = best.key; targetGroupByWindow[k] = best; }
    }

    // Split each window's base order into top / target / bottom.
    const parts = new Array(numWindows);
    for (let k = 0; k < numWindows; k++) {
      const t = targetGroupByWindow[k];
      if (!t) { parts[k] = { top: base.order[k].slice(), target: null, bottom: [] }; continue; }
      const ti = base.order[k].indexOf(t);
      parts[k] = {
        top: base.order[k].slice(0, ti),
        target: t,
        bottom: base.order[k].slice(ti + 1),
      };
    }

    // Forward sweep: LCS-align each window's top part to the previous window's
    // top part, and likewise bottom. The loose-align gate (thc) governs whether
    // the previous window is used as a reference: only carry the partition
    // forward when consecutive targets share >= thc entities.
    for (let k = 1; k < numWindows; k++) {
      const tPrev = targetGroupByWindow[k - 1];
      const tCurr = targetGroupByWindow[k];
      const gated =
        tPrev && tCurr && intersectionSize(tPrev.members, tCurr.members) >= thc;
      if (!gated) continue;
      parts[k].top = alignListToPrev(parts[k].top, parts[k - 1].top);
      parts[k].bottom = alignListToPrev(parts[k].bottom, parts[k - 1].bottom);
    }

    // Reassemble.
    const order = new Array(numWindows);
    for (let k = 0; k < numWindows; k++) {
      const p = parts[k];
      order[k] = p.target ? p.top.concat([p.target], p.bottom) : p.top.slice();
    }
    return { order, memberWithinGroupOrder: base.memberWithinGroupOrder, targetKeyByWindow };
  }
```

Then extend the exported object:

```javascript
  const StorylineAlign = { weightedLCS, enforceAlignOrder };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/js/storyline_align.test.js`
Expected: PASS — 5 tests total.

- [ ] **Step 5: Commit**

```bash
git add storyline_align.js tests/js/storyline_align.test.js
git commit -m "feat(storyline): add enforceAlignOrder LCS top/bottom re-run"
```

---

## Task 3: Wire the transform into `buildRoadStructure` + load the module

**Files:**
- Modify: `storyline.js:875` (return of `buildRoadStructure`), `storyline.js:878-880` (`buildAllStructures`)
- Modify: `storyline.js:60-77` (state) — add `enforcedAlign`
- Modify: `storyline.html:77` — add `<script src="storyline_align.js">`
- Mirror all of the above in: `storyline_peryear.js`, `storyline_peryear.html`

**Interfaces:**
- Consumes: `StorylineAlign.enforceAlignOrder` (Task 2).
- Produces: `struct.enforceTargetKey: Array<string|null> | null` on each road structure (used by Task 4). `state.enforcedAlign: { roadIdx, k, s } | null` (set by Task 5).

- [ ] **Step 1: Add the state field**

In `storyline.js`, in the `state` object literal (after line 72 `hover: null,`), add:

```javascript
    enforcedAlign: null,  // { roadIdx, k, s } | null - active click-to-align cohort
```

- [ ] **Step 2: Branch `buildRoadStructure` to use the transform when enforced**

In `storyline.js`, `buildRoadStructure` currently ends at line 875:

```javascript
    return { segKMap, groupsAtK, order, memberWithinGroupOrder, nodeColorTrack, segCount: n };
```

`buildRoadStructure` is invoked as `state.data.roads.map(buildRoadStructure)`, so its second parameter is the road index. Change the signature and the return. Replace the function header line `function buildRoadStructure(road) {` (line 605) with:

```javascript
  function buildRoadStructure(road, roadIdx) {
```

and replace the `return` at line 875 with:

```javascript
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
```

- [ ] **Step 3: Make `buildAllStructures` pass the index**

`Array.prototype.map` already passes `(road, index)` to `buildRoadStructure`, so `state.data.roads.map(buildRoadStructure)` at line 879 needs no change. Verify by reading line 878-880 — leave as-is.

- [ ] **Step 4: Load the shared module before the renderer**

In `storyline.html`, before line 78 (`<script src="storyline.js"></script>`), add:

```html
  <script src="storyline_align.js"></script>
```

- [ ] **Step 5: Mirror into the per-year renderer**

Apply Steps 1, 2, 4 identically to `storyline_peryear.js` (same `state` field; same `buildRoadStructure` signature + return change — the function is structurally identical) and add `<script src="storyline_align.js"></script>` before `<script src="storyline_peryear.js"></script>` in `storyline_peryear.html` (line 73).

- [ ] **Step 6: Smoke-check the wiring in Node**

There is no browser assertion yet (Task 5 adds the click); confirm nothing throws when `enforcedAlign` is null by loading both files' syntax:

Run: `node --check storyline.js && node --check storyline_peryear.js && node --check storyline_align.js`
Expected: no output, exit 0 (all three parse).

- [ ] **Step 7: Commit**

```bash
git add storyline.js storyline_peryear.js storyline.html storyline_peryear.html
git commit -m "feat(storyline): wire enforceAlignOrder into buildRoadStructure"
```

---

## Task 4: Straighten the target by padding its top-y in `buildGeometry`

**Files:**
- Modify: `storyline.js:885-950` (`buildGeometry`)
- Mirror in: `storyline_peryear.js` (`buildGeometry`)

**Interfaces:**
- Consumes: `struct.enforceTargetKey` (Task 3), `struct.order` (existing).
- Produces: geometry where, for the enforced road, the target group's top-y is constant across windows (the paper's straightened cohort).

**Why:** `buildGeometry` stacks groups top-down per window (line 901-936). When the number/size of top-part groups varies window to window, the target cohort's y drifts. To straighten, compute the max top-part height across windows for the enforced road and pad each window's target start-y up to that maximum.

- [ ] **Step 1: Write the failing test**

The straightening is a DOM/geometry behavior verified in the browser (Task 6), but the pad computation is pure arithmetic worth isolating. Add a helper to `storyline_align.js` and test it. Append to `tests/js/storyline_align.test.js`:

```javascript
test("targetTopPad equalizes target start rows across windows", () => {
  // top-part member counts per window before the target: [2, 0, 5]
  // rowPx=4 -> top heights [8,0,20]; laneGap=48 applied before target when
  // top part non-empty. Expected pad so every target starts at the max top-y.
  const topCounts = [2, 0, 5];
  const pads = StorylineAlign.targetTopPad(topCounts, { rowPx: 4, laneGap: 48 });
  // window with the tallest top part gets pad 0; others padded up to it.
  assert.strictEqual(Math.min(...pads), 0);
  assert.strictEqual(pads.length, 3);
  // the window with the largest top part (index 2) is the reference (pad 0)
  assert.strictEqual(pads[2], 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/js/storyline_align.test.js`
Expected: FAIL — `targetTopPad is not a function`.

- [ ] **Step 3: Implement `targetTopPad` in the shared module**

In `storyline_align.js`, add before the exported object:

```javascript
  // Given the number of member-rows in each window's top part (the groups
  // above the target), return per-window vertical pad (px) so every window's
  // target group starts at the same y (the tallest top part becomes the
  // reference with pad 0). topCounts[k] is the total member count above the
  // target at window k; a non-empty top part also consumes one laneGap before
  // the target, matching buildGeometry's stacking.
  function targetTopPad(topCounts, opts) {
    const rowPx = opts.rowPx, laneGap = opts.laneGap;
    const topY = topCounts.map((c) => (c > 0 ? c * rowPx + laneGap : 0));
    const maxY = topY.reduce((a, b) => (b > a ? b : a), 0);
    return topY.map((y) => maxY - y);
  }
```

Extend the export:

```javascript
  const StorylineAlign = { weightedLCS, enforceAlignOrder, targetTopPad };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/js/storyline_align.test.js`
Expected: PASS — 6 tests total.

- [ ] **Step 5: Apply the pad in `buildGeometry`**

In `storyline.js` `buildGeometry`, the per-road loop starts at line 892. Before the `for (let k ...)` window loop (line 901), compute the pad array for enforced roads. Insert after line 900 (`let roadHeight = 0;`):

```javascript
      // Enforce-align straightening: pad each window's top part so the target
      // cohort starts at a constant y across windows (paper Fig. 4D).
      let targetPad = null;
      if (struct.enforceTargetKey) {
        const topCounts = new Array(state.numWindows).fill(0);
        for (let k = 0; k < state.numWindows; k++) {
          const tk = struct.enforceTargetKey[k];
          if (!tk) continue;
          for (const g of struct.order[k]) {
            if (g.key === tk) break;
            topCounts[k] += g._sortedMembers.length;
          }
        }
        targetPad = StorylineAlign.targetTopPad(topCounts, { rowPx, laneGap });
      }
```

Then, inside the window loop, apply the pad as leading whitespace before laying out groups. Replace the loop's initializer `let y = 0;` (line 904) with:

```javascript
        let y = targetPad ? targetPad[k] : 0;
```

- [ ] **Step 6: Mirror into the per-year renderer**

Apply Steps 5 identically to `storyline_peryear.js` `buildGeometry` (structurally identical block).

- [ ] **Step 7: Syntax check**

Run: `node --check storyline.js && node --check storyline_peryear.js && node --test tests/js/storyline_align.test.js`
Expected: parse OK; 6 tests pass.

- [ ] **Step 8: Commit**

```bash
git add storyline.js storyline_peryear.js storyline_align.js tests/js/storyline_align.test.js
git commit -m "feat(storyline): straighten enforced cohort via target top-y padding"
```

---

## Task 5: Canvas click handler, toggle, and clear-on-reload

**Files:**
- Modify: `storyline.js:1403-1445` (add click handler next to the mousemove handler)
- Modify: `storyline.js:500-518` (clear `enforcedAlign` on data load)
- Mirror in: `storyline_peryear.js`

**Interfaces:**
- Consumes: `hitIndex`, `nearestInSortedY`, `state.enforcedAlign`, `buildAllStructures`, `buildGeometry`, `render` (all existing), `struct.segKMap` (existing on structures).
- Produces: user interaction that sets/toggles `state.enforcedAlign` and recomputes.

- [ ] **Step 1: Add the click handler**

In `storyline.js`, immediately after the `canvas.addEventListener("mouseleave", ...)` block (ends line 1407), add:

```javascript
  canvas.addEventListener("click", onCanvasClick);

  function onCanvasClick(evt) {
    if (!hitIndex) return;
    const rect = canvasWrap.getBoundingClientRect();
    const x = evt.clientX - rect.left + state.scrollLeft;
    const y = evt.clientY - rect.top + state.scrollTop;
    const k = Math.round((x - MARGIN_LEFT - state.colW / 2) / colPitch());

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
```

- [ ] **Step 2: Clear enforcement when new data loads**

In `storyline.js`, `loadData` builds structures at lines 514-515. Immediately before `buildAllStructures();` (line 514), add:

```javascript
          state.enforcedAlign = null;
```

- [ ] **Step 3: Mirror into the per-year renderer**

Apply Steps 1-2 to `storyline_peryear.js` at the structurally identical locations (the mousemove/mouseleave block and the `loadData` structure-build).

- [ ] **Step 4: Syntax check**

Run: `node --check storyline.js && node --check storyline_peryear.js`
Expected: parse OK, exit 0.

- [ ] **Step 5: Commit**

```bash
git add storyline.js storyline_peryear.js
git commit -m "feat(storyline): add click-to-align toggle and clear-on-reload"
```

---

## Task 6: Browser verification

**Files:** none (manual verification of the running app).

- [ ] **Step 1: Serve the app locally**

Run: `python -m http.server 8777`
(The app fetches `storyline_data_hwcounty.json` over HTTP; opening the file via `file://` will fail CORS.)

- [ ] **Step 2: Load and click a cohort**

Open `http://localhost:8777/storyline.html`. Using the browser tools (`mcp__claude-in-chrome__*`) or manually:
- Confirm the page renders the Storyline as before (no regression when nothing is clicked).
- Click on a visible cohort bar (a thick colored band, not a thin singleton line).
- Expected: that cohort straightens into a constant-height horizontal band across the windows it spans; cohorts above/below it re-order to line up (fewer diagonal crossings around it).

- [ ] **Step 3: Toggle off**

Click the same cohort again (or click empty space).
Expected: layout returns to the default barycenter arrangement.

- [ ] **Step 4: Verify clear-on-reload**

Enforce a cohort, then toggle the correlation threshold (the `Threshold` control, `thr=0.7`↔`0.8`).
Expected: the new dataset loads with no enforcement active (default layout).

- [ ] **Step 5: Repeat on the per-year page**

Open `http://localhost:8777/storyline_peryear.html` and repeat Steps 2-4.
Expected: identical behavior.

- [ ] **Step 6: Final commit (if any doc updates)**

No code change expected here. If verification surfaced a bug, fix it under the relevant task's TDD cycle, then re-run `node --test tests/js/storyline_align.test.js` before committing.

---

## Self-Review Notes

- **Spec coverage:** §3 shared module → Tasks 1-2; §4 algorithm (target propagation, loose-align gate `thc=1`, top/bottom LCS) → Task 2; §5 interaction (single-click toggle, per-road, clear-on-reload, singleton clears) → Task 5; §6 recompute via existing path → Task 5 `recomputeEnforce`; §8 unit + browser tests → Tasks 1/2/4 (Node) + Task 6 (browser). §7 edge cases: no-cohort click → Task 5 `cell.s == null`; single-window target → Task 2 (no adjacent pair, gate simply skips); gate-fail pair → Task 2 `if (!gated) continue`.
- **Beyond spec (flagged):** Task 4 (`targetTopPad` geometry straightening) is required to deliver the spec's "constant sub-row" outcome, which ordering alone cannot due to top-down stacking. Called out to the user before planning.
- **Type consistency:** `enforceAlignOrder(base, ctx)` returns `{ order, memberWithinGroupOrder, targetKeyByWindow }`; consumed in Task 3 (`res.order`/`res.memberWithinGroupOrder`/`res.targetKeyByWindow`) and Task 4 reads `struct.enforceTargetKey`. `state.enforcedAlign = { roadIdx, k, s }` set in Task 5, read in Task 3. Consistent throughout.
