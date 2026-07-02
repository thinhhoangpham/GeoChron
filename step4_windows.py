"""
Step 4: Slice the time span into overlapping multi-year windows.

Each window of width W steps forward by 1 year and acts as one Storyline
slice. A section *participates* in a window only if it has >= MIN_OBS REAL
(non-gap) observations inside that window -- a necessary condition for it to
form any pairwise-complete correlation (Step 6) at MIN_OVERLAP. No gaps are
filled; we just count and index the real points.

Outputs (per chosen W):
  windows_W{W}.json  -- window definitions + participating section index
"""
import csv, json, collections

MATRIX = "section_year_matrix.csv"
MIN_OBS = 4          # min real observations for a section to join a window
WIDTHS = [5, 6, 7]   # candidate window widths to compare

# ---- load matrix ------------------------------------------------------------
r = csv.reader(open(MATRIX, encoding="utf-8"))
hdr = next(r)
years = [int(y) for y in hdr[1:]]
yidx = {y: i for i, y in enumerate(years)}
sections = []          # section_id
obs = []               # list of {year_index: score} for observed cells
for row in r:
    sections.append(row[0])
    d = {}
    for i, v in enumerate(row[1:]):
        if v != "":
            d[i] = float(v)
    obs.append(d)
n_sec = len(sections)

def windows_for(W):
    """Return list of (start_year, end_year, [col indices])."""
    out = []
    for s in range(0, len(years) - W + 1):
        cols = list(range(s, s + W))
        out.append((years[s], years[s + W - 1], cols))
    return out

# ---- build + report each width ----------------------------------------------
summary = {}
for W in WIDTHS:
    wins = windows_for(W)
    part_counts = []          # participating sections per window
    sec_window_count = collections.Counter()   # how many windows each section joins
    win_records = []
    for (y0, y1, cols) in wins:
        cset = set(cols)
        members = [i for i in range(n_sec)
                   if sum(1 for c in obs[i] if c in cset) >= MIN_OBS]
        part_counts.append(len(members))
        for i in members:
            sec_window_count[i] += 1
        win_records.append({"start": y0, "end": y1,
                             "n_sections": len(members),
                             "section_idx": members})
    sec_in_any = sum(1 for i in range(n_sec) if sec_window_count[i] > 0)
    out = {"W": W, "MIN_OBS": MIN_OBS, "years": years,
           "sections": sections, "windows": win_records}
    json.dump(out, open(f"windows_W{W}.json", "w"))
    avg = sum(part_counts) / len(part_counts)
    summary[W] = {
        "n_windows": len(wins),
        "avg_sections_per_window": round(avg),
        "min_sections_per_window": min(part_counts),
        "max_sections_per_window": max(part_counts),
        "sections_in_>=1_window": sec_in_any,
        "sections_in_0_windows": n_sec - sec_in_any,
    }

print(f"sections in matrix: {n_sec}   years: {years[0]}..{years[-1]}\n")
print(f"{'W':>2} {'#win':>5} {'avg/win':>8} {'min':>6} {'max':>6} "
      f"{'in>=1win':>9} {'in0win':>7}")
for W in WIDTHS:
    s = summary[W]
    print(f"{W:>2} {s['n_windows']:>5} {s['avg_sections_per_window']:>8} "
          f"{s['min_sections_per_window']:>6} {s['max_sections_per_window']:>6} "
          f"{s['sections_in_>=1_window']:>9} {s['sections_in_0_windows']:>7}")
json.dump(summary, open("step4_summary.json", "w"), indent=2)
