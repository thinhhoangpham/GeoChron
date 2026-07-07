"""
GeoChron Step 1/2 -- GeoJSON-sourced experiment (branch: pipeline-from-geojson).

Non-destructive replica of build_matrix.py that reads the results_dfo_highway
LineString GeoJSON files instead of PMIS_merged.csv. Reproduces the exact
Step-1 (stable section id) and Step-2 (length-weighted collapse + coverage
filter) semantics, and additionally extracts a representative centroid
coordinate per kept section from the road geometry.

Writes ONLY new *_geo files. Overwrites nothing.
"""
import os, glob, json, csv, collections

SRC_DIR   = "results_dfo_highway"
MIN_YEARS = 10                    # keep sections observed in >= N years
SCORE_COL = "TX_CONDITION_SCORE"


def geo_to_roadbed(rid):
    """Convert dashed GeoJSON roadbed id (e.g. 'BI0020E-KG') to the compact
    fixed-width pipeline convention (e.g. 'BI0020EK'). Exact transform per spec."""
    if not rid or "-" not in rid:
        return None
    pre, post = rid.split("-", 1)
    return f"{pre:<7}{post[0]}" if post else None


def fnum(v):
    """Coerce a GeoJSON property value to float, or None if absent/invalid."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip()
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def fmt_marker(v):
    n = fnum(v)
    return None if n is None else str(int(round(n)))


def fmt_disp(v):
    n = fnum(v)
    return None if n is None else str(n)      # 0.0 -> "0.0", 0.5 -> "0.5"


def clean(v):
    return "" if v is None else str(v).strip()


def centroid(coords):
    """Mean of a LineString's [lon,lat] coordinate pairs, rounded to 6 dp."""
    xs = ys = 0.0
    n = 0
    for pt in coords:
        if len(pt) >= 2:
            xs += pt[0]; ys += pt[1]; n += 1
    if n == 0:
        return None
    return (round(xs / n, 6), round(ys / n, 6))


# accumulator: (section, year) -> [sum(score*len), sum(len), raw_count]
agg        = collections.defaultdict(lambda: [0.0, 0.0, 0])
meta       = {}                                  # section_id -> metadata (first seen)
coords_by  = {}                                  # section_id -> (lon, lat)
years_seen = collections.defaultdict(set)

n_rows = skipped_no_score = skipped_no_len = skipped_no_rdbd = 0

files = sorted(glob.glob(os.path.join(SRC_DIR, "pmis_lines_*.geojson")))
print(f"found {len(files)} GeoJSON files in {SRC_DIR}/")

for path in files:
    with open(path, encoding="utf-8", errors="replace") as fh:
        gj = json.load(fh)
    feats = gj.get("features", [])
    for feat in feats:
        n_rows += 1
        p = feat.get("properties", {}) or {}

        roadbed = geo_to_roadbed(clean(p.get("TX_SIGNED_HIGHWAY_RDBD_ID")))
        if roadbed is None:
            skipped_no_rdbd += 1
            continue
        marker = fmt_marker(p.get("TX_BEG_REF_MARKER_NBR"))
        disp   = fmt_disp(p.get("TX_BEG_REF_MRKR_DISP"))
        if marker is None or disp is None:
            skipped_no_rdbd += 1
            continue
        sid  = f"{roadbed}|{marker}|{disp}"

        year = p.get("EFF_YEAR")
        year = None if year is None else str(int(year)) if isinstance(year, (int, float)) else str(year).strip()

        score  = fnum(p.get(SCORE_COL))
        length = fnum(p.get("TX_LENGTH"))
        # 0 is a missing/sentinel code -> treat as absent (verbatim from build_matrix.py)
        if score is None or score == 0:
            skipped_no_score += 1
            continue

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
                "section_id":   sid,
                "roadbed":      roadbed,
                "begin_marker": marker,
                "begin_disp":   disp,
                "district":     clean(p.get("RESPONSIBLE_DISTRICT")),
                "county":       clean(p.get("COUNTY")),
                "pavtype":      clean(p.get("BROAD_PAV_TYPE")),
                "begin_dfo":    clean(p.get("start_dfo", p.get("BEGINNING DFO"))),
                "end_dfo":      clean(p.get("end_dfo",   p.get("ENDING DFO"))),
            }
        # geometry is ~static across years: capture from first year the section appears
        if sid not in coords_by:
            geom = feat.get("geometry") or {}
            gtype = geom.get("type")
            gcoords = geom.get("coordinates")
            line = None
            if gtype == "LineString":
                line = gcoords
            elif gtype == "MultiLineString" and gcoords:
                line = [pt for seg in gcoords for pt in seg]
            if line:
                c = centroid(line)
                if c is not None:
                    coords_by[sid] = c

    del gj, feats          # free the ~30MB parsed file before the next one

# ---- Step 2: pivot + coverage filter ----------------------------------------
all_years = sorted({y for (_, y) in agg.keys()}, key=int)
kept = sorted(sid for sid, ys in years_seen.items() if len(ys) >= MIN_YEARS)

matrix_path = "section_year_matrix_geo.csv"
with open(matrix_path, "w", encoding="utf-8", newline="") as f:
    w = csv.writer(f)
    w.writerow(["section_id"] + all_years)
    for sid in kept:
        out = [sid]
        for y in all_years:
            cell = agg.get((sid, y))
            out.append(round(cell[0] / cell[1], 3) if (cell and cell[1] > 0) else "")
        w.writerow(out)

meta_path = "sections_meta_geo.csv"
with open(meta_path, "w", encoding="utf-8", newline="") as f:
    cols = ["section_id", "roadbed", "begin_marker", "begin_disp",
            "district", "county", "pavtype", "begin_dfo", "end_dfo",
            "n_years", "lon", "lat"]
    w = csv.DictWriter(f, fieldnames=cols)
    w.writeheader()
    for sid in kept:
        m = dict(meta[sid])
        m["n_years"] = len(years_seen[sid])
        c = coords_by.get(sid)
        m["lon"], m["lat"] = (c[0], c[1]) if c else ("", "")
        w.writerow(m)

# ---- summary ----------------------------------------------------------------
roadbeds = {meta[s]["roadbed"] for s in kept}
counties = {meta[s]["county"] for s in kept}
units    = {(meta[s]["roadbed"], meta[s]["county"]) for s in kept}
with_coord = sum(1 for s in kept if s in coords_by)

print("---- Step 1/2 (GeoJSON) summary ----")
print(f"features read          : {n_rows}")
print(f"skipped (no roadbed/mrkr): {skipped_no_rdbd}")
print(f"skipped (no score)     : {skipped_no_score}")
print(f"records w/o usable len : {skipped_no_len}")
print(f"year range             : {all_years[0]}..{all_years[-1]} ({len(all_years)} yrs)")
print(f"unique sections (all)  : {len(years_seen)}")
print(f"sections kept (>= {MIN_YEARS})  : {len(kept)}")
print(f"distinct roadbeds      : {len(roadbeds)}")
print(f"distinct counties      : {len(counties)}")
print(f"distinct (roadbed,county) units : {len(units)}")
print(f"kept w/ coordinate     : {with_coord}")
print(f"kept w/o coordinate    : {len(kept) - with_coord}")
print(f"wrote {matrix_path}, {meta_path}")
