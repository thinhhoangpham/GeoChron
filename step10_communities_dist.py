"""
Step 10 (distance-gate variant): Louvain communities per window on the
distance-gated network from step8_network_dist.py.

Non-destructive clone of step10_communities.py -- identical Louvain logic (same
SEED, every participating section added as a node so singletons are covered) --
but reads the dist{THD}{tag} network and writes distinctly named community files
so it never collides with the county / hwcounty step10 outputs.

Inputs : step9_network_W5_dist{THD}{tag}/win*.npz
Output : step10_communities_W5_dist{THD}{tag}.json  (per window: list of sessions)
         step10_summary_dist{THD}{tag}.json

Usage: python step10_communities_dist.py [THD_KM] [THR]  (defaults 10.0, 0.7)
"""
import json, os, sys
import numpy as np
import networkx as nx

THD  = float(sys.argv[1]) if len(sys.argv) > 1 else 10.0
THR  = float(sys.argv[2]) if len(sys.argv) > 2 else 0.7
tag  = "" if abs(THR - 0.7) < 1e-9 else f"_thr{round(THR*100)}"
dtag = f"dist{THD:g}"

IN_DIR = f"step9_network_W5_{dtag}{tag}"
SEED   = 42

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
    G.add_nodes_from(members)
    G.add_edges_from(zip(i, j))

    comms = nx.community.louvain_communities(G, seed=SEED)
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

json.dump({"windows": windows_out}, open(f"step10_communities_W5_{dtag}{tag}.json", "w"))
json.dump(summary, open(f"step10_summary_{dtag}{tag}.json", "w"), indent=2)
print(f"\nwrote step10_communities_W5_{dtag}{tag}.json + step10_summary_{dtag}{tag}.json")
