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
