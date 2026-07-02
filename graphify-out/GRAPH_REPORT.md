# Graph Report - .  (2026-07-02)

## Corpus Check
- 97 files · ~11,443,445 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 278 nodes · 368 edges · 28 communities (19 shown, 9 thin omitted)
- Extraction: 81% EXTRACTED · 19% INFERRED · 0% AMBIGUOUS · INFERRED: 70 edges (avg confidence: 0.81)
- Token cost: 0 input · 50,892 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Storyline Renderer (storyline.js)|Storyline Renderer (storyline.js)]]
- [[_COMMUNITY_Session Tracking & Storyline Emit (Steps 12-17)|Session Tracking & Storyline Emit (Steps 12-17)]]
- [[_COMMUNITY_Graphify Skill & Extraction Spec|Graphify Skill & Extraction Spec]]
- [[_COMMUNITY_Domain Concepts & GeoChron Paper|Domain Concepts & GeoChron Paper]]
- [[_COMMUNITY_Relation Network & Community Mining (Steps 6-11)|Relation Network & Community Mining (Steps 6-11)]]
- [[_COMMUNITY_Cluster Viewer (clusters.js)|Cluster Viewer (clusters.js)]]
- [[_COMMUNITY_Windowing & Normalization (Steps 4-5)|Windowing & Normalization (Steps 4-5)]]
- [[_COMMUNITY_Storyline HTML Pages|Storyline HTML Pages]]
- [[_COMMUNITY_All-Roads TimeArcs View|All-Roads TimeArcs View]]
- [[_COMMUNITY_Clusters Page Screenshot|Clusters Page Screenshot]]
- [[_COMMUNITY_Cluster Verification UI|Cluster Verification UI]]
- [[_COMMUNITY_All-Roads Top View|All-Roads Top View]]
- [[_COMMUNITY_Cluster Sample Heatmaps|Cluster Sample Heatmaps]]
- [[_COMMUNITY_All-Roads Scrolled View|All-Roads Scrolled View]]
- [[_COMMUNITY_All-Roads Flow (v2)|All-Roads Flow (v2)]]
- [[_COMMUNITY_All-Roads Flow (v3)|All-Roads Flow (v3)]]
- [[_COMMUNITY_PPTX Presentation Builder|PPTX Presentation Builder]]
- [[_COMMUNITY_Road Structure & UnionFind|Road Structure & UnionFind]]
- [[_COMMUNITY_Full-Res Unit Segments|Full-Res Unit Segments]]
- [[_COMMUNITY_Unit Heatmaps|Unit Heatmaps]]
- [[_COMMUNITY_Unit Heatmaps (fill1)|Unit Heatmaps (fill1)]]
- [[_COMMUNITY_Unit Heatmaps (no-fill)|Unit Heatmaps (no-fill)]]
- [[_COMMUNITY_Unit Clustering|Unit Clustering]]
- [[_COMMUNITY_Unit Clustering (fill1)|Unit Clustering (fill1)]]
- [[_COMMUNITY_Unit Clustering (no-fill)|Unit Clustering (no-fill)]]
- [[_COMMUNITY_Cluster Sample Plotter|Cluster Sample Plotter]]
- [[_COMMUNITY_Validation Metrics|Validation Metrics]]

## God Nodes (most connected - your core abstractions)
1. `graphify skill` - 15 edges
2. `Two-Level Visualization (Storyline + EvoLens)` - 12 edges
3. `draw()` - 8 edges
4. `render()` - 7 edges
5. `rebuildGLGeometry()` - 7 edges
6. `appendLines()` - 7 edges
7. `edgeColor()` - 7 edges
8. `Storyline Technique` - 7 edges
9. `conditionColor()` - 6 edges
10. `cohortColor()` - 6 edges

## Surprising Connections (you probably didn't know these)
- `Sliding Multi-Year Window (W)` --semantically_similar_to--> `Wrapping Window Correlation Smoothing`  [INFERRED] [semantically similar]
  procedure.md → paper.txt
- `dominant()` --conceptually_related_to--> `Two-Level Visualization (Storyline + EvoLens)`  [INFERRED]
  step16_storyline_json.py → procedure.md
- `Correlation-Distance Hierarchical Clustering of Units` --semantically_similar_to--> `Pairwise-Complete Pearson Trend Similarity`  [INFERRED] [semantically similar]
  PLAN_cluster_units.md → procedure.md
- `Per-Window Relation Network (intersection of filters)` --semantically_similar_to--> `Network Formulation (fuse correlation + proximity, no summed distance)`  [INFERRED] [semantically similar]
  procedure.md → paper.txt
- `All Storyline Visualization` --semantically_similar_to--> `Storyline Visualization (base)`  [INFERRED] [semantically similar]
  all_storyline.html → storyline.html

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Graphify Extraction Pipeline** — _claude_skills_graphify_skill_ast_extraction, _claude_skills_graphify_skill_semantic_extraction, _claude_skills_graphify_references_extraction_spec_spec [INFERRED 0.85]
- **Graphify Query Flows** — _claude_skills_graphify_references_query_query, _claude_skills_graphify_references_query_path, _claude_skills_graphify_references_query_explain [INFERRED 0.85]
- **Evolution Pattern Mining Flow** — procedure_pairwise_pearson, procedure_relation_network, procedure_louvain [INFERRED 0.85]
- **Two-Level Visualization Stack** — paper_storyline, paper_evolens, paper_trend_motif [INFERRED 0.85]
- **Windowing and Similarity Pipeline** — procedure_sliding_window, procedure_window_normalize, procedure_threshold_binary [INFERRED 0.75]
- **Storyline Visualization Page Family** — storyline_page, all_storyline_page, paper_storyline_page, segment_storyline_page, index_page, index_county_page [INFERRED 0.85]

## Communities (28 total, 9 thin omitted)

### Community 0 - "Storyline Renderer (storyline.js)"
Cohesion: 0.12
Nodes (34): appendLines(), avgV(), bucketFor(), buildAxis(), buildHitIndex(), cohortColor(), colorToFloats(), colPitch() (+26 more)

### Community 1 - "Session Tracking & Storyline Emit (Steps 12-17)"
Cohesion: 0.07
Nodes (21): EvoLens Drill-Down Lens, Trend Motif (normalized quartile band + median), Cross-Window Session Tracking (max overlap), Treatment Event Detection (rehab/overlay jumps), Two-Level Visualization (Storyline + EvoLens), Track (mutual-best-overlap union-find bundle), Step 12: Track sessions across consecutive windows.  For each consecutive window, dominant() (+13 more)

### Community 2 - "Graphify Skill & Extraction Spec"
Cohesion: 0.08
Nodes (31): graphify add (URL ingest), graphify --watch, graphify exports (wiki/neo4j/falkordb/svg/graphml/mcp), MCP Stdio Server, Confidence Score Rubric, Hyperedges, Node ID Format Rule, Semantic Similarity Edges (+23 more)

### Community 3 - "Domain Concepts & GeoChron Paper"
Cohesion: 0.10
Nodes (24): Graphify Knowledge Graph Workflow, Air Quality in China Case Study, Evolution Pattern (spatially close + trend-correlated ST series), GeoChron (Visualizing Large-Scale Spatial Time Series), Session-Based Linked Geographic Map, Session (evolution pattern as Storyline session), Gradient Shade Trend Encoding, Spatial Time Series (ST Series) (+16 more)

### Community 4 - "Relation Network & Community Mining (Steps 6-11)"
Cohesion: 0.15
Nodes (16): Network Formulation (fuse correlation + proximity, no summed distance), Pattern Mining Framework, Wrapping Window Correlation Smoothing, Louvain Community Detection, Pairwise-Complete Pearson Trend Similarity, Per-Window Relation Network (intersection of filters), Small Session Filtering (ths), Binary Spatial Proximity Rule (+8 more)

### Community 5 - "Cluster Viewer (clusters.js)"
Cohesion: 0.21
Nodes (13): buildThumbCard(), conditionColor(), drawSegmentHeatmap(), fetchJson(), findBigGap(), getCategory(), getCategoryColor(), getContrastColor() (+5 more)

### Community 6 - "Windowing & Normalization (Steps 4-5)"
Cohesion: 0.19
Nodes (10): Sliding Multi-Year Window (W), Within-Window Trajectory Normalization, Skip Normalization (Pearson z-norm invariance), Data export for the EvoLens drill-down panel (paper Step 17, Level 2).  The main, Step 4: Slice the time span into overlapping multi-year windows.  Each window of, Return list of (start_year, end_year, [col indices])., windows_for(), normalize() (+2 more)

### Community 7 - "Storyline HTML Pages"
Cohesion: 0.18
Nodes (12): All Storyline Visualization, Gap-Fill Mode Selector, Unit Clusters Page, Cluster Thumbnail Grid, Storyline by County Only (index_county), Storyline by Highway+County (index), Paper Storyline Visualization, GeoChron to PMIS Presentation Deck (+4 more)

### Community 8 - "All-Roads TimeArcs View"
Cohesion: 0.32
Nodes (8): Arc Links Between Segment Windows, Condition (RdYlGn) Color Mode, Highway IH0010 L (619 segments), All Roads Top2 - TimeArcs Pavement Condition View, Layout Controls (Row Height, Lane Gap, Road Gap, Column Width), Road Segments (722 roads, 14810 segments), Sliding 5-Year Time Windows (1996-2024), TimeArcs Interactive Visualization

### Community 9 - "Clusters Page Screenshot"
Cohesion: 0.32
Nodes (8): Single-Member Cluster Item, Directional Pair (L/R Roadway), Unit Heatmap Card (SS0303 TARRANT), Clusters Web Page Screenshot, Pavement Unit Trajectory, Segment-Time Green Heatmap Grid, Cluster List Sidebar, Clusters Summary Header (126 clusters, 295 units)

### Community 10 - "Cluster Verification UI"
Cohesion: 0.29
Nodes (8): Cluster 108 (7 members, selected), Cluster List (126 clusters, 295 units), Cluster Membership Validation, Green-Yellow-Red Condition Colormap, County Labels (HARRIS, TARRANT, MCLENNAN, DENTON), Highway Units (IH0045, IH0020, IH0035), Cluster Verification UI Screenshot, Per-Unit Segment Heatmaps

### Community 11 - "All-Roads Top View"
Cohesion: 0.29
Nodes (7): Condition Color Mode (RdYlGn), Layout Controls (Row Height, Lane/Road Gap, Column Width), Highway IH0010 L (619 segments), All Roads Trajectory Explorer (Top View), Roads and Segments Dataset (722 roads, 14810 segments), Sliding 5-Year Time Windows (1996-2024), Pavement Condition Trajectory Visualization

### Community 12 - "Cluster Sample Heatmaps"
Cohesion: 0.38
Nodes (7): Cluster Heatmap Grid (rows = clusters), Texas County Labels (HARRIS, TARRANT, COLLIN, DALLAS, NAVARRO, CHAMBERS), Sample Heatmaps from Largest Clusters, Pavement Segments (IH0045, IH0020, SH0289, US0075, US0290, SH0031, IH0010, IH0045), Red-Yellow-Green Distress Colormap, Space (x) vs Window (y) Axes, Spatiotemporal Distress Pattern

### Community 13 - "All-Roads Scrolled View"
Cohesion: 0.47
Nodes (6): Condition (RdYlGn) Color Mode, Filter & Layout Controls Panel, 303 Roads, 11119 Segments Corpus, Road Segment Flow Lines, 25 Sliding Time Windows (1996-2024), All Roads Scrolled Storyline View

### Community 14 - "All-Roads Flow (v2)"
Cohesion: 0.47
Nodes (6): Condition Color Mode (RdYlGn), All Roads Pavement Condition Flow Visualization (top, v2), Interactive Layout Controls (row height, lane/road gap, column width, filter), Parallel Coordinates Flow Chart, 722 Roads / 14810 Segments / 25 Windows, Rolling 5-Year Time Windows (1996-2000 to 2020-2024)

### Community 15 - "All-Roads Flow (v3)"
Cohesion: 0.47
Nodes (6): Condition (RdYlGn) Color Mode, Segment Flow Lines, All Roads Top v3 Flow Visualization, Road Filter & Layout Controls, 722 Roads / 14810 Segments, 5-Year Sliding Time Windows (1996-2024)

### Community 17 - "Road Structure & UnionFind"
Cohesion: 0.47
Nodes (3): buildAllStructures(), buildRoadStructure(), UnionFind

### Community 18 - "Full-Res Unit Segments"
Cohesion: 0.50
Nodes (3): clean_and_round(), Full-resolution per-segment, per-year data for the cluster-thumbnail viewer, mat, Port of the reference chart's cleanAndRound(): strip everything but     digits/d

## Knowledge Gaps
- **44 isolated node(s):** `Community Detection`, `God Nodes`, `Gemini Extraction Backend`, `Hyperedges`, `Semantic Similarity Edges` (+39 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **9 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Two-Level Visualization (Storyline + EvoLens)` connect `Session Tracking & Storyline Emit (Steps 12-17)` to `Domain Concepts & GeoChron Paper`, `Windowing & Normalization (Steps 4-5)`?**
  _High betweenness centrality (0.062) - this node is a cross-community bridge._
- **Why does `Storyline Technique` connect `Domain Concepts & GeoChron Paper` to `Session Tracking & Storyline Emit (Steps 12-17)`?**
  _High betweenness centrality (0.022) - this node is a cross-community bridge._
- **Why does `Preserve Gaps (No Interpolation)` connect `Domain Concepts & GeoChron Paper` to `Relation Network & Community Mining (Steps 6-11)`, `Windowing & Normalization (Steps 4-5)`?**
  _High betweenness centrality (0.019) - this node is a cross-community bridge._
- **Are the 10 inferred relationships involving `Two-Level Visualization (Storyline + EvoLens)` (e.g. with `step12_track.py` and `step16_storyline_json.py`) actually correct?**
  _`Two-Level Visualization (Storyline + EvoLens)` has 10 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Generate presentation.pptx -- a PowerPoint version of presentation.html, same 12`, `Build a fixed-size space x time heatmap grid per (roadbed, county) unit, for clu`, `Variant of build_unit_heatmaps.py using a different gap-fill strategy ("option 1` to the rest of the system?**
  _80 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Storyline Renderer (storyline.js)` be split into smaller, more focused modules?**
  _Cohesion score 0.1166429587482219 - nodes in this community are weakly interconnected._
- **Should `Session Tracking & Storyline Emit (Steps 12-17)` be split into smaller, more focused modules?**
  _Cohesion score 0.07007575757575757 - nodes in this community are weakly interconnected._