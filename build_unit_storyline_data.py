"""
Join unit_series.json + unit_sessions.json into storyline_data_units.json,
consumed by index_units.html + storyline.js. Bands = counties; atoms = units.
v colors by an effective (distribution-aware) condition score; sp carries the
window's spread for optional thickness rendering.
"""
import json, math, collections

def level_to_color_score(level):
    if level is None:
        return None
    return round(max(0.0, 100.0 - math.sqrt(level)), 1)

def _win_mean(series, cols):
    vals = [series[c] for c in cols if series[c] is not None]
    return sum(vals) / len(vals) if vals else None

def build_storyline(series, sessions):
    years = series["years"]
    yidx = {y: i for i, y in enumerate(years)}
    wins = series["windows"]
    wcols = [[yidx[y] for y in range(w["start"], w["end"] + 1) if y in yidx]
             for w in wins]
    # per-window unit -> session index
    sess_of = [dict() for _ in wins]
    for wk, sw in enumerate(sessions["windows"]):
        for s, members in enumerate(sw["sessions"]):
            for u in members:
                sess_of[wk][u] = s

    bands = collections.defaultdict(list)     # county -> [segment dict]
    for ui, u in enumerate(series["units"]):
        win = []
        for wk in u["member_windows"]:
            cols = wcols[wk]
            lvl = _win_mean(u["level"], cols)
            spv = _win_mean(u["spread"], cols)
            win.append({"k": wk, "s": sess_of[wk].get(ui),
                        "v": level_to_color_score(lvl),
                        "sp": round(spv, 3) if spv is not None else None})
        bands[u["county"]].append({"id": u["key"], "marker": 0.0,
                                   "roadbed": u["roadbed"], "county": u["county"],
                                   "win": win})
    for segs in bands.values():
        segs.sort(key=lambda s: s["roadbed"])
    roads = [{"roadbed": cty, "segments": segs}
             for cty, segs in sorted(bands.items(), key=lambda kv: -len(kv[1]))]
    return {"windows": wins, "roads": roads}

def main():
    series = json.load(open("unit_series.json", encoding="utf-8"))
    sessions = json.load(open("unit_sessions.json", encoding="utf-8"))
    out = build_storyline(series, sessions)
    json.dump(out, open("storyline_data_units.json", "w"))
    print(f"county bands: {len(out['roads'])}  "
          f"units: {sum(len(r['segments']) for r in out['roads'])}")
    print("wrote storyline_data_units.json")

if __name__ == "__main__":
    main()
