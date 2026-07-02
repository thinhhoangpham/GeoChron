"""
Build per-unit (roadbed · county) distribution-aware yearly series for the
unit-level evolution pattern:

  Level  = mean over the unit's valid segments that year of the squared gap
           below 100 -- bad segments weigh disproportionately more.
  Spread = population std of the unit's valid segment scores that year --
           uniform unit ~ 0, mixed unit large.

See docs/superpowers/specs/2026-07-02-unit-evolution-distribution-design.md.
"""
import math
import csv
import json
import collections

def level_of(scores):
    valid = [s for s in scores if s is not None and s >= 1]
    if not valid:
        return float("nan")
    return sum((100.0 - s) ** 2 for s in valid) / len(valid)

def spread_of(scores):
    valid = [s for s in scores if s is not None and s >= 1]
    if not valid:
        return float("nan")
    if len(valid) == 1:
        return 0.0
    mean = sum(valid) / len(valid)
    var = sum((s - mean) ** 2 for s in valid) / len(valid)
    return math.sqrt(var)

MIN_SEGMENTS = 15

def build_units(matrix_rows, sections, years, meta):
    by_unit = collections.defaultdict(list)          # (roadbed,county) -> [section_id]
    for sid in sections:
        rc = meta.get(sid)
        if rc is not None:
            by_unit[rc].append(sid)

    n_years = len(years)
    units = []
    for (roadbed, county), sids in by_unit.items():
        if len(sids) < MIN_SEGMENTS:
            continue
        level, spread = [], []
        for yi in range(n_years):
            col = [matrix_rows[sid][yi] for sid in sids]
            lv = level_of(col); sp = spread_of(col)
            level.append(None if math.isnan(lv) else lv)
            spread.append(None if math.isnan(sp) else sp)
        units.append({"key": f"{roadbed} · {county}", "roadbed": roadbed,
                      "county": county, "n_segments": len(sids),
                      "level": level, "spread": spread})
    units.sort(key=lambda u: -u["n_segments"])
    return {"years": list(years), "units": units}

def _load_sources():
    r = csv.reader(open("section_year_matrix.csv", encoding="utf-8"))
    hdr = next(r); years = [int(y) for y in hdr[1:]]
    rows, sections = {}, []
    for row in r:
        sections.append(row[0])
        rows[row[0]] = [float(v) if v != "" else None for v in row[1:]]
    meta = {}
    for m in csv.DictReader(open("sections_meta.csv", encoding="utf-8")):
        meta[m["section_id"]] = (m["roadbed"], m["county"])
    win = json.load(open("windows_W5.json", encoding="utf-8"))
    return rows, sections, years, meta, win

def main():
    rows, sections, years, meta, win = _load_sources()
    out = build_units(rows, sections, years, meta)
    yidx = {y: i for i, y in enumerate(years)}
    out["windows"] = [{"k": k, "start": w["start"], "end": w["end"],
                       "label": f'{w["start"]}-{w["end"]}'}
                      for k, w in enumerate(win["windows"])]
    wyears = [[yi for y in range(w["start"], w["end"] + 1)
               if (yi := yidx.get(y)) is not None] for w in win["windows"]]
    for u in out["units"]:
        u["member_windows"] = [k for k, cols in enumerate(wyears)
                               if any(u["level"][c] is not None for c in cols)]
    json.dump(out, open("unit_series.json", "w"))
    print(f"units: {len(out['units'])}  years: {years[0]}-{years[-1]}")
    print("wrote unit_series.json")

if __name__ == "__main__":
    main()
