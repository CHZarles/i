// Sync deleted files between local disk and the existing knowledge graph.
// Identifies nodes whose filePath is no longer on disk and removes them plus
// any edges referencing those nodes. Also prunes layer/tour nodeIds.
//
// Usage:
//   node sync-local-deletes.cjs <project-root> <graph-json-path> <meta-json-path>

const fs = require('fs');
const path = require('path');

const projectRoot = process.argv[2];
const graphPath = process.argv[3];
const metaPath = process.argv[4];

const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));

// Map every file-like node to its on-disk existence.
const fileLevelTypes = new Set(['file', 'config', 'document', 'service', 'pipeline', 'table', 'schema', 'resource', 'endpoint']);

const removed = [];
const survivors = [];
const staleNodes = graph.nodes.filter(n => {
  if (!fileLevelTypes.has(n.type)) return false;
  if (!n.filePath) return false;
  const abs = path.join(projectRoot, n.filePath);
  return !fs.existsSync(abs);
});

const staleIds = new Set(staleNodes.map(n => n.id));
const freshNodes = graph.nodes.filter(n => !staleIds.has(n.id));
const freshEdges = graph.edges.filter(e => !staleIds.has(e.source) && !staleIds.has(e.target));

// Reconcile layers and tour: drop node references to removed nodes; drop empty layers/steps.
function reconcileContainer(arr, label) {
  if (!Array.isArray(arr)) return { arr, changed: 0, dropped: 0 };
  let changed = 0, dropped = 0;
  const filtered = arr.filter(item => {
    const ids = (item.nodeIds || []).filter(id => {
      if (staleIds.has(id)) { changed++; return false; }
      return true;
    });
    item.nodeIds = ids;
    if (ids.length === 0) { dropped++; return false; }
    return true;
  });
  return { arr: filtered, changed, dropped };
}

const layersResult = reconcileContainer(graph.layers, 'layers');
graph.layers = layersResult.arr;

const tourResult = reconcileContainer(graph.tour, 'tour');
graph.tour = tourResult.arr.sort((a, b) => (a.order || 0) - (b.order || 0));

graph.nodes = freshNodes;
graph.edges = freshEdges;

console.log('Removed', staleNodes.length, 'nodes:');
for (const n of staleNodes) console.log('  -', n.id, '(', n.type, ',', n.filePath, ')');
console.log('Edges after pruning:', freshEdges.length, '(was', graph.edges.length + staleIds.size, 'originally total maybe higher)');
console.log('Layers: pruned', layersResult.changed, 'nodeIds in', layersResult.dropped, 'empty layer(s)');
console.log('Tour steps: pruned', tourResult.changed, 'nodeIds in', tourResult.dropped, 'empty step(s)');

fs.writeFileSync(graphPath, JSON.stringify(graph, null, 2));

// Update meta.json lastAnalyzedAt.
let meta = null;
try {
  meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
} catch (_) {}
if (meta) {
  meta.lastAnalyzedAt = new Date().toISOString();
  meta.analyzedFiles = graph.nodes.filter(n => fileLevelTypes.has(n.type)).length;
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  console.log('meta.json updated.');
}

// Recompute stats.
const stats = {
  totalNodes: graph.nodes.length,
  totalEdges: graph.edges.length,
  totalLayers: graph.layers.length,
  tourSteps: graph.tour.length,
  nodeTypes: graph.nodes.reduce((a, n) => { a[n.type] = (a[n.type]||0)+1; return a; }, {}),
  edgeTypes: graph.edges.reduce((a, e) => { a[e.type] = (a[e.type]||0)+1; return a; }, {})
};
fs.writeFileSync(path.join(path.dirname(graphPath), 'intermediate', 'post-sync-stats.json'), JSON.stringify(stats, null, 2));
console.log('Final stats:', JSON.stringify(stats, null, 2));
