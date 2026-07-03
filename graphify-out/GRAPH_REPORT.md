# Graph Report - C:\Users\Owner\Documents\GeoChron  (2026-07-02)

## Corpus Check
- 20 files · ~11,754,015 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 329 nodes · 461 edges · 27 communities (18 shown, 9 thin omitted)
- Extraction: 85% EXTRACTED · 15% INFERRED · 0% AMBIGUOUS · INFERRED: 70 edges (avg confidence: 0.81)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]

## God Nodes (most connected - your core abstractions)
1. `graphify skill` - 15 edges
2. `Two-Level Visualization (Storyline + EvoLens)` - 12 edges
3. `draw()` - 8 edges
4. `Storyline Technique` - 7 edges
5. `build_units()` - 7 edges
6. `render()` - 7 edges
7. `rebuildGLGeometry()` - 7 edges
8. `appendLines()` - 7 edges
9. `edgeColor()` - 7 edges
10. `graphify query (BFS/DFS traversal)` - 6 edges

## Surprising Connections (you probably didn't know these)
- `dominant()` --conceptually_related_to--> `Two-Level Visualization (Storyline + EvoLens)`  [INFERRED]
  step16_storyline_json.py → procedure.md
- `Sliding Multi-Year Window (W)` --semantically_similar_to--> `Wrapping Window Correlation Smoothing`  [INFERRED] [semantically similar]
  procedure.md → paper.txt
- `Per-Window Relation Network (intersection of filters)` --semantically_similar_to--> `Network Formulation (fuse correlation + proximity, no summed distance)`  [INFERRED] [semantically similar]
  procedure.md → paper.txt
- `All Storyline Visualization` --semantically_similar_to--> `Storyline Visualization (base)`  [INFERRED] [semantically similar]
  all_storyline.html → storyline.html
- `Paper Storyline Visualization` --semantically_similar_to--> `Storyline Visualization (base)`  [INFERRED] [semantically similar]
  paper_storyline.html → storyline.html

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Graphify Extraction Pipeline** — _claude_skills_graphify_skill_ast_extraction, _claude_skills_graphify_skill_semantic_extraction, _claude_skills_graphify_references_extraction_spec_spec [INFERRED 0.85]
- **Graphify Query Flows** — _claude_skills_graphify_references_query_query, _claude_skills_graphify_references_query_path, _claude_skills_graphify_references_query_explain [INFERRED 0.85]
- **Evolution Pattern Mining Flow** — procedure_pairwise_pearson, procedure_relation_network, procedure_louvain [INFERRED 0.85]
- **Two-Level Visualization Stack** — paper_storyline, paper_evolens, paper_trend_motif [INFERRED 0.85]
- **Windowing and Similarity Pipeline** — procedure_sliding_window, procedure_window_normalize, procedure_threshold_binary [INFERRED 0.75]
- **Storyline Visualization Page Family** — storyline_page, all_storyline_page, paper_storyline_page, segment_storyline_page, index_page, index_county_page [INFERRED 0.85]

## Communities (27 total, 9 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.06
Nodes (45): Graphify Knowledge Graph Workflow, Air Quality in China Case Study, Evolution Pattern (spatially close + trend-correlated ST series), GeoChron (Visualizing Large-Scale Spatial Time Series), Session-Based Linked Geographic Map, Network Formulation (fuse correlation + proximity, no summed distance), Pattern Mining Framework, Session (evolution pattern as Storyline session) (+37 more)

### Community 1 - "Community 1"
Cohesion: 0.06
Nodes (26): EvoLens Drill-Down Lens, Trend Motif (normalized quartile band + median), Louvain Community Detection, Small Session Filtering (ths), Cross-Window Session Tracking (max overlap), Treatment Event Detection (rehab/overlay jumps), Two-Level Visualization (Storyline + EvoLens), Track (mutual-best-overlap union-find bundle) (+18 more)

### Community 2 - "Community 2"
Cohesion: 0.12
Nodes (34): appendLines(), avgV(), bucketFor(), buildAxis(), buildHitIndex(), cohortColor(), colorToFloats(), colPitch() (+26 more)

### Community 3 - "Community 3"
Cohesion: 0.08
Nodes (31): graphify add (URL ingest), graphify --watch, graphify exports (wiki/neo4j/falkordb/svg/graphml/mcp), MCP Stdio Server, Confidence Score Rubric, Hyperedges, Node ID Format Rule, Semantic Similarity Edges (+23 more)

### Community 4 - "Community 4"
Cohesion: 0.13
Nodes (19): Arc Links Between Segment Windows, Condition (RdYlGn) Color Mode, Highway IH0010 L (619 segments), All Roads Top2 - TimeArcs Pavement Condition View, Road Segments (722 roads, 14810 segments), Sliding 5-Year Time Windows (1996-2024), TimeArcs Interactive Visualization, Condition Color Mode (RdYlGn) (+11 more)

### Community 5 - "Community 5"
Cohesion: 0.16
Nodes (12): Run the full unit-level evolution-pattern data build end to end., clean_and_round(), main(), Full-resolution per-segment, per-year data for the cluster-thumbnail viewer, mat, Port of the reference chart's cleanAndRound(): strip everything but     digits/d, build_storyline(), level_to_color_score(), main() (+4 more)

### Community 6 - "Community 6"
Cohesion: 0.22
Nodes (10): and_edges(), county_gate(), filter_sessions(), louvain_sessions(), main(), pairwise_edges(), _pearson(), Unit-level grouping for the distribution-aware evolution pattern.  Per window: c (+2 more)

### Community 7 - "Community 7"
Cohesion: 0.23
Nodes (8): build_units(), level_of(), _load_sources(), main(), Build per-unit (roadbed · county) distribution-aware yearly series for the unit-, spread_of(), TestBuildUnits, TestUnitSeriesMath

### Community 8 - "Community 8"
Cohesion: 0.18
Nodes (12): All Storyline Visualization, Gap-Fill Mode Selector, Unit Clusters Page, Cluster Thumbnail Grid, Storyline by County Only (index_county), Storyline by Highway+County (index), Paper Storyline Visualization, GeoChron to PMIS Presentation Deck (+4 more)

### Community 9 - "Community 9"
Cohesion: 0.27
Nodes (7): buildThumbCard(), drawSegmentHeatmap(), fetchJson(), hideTooltip(), loadClusters(), renderThumbnails(), selectCluster()

### Community 10 - "Community 10"
Cohesion: 0.32
Nodes (8): Single-Member Cluster Item, Directional Pair (L/R Roadway), Unit Heatmap Card (SS0303 TARRANT), Clusters Web Page Screenshot, Pavement Unit Trajectory, Segment-Time Green Heatmap Grid, Cluster List Sidebar, Clusters Summary Header (126 clusters, 295 units)

### Community 11 - "Community 11"
Cohesion: 0.29
Nodes (8): Cluster 108 (7 members, selected), Cluster List (126 clusters, 295 units), Cluster Membership Validation, Green-Yellow-Red Condition Colormap, County Labels (HARRIS, TARRANT, MCLENNAN, DENTON), Highway Units (IH0045, IH0020, IH0035), Cluster Verification UI Screenshot, Per-Unit Segment Heatmaps

### Community 12 - "Community 12"
Cohesion: 0.38
Nodes (7): Cluster Heatmap Grid (rows = clusters), Texas County Labels (HARRIS, TARRANT, COLLIN, DALLAS, NAVARRO, CHAMBERS), Sample Heatmaps from Largest Clusters, Pavement Segments (IH0045, IH0020, SH0289, US0075, US0290, SH0031, IH0010, IH0045), Red-Yellow-Green Distress Colormap, Space (x) vs Window (y) Axes, Spatiotemporal Distress Pattern

### Community 13 - "Community 13"
Cohesion: 0.52
Nodes (5): conditionColor(), drawSegmentHeatmap(), findBigGap(), getCategory(), getCategoryColor()

### Community 14 - "Community 14"
Cohesion: 0.47
Nodes (6): Condition (RdYlGn) Color Mode, Filter & Layout Controls Panel, 303 Roads, 11119 Segments Corpus, Road Segment Flow Lines, 25 Sliding Time Windows (1996-2024), All Roads Scrolled Storyline View

### Community 15 - "Community 15"
Cohesion: 0.47
Nodes (6): Condition Color Mode (RdYlGn), All Roads Pavement Condition Flow Visualization (top, v2), Interactive Layout Controls (row height, lane/road gap, column width, filter), Parallel Coordinates Flow Chart, 722 Roads / 14810 Segments / 25 Windows, Rolling 5-Year Time Windows (1996-2000 to 2020-2024)

### Community 17 - "Community 17"
Cohesion: 0.47
Nodes (3): buildAllStructures(), buildRoadStructure(), UnionFind

## Knowledge Gaps
- **41 isolated node(s):** `Community Detection`, `God Nodes`, `Gemini Extraction Backend`, `Hyperedges`, `Semantic Similarity Edges` (+36 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **9 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Two-Level Visualization (Storyline + EvoLens)` connect `Community 1` to `Community 0`?**
  _High betweenness centrality (0.044) - this node is a cross-community bridge._
- **Why does `Storyline Technique` connect `Community 0` to `Community 1`?**
  _High betweenness centrality (0.015) - this node is a cross-community bridge._
- **Are the 10 inferred relationships involving `Two-Level Visualization (Storyline + EvoLens)` (e.g. with `step12_track.py` and `step16_storyline_json.py`) actually correct?**
  _`Two-Level Visualization (Storyline + EvoLens)` has 10 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Generate presentation.pptx -- a PowerPoint version of presentation.html, same 12`, `Cluster (roadbed, county) units whose space x time heatmaps look similar.  Input`, `Same clustering method as cluster_units.py (dense Pearson correlation, average o` to the rest of the system?**
  _82 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.05795918367346939 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.05731707317073171 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.1166429587482219 - nodes in this community are weakly interconnected._