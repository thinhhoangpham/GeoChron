"""
Step 17 (Level 1): generate a self-contained D3 Storyline HTML page.

Embeds storyline_W5.json directly into the page so it opens by double-click
(no local server / CORS needed). Renders a session-level Storyline: each cohort
is a vertical band per time window, ribbons connect a cohort to its successor
(thickness = shared segments), color encodes mean condition score.
"""
import json

data = open("storyline_W5.json", encoding="utf-8").read()

TEMPLATE = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Pavement Cohort Storyline (W5)</title>
<script src="https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"></script>
<style>
  body { margin:0; font-family: system-ui, sans-serif; background:#0f1115; color:#e6e6e6; }
  #controls { padding:10px 16px; display:flex; gap:18px; align-items:center;
              border-bottom:1px solid #2a2d36; flex-wrap:wrap; }
  #controls label { font-size:13px; }
  h1 { font-size:15px; margin:0 14px 0 0; font-weight:600; }
  #chart { width:100%; }
  .ribbon { fill:#7f8c9b; opacity:0.28; }
  .ribbon:hover { opacity:0.6; }
  .node rect { stroke:#0f1115; stroke-width:0.5; cursor:pointer; }
  .axis text { fill:#9aa0ab; font-size:11px; }
  .legend text { fill:#cfd3da; font-size:11px; }
  #tooltip { position:fixed; pointer-events:none; background:#1c1f27; border:1px solid #3a3f4b;
             padding:7px 9px; border-radius:6px; font-size:12px; opacity:0; line-height:1.45; }
  .muted { color:#8b919c; }
</style>
</head>
<body>
<div id="controls">
  <h1>Pavement Cohort Storyline</h1>
  <label>Min cohort size: <span id="msv">30</span>
    <input id="ms" type="range" min="5" max="80" value="30" step="1"></label>
  <label class="muted">color = mean condition score (red=low/poor &rarr; green=high/good) ·
    band height &amp; ribbon width = segments</label>
</div>
<svg id="chart"></svg>
<div id="tooltip"></div>
<script>
const DATA = __DATA__;

const tip = d3.select("#tooltip");
const color = d3.scaleSequential(d3.interpolateRdYlGn).domain([0,100]);
const nodesById = new Map(DATA.nodes.map(n => [n.id, n]));
// incoming links per target (predecessors), for barycenter ordering
const incoming = d3.group(DATA.links, l => l.target);

const margin = {top:48, right:20, bottom:30, left:20};
const colW = 46, nodeW = 13, plotH = 720;
const W = margin.left + margin.right + DATA.windows.length * colW;
const H = margin.top + margin.bottom + plotH;

const svg = d3.select("#chart").attr("width", W).attr("height", H);
const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

const x = k => k * colW;

function render(minSize) {
  g.selectAll("*").remove();

  // visible nodes per window
  const vis = DATA.nodes.filter(n => n.size >= minSize);
  const byWin = d3.group(vis, n => n.k);

  // global vertical scale: largest window column fits plotH
  let maxColMembers = 0;
  for (const [,arr] of byWin) maxColMembers = Math.max(maxColMembers, d3.sum(arr, d=>d.size));
  const gap = 2;
  const gpx = (plotH - 6*gap) / Math.max(1, maxColMembers);   // px per member

  // order + position each column left->right (barycenter on predecessors)
  const pos = new Map();             // id -> {y,h,cy}
  const ks = DATA.windows.map(w=>w.k);
  for (const k of ks) {
    let arr = (byWin.get(k) || []).slice();
    if (k === ks[0]) {
      arr.sort((a,b)=> (b.mean_score??-1)-(a.mean_score??-1));
    } else {
      const bary = n => {
        const ins = (incoming.get(n.id)||[]).filter(l=>pos.has(l.source));
        if (!ins.length) return 1e9;
        let ws=0, wsum=0;
        for (const l of ins){ const p=pos.get(l.source); ws+=l.overlap*p.cy; wsum+=l.overlap; }
        return ws/wsum;
      };
      arr.sort((a,b)=> bary(a)-bary(b) || b.size-a.size);
    }
    let y=0;
    for (const n of arr){ const h=Math.max(1.2, n.size*gpx); pos.set(n.id,{y,h,cy:y+h/2}); y+=h+gap; }
  }

  // ribbon stacking offsets (sankey-style) for visible links
  const L = DATA.links.filter(l => pos.has(l.source) && pos.has(l.target));
  const outOff = new Map(), inOff = new Map();
  for (const [src, arr] of d3.group(L, l=>l.source)) {
    arr.sort((a,b)=> pos.get(a.target).cy - pos.get(b.target).cy);
    let o=0; for (const l of arr){ outOff.set(l, o); o += l.overlap*gpx; }
  }
  for (const [tgt, arr] of d3.group(L, l=>l.target)) {
    arr.sort((a,b)=> pos.get(a.source).cy - pos.get(b.source).cy);
    let o=0; for (const l of arr){ inOff.set(l, o); o += l.overlap*gpx; }
  }

  // draw ribbons
  const ribbon = d3.area().x(d=>d[0]).y0(d=>d[1]).y1(d=>d[2]).curve(d3.curveBasis);
  g.append("g").selectAll("path").data(L).join("path")
    .attr("class","ribbon")
    .attr("d", l => {
      const s=nodesById.get(l.source), t=nodesById.get(l.target);
      const ps=pos.get(l.source), pt=pos.get(l.target);
      const th=Math.max(0.8, l.overlap*gpx);
      const x0=x(s.k)+nodeW, x1=x(t.k);
      const sy=ps.y+(outOff.get(l)||0), ty=pt.y+(inOff.get(l)||0);
      const xm=(x0+x1)/2;
      const top=[[x0,sy],[xm,sy],[xm,ty],[x1,ty]];
      const bot=[[x1,ty+th],[xm,ty+th],[xm,sy+th],[x0,sy+th]];
      const pts=top.map(p=>[p[0],p[1],p[1]]).concat(bot.map(p=>[p[0],p[1],p[1]]));
      // build path manually for a smooth filled band
      const line=d3.line().curve(d3.curveBasis);
      return line(top)+"L"+line(bot).slice(1);
    });

  // draw nodes
  const node=g.append("g").selectAll("g").data(vis).join("g").attr("class","node");
  node.append("rect")
    .attr("x", d=>x(d.k)).attr("y", d=>pos.get(d.id).y)
    .attr("width", nodeW).attr("height", d=>pos.get(d.id).h)
    .attr("fill", d=> d.mean_score==null ? "#555" : color(d.mean_score))
    .on("mousemove", (e,d)=> {
      tip.style("opacity",1).style("left",(e.clientX+14)+"px").style("top",(e.clientY+12)+"px")
        .html(`<b>${d.roadbed||"?"}</b> · ${d.county||"?"}<br>`+
              `window ${DATA.windows[d.k].label}<br>`+
              `${d.size} segments · mean score ${d.mean_score??"n/a"}`);
    })
    .on("mouseleave", ()=> tip.style("opacity",0));

  // axis: window labels
  const ax=g.append("g").attr("class","axis");
  ax.selectAll("text").data(DATA.windows).join("text")
    .attr("x", d=>x(d.k)+nodeW/2).attr("y", -10)
    .attr("text-anchor","start").attr("transform", d=>`rotate(-40 ${x(d.k)+nodeW/2} -10)`)
    .text(d=>d.label);

  // counts
  ax.append("text").attr("x",0).attr("y", plotH+22).attr("text-anchor","start")
    .attr("fill","#8b919c")
    .text(`${vis.length} cohorts shown (size ≥ ${minSize}), ${L.length} links`);
}

render(30);
d3.select("#ms").on("input", function(){
  d3.select("#msv").text(this.value);
  render(+this.value);
});
</script>
</body>
</html>
"""

html = TEMPLATE.replace("__DATA__", data)
open("storyline.html", "w", encoding="utf-8").write(html)
print(f"wrote storyline.html ({len(html)//1024} KB)")
