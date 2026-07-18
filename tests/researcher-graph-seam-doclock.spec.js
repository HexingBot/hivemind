// tests/researcher-graph-seam-doclock.spec.js
// TASK-113(a) — agents/researcher.md's "Graph lookup first" step originally
// instructed hand-simulating src/knowledge-graph.js's neighbors()/
// nodesByType() calls with no execution grant anywhere in the Researcher's
// tool list, so the doc-lock below required an honest direct-file-read
// fallback instead ("Read `knowledge/graph/graph.json` directly").
//
// TASK-170 (KB-GRAPH-2) supersedes that design: TASK-168/172 shipped
// kb_graph_query, a real MCP execution seam wrapping neighbors()/
// nodesByType() with deterministic output. The Researcher's tool grant now
// includes mcp__plugin_hivemind_hivemind-tasks__kb_graph_query, so the
// hand-read fallback is no longer honest-by-necessity — it is a graph query
// via the tool, never a hand read. This doc-lock is updated (not retired) to
// assert the NEW contract: the tool call replaces the direct file read, and
// the hand-simulation phrasing (locked out since TASK-113) still never
// reappears.
//
// Parity note: .claude/agents/researcher.md and the plugin-root
// agents/researcher.md are already asserted byte-identical by
// tests/agents-parity.spec.js, so asserting content here against only the
// .claude/ copy is sufficient (same convention as tests/agility-doc-locks.spec.js).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from './helpers/repoRoot.js';

const RESEARCHER_PATH = join(REPO_ROOT, '.claude', 'agents', 'researcher.md');

function load() {
  return readFileSync(RESEARCHER_PATH, 'utf8');
}

describe('TASK-170 — researcher.md graph-lookup step calls kb_graph_query, never hand-reads the graph', () => {
  it('no longer instructs querying the graph "using neighbors and nodesByType" as a hand-simulated call', () => {
    const text = load();
    expect(
      text.includes('using `neighbors` and `nodesByType` from `src/knowledge-graph.js`'),
      'the hand-simulation phrasing must not survive',
    ).toBe(false);
  });

  it('no longer instructs a direct hand-read of knowledge/graph/graph.json as the query mechanism', () => {
    const text = load();
    expect(
      text.includes('Read `knowledge/graph/graph.json` directly'),
      'the pre-TASK-170 hand-read fallback must not survive — kb_graph_query replaced it',
    ).toBe(false);
  });

  it('instructs calling the kb_graph_query MCP tool as the graph query surface', () => {
    const text = load();
    expect(text).toMatch(/mcp__plugin_hivemind_hivemind-tasks__kb_graph_query/);
    expect(text).toMatch(/never hand-read `knowledge\/graph\/graph\.json`/);
  });

  it('the tool grant in frontmatter includes kb_graph_query', () => {
    const text = load();
    expect(text).toMatch(/tools:.*mcp__plugin_hivemind_hivemind-tasks__kb_graph_query/);
  });
});
