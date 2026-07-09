"""
Step 6 + Step 7 (geo variant): pairwise trend correlation per window, on the
GEO-sourced matrix, thresholded to binary edges.

Non-destructive clone of step6_corr.py. Identical all-pairs pairwise-complete
Pearson math (vectorized, blocked), but reads section_year_matrix_geo.csv +
windows_W5_geo.json and writes to a distinct geo edge dir so it never collides
with the PMIS step6_edges_W5{tag}/ outputs.

  Step 6  pairwise-complete Pearson, require >= MIN_OVERLAP real common years.
  Step 7  a pair is "trend-correlated" iff r > THR  -> binary edge (yes/no).

Inputs : windows_W5_geo.json (membership + section order), section_year_matrix_geo.csv
Output : step6_edges_W5_geo{tag}/win{k:02d}.npz  (arrays i, j, members : int32)
         step6_summary_geo{tag}.json

Usage: python step6_corr_geo.py [THR]   (default THR=0.7)
"""
import csv, json, os, sys
import numpy as np

WIN_FILE    = "windows_W5_geo.json"
MATRIX      = "section_year_matrix_geo.csv"
THR         = float(sys.argv[1]) if len(sys.argv) > 1 else 0.7
tag         = "" if abs(THR - 0.7) < 1e-9 else f"_thr{round(THR*100)}"
OUT_DIR     = f"step6_edges_W5_geo{tag}"
MIN_OVERLAP = 4       # min real overlapping years for a pair to count
BLOCK       = 1500    # rows per block (memory vs speed)

# ---- load raw scores into a dense array, NaN for gaps -----------------------
r = csv.reader(open(MATRIX, encoding="utf-8"))
hdr = next(r)
mat_sections, rows = [], []
for row in r:
    mat_sections.append(row[0])
    vals = [float(v) if v != "" else np.nan for v in row[1:]]
    rows.append(vals)
SCORES = np.array(rows, dtype=np.float32)            # (n_sections, n_years)

win = json.load(open(WIN_FILE, encoding="utf-8"))
W, years, sections, windows = win["W"], win["years"], win["sections"], win["windows"]
assert sections == mat_sections, "section order mismatch (geo)"
yidx = {y: i for i, y in enumerate(years)}
os.makedirs(OUT_DIR, exist_ok=True)

def window_edges(members, cols):
    """All-pairs pairwise-complete Pearson > THR within one window.
    Returns (i_idx, j_idx) global section indices, j > i."""
    M = SCORES[np.ix_(members, cols)]                # (N, W) raw, NaN gaps
    mask = np.isfinite(M).astype(np.float32)
    M0 = np.where(mask > 0, M, 0.0).astype(np.float32)
    M0sq = M0 * M0
    N = M.shape[0]
    gidx = np.asarray(members)
    out_i, out_j = [], []
    for a in range(0, N, BLOCK):
        b = min(a + BLOCK, N)
        mB, m0B, m0sB = mask[a:b], M0[a:b], M0sq[a:b]
        n   = mB   @ mask.T
        Sx  = m0B  @ mask.T
        Sy  = mB   @ M0.T
        Sxx = m0sB @ mask.T
        Syy = mB   @ M0sq.T
        Sxy = m0B  @ M0.T
        num = n * Sxy - Sx * Sy
        vx  = n * Sxx - Sx * Sx
        vy  = n * Syy - Sy * Sy
        den = np.sqrt(np.clip(vx, 0, None) * np.clip(vy, 0, None))
        col = np.arange(N)[None, :]
        gi  = np.arange(a, b)[:, None]
        keep = (n >= MIN_OVERLAP) & (den > 0) & (col > gi)
        with np.errstate(invalid="ignore", divide="ignore"):
            rr = np.where(den > 0, num / den, 0.0)
        keep &= rr > THR
        bi, bj = np.nonzero(keep)
        if bi.size:
            out_i.append(gidx[a + bi])
            out_j.append(gidx[bj])
    if out_i:
        return np.concatenate(out_i), np.concatenate(out_j)
    return np.empty(0, np.int32), np.empty(0, np.int32)

summary = {"W": W, "THR": THR, "MIN_OVERLAP": MIN_OVERLAP,
           "n_windows": len(windows), "windows": []}
total_edges = 0
print(f"{'win':>3} {'years':>11} {'nodes':>7} {'edges':>12} {'density':>9}")
for k, w in enumerate(windows):
    s = yidx[w["start"]]
    cols = list(range(s, s + W))
    members = w["section_idx"]
    i_idx, j_idx = window_edges(members, cols)
    np.savez_compressed(os.path.join(OUT_DIR, f"win{k:02d}.npz"),
                        i=i_idx.astype(np.int32), j=j_idx.astype(np.int32),
                        members=np.asarray(members, np.int32))
    N = len(members)
    poss = N * (N - 1) / 2
    dens = (i_idx.size / poss) if poss else 0.0
    total_edges += int(i_idx.size)
    summary["windows"].append({"k": k, "start": w["start"], "end": w["end"],
                               "n_nodes": N, "n_edges": int(i_idx.size),
                               "density": round(dens, 6)})
    print(f"{k:>3} {w['start']}-{w['end']} {N:>7} {i_idx.size:>12} {dens:>9.5f}")

summary["total_edges"] = total_edges
json.dump(summary, open(f"step6_summary_geo{tag}.json", "w"), indent=2)
print(f"\ntotal edges across {len(windows)} windows: {total_edges:,}")
print(f"wrote {OUT_DIR}/win*.npz + step6_summary_geo{tag}.json")
