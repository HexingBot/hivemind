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
// TASK-111 AC1/AC2/AC5 (review MEDIUM-1/MEDIUM-2/LOW follow-ups on TASK-105):
//   AC1 — writeKnowledgeEntry gains an E_KB_EXISTS overwrite guard (default
//   reject on a repeated target id; explicit { overwrite: true } opt-in).
//   AC2 — promoteDraftEntry({ repoRoot, id }) is a new one-call helper:
//   validate + write-to-entries + unlink-proposed, write-then-unlink ordered
//   so a crash leaves at worst a duplicate, never a loss.
//   AC5 — the id pattern now rejects Windows reserved device names
//   (nul/con/prn/aux/com1/lpt1) at the schema level.
//
// TESTS-FIRST FAILURE SURFACE:
//   src/knowledge.js does not export writeKnowledgeEntry or listDraftEntries
//   yet -> importing them resolves to undefined (same interop as
//   tests/e2e/knowledge-graph-canonical-ids.spec.js's UnknownNodeIdError case)
//   -> calling undefined as a function throws "is not a function", a red
//   failure for the right reason (missing implementation, not a typo).
//   TASK-111: writeKnowledgeEntry has no existence check yet -> the
//   E_KB_EXISTS specs fail because the second write silently succeeds
//   (assertion on the rejected promise fails, and the "preserved" assertion
//   fails because the file WAS overwritten). promoteDraftEntry does not
//   exist yet -> importing it resolves to undefined, same "not a function"
//   red failure. The reserved-device-name ids currently pass schema
//   validation (the pattern doesn't exclude them yet) -> those specs fail
//   because writeKnowledgeEntry does NOT reject/throw.

import { describe, it, expect, afterAll } from 'vitest';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';

import { REPO_ROOT } from '../helpers/repoRoot.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';
import {
  writeKnowledgeEntry, listDraftEntries, lookupKnowledge, promoteDraftEntry,
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

describe('TASK-111 AC1 — writeKnowledgeEntry: E_KB_EXISTS overwrite guard', () => {
  // MEDIUM-1 (TASK-105 review): writeKnowledgeEntry had no existence check —
  // a repeated draft id silently clobbered an unpromoted draft, and
  // draft:false silently clobbered an existing VETTED entry. AC1 names three
  // scenarios (draft-over-draft, vetted-over-vetted, draft:false-over-vetted);
  // the latter two collide on the exact same code path (a second draft:false
  // write against an already-vetted target id), so they are proven by ONE
  // test below (`rejects_a_repeated_vetted_id...`) rather than two redundant
  // specs — see CLAUDE.md's new-test-budget rule against duplicative specs.
  it('rejects_a_repeated_draft_id_draft_over_draft_with_E_KB_EXISTS_preserving_the_original', async () => {
    const repoRoot = makeTmpDir('ke-exists-draft-over-draft');
    seedSchema(repoRoot);

    const original = validEntry('dup-draft-lesson');
    await writeKnowledgeEntry({ repoRoot, entry: original });
    const targetPath = join(repoRoot, 'knowledge', 'proposed', 'dup-draft-lesson.md');
    const before = readFileSync(targetPath, 'utf8');

    const second = validEntry('dup-draft-lesson');
    second.solution = 'A completely different solution text, at least ten chars.';
    await expect(writeKnowledgeEntry({ repoRoot, entry: second })).rejects.toMatchObject({
      code: 'E_KB_EXISTS',
    });

    expect(readFileSync(targetPath, 'utf8'), 'the original draft must be untouched').toBe(before);
  });

  it('rejects_a_repeated_vetted_id_vetted_over_vetted_and_draft_false_over_vetted_with_E_KB_EXISTS_preserving_the_original', async () => {
    const repoRoot = makeTmpDir('ke-exists-vetted-over-vetted');
    seedSchema(repoRoot);

    const original = validEntry('dup-vetted-lesson');
    await writeKnowledgeEntry({ repoRoot, entry: original, draft: false });
    const targetPath = join(repoRoot, 'knowledge', 'entries', 'dup-vetted-lesson.md');
    const before = readFileSync(targetPath, 'utf8');

    const second = validEntry('dup-vetted-lesson');
    second.solution = 'Yet another different solution text, ten-plus chars.';
    await expect(
      writeKnowledgeEntry({ repoRoot, entry: second, draft: false }),
    ).rejects.toMatchObject({ code: 'E_KB_EXISTS' });

    expect(readFileSync(targetPath, 'utf8'), 'the vetted entry must be untouched').toBe(before);
  });

  it('accepts_an_explicit_overwrite_true_opt_in_for_a_repeated_draft_id', async () => {
    const repoRoot = makeTmpDir('ke-exists-overwrite-draft');
    seedSchema(repoRoot);

    await writeKnowledgeEntry({ repoRoot, entry: validEntry('overwrite-draft-lesson') });
    const updated = validEntry('overwrite-draft-lesson');
    updated.solution = 'The overwritten solution text, definitely ten-plus chars.';
    await writeKnowledgeEntry({ repoRoot, entry: updated, overwrite: true });

    const targetPath = join(repoRoot, 'knowledge', 'proposed', 'overwrite-draft-lesson.md');
    const parsed = matter(readFileSync(targetPath, 'utf8'));
    expect(parsed.data.solution).toBe(updated.solution);
  });

  it('accepts_an_explicit_overwrite_true_opt_in_for_a_repeated_vetted_id', async () => {
    const repoRoot = makeTmpDir('ke-exists-overwrite-vetted');
    seedSchema(repoRoot);

    await writeKnowledgeEntry({ repoRoot, entry: validEntry('overwrite-vetted-lesson'), draft: false });
    const updated = validEntry('overwrite-vetted-lesson');
    updated.solution = 'A second overwritten solution text, ten-plus chars.';
    await writeKnowledgeEntry({
      repoRoot, entry: updated, draft: false, overwrite: true,
    });

    const targetPath = join(repoRoot, 'knowledge', 'entries', 'overwrite-vetted-lesson.md');
    const parsed = matter(readFileSync(targetPath, 'utf8'));
    expect(parsed.data.solution).toBe(updated.solution);
  });
});

describe('TASK-111 AC5 — Windows reserved device names rejected by id validation', () => {
  it.each(['nul', 'con', 'prn', 'aux', 'com1', 'lpt1'])(
    'rejects reserved device name "%s" as an entry id',
    async (reserved) => {
      const repoRoot = makeTmpDir(`ke-reserved-${reserved}`);
      seedSchema(repoRoot);

      await expect(
        writeKnowledgeEntry({ repoRoot, entry: validEntry(reserved) }),
      ).rejects.toThrow();
      expect(existsSync(join(repoRoot, 'knowledge', 'proposed', `${reserved}.md`))).toBe(false);
    },
  );

  it('accepts an id that merely CONTAINS a reserved word as a substring', async () => {
    const repoRoot = makeTmpDir('ke-reserved-substring-ok');
    seedSchema(repoRoot);

    const entry = validEntry('consolidate-fix');
    const result = await writeKnowledgeEntry({ repoRoot, entry });
    expect(result.id).toBe('consolidate-fix');
  });
});

describe('TASK-111 AC2 — promoteDraftEntry: validate + write-to-entries + unlink-proposed as one helper', () => {
  it('promotes_a_draft_to_entries_and_removes_the_proposed_copy', async () => {
    const repoRoot = makeTmpDir('ke-promote-happy');
    seedSchema(repoRoot);

    await writeKnowledgeEntry({ repoRoot, entry: validEntry('promote-me') });
    const draftPath = join(repoRoot, 'knowledge', 'proposed', 'promote-me.md');
    expect(existsSync(draftPath)).toBe(true);

    const result = await promoteDraftEntry({ repoRoot, id: 'promote-me' });

    const entriesPath = join(repoRoot, 'knowledge', 'entries', 'promote-me.md');
    expect(result.path).toBe(entriesPath);
    expect(existsSync(entriesPath), 'promoted entry must land in knowledge/entries/').toBe(true);
    expect(existsSync(draftPath), 'the knowledge/proposed/ copy must be removed').toBe(false);
  });

  it('throws E_KB_DRAFT_NOT_FOUND for a missing draft and writes nothing', async () => {
    const repoRoot = makeTmpDir('ke-promote-missing-draft');
    seedSchema(repoRoot);

    await expect(
      promoteDraftEntry({ repoRoot, id: 'never-drafted' }),
    ).rejects.toMatchObject({ code: 'E_KB_DRAFT_NOT_FOUND' });
    expect(existsSync(join(repoRoot, 'knowledge', 'entries', 'never-drafted.md'))).toBe(false);
  });

  it('throws E_KB_EXISTS on an already-vetted-collision and does NOT delete the draft (write-then-unlink ordering)', async () => {
    const repoRoot = makeTmpDir('ke-promote-vetted-collision');
    seedSchema(repoRoot);

    // A vetted entry with the same id already exists (e.g. promoted earlier
    // by a different path), AND an unpromoted draft with the same id exists.
    await writeKnowledgeEntry({ repoRoot, entry: validEntry('already-vetted'), draft: false });
    await writeKnowledgeEntry({ repoRoot, entry: validEntry('already-vetted') });
    const draftPath = join(repoRoot, 'knowledge', 'proposed', 'already-vetted.md');
    expect(existsSync(draftPath)).toBe(true);

    await expect(
      promoteDraftEntry({ repoRoot, id: 'already-vetted' }),
    ).rejects.toMatchObject({ code: 'E_KB_EXISTS' });

    // Write-then-unlink ordering: the write failed, so unlink never ran — the
    // draft is preserved (at worst a caller retries; a crash here never LOSES
    // the draft, only ever leaves a harmless duplicate scenario).
    expect(existsSync(draftPath), 'the draft must survive a failed promotion').toBe(true);
  });
});

describe('TASK-113(d) — promoteDraftEntry rejects a frontmatter-id/arg-id mismatch before any write', () => {
  // Pre-fix, a hand-edited draft whose frontmatter `id` disagrees with the
  // `id` argument silently promotes under the FRONTMATTER id (writes
  // entries/<frontmatter-id>.md, unlinks proposed/<arg-id>.md) and returns an
  // internally inconsistent `{ id: <arg-id>, path: <frontmatter-id path> }` —
  // this spec is RED against that: it expects a typed rejection BEFORE any
  // write, so it fails today because the call instead succeeds.
  it('rejects_a_hand_edited_mismatched_draft_with_a_typed_error_and_writes_nothing', async () => {
    const repoRoot = makeTmpDir('ke-promote-id-mismatch');
    seedSchema(repoRoot);

    await writeKnowledgeEntry({ repoRoot, entry: validEntry('draft-arg-id') });
    const draftPath = join(repoRoot, 'knowledge', 'proposed', 'draft-arg-id.md');

    // Hand-edit the draft's frontmatter id so it disagrees with the filename
    // (and with the `id` argument promoteDraftEntry will be called with).
    const raw = readFileSync(draftPath, 'utf8');
    const mismatched = raw.replace('id: draft-arg-id', 'id: draft-frontmatter-id');
    writeFileSync(draftPath, mismatched, 'utf8');

    await expect(
      promoteDraftEntry({ repoRoot, id: 'draft-arg-id' }),
    ).rejects.toMatchObject({ code: 'E_KB_DRAFT_ID_MISMATCH' });

    // No write landed under knowledge/entries/ under EITHER id, and the
    // draft copy is untouched.
    expect(existsSync(join(repoRoot, 'knowledge', 'entries', 'draft-arg-id.md'))).toBe(false);
    expect(existsSync(join(repoRoot, 'knowledge', 'entries', 'draft-frontmatter-id.md'))).toBe(false);
    expect(existsSync(draftPath), 'the mismatched draft must survive a rejected promotion').toBe(true);
  });
});

describe('TASK-113(e) — promoteDraftEntry: an unlink failure after a landed write reports "already landed"', () => {
  // Pre-fix, an unlink that throws AFTER writeKnowledgeEntry already landed
  // durably (the AV-handle class documented in the
  // windows-atomic-rename-not-truly-atomic KB entry) rejects with the RAW
  // unlink error, giving no indication the promotion actually succeeded — a
  // caller who retries then hits E_KB_EXISTS with no context. RED against
  // that: expects a typed error whose message states the promotion landed
  // and names the leftover proposed copy.
  it('states_the_promotion_landed_and_names_the_leftover_proposed_copy_when_unlink_throws', async () => {
    const repoRoot = makeTmpDir('ke-promote-unlink-fails');
    seedSchema(repoRoot);

    await writeKnowledgeEntry({ repoRoot, entry: validEntry('unlink-fails') });
    const draftPath = join(repoRoot, 'knowledge', 'proposed', 'unlink-fails.md');
    const entriesPath = join(repoRoot, 'knowledge', 'entries', 'unlink-fails.md');

    const throwingUnlink = () => {
      const err = new Error('EBUSY: resource busy or locked, unlink');
      err.code = 'EBUSY';
      throw err;
    };

    let firstError = null;
    try {
      await promoteDraftEntry({ repoRoot, id: 'unlink-fails', unlink: throwingUnlink });
    } catch (err) {
      firstError = err;
    }
    expect(firstError, 'promoteDraftEntry must reject when unlink throws').not.toBeNull();
    expect(firstError.code).toBe('E_KB_PROMOTE_UNLINK_FAILED');
    expect(firstError.message).toMatch(/already/i);
    expect(firstError.message).toContain(draftPath);

    // The write landed durably despite the rejection — that's the whole
    // point of the improved error: it must be truthful about this.
    expect(existsSync(entriesPath), 'the entry must have landed durably in knowledge/entries/').toBe(true);
    expect(existsSync(draftPath), 'the leftover proposed copy must still be named accurately').toBe(true);

    // A retry now correctly surfaces E_KB_EXISTS (from writeKnowledgeEntry) —
    // not a repeat of the unlink error — because the promotion already
    // landed; this is the documented "delete manually, or retry" contract.
    await expect(
      promoteDraftEntry({ repoRoot, id: 'unlink-fails', unlink: throwingUnlink }),
    ).rejects.toMatchObject({ code: 'E_KB_EXISTS' });
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
