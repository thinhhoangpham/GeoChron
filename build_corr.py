"""
Step 6 + Step 7: Pairwise trend correlation per window, thresholded to binary.

Faithful to the paper's Step 2: for EVERY pair of sections participating in a
window we compute the Pearson correlation on the RAW scores (no normalization --
Pearson is scale/shift invariant anyway), using only the years BOTH sections were
actually observed inside that window (pairwise-complete, no interpolated points).

  Step 6  pairwise-complete Pearson, require >= MIN_OVERLAP real common years.
  Step 7  a pair is "trend-correlated" iff r > THR  -> binary edge (yes/no).

No spatial gate here -- this is genuine all-pairs, as the paper computes it. The
spatial proximity filter is Step 8 and is intersected with these edges in Step 9.

Vectorized with numpy. Pairwise-complete stats over gaps via masked matrix
products; rows processed in blocks to bound memory. Only the upper triangle
(j > i) is emitted, so each undirected edge appears once.

Inputs : windows_W5.json (membership + cols), section_year_matrix.csv (raw)
Output : step6_edges_W5/win{k:02d}.npz  (arrays i, j : int32 section indices)
         step6_summary.json
"""
import csv, json, os
import numpy as np

WIN_FILE    = "windows_W5.json"
MATRIX      = "section_year_matrix.csv"
OUT_DIR     = "step6_edges_W5"
THR         = 0.7     # Step 7 correlation threshold
MIN_OVERLAP = 4       # min real overlapping years for a pair to count
BLOCK       = 1500    # rows per block (memory vs speed)

# ---- load raw scores into a dense array, NaN for gaps -----------------------
r = csv.reader(open(MATRIX, encoding="utf-8"))
hdr = next(r)
n_cols = len(hdr) - 1
mat_sections, rows = [], []
for row in r:
    mat_sections.append(row[0])
    vals = [float(v) if v != "" else np.nan for v in row[1:]]
    rows.append(vals)
SCORES = np.array(rows, dtype=np.float32)            # (n_sections, n_years)

win = json.load(open(WIN_FILE, encoding="utf-8"))
W, years, sections, windows = win["W"], win["years"], win["sections"], win["windows"]
assert sections == mat_sections, "section order mismatch"
yidx = {y: i for i, y in enumerate(years)}
os.makedirs(OUT_DIR, exist_ok=True)

def window_edges(members, cols):
    """All-pairs pairwise-complete Pearson > THR within one window.
    Returns (i_idx, j_idx) global section indices, j > i."""
    M = SCORES[np.ix_(members, cols)]                # (N, W) raw, NaN gaps
    mask = np.isfinite(M).astype(np.float32)         # 1 where observed
    M0 = np.where(mask > 0, M, 0.0).astype(np.float32)
    M0sq = M0 * M0
    N = M.shape[0]
    gidx = np.asarray(members)
    out_i, out_j = [], []
    for a in range(0, N, BLOCK):
        b = min(a + BLOCK, N)
        mB, m0B, m0sB = mask[a:b], M0[a:b], M0sq[a:b]
        n   = mB   @ mask.T          # overlap counts        (B, N)
        Sx  = m0B  @ mask.T          # sum x over overlap
        Sy  = mB   @ M0.T            # sum y over overlap
        Sxx = m0sB @ mask.T
        Syy = mB   @ M0sq.T
        Sxy = m0B  @ M0.T
        num = n * Sxy - Sx * Sy
        vx  = n * Sxx - Sx * Sx
        vy  = n * Syy - Sy * Sy
        den = np.sqrt(np.clip(vx, 0, None) * np.clip(vy, 0, None))
        # upper triangle only: global j > global i
        col = np.arange(N)[None, :]
        gi  = np.arange(a, b)[:, None]
        keep = (n >= MIN_OVERLAP) & (den > 0) & (col > gi)
        with np.errstate(invalid="ignore", divide="ignore"):
            r = np.where(den > 0, num / den, 0.0)
        keep &= r > THR
        bi, bj = np.nonzero(keep)
        if bi.size:
            out_i.append(gidx[a + bi])
            out_j.append(gidx[bj])
    if out_i:
        return np.concatenate(out_i), np.concatenate(out_j)
    return np.empty(0, np.int32), np.empty(0, np.int32)

# ---- run every window -------------------------------------------------------
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
json.dump(summary, open("step6_summary.json", "w"), indent=2)
print(f"\ntotal edges across {len(windows)} windows: {total_edges:,}")
print(f"wrote {OUT_DIR}/win*.npz + step6_summary.json")
