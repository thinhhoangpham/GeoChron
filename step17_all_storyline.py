"""
Per-segment Storyline for ALL corridors, stacked.

Cohorts never cross a roadbed (Step 8 proximity = same roadbed AND county), so the
statewide per-segment Storyline decomposes into one independent mini-Storyline per
roadbed. We compute each roadbed's bundled layout, then stack them vertically into
one tall Canvas page (one labeled band per roadbed). Canvas (not SVG) because
~14.8k gradient lines would choke SVG.

Roadbeds with < MINSEG segments are omitted (reported, not silently dropped).

Output: all_storyline.html  (self-contained, Canvas-rendered)
"""
import csv, json
import numpy as np

MINSEG = 15        # min segments for a roadbed to be drawn
M_PX   = 1.4       # vertical px per segment line
SGAP   = 3.0       # gap between stacked sessions
RBGAP  = 22.0      # gap between roadbed bands (room for label)
SWEEPS = 4

# ---- load -------------------------------------------------------------------
r = csv.reader(open("section_year_matrix.csv", encoding="utf-8"))
hdr = next(r); SCORES, mat_sections = [], []
for row in r:
    mat_sections.append(row[0])
    SCORES.append([float(v) if v != "" else np.nan for v in row[1:]])
SCORES = np.array(SCORES, dtype=np.float32)

win = json.load(open("windows_W5.json", encoding="utf-8"))
years, sections = win["years"], win["sections"]
yidx = {y: i for i, y in enumerate(years)}
pos = {s: i for i, s in enumerate(sections)}
win_meta = win["windows"]; nW = len(win_meta)

roadbed = [""] * len(sections); marker = [0.0] * len(sections)
for row in csv.DictReader(open("sections_meta.csv", encoding="utf-8")):
    p = pos.get(row["section_id"])
    if p is not None:
        roadbed[p] = row["roadbed"]
        try: marker[p] = float(row["begin_marker"])
        except: marker[p] = 0.0

sess = json.load(open("step11_sessions_W5.json"))["windows"]; sess.sort(key=lambda w: w["k"])
seg_sessions = []      # per window: list of member-lists
for w in sess:
    seg_sessions.append([list(s) for s in w["sessions"]])

wcols = [[yidx[y] for y in range(win_meta[k]["start"], win_meta[k]["end"] + 1)] for k in range(nW)]
def win_score(seg, k):
    v = SCORES[seg, wcols[k]]
    return float(np.nanmean(v)) if np.isfinite(v).any() else None

# ---- per-roadbed bundled layout ---------------------------------------------
def layout_roadbed(scope):
    # win_sessions restricted to scope
    ws = []
    for k in range(nW):
        rows = []
        for members in seg_sessions[k]:
            ms = [m for m in members if m in scope]
            if ms: rows.append(ms)
        ws.append(rows)
    order = [sorted(ws[k], key=lambda ms: np.mean([marker[m] for m in ms])) for k in range(nW)]
    order = [[sorted(ms, key=lambda m: marker[m]) for ms in order[k]] for k in range(nW)]

    def stack(ok):
        y, d = 0.0, {}
        for ms in ok:
            for m in ms: d[m] = y + M_PX / 2; y += M_PX
            y += SGAP
        return d, max(0.0, y - SGAP)
    yof = [stack(order[k])[0] for k in range(nW)]

    def bary(ms, k):
        vals = [yof[nb][m] for m in ms for nb in (k - 1, k + 1) if 0 <= nb < nW and m in yof[nb]]
        return float(np.mean(vals)) if vals else 1e9
    for sw in range(SWEEPS):
        ks = range(nW) if sw % 2 == 0 else range(nW - 1, -1, -1)
        for k in ks:
            order[k] = sorted(order[k], key=lambda ms: bary(ms, k))
            order[k] = [sorted(ms, key=lambda m: bary([m], k)) for ms in order[k]]
            yof[k] = stack(order[k])[0]
    heights = []
    for k in range(nW):
        yof[k], h = stack(order[k]); heights.append(h)
    H = max(heights) if heights else 0.0
    for k in range(nW):
        off = (H - heights[k]) / 2
        for m in yof[k]: yof[k][m] += off
    return yof, H

# ---- roadbeds to draw -------------------------------------------------------
import collections
rb_members = collections.defaultdict(list)
for i in range(len(sections)):
    rb_members[roadbed[i]].append(i)
rbs = sorted([(rb, ms) for rb, ms in rb_members.items() if len(ms) >= MINSEG],
             key=lambda kv: -len(kv[1]))
dropped_rb = sum(1 for rb, ms in rb_members.items() if len(ms) < MINSEG)
dropped_seg = sum(len(ms) for rb, ms in rb_members.items() if len(ms) < MINSEG)

# ---- assemble stacked layout ------------------------------------------------
segments = []; bands = []; yoff = 0.0
for rb, ms in rbs:
    scope = set(ms)
    yof, H = layout_roadbed(scope)
    drawn = 0
    for seg in sorted(ms, key=lambda m: marker[m]):
        pts = [{"k": k, "y": round(yof[k][seg] + yoff, 1), "score": win_score(seg, k)}
               for k in range(nW) if seg in yof[k]]
        if pts:
            segments.append({"id": sections[seg], "rb": rb, "points": pts}); drawn += 1
    bands.append({"rb": rb, "y0": round(yoff, 1), "y1": round(yoff + H, 1),
                  "n": len(ms), "drawn": drawn})
    yoff += H + RBGAP

out = {"windows": [{"k": k, "label": f'{w["start"]}–{w["end"]}'} for k, w in enumerate(win_meta)],
       "ymax": round(yoff, 1), "n_segments": len(segments),
       "n_roadbeds": len(rbs), "segments": segments, "bands": bands}

TEMPLATE = r"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Per-Segment Storyline — ALL corridors</title>
<script src="https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"></script>
<style>
 body{margin:0;font-family:system-ui,sans-serif;background:#0f1115;color:#e6e6e6}
 #top{padding:9px 16px;border-bottom:1px solid #2a2d36;position:sticky;top:0;background:#0f1115;z-index:5}
 h1{font-size:14px;margin:0 0 3px;font-weight:600}
 .muted{color:#8b919c;font-size:12px}
 input{background:#1c1f27;border:1px solid #3a3f4b;color:#e6e6e6;border-radius:5px;padding:4px 8px}
</style></head><body>
<div id="top"><h1>Per-Segment Storyline — ALL corridors</h1>
 <span class="muted" id="sub"></span><br>
 <input id="q" placeholder="highlight roadbed (e.g. IH0010 R)" size="28">
</div>
<canvas id="cv"></canvas>
<script>
const D=__DATA__;
const color=d3.scaleSequential(d3.interpolateRdYlGn).domain([0,100]);
const m={top:40,left:24,right:24}, colW=46;
const x=k=>m.left+k*colW+7;
const W=m.left+m.right+D.windows.length*colW, H=m.top+D.ymax+30;
const cv=document.getElementById("cv"); cv.width=W; cv.height=H;
const ctx=cv.getContext("2d");
document.getElementById("sub").textContent=
  `${D.n_segments.toLocaleString()} segments · ${D.n_roadbeds} roadbeds · color = condition (red poor → green good)`;

function draw(hl){
  ctx.clearRect(0,0,W,H); ctx.lineWidth=1.1;
  // roadbed band labels
  ctx.fillStyle="#6b7280"; ctx.font="11px system-ui";
  D.bands.forEach(b=>{ ctx.fillText(`${b.rb}  (${b.n})`, m.left, m.top+b.y0-4); });
  // window axis
  ctx.fillStyle="#9aa0ab"; ctx.font="10px system-ui";
  D.windows.forEach(w=>{ ctx.save(); ctx.translate(x(w.k),m.top-6); ctx.rotate(-0.7);
    ctx.fillText(w.label,0,0); ctx.restore(); });
  // segments
  for(const s of D.segments){
    const dim = hl && s.rb!==hl;
    const pts=s.points;
    for(let i=1;i<pts.length;i++){
      if(pts[i].k-pts[i-1].k>1) continue;           // break across gaps
      const a=pts[i-1], b=pts[i];
      const xa=x(a.k), xb=x(b.k), ya=m.top+a.y, yb=m.top+b.y;
      const g=ctx.createLinearGradient(xa,0,xb,0);
      g.addColorStop(0, a.score==null?"#555":color(a.score));
      g.addColorStop(1, b.score==null?"#555":color(b.score));
      ctx.strokeStyle=g; ctx.globalAlpha=dim?0.05:0.8;
      ctx.beginPath(); ctx.moveTo(xa,ya); ctx.lineTo(xb,yb); ctx.stroke();
    }
  }
  ctx.globalAlpha=1;
}
draw(null);
let t; document.getElementById("q").addEventListener("input",e=>{
  clearTimeout(t); const v=e.target.value.trim().toUpperCase();
  t=setTimeout(()=>draw(v|| null),120);
});
</script></body></html>"""

html = TEMPLATE.replace("__DATA__", json.dumps(out))
open("all_storyline.html", "w", encoding="utf-8").write(html)
print(f"roadbeds drawn: {len(rbs)}  segments: {len(segments):,}  height: {yoff:.0f}px")
print(f"omitted (roadbed <{MINSEG} segs): {dropped_rb} roadbeds, {dropped_seg} segments")
print(f"wrote all_storyline.html ({len(html)//1024} KB)")
