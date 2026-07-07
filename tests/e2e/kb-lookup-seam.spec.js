// tests/e2e/kb-lookup-seam.spec.js
// TASK-106 — deep-review R18 (F31+F48): an executable, reproducible KB lookup
// seam for the researcher, and a live production caller for recordKbReuse.
//
// Before this ticket, recordKbReuse (src/knowledge.js) had ZERO production
// importers — it was only reachable via the demoted brain client — so
// last_seen_at (lookupKnowledge's tie-breaker) was frozen at authoring time
// forever. This spec proves that gap with a real invocation of the new seam
// (the `kb_lookup` MCP tool on the hivemind-tasks server), not a hand-wave:
// every test below fails TODAY because `kb_lookup` is not a registered tool
// (the seam does not exist yet) — `listTools()` omits it, and `callTool`
// either throws or returns `{ isError: true }` with a "Tool kb_lookup not
// found" message that is not valid JSON, so `parse()` throws too. Both are
// the same "right reason" failure surface TASK-082's close_task tests-first
// spec documented (tests/e2e/mcp-close-task.spec.js). Every test goes green
// once src/mcp-server.js registers `kb_lookup` (wrapping lookupKnowledge +
// recordKbReuse, per src/knowledge.js).
//
// Route: MCP tool, not a CLI + Bash grant (see the hand-off for the
// justification) — exercised through the same InMemoryTransport pattern as
// tests/e2e/mcp-server.spec.js / tests/e2e/mcp-close-task.spec.js.

import {
  describe, it, expect, beforeEach, afterEach,
} from 'vitest';
import {
  mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, cpSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import matter from 'gray-matter';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createServer } from '../../src/mcp-server.js';
import { lookupKnowledge } from '../../src/knowledge.js';
import { makeRepoSkeleton } from '../helpers/fixtures.js';
import { REPO_ROOT } from '../helpers/repoRoot.js';

function parse(result) {
  return JSON.parse(result.content[0].text);
}

/** Write a schema-shaped fixture entry (mirrors the real entries' frontmatter). */
function writeEntry(dir, id, {
  tags, symptoms, problem, solution, lastSeenAt,
}) {
  const frontmatter = {
    id,
    problem,
    symptoms,
    solution,
    tags,
    projects: ['test-fixture'],
    created_at: '2020-01-01T00:00:00Z',
    last_seen_at: lastSeenAt,
  };
  const rendered = matter.stringify('\n## Fixture entry\n', frontmatter);
  writeFileSync(join(dir, `${id}.md`), rendered, 'utf8');
}

describe('TASK-106 — kb_lookup seam: recordKbReuse gains a live production caller', () => {
  let repoRoot;
  let client;
  let server;
  let entriesDir;

  beforeEach(async () => {
    repoRoot = mkdtempSync(join(tmpdir(), 'kb-lookup-seam-'));
    makeRepoSkeleton(repoRoot);
    mkdirSync(join(repoRoot, 'knowledge'), { recursive: true });
    // Reuse the real, unchanged schema — this ticket does not touch it.
    cpSync(
      join(REPO_ROOT, 'knowledge', 'schema.json'),
      join(repoRoot, 'knowledge', 'schema.json'),
    );
    entriesDir = join(repoRoot, 'knowledge', 'entries');
    mkdirSync(entriesDir, { recursive: true });

    // Two fixture entries that TIE on score for the query "widget problem"
    // (both carry the "widget" tag/symptom/body token => score 6 each), but
    // differ in id AND in last_seen_at recency in a way that DELIBERATELY
    // CONTRADICTS the id order. This isolates the required id-based tie-break
    // (AC3/AC5) from lookupKnowledge's own recency tie-break: a naive
    // pass-through of lookupKnowledge's own hit order would rank
    // widget-timeout-fix first (it is more recent); the deterministic
    // score-desc/id-asc contract this ticket requires must rank
    // widget-retry-fix first regardless, because last_seen_at is exactly the
    // field this same call is about to mutate.
    writeEntry(entriesDir, 'widget-retry-fix', {
      tags: ['widget', 'retry'],
      symptoms: ['widget retries endlessly'],
      problem: 'widget stuck in a retry loop under load',
      solution: 'cap the retry count and back off',
      lastSeenAt: '2020-01-01T00:00:00Z', // older
    });
    writeEntry(entriesDir, 'widget-timeout-fix', {
      tags: ['widget', 'timeout'],
      symptoms: ['widget hangs waiting for a response'],
      problem: 'widget times out under load',
      solution: 'increase the timeout and add a circuit breaker',
      lastSeenAt: '2021-01-01T00:00:00Z', // more recent
    });

    server = createServer({ repoRoot });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'task-106-test', version: '0.0.0' });
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
  });

  afterEach(async () => {
    if (client) await client.close();
    if (repoRoot) rmSync(repoRoot, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // Baseline fact the ticket names: lookupKnowledge ALONE (the pre-ticket
  // production surface) never mutates last_seen_at. This is "today's frozen
  // last_seen_at" — and it stays true after the fix too, because the new seam
  // WRAPS lookupKnowledge (calls recordKbReuse alongside it); it does not
  // change lookupKnowledge itself.
  // ---------------------------------------------------------------------------
  it('lookupKnowledge_alone_never_mutates_last_seen_at_on_disk', async () => {
    const before = readFileSync(join(entriesDir, 'widget-retry-fix.md'), 'utf8');
    await lookupKnowledge({ repoRoot, question: 'widget problem' });
    const after = readFileSync(join(entriesDir, 'widget-retry-fix.md'), 'utf8');
    expect(after).toBe(before);
  });

  // ---------------------------------------------------------------------------
  // AC1 — the seam is registered and callable.
  // ---------------------------------------------------------------------------
  it('kb_lookup_tool_is_registered_on_the_server', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain('kb_lookup');
  });

  // ---------------------------------------------------------------------------
  // AC2 — recordKbReuse gains a live production caller: a lookup that returns
  // hits updates those entries' last_seen_at, with every OTHER frontmatter
  // field (and the body) byte-preserved.
  // ---------------------------------------------------------------------------
  it('kb_lookup_bumps_last_seen_at_for_every_returned_hit_and_preserves_other_fields', async () => {
    const beforeRetry = matter(readFileSync(join(entriesDir, 'widget-retry-fix.md'), 'utf8'));
    const beforeTimeout = matter(readFileSync(join(entriesDir, 'widget-timeout-fix.md'), 'utf8'));

    const result = parse(await client.callTool({
      name: 'kb_lookup',
      arguments: { question: 'widget problem' },
    }));

    expect(Array.isArray(result.kb_hits)).toBe(true);
    expect(result.kb_hits.map((h) => h.id).sort()).toEqual(
      ['widget-retry-fix', 'widget-timeout-fix'].sort(),
    );

    for (const [id, before] of [
      ['widget-retry-fix', beforeRetry],
      ['widget-timeout-fix', beforeTimeout],
    ]) {
      const after = matter(readFileSync(join(entriesDir, `${id}.md`), 'utf8'));
      expect(after.data.last_seen_at, `${id} last_seen_at must be bumped`)
        .not.toBe(before.data.last_seen_at);
      const { last_seen_at: _b, ...beforeRest } = before.data;
      const { last_seen_at: _a, ...afterRest } = after.data;
      expect(afterRest).toEqual(beforeRest);
      expect(after.content).toBe(before.content);
    }
  });

  // ---------------------------------------------------------------------------
  // AC5 — output includes scored hits with ids/paths so a Reviewer can
  // reproduce the exact lookup from the recorded invocation.
  // ---------------------------------------------------------------------------
  it('kb_lookup_output_includes_id_path_and_score_for_every_hit', async () => {
    const result = parse(await client.callTool({
      name: 'kb_lookup',
      arguments: { question: 'widget problem' },
    }));
    expect(result.kb_hits.length).toBeGreaterThan(0);
    for (const hit of result.kb_hits) {
      expect(typeof hit.id).toBe('string');
      expect(typeof hit.score).toBe('number');
      expect(typeof hit.path).toBe('string');
      expect(hit.path.endsWith(`${hit.id}.md`)).toBe(true);
    }
  });

  // ---------------------------------------------------------------------------
  // AC3/AC5 — deterministic ranking: score desc, then id asc — independent of
  // last_seen_at, which this very call is about to mutate.
  // ---------------------------------------------------------------------------
  it('kb_lookup_sorts_tied_scores_by_id_ascending_not_by_recency', async () => {
    const result = parse(await client.callTool({
      name: 'kb_lookup',
      arguments: { question: 'widget problem' },
    }));
    expect(result.kb_hits.length).toBe(2);
    expect(result.kb_hits[0].score).toBe(result.kb_hits[1].score); // confirms the tie
    expect(result.kb_hits.map((h) => h.id)).toEqual(['widget-retry-fix', 'widget-timeout-fix']);
  });

  // ---------------------------------------------------------------------------
  // AC5 — reproducibility: the same (query, KB state) yields the same scored
  // hits (ids/paths/scores) on repeat invocation.
  // ---------------------------------------------------------------------------
  it('kb_lookup_is_reproducible_for_the_same_query_and_kb_state', async () => {
    const first = parse(await client.callTool({
      name: 'kb_lookup',
      arguments: { question: 'widget problem' },
    }));
    const second = parse(await client.callTool({
      name: 'kb_lookup',
      arguments: { question: 'widget problem' },
    }));
    const shape = (r) => r.kb_hits.map((h) => ({ id: h.id, path: h.path, score: h.score }));
    expect(shape(second)).toEqual(shape(first));
  });
});
