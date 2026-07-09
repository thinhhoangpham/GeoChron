"""
Step 11: Session filtering (paper-faithful), ths = 5.

The paper deletes a session ONLY IF BOTH hold:
  1) its size is less than ths, AND
  2) none of its member entities appear in a session of size >= ths in the two
     neighboring windows (k-1 and k+1).

So a small session -- even a singleton loner -- is KEPT if any of its members
belongs to a large session in an adjacent window (a brief one-window gap in an
otherwise continuous group membership is not discarded).

Inputs : step10_communities_W5.json
Output : step11_sessions_W5.json  (kept sessions per window)
         step11_summary.json
"""
import json

THS = 5

W = json.load(open("step10_communities_W5.json"))["windows"]
W.sort(key=lambda w: w["k"])
n = len(W)

# For each window, the set of segments that are in a LARGE (>=THS) session there.
large_members = []
for w in W:
    s = set()
    for sess in w["sessions"]:
        if len(sess) >= THS:
            s.update(sess)
    large_members.append(s)

out_windows = []
summary = {"ths": THS, "rule": "drop iff size<ths AND no member in a >=ths "
           "session in either neighbor window", "windows": []}
tot_before = tot_after = tot_rescued = 0

for idx, w in enumerate(W):
    prev_large = large_members[idx - 1] if idx > 0 else set()
    next_large = large_members[idx + 1] if idx < n - 1 else set()
    neighbor_large = prev_large | next_large

    kept = []
    rescued = 0
    for sess in w["sessions"]:
        if len(sess) >= THS:
            kept.append(sess)                       # large: always kept
        elif any(m in neighbor_large for m in sess):
            kept.append(sess)                       # small but feeds a neighbor
            rescued += 1
        # else: dropped

    kept.sort(key=len, reverse=True)
    out_windows.append({"k": w["k"], "start_idx": idx, "sessions": kept})

    nb, na = len(w["sessions"]), len(kept)
    tot_before += nb; tot_after += na; tot_rescued += rescued
    summary["windows"].append({
        "k": w["k"], "sessions_before": nb, "sessions_after": na,
        "rescued_small": rescued,
        "largest": max((len(s) for s in kept), default=0),
        "segments_in_kept": sum(len(s) for s in kept)})

json.dump({"ths": THS, "windows": out_windows},
          open("step11_sessions_W5.json", "w"))
summary["total_sessions_before"] = tot_before
summary["total_sessions_after"] = tot_after
summary["total_rescued_small"] = tot_rescued
json.dump(summary, open("step11_summary.json", "w"), indent=2)

print(f"ths={THS}")
print(f"{'win':>3} {'before':>7} {'after':>6} {'rescued':>8} {'largest':>8} {'segs':>7}")
for s in summary["windows"]:
    print(f"{s['k']:>3} {s['sessions_before']:>7} {s['sessions_after']:>6} "
          f"{s['rescued_small']:>8} {s['largest']:>8} {s['segments_in_kept']:>7}")
print(f"\nsessions: {tot_before:,} -> {tot_after:,}   "
      f"(rescued {tot_rescued:,} small sessions via neighbor rule)")
print("wrote step11_sessions_W5.json + step11_summary.json")
