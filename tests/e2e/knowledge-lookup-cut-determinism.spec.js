// tests/e2e/knowledge-lookup-cut-determinism.spec.js
// TASK-113(b) — lookupKnowledge's top-3 SELECTION (the slice(0,3) cut, not
// just the returned order) tie-broke on `last_seen_at` — the very field the
// same kb_lookup call bumps on every returned hit (src/mcp-server.js). With
// more than 3 candidates tied on score, that made the CUT self-reinforcing:
// whichever entries won a prior lookup get their last_seen_at bumped, biasing
// them to win the next identically-scored lookup too, and the initial winner
// (before any bump has ever happened) depended on entry-authoring order —
// not on anything id-stable.
//
// Design judgment (recorded in the TASK-113 hand-off): deterministic cut
// (score desc, then id asc) was chosen over "recency-selection is intended"
// — there is no stated self-reinforcement rationale anywhere in the codebase
// or knowledge/README.md, and kb_lookup (src/mcp-server.js) ALREADY re-sorts
// its OWN final ordering by score desc/id asc for exactly this reproducibility
// reason (TASK-106). Matching that precedent for the underlying SELECTION
// closes the gap instead of leaving two different tie-break rules coexisting
// on the same data.
//
// This spec is RED against the pre-fix code: four fixture entries score an
// identical 6 on the query below (each carries the "widget" tag + a matching
// symptom + a matching problem-body token), so all four are candidates for a
// top-3 cut. last_seen_at is set so the id-ascending loser (`ddd-fourth`)
// is the MOST recently seen — under the old recency tie-break it wins the
// cut and evicts `aaa-first`. The desired, deterministic cut always keeps
// the three lowest ids regardless of recency.

import {
  describe, it, expect, afterAll,
} from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';

import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';
import { lookupKnowledge } from '../../src/knowledge.js';

afterAll(cleanupAll);

function writeEntry(dir, id, lastSeenAt) {
  const frontmatter = {
    id,
    problem: 'widget stuck in a retry loop under load',
    symptoms: ['widget retries endlessly'],
    solution: 'cap the retry count and back off',
    tags: ['widget', 'retry'],
    projects: ['test-fixture'],
    created_at: '2020-01-01T00:00:00Z',
    last_seen_at: lastSeenAt,
  };
  const rendered = matter.stringify('\n## Fixture entry\n', frontmatter);
  writeFileSync(join(dir, `${id}.md`), rendered, 'utf8');
}

describe('TASK-113(b) — lookupKnowledge top-3 cut is id-deterministic, independent of last_seen_at', () => {
  it('keeps the three lowest ids on a 4-way score tie, even when the excluded id is the most recently seen', async () => {
    const repoRoot = makeTmpDir('kb-cut-determinism');
    const entriesDir = join(repoRoot, 'knowledge', 'entries');
    mkdirSync(entriesDir, { recursive: true });

    // All four tie on score (identical tag/symptom/problem tokens). Recency
    // is arranged to CONTRADICT id order: ddd-fourth is newest, aaa-first is
    // oldest — the opposite of what a correct, recency-blind cut should pick.
    writeEntry(entriesDir, 'aaa-first', '2020-01-01T00:00:00Z'); // oldest
    writeEntry(entriesDir, 'bbb-second', '2020-01-02T00:00:00Z');
    writeEntry(entriesDir, 'ccc-third', '2020-01-03T00:00:00Z');
    writeEntry(entriesDir, 'ddd-fourth', '2020-01-04T00:00:00Z'); // newest

    const result = await lookupKnowledge({ repoRoot, question: 'widget stuck in a retry loop' });

    expect(result.kb_hits).toHaveLength(3);
    expect(result.kb_hits.map((h) => h.id)).toEqual(['aaa-first', 'bbb-second', 'ccc-third']);
  });

  it('orders the surviving top-3 by id ascending too (consistent single tie-break)', async () => {
    const repoRoot = makeTmpDir('kb-cut-determinism-order');
    const entriesDir = join(repoRoot, 'knowledge', 'entries');
    mkdirSync(entriesDir, { recursive: true });

    // Author + recency order both disagree with id order, so a pass-through
    // of directory-read order OR the old recency tie-break would both fail
    // this assertion (recency-desc would rank bbb-second, ccc-third,
    // aaa-first — none of which matches the required id-ascending order).
    writeEntry(entriesDir, 'ccc-third', '2020-01-02T00:00:00Z');
    writeEntry(entriesDir, 'aaa-first', '2020-01-01T00:00:00Z');
    writeEntry(entriesDir, 'bbb-second', '2020-01-03T00:00:00Z');

    const result = await lookupKnowledge({ repoRoot, question: 'widget stuck in a retry loop' });
    expect(result.kb_hits.map((h) => h.id)).toEqual(['aaa-first', 'bbb-second', 'ccc-third']);
  });
});
