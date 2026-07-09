"""
GeoChron -- road-polyline layer for the map (branch: pipeline-from-geojson).

Emits section_lines_geo.geojson: one Feature per kept section (from
sections_meta_geo.csv), with a representative LineString/MultiLineString taken
from the FIRST year (1996 -> 2024) in which that section has geometry.

Join key and section_id reconstruction reuse the EXACT helpers from
build_matrix_geo.py so the (roadbed, marker, disp) -> section_id mapping is
identical to how sections_meta_geo.csv was built.

Non-destructive: writes ONLY section_lines_geo.geojson. Overwrites nothing else.
"""
import os, glob, json, csv

SRC_DIR   = "results_dfo_highway"
META_CSV  = "sections_meta_geo.csv"
OUT_PATH  = "section_lines_geo.geojson"


# --- helpers copied verbatim from build_matrix_geo.py (authoritative) ---------
def geo_to_roadbed(rid):
    if not rid or "-" not in rid:
        return None
    pre, post = rid.split("-", 1)
    return f"{pre:<7}{post[0]}" if post else None


def fnum(v):
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
    return None if n is None else str(n)


def clean(v):
    return "" if v is None else str(v).strip()
# -----------------------------------------------------------------------------


def main():
    # 1. Kept section ids (authoritative join target).
    kept = set()
    with open(META_CSV, encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            kept.add(row["section_id"])
    print(f"kept sections in {META_CSV}: {len(kept)}")

    # 2. Scan years oldest -> newest, taking geometry the FIRST time a kept
    #    section is seen with a usable geometry.
    geom_by_sid = {}                    # section_id -> geometry dict
    files = sorted(glob.glob(os.path.join(SRC_DIR, "pmis_lines_*.geojson")))
    print(f"found {len(files)} GeoJSON files in {SRC_DIR}/")

    for path in files:
        with open(path, encoding="utf-8", errors="replace") as fh:
            gj = json.load(fh)
        for feat in gj.get("features", []):
            p = feat.get("properties", {}) or {}
            roadbed = geo_to_roadbed(clean(p.get("TX_SIGNED_HIGHWAY_RDBD_ID")))
            if roadbed is None:
                continue
            marker = fmt_marker(p.get("TX_BEG_REF_MARKER_NBR"))
            disp   = fmt_disp(p.get("TX_BEG_REF_MRKR_DISP"))
            if marker is None or disp is None:
                continue
            sid = f"{roadbed}|{marker}|{disp}"
            if sid not in kept or sid in geom_by_sid:
                continue
            geom = feat.get("geometry")
            if not geom or geom.get("type") not in ("LineString", "MultiLineString"):
                continue
            coords = geom.get("coordinates")
            if not coords:                          # blank / empty geometry
                continue
            geom_by_sid[sid] = {"type": geom["type"], "coordinates": coords}

    # 3. Build FeatureCollection (WGS84 / EPSG:4326, same as source).
    features = [
        {"type": "Feature",
         "properties": {"id": sid},
         "geometry": geom}
        for sid, geom in geom_by_sid.items()
    ]
    fc = {"type": "FeatureCollection", "features": features}

    with open(OUT_PATH, "w", encoding="utf-8") as fh:
        json.dump(fc, fh)

    # 4. Report.
    n_written = len(features)
    n_skipped = len(kept) - n_written
    size = os.path.getsize(OUT_PATH)
    print(f"features written        : {n_written}")
    print(f"kept sections w/ geometry: {n_written}")
    print(f"skipped (no geometry)   : {n_skipped}")
    print(f"output file             : {OUT_PATH} ({size:,} bytes, {size/1e6:.2f} MB)")

    # 5. Verify: reload and sanity-check.
    with open(OUT_PATH, encoding="utf-8") as fh:
        back = json.load(fh)
    assert back["type"] == "FeatureCollection", "not a FeatureCollection"
    assert len(back["features"]) == n_written
    if back["features"]:
        s = back["features"][0]
        assert "id" in s["properties"], "sample feature missing properties.id"
        assert s["geometry"]["type"] in ("LineString", "MultiLineString")
        print(f"sample feature          : id={s['properties']['id']} "
              f"geom={s['geometry']['type']} "
              f"npts={len(s['geometry']['coordinates'])}")
    print("valid GeoJSON: OK")


if __name__ == "__main__":
    main()
