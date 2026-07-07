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
