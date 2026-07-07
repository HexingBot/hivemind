// tests/e2e/knowledge-entry-write.spec.js
// TASK-105 AC1 — src/knowledge.js gains a schema-validated, atomic entry-write
// helper (the KB write path), mirroring the store's validate-before-write
// pattern (task-store.js / knowledge-graph.js): validate against
// knowledge/schema.json BEFORE any disk mutation, then write atomically via
// atomicWriteFile.
// TASK-105 AC3 — drafts land in a designated unvetted location
// (knowledge/proposed/, chosen over a vetted:false frontmatter flag — see
// knowledge/schema.md for the recorded rationale) and lookupKnowledge
// EXCLUDES them entirely (directory boundary, not a scoring down-weight).
//
// Real disk I/O via mkdtemp (mirrors tests/e2e/knowledge-lookup.spec.js), so
// this lives in the slow/e2e tier per the fast/e2e directory split.
//
// TESTS-FIRST FAILURE SURFACE:
//   src/knowledge.js does not export writeKnowledgeEntry or listDraftEntries
//   yet -> importing them resolves to undefined (same interop as
//   tests/e2e/knowledge-graph-canonical-ids.spec.js's UnknownNodeIdError case)
//   -> calling undefined as a function throws "is not a function", a red
//   failure for the right reason (missing implementation, not a typo).

import { describe, it, expect, afterAll } from 'vitest';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';

import { REPO_ROOT } from '../helpers/repoRoot.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';
import {
  writeKnowledgeEntry, listDraftEntries, lookupKnowledge,
} from '../../src/knowledge.js';

afterAll(cleanupAll);

function seedSchema(repoRoot) {
  mkdirSync(join(repoRoot, 'knowledge'), { recursive: true });
  const schema = readFileSync(join(REPO_ROOT, 'knowledge', 'schema.json'), 'utf8');
  writeFileSync(join(repoRoot, 'knowledge', 'schema.json'), schema, 'utf8');
}

function validEntry(id) {
  return {
    id,
    problem: 'A recurring problem statement that is at least ten characters long.',
    symptoms: ['some observable symptom'],
    solution: 'Do the fix, which is at least ten characters long.',
    tags: ['some-tag'],
    projects: ['hivemind'],
    created_at: '2026-07-06T00:00:00Z',
    last_seen_at: '2026-07-06T00:00:00Z',
    body: 'Body text describing the lesson in generic terms.',
  };
}

describe('TASK-105 AC1 — writeKnowledgeEntry: schema-validated, atomic write path', () => {
  it('writes a valid draft entry under knowledge/proposed/ by default', async () => {
    const repoRoot = makeTmpDir('ke-write-draft');
    seedSchema(repoRoot);

    const entry = validEntry('a-new-lesson');
    const result = await writeKnowledgeEntry({ repoRoot, entry });

    expect(result.draft).toBe(true);
    const targetPath = join(repoRoot, 'knowledge', 'proposed', 'a-new-lesson.md');
    expect(existsSync(targetPath), 'draft must land under knowledge/proposed/').toBe(true);
    expect(existsSync(join(repoRoot, 'knowledge', 'entries', 'a-new-lesson.md')),
      'draft must NOT also land under knowledge/entries/').toBe(false);

    const raw = readFileSync(targetPath, 'utf8');
    const parsed = matter(raw);
    expect(parsed.data.id).toBe('a-new-lesson');
    expect(parsed.data.problem).toBe(entry.problem);
    expect(parsed.content.trim()).toBe(entry.body);
  });

  it('writes a vetted (non-draft) entry under knowledge/entries/ when draft: false', async () => {
    const repoRoot = makeTmpDir('ke-write-vetted');
    seedSchema(repoRoot);

    const entry = validEntry('a-vetted-lesson');
    await writeKnowledgeEntry({ repoRoot, entry, draft: false });

    const targetPath = join(repoRoot, 'knowledge', 'entries', 'a-vetted-lesson.md');
    expect(existsSync(targetPath), 'vetted write must land under knowledge/entries/').toBe(true);
    expect(existsSync(join(repoRoot, 'knowledge', 'proposed', 'a-vetted-lesson.md')),
      'vetted write must NOT also land under knowledge/proposed/').toBe(false);
  });

  it('self-bootstraps knowledge/proposed/ when it does not yet exist', async () => {
    const repoRoot = makeTmpDir('ke-write-bootstrap');
    seedSchema(repoRoot);
    expect(existsSync(join(repoRoot, 'knowledge', 'proposed'))).toBe(false);

    await writeKnowledgeEntry({ repoRoot, entry: validEntry('bootstraps-fine') });

    expect(existsSync(join(repoRoot, 'knowledge', 'proposed', 'bootstraps-fine.md'))).toBe(true);
  });

  it('rejects a schema-invalid entry BEFORE writing anything to disk', async () => {
    const repoRoot = makeTmpDir('ke-write-invalid');
    seedSchema(repoRoot);

    const bad = validEntry('missing-problem-field');
    delete bad.problem; // required by knowledge/schema.json

    await expect(writeKnowledgeEntry({ repoRoot, entry: bad })).rejects.toThrow();
    expect(existsSync(join(repoRoot, 'knowledge', 'proposed', 'missing-problem-field.md')),
      'an invalid entry must never reach disk').toBe(false);
    expect(existsSync(join(repoRoot, 'knowledge', 'proposed')),
      'validation failure must not even create the directory').toBe(false);
  });

  it('rejects an entry whose id does not match the kebab-slug pattern', async () => {
    const repoRoot = makeTmpDir('ke-write-bad-id');
    seedSchema(repoRoot);

    const bad = validEntry('Not_A_Valid_Slug');
    await expect(writeKnowledgeEntry({ repoRoot, entry: bad })).rejects.toThrow();
  });
});

describe('TASK-105 AC1 — listDraftEntries', () => {
  it('lists ids of every draft under knowledge/proposed/', async () => {
    const repoRoot = makeTmpDir('ke-list-drafts');
    seedSchema(repoRoot);
    await writeKnowledgeEntry({ repoRoot, entry: validEntry('draft-one') });
    await writeKnowledgeEntry({ repoRoot, entry: validEntry('draft-two') });

    const drafts = listDraftEntries({ repoRoot });
    expect(drafts.map((d) => d.id).sort()).toEqual(['draft-one', 'draft-two']);
  });

  it('returns an empty array when knowledge/proposed/ does not exist', () => {
    const repoRoot = makeTmpDir('ke-list-drafts-empty');
    seedSchema(repoRoot);
    expect(listDraftEntries({ repoRoot })).toEqual([]);
  });
});

describe('TASK-105 AC3 — lookupKnowledge excludes knowledge/proposed/ drafts', () => {
  it('a draft entry never surfaces as a kb_hit, even when it would score highly', async () => {
    const repoRoot = makeTmpDir('ke-lookup-excludes-drafts');
    seedSchema(repoRoot);

    const entry = validEntry('windows-rename-draft-lesson');
    entry.tags = ['windows', 'atomic-rename', 'filesystem'];
    entry.symptoms = ['EBUSY on rename'];
    await writeKnowledgeEntry({ repoRoot, entry });

    const result = await lookupKnowledge({
      repoRoot,
      question: 'how do I do an atomic rename safely on windows filesystem?',
    });
    expect(result.kb_hits.map((h) => h.id)).not.toContain('windows-rename-draft-lesson');
    expect(result.kb_hits).toEqual([]);
  });

  it('the same entry DOES surface once promoted (re-written with draft: false)', async () => {
    const repoRoot = makeTmpDir('ke-lookup-promoted');
    seedSchema(repoRoot);

    const entry = validEntry('windows-rename-promoted-lesson');
    entry.tags = ['windows', 'atomic-rename', 'filesystem'];
    entry.symptoms = ['EBUSY on rename'];
    await writeKnowledgeEntry({ repoRoot, entry, draft: false });

    const result = await lookupKnowledge({
      repoRoot,
      question: 'how do I do an atomic rename safely on windows filesystem?',
    });
    expect(result.kb_hits.map((h) => h.id)).toContain('windows-rename-promoted-lesson');
  });
});
