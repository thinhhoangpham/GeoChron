"""
Paper-faithful Storyline for one corridor (StoryFlow-style).

Differences from the earlier per-segment view, to match GeoChron Fig.5(D):
  * Cohorts are TRACKED into continuous multi-window bundles (mutual-best overlap
    union across adjacent windows). A persistent cohort = one horizontal lane.
  * Each bundle is STRAIGHTENED: its member segments run horizontally at a fixed
    sub-row across the windows the bundle spans -> flat colored streaks, not
    diagonals. Lanes are spread vertically with whitespace.
  * Connectors (a segment moving between bundles) are drawn THIN + FAINT, and big
    vertical jumps are HIDDEN except short stubs at each end (the paper's curve
    hiding, thw). So bundles dominate the picture, connectors are hints.
  * Color = condition shade (RdYlGn) along each segment.

Scope: one roadbed (Step 15). Output: paper_storyline.html
"""
import csv, json, collections
import numpy as np

SCOPE = "IH0027 L"
M_PX  = 4.0        # px per segment row inside a bundle
LGAP  = 48.0       # whitespace between bundle lanes
THW   = 90.0       # curve-hiding threshold (px); bigger vertical jumps are stubbed
MINTRK = 3         # min members for a track to be drawn as a bundle

# ---- load -------------------------------------------------------------------
r = csv.reader(open("section_year_matrix.csv", encoding="utf-8"))
next(r); SCORES, sections = [], []
for row in r:
    sections.append(row[0])
    SCORES.append([float(v) if v != "" else np.nan for v in row[1:]])
SCORES = np.array(SCORES, dtype=np.float32)

win = json.load(open("windows_W5.json", encoding="utf-8"))
years = win["years"]; yidx = {y: i for i, y in enumerate(years)}
pos = {s: i for i, s in enumerate(sections)}
win_meta = win["windows"]; nW = len(win_meta)
wcols = [[yidx[y] for y in range(w["start"], w["end"] + 1)] for w in win_meta]
def wscore(seg, k):
    v = SCORES[seg, wcols[k]]
    return float(np.nanmean(v)) if np.isfinite(v).any() else None

roadbed = {}; marker = {}
for row in csv.DictReader(open("sections_meta.csv", encoding="utf-8")):
    p = pos.get(row["section_id"])
    if p is not None:
        roadbed[p] = row["roadbed"]
        try: marker[p] = float(row["begin_marker"])
        except: marker[p] = 0.0
scope = [i for i in range(len(sections)) if roadbed.get(i) == SCOPE]
sset = set(scope)

sess = json.load(open("step11_sessions_W5.json"))["windows"]; sess.sort(key=lambda w: w["k"])

# per-window in-scope sessions: list of member-sets; seg->local session idx
win_sess, seg2si = [], []
for w in sess:
    rows, smap = [], {}
    for members in w["sessions"]:
        ms = [m for m in members if m in sset]
        if ms:
            for m in ms: smap[m] = len(rows)
            rows.append(set(ms))
    win_sess.append(rows); seg2si.append(smap)

# ---- track cohorts across windows: mutual-best overlap union-find ------------
parent = {}
def find(a):
    while parent[a] != a: parent[a] = parent[parent[a]]; a = parent[a]
    return a
def union(a, b): parent.setdefault(a, a); parent.setdefault(b, b); parent[find(a)] = find(b)
for k in range(nW):
    for si in range(len(win_sess[k])): parent.setdefault((k, si), (k, si))
for k in range(nW - 1):
    A, B = win_sess[k], win_sess[k + 1]
    if not A or not B: continue
    bestB = [max(range(len(B)), key=lambda j: len(A[i] & B[j])) if B else -1 for i in range(len(A))]
    bestA = [max(range(len(A)), key=lambda i: len(B[j] & A[i])) if A else -1 for j in range(len(B))]
    for i in range(len(A)):
        j = bestB[i]
        if j >= 0 and bestA[j] == i and len(A[i] & B[j]) > 0:
            union((k, i), (k + 1, j))

# ---- assemble tracks --------------------------------------------------------
tracks = collections.defaultdict(lambda: {"members": set(), "nodes": []})
for (k, si) in list(parent.keys()):
    t = tracks[find((k, si))]
    t["members"] |= win_sess[k][si]; t["nodes"].append((k, si))
tracks = {tid: t for tid, t in tracks.items() if len(t["members"]) >= MINTRK}

# order lanes by mean marker; sub-row of each member by marker; assign y0
lane = sorted(tracks.values(), key=lambda t: np.mean([marker[m] for m in t["members"]]))
y = 0.0
for t in lane:
    mem = sorted(t["members"], key=lambda m: marker[m])
    t["subrow"] = {m: r for r, m in enumerate(mem)}
    t["y0"] = y; t["h"] = len(mem) * M_PX
    y += t["h"] + LGAP
ymax = y
node2track = {}
for t in lane:
    for nd in t["nodes"]: node2track[nd] = t

# ---- per-segment points (y from its track each window) ----------------------
segments = []
for seg in sorted(scope, key=lambda m: marker[m]):
    pts = []
    for k in range(nW):
        si = seg2si[k].get(seg)
        if si is None: continue
        t = node2track.get((k, si))
        if t is None or seg not in t.get("subrow", {}): continue
        yy = t["y0"] + t["subrow"][seg] * M_PX + M_PX / 2
        pts.append({"k": k, "y": round(yy, 1), "score": wscore(seg, k),
                    "t": id(t) % 100000})
    if pts:
        segments.append({"id": sections[seg], "marker": marker[seg], "points": pts})

out = {"scope": SCOPE, "thw": THW,
       "windows": [{"k": k, "label": f'{w["start"]}–{w["end"]}'} for k, w in enumerate(win_meta)],
       "ymax": round(ymax, 1), "n_segments": len(segments), "n_tracks": len(lane),
       "segments": segments}

TEMPLATE = r"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Storyline (paper-style) — __SCOPE__</title>
<script src="https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"></script>
<style>
 body{margin:0;font-family:system-ui,sans-serif;background:#fbfbfd;color:#222}
 #top{padding:9px 16px;border-bottom:1px solid #e3e3ea}
 h1{font-size:14px;margin:0 0 2px;font-weight:600}.muted{color:#888;font-size:12px}
 .bundle{fill:none;stroke-width:2.2;stroke-linecap:round}
 .conn{fill:none;stroke:#8a93a0;stroke-width:0.9;opacity:0.5}
 .conn.big{opacity:0.12}
 .seg.hot .bundle{stroke-width:3.6}.seg.hot .conn{opacity:0.95;stroke:#333;stroke-width:1.4}
 .dim{opacity:0.06}
 .axis text{fill:#9098a3;font-size:10px}
 #tt{position:fixed;pointer-events:none;background:#fff;border:1px solid #ccc;padding:6px 8px;
     border-radius:5px;font-size:12px;opacity:0;box-shadow:0 2px 8px rgba(0,0,0,.12)}
</style></head><body>
<div id="top"><h1>Storyline (paper-style) — __SCOPE__</h1>
 <span class="muted">tracked cohorts = horizontal bundles · faint curves = segments moving between cohorts (big jumps hidden) · color = condition (red poor → green good)</span></div>
<svg id="c"></svg><div id="tt"></div>
<script>
const D=__DATA__;
const color=d3.scaleSequential(d3.interpolateRdYlGn).domain([0,100]);
const m={top:44,left:24,right:24}, colW=62;
const x=k=>m.left+k*colW+7;
const W=m.left+m.right+D.windows.length*colW, H=m.top+D.ymax+24;
const svg=d3.select("#c").attr("width",W).attr("height",H);
const g=svg.append("g"); const defs=svg.append("defs"); const tt=d3.select("#tt");

D.segments.forEach((s,i)=>{
  const xs=s.points.map(p=>x(p.k)), x0=Math.min(...xs),x1=Math.max(...xs);
  const gr=defs.append("linearGradient").attr("id","g"+i)
    .attr("gradientUnits","userSpaceOnUse").attr("x1",x0).attr("x2",x1).attr("y1",0).attr("y2",0);
  s.points.forEach(p=>gr.append("stop").attr("offset",x1>x0?(x(p.k)-x0)/(x1-x0):0)
     .attr("stop-color",p.score==null?"#888":color(p.score)));
});

const sg=g.selectAll("g.seg").data(D.segments).join("g").attr("class","seg");
// bundle strokes: consecutive same-track, same/near y -> horizontal
sg.each(function(s,i){
  const node=d3.select(this);
  for(let a=1;a<s.points.length;a++){
    const p0=s.points[a-1],p1=s.points[a];
    if(p1.k-p0.k>1) continue;                    // gap
    const x0=x(p0.k),x1=x(p1.k),y0=p0.y,y1=p1.y;
    if(p0.t===p1.t){                             // inside a bundle -> solid shaded
      node.append("path").attr("class","bundle").attr("stroke",`url(#g${i})`)
        .attr("d",`M${x0},${y0}L${x1},${y1}`);
    } else {                                     // connector between bundles
      const dy=Math.abs(y1-y0);
      if(dy>D.thw){                              // curve hiding: short stubs only
        const st=(x1-x0)*0.22;
        node.append("path").attr("class","conn").attr("d",`M${x0},${y0}L${x0+st},${y0}`);
        node.append("path").attr("class","conn").attr("d",`M${x1-st},${y1}L${x1},${y1}`);
      } else {
        const xm=(x0+x1)/2;
        node.append("path").attr("class","conn")
          .attr("d",`M${x0},${y0}C${xm},${y0} ${xm},${y1} ${x1},${y1}`);
      }
    }
  }
});
sg.on("mousemove",function(e,d){
   d3.selectAll("g.seg").classed("dim",true);
   d3.select(this).classed("dim",false).classed("hot",true);
   tt.style("opacity",1).style("left",(e.clientX+14)+"px").style("top",(e.clientY+12)+"px")
     .html(`<b>${d.id}</b><br>marker ${d.marker} · ${d.points.length} windows`);
}).on("mouseleave",function(){
   d3.selectAll("g.seg").classed("dim",false).classed("hot",false); tt.style("opacity",0);});

const ax=g.append("g").attr("class","axis");
ax.selectAll("text").data(D.windows).join("text")
 .attr("x",d=>x(d.k)).attr("y",m.top-8).attr("transform",d=>`rotate(-40 ${x(d.k)} ${m.top-8})`)
 .text(d=>d.label);
ax.append("text").attr("x",m.left).attr("y",H-8).attr("fill","#9098a3")
 .text(`${D.n_segments} segments · ${D.n_tracks} tracked cohorts on ${D.scope}`);
</script></body></html>"""

html = TEMPLATE.replace("__SCOPE__", SCOPE).replace("__DATA__", json.dumps(out))
open("paper_storyline.html", "w", encoding="utf-8").write(html)
print(f"scope {SCOPE}: {len(segments)} segments, {len(lane)} tracked cohorts, ymax={ymax:.0f}px")
print("wrote paper_storyline.html")
