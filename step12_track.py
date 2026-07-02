"""
Step 12: Track sessions across consecutive windows.

For each consecutive window pair (k, k+1), link every session in window k to the
session in window k+1 with which it shares the most member segments (largest
membership overlap). These links are the curves that thread between bundles --
the Storyline's continuity.

Sessions are identified as (k, s) where k is the window index and s is the
session's position in that window's kept list (step11_sessions_W5.json, sorted
by size desc). A session with no overlap into the next window has no forward link
(a curve that ends).

Input  : step11_sessions_W5_<rule>.json
Output : step12_transitions_W5_<rule>.json  (forward links between sessions)
         step12_summary_<rule>.json

Usage: python step12_track.py [county|hwcounty]  (default: hwcounty)
"""
import json, collections, sys

RULE = sys.argv[1] if len(sys.argv) > 1 else "hwcounty"
assert RULE in ("county", "hwcounty")

data = json.load(open(f"step11_sessions_W5_{RULE}.json"))
THS = data["ths"]
W = data["windows"]
W.sort(key=lambda w: w["k"])
n = len(W)

# session sizes per window (for reporting / frontend)
sizes = [[len(s) for s in w["sessions"]] for w in W]

transitions = []
summary_rows = []
for a in range(n - 1):
    cur, nxt = W[a]["sessions"], W[a + 1]["sessions"]
    # map each segment -> next-window session index
    seg2next = {}
    for sj, sess in enumerate(nxt):
        for m in sess:
            seg2next[m] = sj
    linked = 0
    for si, sess in enumerate(cur):
        counts = collections.Counter(seg2next[m] for m in sess if m in seg2next)
        if not counts:
            continue                              # curve ends here
        sj, ov = counts.most_common(1)[0]
        transitions.append({"from_k": W[a]["k"], "from_s": si,
                            "to_k": W[a + 1]["k"], "to_s": sj,
                            "overlap": ov,
                            "from_size": len(sess), "to_size": len(nxt[sj])})
        linked += 1
    summary_rows.append({"from_window": W[a]["k"], "to_window": W[a + 1]["k"],
                         "sessions_from": len(cur), "linked": linked,
                         "ended": len(cur) - linked})

json.dump({"ths": THS, "n_windows": n, "sizes_per_window": sizes,
           "transitions": transitions},
          open(f"step12_transitions_W5_{RULE}.json", "w"))

summary = {"ths": THS, "n_windows": n, "n_transitions": len(transitions),
           "pairs": summary_rows}
json.dump(summary, open(f"step12_summary_{RULE}.json", "w"), indent=2)

print(f"[{RULE}] {'pair':>11} {'sessions':>9} {'linked':>7} {'ended':>6}")
for r in summary_rows:
    print(f"{r['from_window']:>3}->{r['to_window']:<3}     {r['sessions_from']:>9} "
          f"{r['linked']:>7} {r['ended']:>6}")
print(f"\ntotal forward links (curves between bundles): {len(transitions):,}")
print(f"wrote step12_transitions_W5_{RULE}.json + step12_summary_{RULE}.json")
