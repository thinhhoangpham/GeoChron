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
