// tests/e2e/kb-lookup-partial-reuse.spec.js
// TASK-113(c) — the kb_lookup tool's recordKbReuse bump loop
// (src/mcp-server.js) was non-atomic across hits: one throwing bump (e.g. a
// hit whose frontmatter `id` disagrees with its filename -> E_KB_NOT_FOUND,
// the exact scenario named in the ticket) left EARLIER hits bumped on disk
// but returned a bare `isError` with no statement of which bumps landed.
//
// Design judgment (recorded in the TASK-113 hand-off): PARTIAL-REPORT was
// chosen over all-or-nothing. Each recordKbReuse call is already its own
// atomic same-directory tmp+rename write (src/atomic-write.js); rolling back
// an already-committed bump on a LATER hit's failure would mean re-deriving
// and re-writing the prior entry's exact original bytes, adding a second
// failure surface (the rollback write itself) to undo a write that was never
// unsafe in the first place. Reporting the true partial state honestly is
// simpler and strictly more informative to the caller than a rollback.
//
// This spec is RED against the pre-fix code: the second hit's bump throws
// E_KB_NOT_FOUND, which propagates out of the tool handler uncaught, so the
// MCP SDK converts it into `{ isError: true, content: [{ text: <message> }] }`
// — a bare error, and the first hit's bump (widget-good) is silently already
// durable on disk with no way for the caller to know that from the response.

import {
  describe, it, expect, beforeEach, afterEach,
} from 'vitest';
import {
  mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import matter from 'gray-matter';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createServer } from '../../src/mcp-server.js';
import { makeRepoSkeleton } from '../helpers/fixtures.js';

function writeEntry(dir, filename, {
  id, tags, symptoms, problem, solution, lastSeenAt,
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
  writeFileSync(join(dir, `${filename}.md`), rendered, 'utf8');
}

describe('TASK-113(c) — kb_lookup reports partial recordKbReuse outcomes instead of a bare isError', () => {
  let repoRoot;
  let client;
  let server;
  let entriesDir;

  beforeEach(async () => {
    repoRoot = mkdtempSync(join(tmpdir(), 'kb-partial-reuse-'));
    makeRepoSkeleton(repoRoot);
    entriesDir = join(repoRoot, 'knowledge', 'entries');
    mkdirSync(entriesDir, { recursive: true });

    // Two entries tie on score for the query below. widget-good's frontmatter
    // id matches its filename (a normal entry). The second file's frontmatter
    // id ("widget-mismatched-id") does NOT match its filename
    // ("widget-orphan-file.md") — lookupKnowledge resolves the hit id from
    // frontmatter, so recordKbReuse('widget-mismatched-id') looks for
    // entries/widget-mismatched-id.md, which does not exist -> E_KB_NOT_FOUND.
    // "widget-good" < "widget-mismatched-id" alphabetically, so it is bumped
    // FIRST, before the throwing second hit.
    writeEntry(entriesDir, 'widget-good', {
      id: 'widget-good',
      tags: ['widget'],
      symptoms: ['widget breaks under load'],
      problem: 'widget problem statement needing a fix',
      solution: 'apply the widget fix',
      lastSeenAt: '2020-01-01T00:00:00Z',
    });
    writeEntry(entriesDir, 'widget-orphan-file', {
      id: 'widget-mismatched-id',
      tags: ['widget'],
      symptoms: ['widget breaks under load'],
      problem: 'widget problem statement needing a fix',
      solution: 'apply the widget fix',
      lastSeenAt: '2020-01-01T00:00:00Z',
    });

    server = createServer({ repoRoot });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'task-113c-test', version: '0.0.0' });
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
  });

  afterEach(async () => {
    if (client) await client.close();
    if (repoRoot) rmSync(repoRoot, { recursive: true, force: true });
  });

  it('does not abort the whole call, and states which hit bumped and which failed', async () => {
    const beforeGood = matter(readFileSync(join(entriesDir, 'widget-good.md'), 'utf8'));

    const result = await client.callTool({
      name: 'kb_lookup',
      arguments: { question: 'widget problem statement needing a fix' },
    });

    expect(result.isError, 'a single throwing bump must not error out the whole tool call').toBeFalsy();
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.kb_hits.map((h) => h.id).sort()).toEqual(
      ['widget-good', 'widget-mismatched-id'].sort(),
    );
    expect(parsed.reuse.bumped).toEqual(['widget-good']);
    expect(parsed.reuse.failed).toHaveLength(1);
    expect(parsed.reuse.failed[0].id).toBe('widget-mismatched-id');
    expect(parsed.reuse.failed[0].error).toMatch(/E_KB_NOT_FOUND|not found/i);

    // The successful bump landed durably even though the other hit failed.
    const afterGood = matter(readFileSync(join(entriesDir, 'widget-good.md'), 'utf8'));
    expect(afterGood.data.last_seen_at).not.toBe(beforeGood.data.last_seen_at);
  });
});
