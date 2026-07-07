#!/usr/bin/env node
// scripts/migrate-graph-ids.mjs
// TASK-104 — ONE-TIME migration: normalizes every node id and edge endpoint in
// knowledge/graph/graph.json to the canonical convention (see
// src/graph-id-migration.js for the exact mechanical rules). Prints
// before/after node+edge counts and the number of ids renamed.
//
// This script is idempotent — re-running it against an already-canonical
// graph.json renames nothing (deriveCanonicalId returns ids unchanged when
// isCanonicalId already holds) — but it is intended to run exactly once as
// part of the TASK-104 hand-off.
//
// Usage: node scripts/migrate-graph-ids.mjs

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { loadGraph, writeGraph } from '../src/knowledge-graph.js';
import { migrateGraphIds, validateCanonicalGraph } from '../src/graph-id-migration.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dir, '..');

async function main() {
  const graph = await loadGraph({ repoRoot: REPO_ROOT });
  const {
    nodes, edges, renameMap, before, after,
  } = migrateGraphIds({ nodes: graph.nodes, edges: graph.edges });

  const violations = validateCanonicalGraph({ nodes, edges });
  if (violations.length > 0) {
    // eslint-disable-next-line no-console
    console.error('migrate-graph-ids: post-migration validation FAILED — aborting write:');
    for (const v of violations) console.error(`  - ${v}`);
    process.exit(1);
  }

  await writeGraph({ repoRoot: REPO_ROOT, graph: { schema_version: graph.schema_version, nodes, edges } });

  // eslint-disable-next-line no-console
  console.log(`before: ${before.nodeCount} nodes / ${before.edgeCount} edges`);
  // eslint-disable-next-line no-console
  console.log(`after:  ${after.nodeCount} nodes / ${after.edgeCount} edges`);
  // eslint-disable-next-line no-console
  console.log(`renamed ${renameMap.size} node ids:`);
  for (const [oldId, newId] of renameMap) {
    // eslint-disable-next-line no-console
    console.log(`  ${oldId} -> ${newId}`);
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
