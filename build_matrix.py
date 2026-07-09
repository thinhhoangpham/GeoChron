"""
GeoChron adaptation for PMIS data.
Step 1: Define entities (stable section IDs).
Step 2: Build the section x year matrix of condition scores
        (length-weighted collapse of duplicate section-year records,
         keep sections observed in >= MIN_YEARS years).
"""
import csv, collections, json

SRC = "PMIS_merged.csv"
MIN_YEARS = 10          # Step 2: keep sections observed in >= N years
SCORE_COL = "TX_CONDITION_SCORE"

# ---- Step 1: build stable section ID ----------------------------------------
# A section is a half-mile segment, uniquely identified by:
#   roadbed id  +  begin reference marker  +  begin marker displacement
# (displacement 0.0 / 0.5 distinguishes the two half-mile segments at a marker)
# NOTE: a DFO-half-mile-bin key was tested to recover the ~10k one-year
# fragments, but it over-merged distinct pavements (11,589 section-years with
# >20pt spread) and yielded fewer long-history sections (13,693 < 14,812).
# The marker tuple is a faithful per-record id (duplicate cells have 0 spread),
# so we keep it. The dropped short-lived sections are genuinely short-lived.
def section_id(row):
    rdbd = row["TX_SIGNED_HIGHWAY_RDBD_ID"].strip()
    mrkr = row["TX_BEG_REF_MARKER_NBR"].strip()
    disp = row["TX_BEG_REF_MRKR_DISP"].strip()
    return f"{rdbd}|{mrkr}|{disp}"

def fnum(s):
    s = (s or "").strip()
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None

# accumulator: (section, year) -> [sum(score*len), sum(len), raw_count]
agg = collections.defaultdict(lambda: [0.0, 0.0, 0])
# section metadata (first seen) for downstream geometry join
meta = {}
years_seen = collections.defaultdict(set)

n_rows = skipped_no_score = skipped_no_len = 0
with open(SRC, encoding="utf-8", errors="replace", newline="") as f:
    for row in csv.DictReader(f):
        n_rows += 1
        sid = section_id(row)
        year = row["EFF_YEAR"].strip()
        score = fnum(row[SCORE_COL])
        length = fnum(row["TX_LENGTH"])
        # 0 is a missing/sentinel code (shares 4-23% pre-2017, exactly 0%
        # from 2017 on) -> treat as absent, not a genuine condition of 0.
        if score is None or score == 0:
            skipped_no_score += 1
            continue
        # length-weighted average; fall back to weight 1.0 if length missing
        w = length if (length is not None and length > 0) else 1.0
        if length is None or length <= 0:
            skipped_no_len += 1
        cell = agg[(sid, year)]
        cell[0] += score * w
        cell[1] += w
        cell[2] += 1
        years_seen[sid].add(year)
        if sid not in meta:
            meta[sid] = {
                "section_id": sid,
                "roadbed": row["TX_SIGNED_HIGHWAY_RDBD_ID"].strip(),
                "begin_marker": row["TX_BEG_REF_MARKER_NBR"].strip(),
                "begin_disp": row["TX_BEG_REF_MRKR_DISP"].strip(),
                "district": row["RESPONSIBLE_DISTRICT"].strip(),
                "county": row["COUNTY"].strip(),
                "pavtype": row["BROAD_PAV_TYPE"].strip(),
                "begin_dfo": row["BEGINNING DFO"].strip(),
                "end_dfo": row["ENDING DFO"].strip(),
            }

# ---- Step 2: pivot to section x year, then filter by coverage ---------------
all_years = sorted({y for (_, y) in agg.keys()}, key=int)

kept = [sid for sid, ys in years_seen.items() if len(ys) >= MIN_YEARS]
kept.sort()

# write the matrix (wide: one row per section, one col per year)
matrix_path = "section_year_matrix.csv"
with open(matrix_path, "w", encoding="utf-8", newline="") as f:
    w = csv.writer(f)
    w.writerow(["section_id"] + all_years)
    for sid in kept:
        out = [sid]
        for y in all_years:
            cell = agg.get((sid, y))
            if cell and cell[1] > 0:
                out.append(round(cell[0] / cell[1], 3))
            else:
                out.append("")          # gap -> handled in Step 3
        w.writerow(out)

# write section metadata (entities) for later geometry join + map
meta_path = "sections_meta.csv"
with open(meta_path, "w", encoding="utf-8", newline="") as f:
    cols = ["section_id", "roadbed", "begin_marker", "begin_disp",
            "district", "county", "pavtype", "begin_dfo", "end_dfo", "n_years"]
    w = csv.DictWriter(f, fieldnames=cols)
    w.writeheader()
    for sid in kept:
        m = dict(meta[sid]); m["n_years"] = len(years_seen[sid])
        w.writerow(m)

# ---- report -----------------------------------------------------------------
total_sections = len(years_seen)
dup_cells = sum(1 for c in agg.values() if c[2] > 1)
cov = collections.Counter(len(ys) for ys in years_seen.values())
print(f"rows read              : {n_rows}")
print(f"skipped (no score)     : {skipped_no_score}")
print(f"records w/o usable len : {skipped_no_len}")
print(f"year range             : {all_years[0]}..{all_years[-1]} ({len(all_years)} yrs)")
print(f"unique sections (all)  : {total_sections}")
print(f"sections kept (>= {MIN_YEARS})  : {len(kept)}")
print(f"section-year cells     : {len(agg)}")
print(f"  of which collapsed >1 : {dup_cells}")
print(f"wrote {matrix_path}, {meta_path}")
summary = {
    "min_years": MIN_YEARS, "years": all_years,
    "sections_all": total_sections, "sections_kept": len(kept),
    "duplicate_cells_collapsed": dup_cells,
}
json.dump(summary, open("step12_summary.json", "w"), indent=2)
