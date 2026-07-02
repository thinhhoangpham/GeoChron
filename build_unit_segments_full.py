"""
Full-resolution per-segment, per-year data for the cluster-thumbnail viewer,
matching the reference chart's actual encoding (real reference-marker position
+ length per segment, real years, not resampled bins or 5-yr windows).

Inputs : storyline_data.json  (unit -> segment membership, marker, county)
         sections_meta.csv    (begin_marker, begin_disp -> true absolute position)
         evolens_data.json    (years, real per-year score per segment id)

Output : unit_segments_full.json
  {
    "years": [1996, ..., 2024],
    "units": [
      { "key": "roadbed · county", "n_segments": int,
        "segments": [ {"id", "begin", "end", "scores": [v_1996..v_2024, null for gaps]} ] }
    ]
  }

Restricted to the same units kept by build_unit_heatmaps.py (>= MIN_SEGMENTS),
so the raw/resampled/full views all agree on which units exist. Each half-mile
segment's absolute position is begin_marker + begin_disp (matches the reference
chart's getAbsBegin); length is fixed at SEGMENT_LENGTH_MI (0.5 mi, per
PROGRESS.md's "half-mile segment" definition -- no explicit end-marker field in
the source data).

begin_marker can carry a letter suffix (e.g. "634A", a TxDOT control-section
marker) -- ported verbatim from the reference chart's cleanAndRound(): strip
every non-digit/non-dot character before parsing, rather than failing/defaulting
to 0 on a bad float() parse (that bare-except was a bug, not a real gap in the
road -- it collapsed those segments' position to ~0).
"""
import csv
import json
import re

STORYLINE_FILE = "storyline_data.json"
META_FILE      = "sections_meta.csv"
EVOLENS_FILE   = "evolens_data.json"
OUT_FILE       = "unit_segments_full.json"
MIN_SEGMENTS   = 5    # keep in sync with build_unit_heatmaps.py
SEGMENT_LENGTH_MI = 0.5

storyline = json.load(open(STORYLINE_FILE, encoding="utf-8"))
evolens = json.load(open(EVOLENS_FILE, encoding="utf-8"))
years = evolens["years"]
scores_by_id = evolens["scores"]

def clean_and_round(value):
    """Port of the reference chart's cleanAndRound(): strip everything but
    digits/dot, then parse -- "634A" -> "634", not a parse failure."""
    cleaned = re.sub(r"[^0-9.]", "", value or "")
    if cleaned in ("", "."):
        return 0.0
    return round(float(cleaned), 3)


begin_pos = {}
for row in csv.DictReader(open(META_FILE, encoding="utf-8")):
    bm = clean_and_round(row["begin_marker"])
    bd = clean_and_round(row["begin_disp"])
    begin_pos[row["section_id"]] = bm + bd

units = []
for road in storyline["roads"]:
    segs = road["segments"]
    if len(segs) < MIN_SEGMENTS:
        continue
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
