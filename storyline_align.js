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

    // Assign each non-target group a side ("top"/"bottom") relative to its
    // window's target. Seed from base position (before/after the target), then
    // propagate a STABLE partition outward from the clicked (anchor) window so a
    // cohort stays on the same side across windows even when the barycenter
    // sweep drifted the target above or below it. Without this propagation the
    // side would be dictated purely by base position and a cohort could flip
    // sides whenever the target crossed it -- breaking the paper's straightened
    // partition.
    const sideByWindow = new Array(numWindows);
    for (let k = 0; k < numWindows; k++) {
      const t = targetGroupByWindow[k];
      const m = new Map();
      if (t) {
        const ti = base.order[k].indexOf(t);
        base.order[k].forEach((g, i) => { if (g !== t) m.set(g, i < ti ? "top" : "bottom"); });
      }
      sideByWindow[k] = m;
    }

    // Carry sides from a reference window to a neighbour when their targets are
    // loosely aligned (share >= thc entities). Matched groups inherit the
    // reference side via member-overlap LCS; unmatched groups keep their base
    // side.
    function propagate(fromK, toK) {
      const tPrev = targetGroupByWindow[fromK], tCurr = targetGroupByWindow[toK];
      if (!(tPrev && tCurr && intersectionSize(tPrev.members, tCurr.members) >= thc)) return;
      const prevGroups = base.order[fromK].filter((g) => g !== tPrev);
      const currGroups = base.order[toK].filter((g) => g !== tCurr);
      const weight = (g, p) => intersectionSize(g.members, p.members);
      const pairs = weightedLCS(currGroups, prevGroups, weight);
      for (const [ci, pi] of pairs) {
        const s = sideByWindow[fromK].get(prevGroups[pi]);
        if (s) sideByWindow[toK].set(currGroups[ci], s);
      }
    }

    let anchor = targetGroupByWindow[clicked.k] ? clicked.k : targetGroupByWindow.findIndex((t) => t);
    if (anchor >= 0) {
      for (let k = anchor + 1; k < numWindows; k++) propagate(k - 1, k);
      for (let k = anchor - 1; k >= 0; k--) propagate(k + 1, k);
    }

    // Reassemble: top-side groups, then target, then bottom-side groups. Keep
    // intra-side order stable by LCS-aligning to the previous window's same-side
    // list when the targets are loosely aligned.
    const order = new Array(numWindows);
    let prevTop = [], prevBottom = [];
    for (let k = 0; k < numWindows; k++) {
      const t = targetGroupByWindow[k];
      if (!t) { order[k] = base.order[k].slice(); prevTop = []; prevBottom = []; continue; }
      let top = [], bottom = [];
      for (const g of base.order[k]) {
        if (g === t) continue;
        (sideByWindow[k].get(g) === "bottom" ? bottom : top).push(g);
      }
      const tPrev = targetGroupByWindow[k - 1];
      const gated = k > 0 && tPrev && intersectionSize(tPrev.members, t.members) >= thc;
      if (gated) {
        top = alignListToPrev(top, prevTop);
        bottom = alignListToPrev(bottom, prevBottom);
      }
      order[k] = top.concat([t], bottom);
      prevTop = top; prevBottom = bottom;
    }
    return { order, memberWithinGroupOrder: base.memberWithinGroupOrder, targetKeyByWindow };
  }

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

  const StorylineAlign = { weightedLCS, enforceAlignOrder, targetTopPad };

  if (typeof module !== "undefined" && module.exports) module.exports = StorylineAlign;
  if (typeof window !== "undefined") window.StorylineAlign = StorylineAlign;
})();
