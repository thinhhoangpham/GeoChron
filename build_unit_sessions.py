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
