"""
Step 16: Emit the front-end JSON for the Storyline.

Produces a session-level (cohort-level) graph: one node per kept session, one link
per cross-window transition (Step 12). Each node carries the data the Storyline
needs: window, size, mean condition score over the window, and a dominant
roadbed/county label for tooltips.

Inputs : windows_W5.json, step11_sessions_W5.json, step12_transitions_W5.json,
         section_year_matrix.csv, sections_meta.csv
Output : storyline_W5.json
"""
import csv, json, collections
import numpy as np

# ---- raw scores -------------------------------------------------------------
r = csv.reader(open("section_year_matrix.csv", encoding="utf-8"))
hdr = next(r)
SCORES, mat_sections = [], []
for row in r:
    mat_sections.append(row[0])
    SCORES.append([float(v) if v != "" else np.nan for v in row[1:]])
SCORES = np.array(SCORES, dtype=np.float32)

win = json.load(open("windows_W5.json", encoding="utf-8"))
W, years, sections = win["W"], win["years"], win["sections"]
assert sections == mat_sections
yidx = {y: i for i, y in enumerate(years)}

# ---- meta: roadbed, county per section index --------------------------------
rm = csv.reader(open("sections_meta.csv", encoding="utf-8"))
mh = next(rm); ci = {n: k for k, n in enumerate(mh)}
pos = {sid: i for i, sid in enumerate(sections)}
roadbed = [""] * len(sections); county = [""] * len(sections)
for row in rm:
    p = pos.get(row[ci["section_id"]])
    if p is not None:
        roadbed[p] = row[ci["roadbed"]]; county[p] = row[ci["county"]]

# ---- sessions + transitions -------------------------------------------------
sess_data = json.load(open("step11_sessions_W5.json"))["windows"]
sess_data.sort(key=lambda w: w["k"])
trans = json.load(open("step12_transitions_W5.json"))["transitions"]

# window start year by k (from windows file, in order)
win_start = {k: win["windows"][k]["start"] for k in range(len(win["windows"]))}
win_end = {k: win["windows"][k]["end"] for k in range(len(win["windows"]))}

def dominant(items):
    return collections.Counter(items).most_common(1)[0][0] if items else ""

nodes = []
for w in sess_data:
    k = w["k"]
    cols = [yidx[y] for y in range(win_start[k], win_end[k] + 1)]
    for s, members in enumerate(w["sessions"]):
        sub = SCORES[np.ix_(members, cols)]
        mean_score = float(np.nanmean(sub)) if np.isfinite(sub).any() else None
        nodes.append({
            "id": f"{k}-{s}", "k": k, "s": s, "size": len(members),
            "mean_score": round(mean_score, 1) if mean_score is not None else None,
            "roadbed": dominant([roadbed[m] for m in members]),
            "county": dominant([county[m] for m in members]),
        })

links = [{"source": f"{t['from_k']}-{t['from_s']}",
          "target": f"{t['to_k']}-{t['to_s']}",
          "overlap": t["overlap"]} for t in trans]

windows_meta = [{"k": k, "start": win_start[k], "end": win_end[k],
                 "label": f"{win_start[k]}–{win_end[k]}"}
                for k in range(len(win["windows"]))]

out = {"W": W, "windows": windows_meta, "nodes": nodes, "links": links,
       "score_range": [0, 100]}
json.dump(out, open("storyline_W5.json", "w"))

szs = sorted((n["size"] for n in nodes), reverse=True)
print(f"nodes (sessions): {len(nodes):,}   links: {len(links):,}")
print(f"size: max={szs[0]} median={szs[len(szs)//2]} "
      f">=10: {sum(1 for x in szs if x>=10)}  >=20: {sum(1 for x in szs if x>=20)} "
      f" >=30: {sum(1 for x in szs if x>=30)}")
print("wrote storyline_W5.json")
