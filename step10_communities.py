"""
Step 10: Detect communities (sessions) with Louvain, per window.

Each window's relation network (Step 9) is partitioned into communities with the
Louvain method. One community = one evolution pattern / session = one Storyline
bundle for that window. Louvain needs no preset number of clusters.

All sections participating in the window are added as nodes (even if the spatial+
correlation gate left them with no edges) so the partition covers every section;
edgeless sections fall out as singleton sessions, which Step 11 will filter.

Inputs : step9_network_W5_<rule>/win*.npz (filtered edges + members)
Output : step10_communities_W5_<rule>.json  (per window: list of sessions, each
                                              a list of section indices)
         step10_summary_<rule>.json

Usage: python step10_communities.py [county|hwcounty]  (default: hwcounty)
"""
import json, os, sys
import numpy as np
import networkx as nx

RULE = sys.argv[1] if len(sys.argv) > 1 else "hwcounty"
assert RULE in ("county", "hwcounty")
THR  = float(sys.argv[2]) if len(sys.argv) > 2 else 0.7  # correlation threshold (matches step6)
tag  = "" if abs(THR - 0.7) < 1e-9 else f"_thr{round(THR*100)}"

IN_DIR  = f"step9_network_W5_{RULE}{tag}"
SEED    = 42

windows_out = []
summary = {"seed": SEED, "windows": []}
print(f"{'win':>3} {'nodes':>7} {'edges':>8} {'sessions':>9} "
      f"{'singletons':>11} {'largest':>8}")

for fn in sorted(os.listdir(IN_DIR)):
    if not fn.endswith(".npz"):
        continue
    k = int(fn[3:5])
    d = np.load(os.path.join(IN_DIR, fn))
    i, j, members = d["i"].tolist(), d["j"].tolist(), d["members"].tolist()

    G = nx.Graph()
    G.add_nodes_from(members)                       # every participating section
    G.add_edges_from(zip(i, j))                     # binary (unweighted) edges

    comms = nx.community.louvain_communities(G, seed=SEED)   # list of sets
    sessions = [sorted(int(x) for x in c) for c in comms]
    sessions.sort(key=len, reverse=True)

    sizes = [len(s) for s in sessions]
    singles = sum(1 for s in sizes if s == 1)
    windows_out.append({"k": k, "n_nodes": G.number_of_nodes(),
                        "n_edges": G.number_of_edges(), "sessions": sessions})
    summary["windows"].append({"k": k, "n_nodes": G.number_of_nodes(),
                               "n_edges": G.number_of_edges(),
                               "n_sessions": len(sessions),
                               "n_singletons": singles,
                               "largest_session": max(sizes) if sizes else 0})
    print(f"{k:>3} {G.number_of_nodes():>7} {G.number_of_edges():>8} "
          f"{len(sessions):>9} {singles:>11} {max(sizes) if sizes else 0:>8}")

json.dump({"windows": windows_out}, open(f"step10_communities_W5_{RULE}{tag}.json", "w"))
json.dump(summary, open(f"step10_summary_{RULE}{tag}.json", "w"), indent=2)
print(f"\nwrote step10_communities_W5_{RULE}{tag}.json + step10_summary_{RULE}{tag}.json")
