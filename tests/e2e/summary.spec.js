// tests/summary.spec.js
// AC6 — session.end emits summary.md with required sections; commits sourced from
//        tasks/<key>.json.linked_commits[].
//
// Maps research §H:
//   #13 summary_md_contains_required_sections
//   #14 summary_lists_commits_from_linked_commits

import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  PROD, makeSessionId, seedActiveBundle, bundlePath, makeRepoSkeleton, pointerPath,
} from '../helpers/fixtures.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';

afterAll(cleanupAll);

describe('AC6 — summary.md content', () => {
  it('summary_md_contains_required_sections', async () => {
    const { startSession, pauseSession, resumeSession, endSession } =
      await import(PROD.lifecycle);

    const repoDir = makeTmpDir('af-summary-sections');
    makeRepoSkeleton(repoDir, {
      pointer: { schema_version: 2, active_session_id: null, updated_at: '2026-05-24T12:00:00Z' },
      tasks: {
        'TASK-004': {
          key: 'TASK-004', title: 'Portable session bundles', status: 'todo',
          linked_commits: [],
        },
      },
    });

    await startSession({ repoRoot: repoDir });
    await pauseSession({
      repoRoot: repoDir,
      handoffSummary: 'pause 1',
      nextAction: 'come back tomorrow',
    });
    await resumeSession({ repoRoot: repoDir });
    await endSession({
      repoRoot: repoDir,
      handoffSummary: 'final wrap-up',
    });

    const ptrBefore = readFileSync(pointerPath(repoDir), 'utf8');
    const ptr = JSON.parse(ptrBefore);
    // After end, the pointer's active_session_id is null (research §C).
    expect(ptr.active_session_id).toBeNull();

    // Find the bundle directory (only one exists).
    const sessionsDir = join(repoDir, 'state', 'sessions');
    const fs = await import('node:fs');
    const bundles = fs.readdirSync(sessionsDir);
    expect(bundles).toHaveLength(1);
    const bundleDir = join(sessionsDir, bundles[0]);

    const summary = readFileSync(join(bundleDir, 'summary.md'), 'utf8');

    for (const heading of [
      '## Dates',
      '## Active task',
      '## Tasks touched',
      '## Commits referenced',
      '## Lifecycle timeline',
      '## Open threads',
      '## Unresolved blockers',
    ]) {
      expect(summary, `missing section heading ${heading}`).toContain(heading);
    }
  });

  it('summary_lists_commits_from_linked_commits', async () => {
    const { startSession, endSession } = await import(PROD.lifecycle);

    const repoDir = makeTmpDir('af-summary-commits');
    const SHA_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const SHA_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    makeRepoSkeleton(repoDir, {
      pointer: { schema_version: 2, active_session_id: null, updated_at: '2026-05-24T12:00:00Z' },
      tasks: {
        'TASK-099': {
          key: 'TASK-099', title: 'fake task with two commits', status: 'todo',
          linked_commits: [SHA_A, SHA_B],
        },
      },
    });

    await startSession({ repoRoot: repoDir, activeTask: 'TASK-099' });
    await endSession({ repoRoot: repoDir, handoffSummary: 'done' });

    const fs = await import('node:fs');
    const bundles = fs.readdirSync(join(repoDir, 'state', 'sessions'));
    const summary = readFileSync(
      join(repoDir, 'state', 'sessions', bundles[0], 'summary.md'),
      'utf8',
    );
    expect(summary).toContain(SHA_A);
    expect(summary).toContain(SHA_B);
    expect(summary).toContain('TASK-099');
  });
});
