"""
Full-coverage variant of build_unit_segments_full.py for the length-bucketed
cluster viewer (clusters_bylength.html/js).

Identical segment-building logic to build_unit_segments_full.py, but with the
MIN_SEGMENTS drop removed so EVERY unit in storyline_data_hwcounty.json
(including 1- and 2-segment units, i.e. Q1) is included. The original
unit_segments_full.json / build_unit_segments_full.py are left untouched --
clusters.js/clusters.html keep using the filtered (>=5 segment) file.

Output: unit_segments_full_all.json, same shape as unit_segments_full.json:
  {
    "years": [1996, ..., 2024],
    "units": [
      { "key": "roadbed · county", "n_segments": int,
        "segments": [ {"id", "begin", "end", "scores": [...]} ] }
    ]
  }
"""
import csv
import json
import re

STORYLINE_FILE = "storyline_data_hwcounty.json"
META_FILE      = "sections_meta.csv"
EVOLENS_FILE   = "evolens_data.json"
OUT_FILE       = "unit_segments_full_all.json"
SEGMENT_LENGTH_MI = 0.5

def clean_and_round(value):
    """Port of the reference chart's cleanAndRound(): strip everything but
    digits/dot, then parse -- "634A" -> "634", not a parse failure."""
    cleaned = re.sub(r"[^0-9.]", "", value or "")
    if cleaned in ("", "."):
        return 0.0
    return round(float(cleaned), 3)


def main():
    storyline = json.load(open(STORYLINE_FILE, encoding="utf-8"))
    evolens = json.load(open(EVOLENS_FILE, encoding="utf-8"))
    years = evolens["years"]
    scores_by_id = evolens["scores"]

    begin_pos = {}
    for row in csv.DictReader(open(META_FILE, encoding="utf-8")):
        bm = clean_and_round(row["begin_marker"])
        bd = clean_and_round(row["begin_disp"])
        begin_pos[row["section_id"]] = bm + bd

    units = []
    for road in storyline["roads"]:
        segs = road["segments"]
        # No MIN_SEGMENTS filter here -- every unit is kept, including
        # 1-segment ones, so Q1/Q2 length buckets have real render data.
        out_segs = []
        for seg in segs:
            sid = seg["id"]
            begin = begin_pos.get(sid, seg.get("marker", 0.0))
            out_segs.append({
                "id": sid, "begin": begin, "end": begin + SEGMENT_LENGTH_MI,
                "scores": scores_by_id.get(sid, [None] * len(years)),
            })
        out_segs.sort(key=lambda s: s["begin"])
        units.append({"key": road["roadbed"], "n_segments": len(out_segs), "segments": out_segs})

    json.dump({"years": years, "units": units}, open(OUT_FILE, "w"))
    print(f"units: {len(units)}   wrote {OUT_FILE}")


if __name__ == "__main__":
    main()
