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
