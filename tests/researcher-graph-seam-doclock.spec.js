// tests/researcher-graph-seam-doclock.spec.js
// TASK-113(a) — agents/researcher.md's "Graph lookup first" step instructed
// hand-simulating src/knowledge-graph.js's neighbors()/nodesByType() calls
// "using `neighbors` and `nodesByType` from `src/knowledge-graph.js`" with no
// execution grant anywhere in the Researcher's tool list (Read, Grep, Glob,
// WebSearch, WebFetch, Write, mcp__github__*, mcp__wisearcher-brain__*,
// mcp__plugin_hivemind_hivemind-tasks__kb_lookup — none of which can invoke
// an arbitrary JS function) — the same hand-simulation defect class TASK-106
// fixed for KB scoring (via the kb_lookup MCP seam), but left un-scoped here.
//
// Design judgment (recorded in the TASK-113 hand-off): the honest
// direct-file-read fallback was chosen over adding a new executable seam —
// the Researcher already holds a Read grant and knowledge/graph/graph.json
// is plain, small JSON it can filter by eye (node type + label/ref match,
// then scan edges for from/to references), so a new MCP tool mirroring
// kb_lookup would be disproportionate machinery for a low-traffic, LOW-
// severity bundled follow-up. No new seam -> no red-first execution spec is
// required by the ticket; this doc-lock is the sensor instead, and it is
// itself red-first: it fails against the pre-fix prose below.
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

describe('TASK-113(a) — researcher.md graph-lookup step carries no hand-simulation instruction', () => {
  it('no longer instructs querying the graph "using neighbors and nodesByType" as an executable call', () => {
    const text = load();
    expect(
      text.includes('using `neighbors` and `nodesByType` from `src/knowledge-graph.js`'),
      'the hand-simulation phrasing must not survive',
    ).toBe(false);
  });

  it('states the honest no-execution-grant fallback and instructs a direct file read', () => {
    const text = load();
    expect(/no execution (seam|grant)/i.test(text), 'must state the no-execution-grant fact').toBe(true);
    expect(
      text.includes('Read `knowledge/graph/graph.json` directly'),
      'must instruct a direct file read instead of a simulated function call',
    ).toBe(true);
  });

  it('still instructs filtering nodes by type (knowledge_entry/skill) and label/ref match', () => {
    const text = load();
    expect(text.includes('knowledge_entry')).toBe(true);
    expect(text.includes('`label` or `ref` matches key terms')).toBe(true);
  });
});
