// tests/project-md.spec.js
// TASK-011 — src/project-md.js exposes writeProjectMd({repoRoot, answers, now})
// and readProjectMd({repoRoot}). PROJECT.md lives at <repoRoot>/PROJECT.md and
// uses a minimal-YAML frontmatter + markdown body. Round-trip lossless.
//
// Covers ACs 4, 5, 6.

import { describe, it, expect, vi, afterAll, afterEach } from 'vitest';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { PROD } from '../helpers/fixtures.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';

afterAll(cleanupAll);

const FIXED_NOW = '2026-05-26T12:00:00Z';

// =====================================================================
// AC4 — write/read round-trip preserves string answers.
// =====================================================================
describe('project-md — round-trip', () => {
  it('round_trip_preserves_string_answers', async () => {
    const { writeProjectMd, readProjectMd } = await import(PROD.projectMd);

    const repoDir = makeTmpDir('af-pmd-strings');
    const answers = {
      project_name: 'demo-app',
      project_description: 'A simple demo of the intake wizard.',
      project_type: 'web-saas',
      target_users: 'developers evaluating the framework',
      success_criteria: 'wizard completes in under 5 minutes',
      frontend_framework: 'React',
      backend_framework: 'FastAPI',
      database: 'Postgres',
      deployment_target: 'Fly.io',
    };

    await writeProjectMd({
      repoRoot: repoDir,
      answers,
      now: () => FIXED_NOW,
    });

    const out = await readProjectMd({ repoRoot: repoDir });

    // Writer adds frontmatter-only fields (created_at, schema_version). Strip
    // them before deep-equal of the answers map.
    const restored = { ...out.answers };
    delete restored.created_at;
    delete restored.schema_version;

    expect(restored).toEqual(answers);
  });

  it('round_trip_preserves_array_answers', async () => {
    const { writeProjectMd, readProjectMd } = await import(PROD.projectMd);

    const repoDir = makeTmpDir('af-pmd-arrays');
    const answers = {
      project_name: 'demo-app',
      project_description: 'Array round-trip test.',
      project_type: 'web-saas',
      target_users: 'qa engineers',
      success_criteria: 'arrays survive a round trip',
      primary_use_cases: ['login', 'export data', 'invite teammate'],
      frontend_framework: 'Svelte',
      backend_framework: 'Node',
      database: 'SQLite',
      deployment_target: 'self-host',
    };

    await writeProjectMd({
      repoRoot: repoDir,
      answers,
      now: () => FIXED_NOW,
    });
    const out = await readProjectMd({ repoRoot: repoDir });

    expect(Array.isArray(out.answers.primary_use_cases)).toBe(true);
    expect(out.answers.primary_use_cases.length).toBe(answers.primary_use_cases.length);
    expect(out.answers.primary_use_cases).toEqual(answers.primary_use_cases);
  });
});

// =====================================================================
// AC5 — writeProjectMd uses atomicWriteFile (fsync precedes rename).
// vi.mock node:fs the same way tests/atomic-write.spec.js does, then assert
// max(fsyncSync.invocationCallOrder) < min(renameSync.invocationCallOrder).
// =====================================================================
describe('project-md — atomic write invariant', () => {
  vi.mock('node:fs', async (importOriginal) => {
    const real = await importOriginal();
    return {
      ...real,
      openSync: vi.fn(real.openSync),
      writeSync: vi.fn(real.writeSync),
      fsyncSync: vi.fn(real.fsyncSync),
      closeSync: vi.fn(real.closeSync),
      renameSync: vi.fn(real.renameSync),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('writeProjectMd_uses_atomic_write', async () => {
    const fs = await import('node:fs');
    const { writeProjectMd } = await import(PROD.projectMd);

    const repoDir = makeTmpDir('af-pmd-atomic');
    const target = join(repoDir, 'PROJECT.md');

    await writeProjectMd({
      repoRoot: repoDir,
      answers: {
        project_name: 'atomic-demo',
        project_type: 'cli-tool',
        project_description: 'a',
        target_users: 'b',
        success_criteria: 'c',
      },
      now: () => FIXED_NOW,
    });

    // At least one rename targeted PROJECT.md.
    const renamesToTarget = fs.renameSync.mock.calls.filter(
      ([, dst]) => dst === target,
    );
    expect(renamesToTarget.length).toBeGreaterThanOrEqual(1);

    // Every fsync that ran did so before the first rename-to-target (the
    // single-file atomic invariant).
    expect(fs.fsyncSync.mock.invocationCallOrder.length).toBeGreaterThan(0);
    expect(fs.renameSync.mock.invocationCallOrder.length).toBeGreaterThan(0);
    const lastFsync = Math.max(...fs.fsyncSync.mock.invocationCallOrder);
    const renamesToTargetOrders = fs.renameSync.mock.calls
      .map((call, idx) => ({ call, order: fs.renameSync.mock.invocationCallOrder[idx] }))
      .filter(({ call }) => call[1] === target)
      .map(({ order }) => order);
    const firstRenameToTarget = Math.min(...renamesToTargetOrders);
    expect(lastFsync).toBeLessThan(firstRenameToTarget);
  });
});

// =====================================================================
// AC4 — readProjectMd: missing file surfaces a clear, named error.
// =====================================================================
describe('project-md — error surface', () => {
  it('readProjectMd_throws_clear_error_on_missing_file', async () => {
    const { readProjectMd } = await import(PROD.projectMd);

    const repoDir = makeTmpDir('af-pmd-missing');
    // Intentionally do NOT create PROJECT.md.

    await expect(readProjectMd({ repoRoot: repoDir }))
      .rejects.toThrow(/PROJECT\.md/);
  });

  it('in_house_parser_rejects_unsupported_yaml', async () => {
    const { readProjectMd } = await import(PROD.projectMd);

    const repoDir = makeTmpDir('af-pmd-badyaml');
    const target = join(repoDir, 'PROJECT.md');
    // Nested object form — disallowed by the in-house subset parser.
    const content =
      '---\n' +
      'name: demo\n' +
      'type: web-saas\n' +
      'schema_version: 1\n' +
      'created_at: 2026-05-26T12:00:00Z\n' +
      'config:\n' +
      '  nested: value\n' +
      '---\n' +
      '\n' +
      '# demo\n';
    writeFileSync(target, content, 'utf8');

    // Must throw with a message mentioning the unsupported structure;
    // must NOT silently coerce the nested key into a string.
    await expect(readProjectMd({ repoRoot: repoDir }))
      .rejects.toThrow(/nest|unsupported|object|yaml/i);
  });
});

// =====================================================================
// AC6 — written frontmatter uses explicit '---' delimiters.
// =====================================================================
describe('project-md — frontmatter format', () => {
  it('frontmatter_uses_explicit_delimiters', async () => {
    const { writeProjectMd } = await import(PROD.projectMd);

    const repoDir = makeTmpDir('af-pmd-fm');
    const target = join(repoDir, 'PROJECT.md');

    await writeProjectMd({
      repoRoot: repoDir,
      answers: {
        project_name: 'delim-demo',
        project_type: 'library',
        project_description: 'd',
        target_users: 't',
        success_criteria: 's',
      },
      now: () => FIXED_NOW,
    });

    expect(existsSync(target)).toBe(true);
    const text = readFileSync(target, 'utf8');

    // File must START with the opening fence on its own line.
    expect(text.startsWith('---\n')).toBe(true);

    // Find the closing fence (second '---' line) and assert it ends with '\n'.
    const lines = text.split('\n');
    expect(lines[0]).toBe('---');
    // Look for the closing '---' after line 0.
    let closeIdx = -1;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i] === '---') {
        closeIdx = i;
        break;
      }
    }
    expect(closeIdx, 'closing --- delimiter must be present').toBeGreaterThan(0);
    // The body (markdown) follows after the closing fence.
    expect(closeIdx).toBeLessThan(lines.length - 1);
  });
});
