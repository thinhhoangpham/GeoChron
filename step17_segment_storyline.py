"""
Step 17 (Level 1), paper-faithful: per-SEGMENT Storyline for one corridor.

Each road segment is drawn as a single line running left->right across the 25
windows. Segments in the same session are stacked tightly (din = 0) so a cohort
reads as a bundle of near-parallel lines; when a segment switches session its
line jumps to the new bundle (a split/merge). Each line is shaded by a gradient
encoding the segment's condition score over time (RdYlGn: red=poor, green=good).

Scope: ONE roadbed (corridor), per the paper's Step 15 (run per corridor, not
statewide) -- statewide per-segment lines would be unreadable.

Layout (StoryFlow-style approximation) is computed here in Python:
  - sessions ordered per window by barycenter of their members' previous y
  - members ordered within a session by previous y (keeps lines continuous)
A segment is only drawn in windows where it belongs to a KEPT session (Step 11);
the line breaks across windows where it is unaffiliated (gap), matching the
paper's session filtering / curve hiding.

Output: segment_storyline.html  (self-contained, opens by double-click)
"""
import csv, json
import numpy as np

SCOPE_ROADBED = "IH0027 L"     # the corridor to render
M_PX   = 3.0                   # vertical px per segment line
SGAP   = 7.0                   # px gap between stacked sessions

# ---- load scores, meta, windows, sessions -----------------------------------
r = csv.reader(open("section_year_matrix.csv", encoding="utf-8"))
hdr = next(r)
SCORES, mat_sections = [], []
for row in r:
    mat_sections.append(row[0])
    SCORES.append([float(v) if v != "" else np.nan for v in row[1:]])
SCORES = np.array(SCORES, dtype=np.float32)

win = json.load(open("windows_W5.json", encoding="utf-8"))
years, sections = win["years"], win["sections"]
yidx = {y: i for i, y in enumerate(years)}
pos = {s: i for i, s in enumerate(sections)}
win_meta = win["windows"]
nW = len(win_meta)

rm = csv.DictReader(open("sections_meta.csv", encoding="utf-8"))
roadbed = [""] * len(sections); county = [""] * len(sections); marker = [0.0] * len(sections)
for row in rm:
    p = pos.get(row["section_id"])
    if p is not None:
        roadbed[p] = row["roadbed"]; county[p] = row["county"]
        try: marker[p] = float(row["begin_marker"])
        except: marker[p] = 0.0

in_scope = set(i for i in range(len(sections)) if roadbed[i] == SCOPE_ROADBED)

sess = json.load(open("step11_sessions_W5.json"))["windows"]
sess.sort(key=lambda w: w["k"])

# per window: list of (session_local_id, [in-scope members]) ; and seg->session map
win_sessions = []      # [ [ (sid, [members]) ... ] per window ]
seg_session = []       # [ {seg: sid} per window ]
for w in sess:
    rows, smap = [], {}
    for sid, members in enumerate(w["sessions"]):
        ms = [m for m in members if m in in_scope]
        if ms:
            rows.append((sid, ms))
            for m in ms: smap[m] = sid
    win_sessions.append(rows)
    seg_session.append(smap)

def win_score(seg, k):
    cols = [yidx[y] for y in range(win_meta[k]["start"], win_meta[k]["end"] + 1)]
    v = SCORES[seg, cols]
    return float(np.nanmean(v)) if np.isfinite(v).any() else None

# ---- layout: stable, vertically-centered (StoryFlow-style sweeps) -----------
# order[k] = list of (session_id, [members ordered]); initialize by mile marker
order = []
for k in range(nW):
    rows = sorted(win_sessions[k], key=lambda it: np.mean([marker[m] for m in it[1]]))
    order.append([(sid, sorted(ms, key=lambda m: marker[m])) for sid, ms in rows])

def stack_y(order_k):
    """y center per member for one window's ordered sessions; returns (dict, height)."""
    y, d = 0.0, {}
    for _, ms in order_k:
        for m in ms:
            d[m] = y + M_PX / 2.0
            y += M_PX
        y += SGAP
    return d, max(0.0, y - SGAP)

yof = [stack_y(order[k])[0] for k in range(nW)]

def bary(ms, k):
    """mean y of these members in the adjacent windows (both sides)."""
    vals = [yof[nb][m] for m in ms for nb in (k - 1, k + 1)
            if 0 <= nb < nW and m in yof[nb]]
    return float(np.mean(vals)) if vals else 1e9

# iterative crossing-reduction sweeps using BOTH neighbours (fixes window-0
# discontinuity and the sink/rise wobble); Gauss-Seidel, alternating direction
for sweep in range(6):
    ks = range(nW) if sweep % 2 == 0 else range(nW - 1, -1, -1)
    for k in ks:
        rows = sorted(order[k], key=lambda it: bary(it[1], k))
        rows = [(sid, sorted(ms, key=lambda m: bary([m], k))) for sid, ms in rows]
        order[k] = rows
        yof[k] = stack_y(rows)[0]

# final pass + vertical centering: each window centered on the canvas so cohorts
# keep a steady baseline instead of sinking/rising between windows
heights = []
for k in range(nW):
    yof[k], h = stack_y(order[k])
    heights.append(h)
ymax = max(heights)
for k in range(nW):
    off = (ymax - heights[k]) / 2.0
    for m in yof[k]:
        yof[k][m] += off

# ---- build per-segment polyline points (break on gaps in window membership) -
segments = []
for seg in sorted(in_scope, key=lambda m: marker[m]):
    pts = []
    for k in range(nW):
        if seg in yof[k]:
            pts.append({"k": k, "y": round(yof[k][seg], 2), "score": win_score(seg, k)})
    if pts:
        segments.append({"id": sections[seg], "county": county[seg],
                         "marker": marker[seg], "points": pts})

out = {"scope": SCOPE_ROADBED,
       "windows": [{"k": k, "label": f'{w["start"]}–{w["end"]}'} for k, w in enumerate(win_meta)],
       "ymax": round(ymax, 1), "n_segments": len(segments), "segments": segments}

# ---- write self-contained HTML ----------------------------------------------
TEMPLATE = r"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<title>Per-Segment Storyline — __SCOPE__</title>
<script src="https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"></script>
<style>
 body{margin:0;font-family:system-ui,sans-serif;background:#0f1115;color:#e6e6e6}
 #top{padding:10px 16px;border-bottom:1px solid #2a2d36;display:flex;gap:18px;align-items:center;flex-wrap:wrap}
 h1{font-size:15px;margin:0;font-weight:600}
 .axis text{fill:#9aa0ab;font-size:11px}
 .seg{fill:none;stroke-width:1.6;opacity:0.85}
 .seg.dim{opacity:0.08}
 .seg.hot{stroke-width:3;opacity:1}
 #tt{position:fixed;pointer-events:none;background:#1c1f27;border:1px solid #3a3f4b;
     padding:7px 9px;border-radius:6px;font-size:12px;opacity:0;line-height:1.45}
 .muted{color:#8b919c;font-size:12px}
</style></head><body>
<div id="top"><h1>Per-Segment Storyline — __SCOPE__</h1>
 <span class="muted">each line = one ½-mile segment · bundled by cohort · color = condition (red poor → green good) · hover to trace</span></div>
<svg id="c"></svg><div id="tt"></div>
<script>
const D=__DATA__;
const color=d3.scaleSequential(d3.interpolateRdYlGn).domain([0,100]);
const m={top:46,right:24,bottom:28,left:24}, colW=46;
const W=m.left+m.right+D.windows.length*colW, H=m.top+m.bottom+Math.max(300,D.ymax);
const svg=d3.select("#c").attr("width",W).attr("height",H);
const g=svg.append("g").attr("transform",`translate(${m.left},${m.top})`);
const x=k=>k*colW+7;
const defs=svg.append("defs");
const tt=d3.select("#tt");

// gradient per segment (userSpaceOnUse so stops align to real x across breaks)
D.segments.forEach((s,i)=>{
  const xs=s.points.map(p=>x(p.k));
  const x0=Math.min(...xs), x1=Math.max(...xs);
  const grad=defs.append("linearGradient").attr("id","g"+i)
    .attr("gradientUnits","userSpaceOnUse").attr("x1",x0).attr("y1",0).attr("x2",x1).attr("y2",0);
  s.points.forEach(p=>{
    const off=x1>x0?((x(p.k)-x0)/(x1-x0)):0;
    grad.append("stop").attr("offset",off).attr("stop-color",p.score==null?"#555":color(p.score));
  });
});

// build path 'd', breaking where windows are non-consecutive
function pathD(s){
  let d="",prev=null;
  s.points.forEach(p=>{
    const X=x(p.k),Y=p.y;
    if(prev===null||p.k-prev>1) d+=`M${X},${Y}`; else d+=`L${X},${Y}`;
    prev=p.k;
  });
  return d;
}
const line=g.append("g").selectAll("path").data(D.segments).join("path")
  .attr("class","seg").attr("d",pathD).attr("stroke",(d,i)=>`url(#g${i})`)
  .on("mousemove",function(e,d){
     d3.selectAll(".seg").classed("dim",true);
     d3.select(this).classed("dim",false).classed("hot",true);
     const last=d.points[d.points.length-1];
     tt.style("opacity",1).style("left",(e.clientX+14)+"px").style("top",(e.clientY+12)+"px")
       .html(`<b>${d.id}</b><br>${d.county}<br>marker ${d.marker} · ${d.points.length} windows`);
  })
  .on("mouseleave",function(){d3.selectAll(".seg").classed("dim",false).classed("hot",false);tt.style("opacity",0);});

// window axis
const ax=g.append("g").attr("class","axis");
ax.selectAll("text").data(D.windows).join("text")
 .attr("x",d=>x(d.k)).attr("y",-10).attr("transform",d=>`rotate(-40 ${x(d.k)} -10)`)
 .text(d=>d.label);
ax.append("text").attr("x",0).attr("y",D.ymax+20).attr("fill","#8b919c")
 .text(`${D.n_segments} segments on ${D.scope}`);
</script></body></html>"""

html = (TEMPLATE.replace("__SCOPE__", SCOPE_ROADBED)
        .replace("__DATA__", json.dumps(out)))
open("segment_storyline.html", "w", encoding="utf-8").write(html)
print(f"scope {SCOPE_ROADBED}: {len(segments)} segments, ymax={ymax:.0f}px")
print(f"wrote segment_storyline.html ({len(html)//1024} KB)")
