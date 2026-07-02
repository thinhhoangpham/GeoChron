"""
Step 5: Normalize each section's W-year sub-trajectory *within each window*.

For every (section, window) pair we take the section's REAL observations inside
that window and rescale them so "correlated" (Step 6) means *same deterioration
rhythm* rather than *same absolute score* -- a section sitting at 90 and one at
50 can land in the same cohort if they fall at the same pace.

Gaps are preserved: a year the section was never observed stays null. Values are
aligned to the window's W year-columns so Step 6 can do pairwise-complete Pearson
by simply intersecting the non-null columns of two sections.

NORM options
  "zscore" (default) -- (v - mean) / std over the section's observed years in the
                        window. NOTE: Pearson is invariant to this, so for a
                        Pearson Step 6 it is a no-op on the correlation itself --
                        but it is what Step 17's normalized-cohort motif draws,
                        and it stops being a no-op under Euclidean/DTW.
  "minmax"           -- (v - min) / (max - min), maps the window to [0, 1].
A flat sub-trajectory (std == 0 / max == min) normalizes to all zeros.

Inputs : windows_W5.json (membership + cols), section_year_matrix.csv (scores)
Output : normalized_W5.json, step5_summary.json
"""
import csv, json, math

WIN_FILE = "windows_W5.json"
MATRIX   = "section_year_matrix.csv"
NORM     = "zscore"      # "zscore" | "minmax"
ND       = 4             # decimals to round normalized values

# ---- load matrix scores (col index -> score), in matrix row order -----------
r = csv.reader(open(MATRIX, encoding="utf-8"))
hdr = next(r)
mat_sections, obs = [], []
for row in r:
    mat_sections.append(row[0])
    obs.append({i: float(v) for i, v in enumerate(row[1:]) if v != ""})

# ---- load window definitions ------------------------------------------------
win = json.load(open(WIN_FILE, encoding="utf-8"))
W, years, sections, windows = win["W"], win["years"], win["sections"], win["windows"]
assert sections == mat_sections, "section order mismatch between matrix and windows file"
yidx = {y: i for i, y in enumerate(years)}

def normalize(vals):
    """vals: list of observed floats. Returns list rescaled per NORM."""
    if NORM == "zscore":
        m = sum(vals) / len(vals)
        sd = math.sqrt(sum((v - m) ** 2 for v in vals) / len(vals))
        if sd == 0:
            return [0.0] * len(vals)
        return [(v - m) / sd for v in vals]
    if NORM == "minmax":
        lo, hi = min(vals), max(vals)
        if hi == lo:
            return [0.0] * len(vals)
        return [(v - lo) / (hi - lo) for v in vals]
    raise ValueError(f"unknown NORM {NORM!r}")

# ---- normalize every (section, window) --------------------------------------
out_windows = []
n_traj = 0
n_flat = 0
for w in windows:
    s = yidx[w["start"]]
    cols = list(range(s, s + W))
    recs = []
    for idx in w["section_idx"]:
        o = obs[idx]
        present = [(c, o[c]) for c in cols if c in o]   # observed (col, score)
        raw = [v for _, v in present]
        norm = normalize(raw)
        if all(x == 0.0 for x in norm):
            n_flat += 1
        # align back to the W columns, null where the section had a gap
        valmap = {c: round(nv, ND) for (c, _), nv in zip(present, norm)}
        vals = [valmap.get(c) for c in cols]            # None for gap years
        recs.append({"idx": idx, "vals": vals})
        n_traj += 1
    out_windows.append({"start": w["start"], "end": w["end"],
                        "cols": cols, "n_sections": len(recs),
                        "sections": recs})

out = {"W": W, "NORM": NORM, "years": years, "section_ids": sections,
       "windows": out_windows}
json.dump(out, open(f"normalized_W{W}.json", "w"))

summary = {
    "W": W, "NORM": NORM, "n_windows": len(out_windows),
    "n_section_window_trajectories": n_traj,
    "n_flat_trajectories": n_flat,
    "first_window": {"start": out_windows[0]["start"], "end": out_windows[0]["end"],
                     "n_sections": out_windows[0]["n_sections"]},
}
json.dump(summary, open("step5_summary.json", "w"), indent=2)

print(f"NORM={NORM}  W={W}  windows={len(out_windows)}")
print(f"section-window trajectories normalized: {n_traj}")
print(f"flat (zero-variance) trajectories: {n_flat}  ({100*n_flat/n_traj:.1f}%)")
print(f"wrote normalized_W{W}.json + step5_summary.json")
