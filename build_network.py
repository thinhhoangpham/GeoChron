"""
Step 8 + Step 9: Spatial proximity gate, intersected with the correlation edges.

Proximity rule (Step 8): two sections are "spatially close" iff they share the
SAME roadbed (highway) AND the SAME county. This is a binary relation derived
purely from geography -- it never looks at condition scores.

Step 9 builds the per-window relation network by INTERSECTING the two filters:
an edge survives only if the pair is BOTH trend-correlated (Step 6/7 edge) AND
spatially close. The filters are kept separate and intersected, not summed.

Inputs : step6_edges_W5/win*.npz (correlation edges + members),
         windows_W5.json (section order), sections_meta.csv (roadbed, county)
Output : step9_network_W5/win*.npz (filtered edges i, j + members)
         step9_summary.json
"""
import csv, json, os
import numpy as np

WIN_FILE = "windows_W5.json"
META     = "sections_meta.csv"
IN_DIR   = "step6_edges_W5"
OUT_DIR  = "step9_network_W5"

# ---- section order (matches matrix / correlation indices) -------------------
win = json.load(open(WIN_FILE, encoding="utf-8"))
sections = win["sections"]
sec_pos = {sid: i for i, sid in enumerate(sections)}

# ---- proximity key per section: (roadbed, county) -> int group id -----------
r = csv.reader(open(META, encoding="utf-8"))
hdr = next(r)
ci = {name: k for k, name in enumerate(hdr)}
group = np.full(len(sections), -1, dtype=np.int64)   # -1 = unknown, matches nothing
key2gid, next_gid = {}, 0
for row in r:
    sid = row[ci["section_id"]]
    p = sec_pos.get(sid)
    if p is None:
        continue
    key = (row[ci["roadbed"]], row[ci["county"]])
    gid = key2gid.get(key)
    if gid is None:
        gid = key2gid[key] = next_gid
        next_gid += 1
    group[p] = gid
n_unknown = int((group < 0).sum())

os.makedirs(OUT_DIR, exist_ok=True)

# ---- intersect each window's correlation edges with the proximity gate ------
summary = {"rule": "same roadbed AND same county",
           "n_proximity_groups": next_gid,
           "sections_without_meta": n_unknown,
           "windows": []}
tot_in = tot_out = 0
print(f"{'win':>3} {'corr_edges':>12} {'kept':>11} {'retained%':>10}")
for fn in sorted(os.listdir(IN_DIR)):
    if not fn.endswith(".npz"):
        continue
    k = int(fn[3:5])
    d = np.load(os.path.join(IN_DIR, fn))
    i, j, members = d["i"], d["j"], d["members"]
    # both endpoints in the same (roadbed, county) group, and group known (>=0)
    gi, gj = group[i], group[j]
    keep = (gi == gj) & (gi >= 0)
    fi, fj = i[keep], j[keep]
    np.savez_compressed(os.path.join(OUT_DIR, fn),
                        i=fi.astype(np.int32), j=fj.astype(np.int32),
                        members=members)
    n_in, n_out = int(i.size), int(fi.size)
    tot_in += n_in; tot_out += n_out
    pct = (100.0 * n_out / n_in) if n_in else 0.0
    summary["windows"].append({"k": k, "corr_edges": n_in,
                               "kept": n_out, "retained_pct": round(pct, 3)})
    print(f"{k:>3} {n_in:>12} {n_out:>11} {pct:>9.3f}%")

summary["total_corr_edges"] = tot_in
summary["total_kept"] = tot_out
summary["overall_retained_pct"] = round(100.0 * tot_out / tot_in, 3) if tot_in else 0.0
json.dump(summary, open("step9_summary.json", "w"), indent=2)
print(f"\nproximity groups (roadbed x county): {next_gid:,}"
      f"   sections without meta: {n_unknown}")
print(f"total edges: {tot_in:,} -> kept {tot_out:,} "
      f"({summary['overall_retained_pct']}%)")
print(f"wrote {OUT_DIR}/win*.npz + step9_summary.json")
