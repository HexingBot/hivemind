// tests/framework-history.spec.js
// TASK-015 — archiveFrameworkHistory({repoRoot, now}) lives in
// src/framework-history.js (developer's pick: a dedicated module — archive is
// read+move, seeder is generate+write, different verbs / different fail
// modes, so the cohesion call falls to a fresh file).
//
// Contract:
//   - Returns {archived: <string[]>} listing the moved ticket keys.
//   - When no framework history is detected — empty tasks/ OR ANY existing
//     ticket carries the `seed` label — returns {archived: []} and does NOT
//     touch the filesystem.
//   - When framework history is detected — at least one TASK-NNN.json AND
//     none of them carry `seed` — moves every TASK-NNN.json from
//     <repoRoot>/tasks/ to <repoRoot>/.framework-history/tasks/ (mkdir -p
//     the destination if absent), then regenerates tasks/index.json to an
//     empty store.
//   - The function does NOT prompt; the caller (bin/init.js) owns the
//     interactive Y/n question and decides whether to invoke this at all.
//
// Covers ACs 2, 3, 4 (module shape + behavior) and 7a-7c (unit cases).

import { describe, it, expect, afterAll } from 'vitest';
import {
  existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync,
} from 'node:fs';
import { join } from 'node:path';

import { PROD, makeRepoSkeleton } from '../helpers/fixtures.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';

afterAll(cleanupAll);

const FIXED_NOW = '2026-05-27T12:00:00Z';

/**
 * Build a synthetic framework-history ticket payload. Mirrors the shape
 * tasks/schema.json enforces (close enough for the archive's purposes —
 * archive moves bytes, it does not re-validate). `labels` defaults to an
 * empty array so the helper produces "framework history" tickets by default;
 * pass `labels: ['seed']` to simulate a fresh-seeded ticket.
 */
function syntheticTicket(key, overrides = {}) {
  return {
    key,
    title: `Synthetic ${key}`,
    description: 'placed by the framework-history spec fixture',
    acceptance_criteria: ['Some criterion'],
    status: 'todo',
    priority: 'medium',
    labels: [],
    assignee: null,
    depends_on: [],
    linked_commits: [],
    linked_prs: [],
    comments: [],
    created_at: '2026-05-27T00:00:00Z',
    updated_at: '2026-05-27T00:00:00Z',
    jira_key: null,
    ...overrides,
  };
}

function listTaskFiles(repoRoot) {
  const dir = join(repoRoot, 'tasks');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => /^TASK-\d{3,}\.json$/.test(n)).sort();
}

function listArchiveTaskFiles(repoRoot) {
  const dir = join(repoRoot, '.framework-history', 'tasks');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => /^TASK-\d{3,}\.json$/.test(n)).sort();
}

// ===========================================================================
// AC4 + AC7a — framework history present → tickets moved + keys returned.
// ===========================================================================
describe('AC4/AC7a — archive when framework history is present', () => {
  it('moves_framework_tickets_to_archive_and_returns_keys', async () => {
    const { archiveFrameworkHistory } = await import(PROD.frameworkHistory);

    const repoDir = makeTmpDir('af-fh-present');
    makeRepoSkeleton(repoDir, {
      tasks: {
        'TASK-001': syntheticTicket('TASK-001'),
        'TASK-002': syntheticTicket('TASK-002', { labels: ['feature'] }),
        'TASK-003': syntheticTicket('TASK-003', { labels: ['docs'] }),
      },
    });

    const result = await archiveFrameworkHistory({
      repoRoot: repoDir,
      now: () => FIXED_NOW,
    });

    expect(result).toBeTruthy();
    expect(typeof result).toBe('object');
    expect(Array.isArray(result.archived)).toBe(true);
    // Returned keys: every moved ticket's `key` field, sorted irrelevant.
    expect([...result.archived].sort()).toEqual(['TASK-001', 'TASK-002', 'TASK-003']);

    // tasks/ no longer contains any TASK-NNN.json files.
    expect(listTaskFiles(repoDir)).toEqual([]);

    // .framework-history/tasks/ now holds every moved file.
    expect(listArchiveTaskFiles(repoDir)).toEqual([
      'TASK-001.json',
      'TASK-002.json',
      'TASK-003.json',
    ]);

    // index.json was regenerated to an empty store.
    const idxPath = join(repoDir, 'tasks', 'index.json');
    expect(existsSync(idxPath)).toBe(true);
    const idx = JSON.parse(readFileSync(idxPath, 'utf8'));
    expect(Array.isArray(idx.tasks)).toBe(true);
    expect(idx.tasks).toEqual([]);
    expect(typeof idx.generated_at).toBe('string');

    // A moved ticket file's bytes survive the move (we don't reformat).
    const moved = JSON.parse(
      readFileSync(join(repoDir, '.framework-history', 'tasks', 'TASK-001.json'), 'utf8'),
    );
    expect(moved.key).toBe('TASK-001');
  });
});

// ===========================================================================
// AC4 + AC7b — any seed-labeled ticket short-circuits: returns empty,
// leaves tasks/ untouched.
// ===========================================================================
describe('AC4/AC7b — short-circuits when a seed-labeled ticket exists', () => {
  it('returns_empty_and_does_not_move_when_any_seed_label_present', async () => {
    const { archiveFrameworkHistory } = await import(PROD.frameworkHistory);

    const repoDir = makeTmpDir('af-fh-seed-present');
    makeRepoSkeleton(repoDir, {
      tasks: {
        'TASK-001': syntheticTicket('TASK-001'),
        // Even ONE seed-labeled ticket means this project is already past the
        // framework-history phase — archive must be a no-op.
        'TASK-002': syntheticTicket('TASK-002', { labels: ['seed'] }),
        'TASK-003': syntheticTicket('TASK-003'),
      },
    });

    const beforeFiles = listTaskFiles(repoDir);
    const result = await archiveFrameworkHistory({
      repoRoot: repoDir,
      now: () => FIXED_NOW,
    });

    expect(result.archived).toEqual([]);
    // tasks/ untouched.
    expect(listTaskFiles(repoDir)).toEqual(beforeFiles);
    // No archive directory created.
    expect(existsSync(join(repoDir, '.framework-history'))).toBe(false);
  });
});

// ===========================================================================
// AC4 + AC7c — empty tasks/ → empty archive, no-op.
// ===========================================================================
describe('AC4/AC7c — no-op when tasks/ is empty', () => {
  it('returns_empty_when_no_task_files_present', async () => {
    const { archiveFrameworkHistory } = await import(PROD.frameworkHistory);

    const repoDir = makeTmpDir('af-fh-empty');
    makeRepoSkeleton(repoDir); // tasks/ exists but has no TASK-NNN files.

    const result = await archiveFrameworkHistory({
      repoRoot: repoDir,
      now: () => FIXED_NOW,
    });

    expect(result.archived).toEqual([]);
    // No archive directory created.
    expect(existsSync(join(repoDir, '.framework-history'))).toBe(false);
  });

  it('returns_empty_when_tasks_directory_is_absent', async () => {
    const { archiveFrameworkHistory } = await import(PROD.frameworkHistory);

    const repoDir = makeTmpDir('af-fh-no-dir');
    // Do NOT create tasks/ at all.
    mkdirSync(repoDir, { recursive: true });

    const result = await archiveFrameworkHistory({
      repoRoot: repoDir,
      now: () => FIXED_NOW,
    });

    expect(result.archived).toEqual([]);
    expect(existsSync(join(repoDir, '.framework-history'))).toBe(false);
  });
});

// ===========================================================================
// AC4 — non-TASK files in tasks/ are NOT moved (schema.json / index.json /
// stray README.md must stay put — they are not framework history).
// ===========================================================================
describe('AC4 — non-task files survive the archive', () => {
  it('schema_and_index_and_readme_are_not_moved', async () => {
    const { archiveFrameworkHistory } = await import(PROD.frameworkHistory);

    const repoDir = makeTmpDir('af-fh-non-task-survival');
    makeRepoSkeleton(repoDir, {
      tasks: {
        'TASK-001': syntheticTicket('TASK-001'),
      },
    });
    // Drop distractors in tasks/.
    writeFileSync(
      join(repoDir, 'tasks', 'schema.json'),
      JSON.stringify({ $id: 'placeholder' }, null, 2),
      'utf8',
    );
    writeFileSync(
      join(repoDir, 'tasks', 'README.md'),
      '# tasks\n',
      'utf8',
    );

    const result = await archiveFrameworkHistory({
      repoRoot: repoDir,
      now: () => FIXED_NOW,
    });

    expect(result.archived).toEqual(['TASK-001']);

    // schema.json and README.md remain in tasks/.
    expect(existsSync(join(repoDir, 'tasks', 'schema.json'))).toBe(true);
    expect(existsSync(join(repoDir, 'tasks', 'README.md'))).toBe(true);

    // The archive only got the TASK file.
    expect(listArchiveTaskFiles(repoDir)).toEqual(['TASK-001.json']);
    expect(existsSync(join(repoDir, '.framework-history', 'tasks', 'schema.json'))).toBe(false);
    expect(existsSync(join(repoDir, '.framework-history', 'tasks', 'README.md'))).toBe(false);
  });
});
