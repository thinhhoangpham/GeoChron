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
        lvl_e = pairwise_edges([level[i] for i in members], cols, THR, MIN_OVERLAP)
        spr_e = pairwise_edges([spread[i] for i in members], cols, THR, MIN_OVERLAP)
        both = and_edges(lvl_e, spr_e)
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
