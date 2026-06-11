// scripts/seed-graph.mjs — one-shot seed generator for knowledge/graph/graph.json.
// Run: node scripts/seed-graph.mjs
// Generates the seed file using the knowledge-graph store API so byte format
// is guaranteed to match the deterministic serializer.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dir, '..');

// Import the store API (compiled from src/knowledge-graph.js).
const { addNode, loadGraph } = await import('../src/knowledge-graph.js');

// Remove any existing graph.json and start fresh.
import { existsSync, rmSync, mkdirSync } from 'node:fs';
const graphPath = join(REPO_ROOT, 'knowledge', 'graph', 'graph.json');
if (existsSync(graphPath)) rmSync(graphPath);
mkdirSync(join(REPO_ROOT, 'knowledge', 'graph'), { recursive: true });

// Seed node 1: windows-atomic-rename-not-truly-atomic.md
await addNode({
  repoRoot: REPO_ROOT,
  node: {
    id: 'ke-windows-atomic-rename',
    type: 'knowledge_entry',
    ref: 'knowledge/entries/windows-atomic-rename-not-truly-atomic.md',
    label: 'Windows atomic rename is not truly atomic',
  },
});

// Seed node 2: session-audit-logs-vs-wildcard-gitignore.md
await addNode({
  repoRoot: REPO_ROOT,
  node: {
    id: 'ke-session-audit-logs-gitignore',
    type: 'knowledge_entry',
    ref: 'knowledge/entries/session-audit-logs-vs-wildcard-gitignore.md',
    label: 'Session audit logs vs wildcard gitignore',
  },
});

const graph = await loadGraph({ repoRoot: REPO_ROOT });
console.log('Seed complete. Nodes:', graph.nodes.map((n) => n.id));
