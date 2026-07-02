// tests/task-store-close-guards.spec.js
// TASK-082 — deep-review S1: deterministic gate enforcement at mutation seams.
//
// TEST MODE — these specs encode acceptance criteria 1 and 3 (the store-level
// halves) BEFORE any implementation lands. They MUST FAIL against the current
// src/task-store.js:
//   - AC1 (uat-only done-guard): transitionStatus does not yet check
//     verification_tier/comments before writing 'done' -> the "throws"
//     assertions fail because no error is thrown (wrong-reason-safe: these are
//     assertion failures on missing behavior, not import errors).
//   - AC3 (close_task atomicity, store half): task-store.js does not yet
//     export `closeTask` -> calling it throws "closeTask is not a function"
//     (TypeError), which is the expected tests-first failure for a
//     not-yet-added export on an already-existing module.
//
// SEAM CONTRACT encoded here (see handoff notes for the full writeup):
//   - task-store.js exports a new `UatGuardError` class: `.name ===
//     'UatGuardError'`, `.code === 'UAT_GUARD_REQUIRED'`, message matches /uat/i.
//   - transitionStatus({ repoRoot, key, status, now, closeGuard }) — NEW
//     optional `closeGuard` param. When status === 'done':
//       1. the uat-only guard runs unconditionally (self-contained, no bundle
//          access — task.verification_tier + task.comments only);
//       2. if `closeGuard` is a function, `await closeGuard({ repoRoot, task,
//          key })` runs next and may throw to block the write.
//     Both checks run BEFORE any disk I/O, so a thrown guard leaves the task
//     file untouched. Transitions to any status OTHER than 'done' never run
//     either guard.
//   - task-store.js exports `closeTask({ repoRoot, key, comment,
//     linked_commits, linked_prs, now, closeGuard })` — a NEW function that
//     performs status->done + comment append + linked_commits/linked_prs
//     append + index regen in ONE read-validate-write pass (a single
//     atomicWriteFiles call, mirroring transitionStatus/appendComment). Runs
//     the same uat-only guard and optional closeGuard as transitionStatus,
//     PLUS a commit-sha shape check (`/^[0-9a-f]{7,40}$/i`) against every
//     entry in `linked_commits`. All validation happens before any disk I/O,
//     so any failure (uat guard, closeGuard, bad sha) leaves both the task
//     file AND index.json byte-unchanged.

import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { makeRepoSkeleton } from './helpers/fixtures.js';
import { makeTmpDir, cleanupAll } from './helpers/tmpRepo.js';

afterAll(cleanupAll);

function readTaskFile(repoDir, key) {
  return JSON.parse(readFileSync(join(repoDir, 'tasks', `${key}.json`), 'utf8'));
}

function readTaskFileBytes(repoDir, key) {
  return readFileSync(join(repoDir, 'tasks', `${key}.json`), 'utf8');
}

function readIndexBytes(repoDir) {
  return readFileSync(join(repoDir, 'tasks', 'index.json'), 'utf8');
}

/** Minimal schema-valid task builder. */
function makeTask({
  key,
  verification_tier,
  comments = [],
  status = 'todo',
  linked_commits = [],
  linked_prs = [],
}) {
  return {
    key,
    title: `Fixture ${key}`,
    description: 'Fixture task for TASK-082 close-guard specs.',
    acceptance_criteria: ['covered by TASK-082 specs'],
    status,
    priority: 'medium',
    labels: [],
    assignee: null,
    depends_on: [],
    linked_commits,
    linked_prs,
    comments,
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    jira_key: null,
    ...(verification_tier !== undefined ? { verification_tier } : {}),
  };
}

// ===========================================================================
// AC1 — uat-only done-guard (store level)
// ===========================================================================
describe('AC1 — transitionStatus enforces the uat-only done-guard', () => {
  it('uat_only_task_without_uat_comment_transitioning_to_done_throws_typed_error', async () => {
    const { transitionStatus, UatGuardError } = await import('../src/task-store.js');

    const repoDir = makeTmpDir('af-uatguard-block');
    makeRepoSkeleton(repoDir, {
      tasks: {
        'TASK-201': makeTask({ key: 'TASK-201', verification_tier: 'uat-only', comments: [] }),
      },
    });
    const before = readTaskFileBytes(repoDir, 'TASK-201');

    await expect(
      transitionStatus({ repoRoot: repoDir, key: 'TASK-201', status: 'done' }),
    ).rejects.toThrow(/uat/i);

    // Assert it is the TYPED error, not an incidental message match.
    let caught;
    try {
      await transitionStatus({ repoRoot: repoDir, key: 'TASK-201', status: 'done' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(UatGuardError);
    expect(caught.code).toBe('UAT_GUARD_REQUIRED');

    // No partial write — file byte-identical.
    expect(readTaskFileBytes(repoDir, 'TASK-201')).toBe(before);
  });

  it('uat_only_task_with_uat_comment_transitions_to_done_normally', async () => {
    const { transitionStatus } = await import('../src/task-store.js');

    const repoDir = makeTmpDir('af-uatguard-allow');
    makeRepoSkeleton(repoDir, {
      tasks: {
        'TASK-202': makeTask({
          key: 'TASK-202',
          verification_tier: 'uat-only',
          comments: [{ author: 'uat', at: '2026-07-01T01:00:00Z', body: 'all steps PASS' }],
        }),
      },
    });

    await transitionStatus({ repoRoot: repoDir, key: 'TASK-202', status: 'done' });

    expect(readTaskFile(repoDir, 'TASK-202').status).toBe('done');
  });

  it('non_uat_only_tier_is_unaffected_by_the_uat_guard', async () => {
    const { transitionStatus } = await import('../src/task-store.js');

    const repoDir = makeTmpDir('af-uatguard-tdd-tier');
    makeRepoSkeleton(repoDir, {
      tasks: {
        'TASK-203': makeTask({ key: 'TASK-203', verification_tier: 'tdd', comments: [] }),
      },
    });

    await transitionStatus({ repoRoot: repoDir, key: 'TASK-203', status: 'done' });

    expect(readTaskFile(repoDir, 'TASK-203').status).toBe('done');
  });

  it('transitions_other_than_done_are_unaffected_by_the_uat_guard', async () => {
    const { transitionStatus } = await import('../src/task-store.js');

    const repoDir = makeTmpDir('af-uatguard-non-done');
    makeRepoSkeleton(repoDir, {
      tasks: {
        'TASK-204': makeTask({ key: 'TASK-204', verification_tier: 'uat-only', comments: [] }),
      },
    });

    await transitionStatus({ repoRoot: repoDir, key: 'TASK-204', status: 'in_progress' });

    expect(readTaskFile(repoDir, 'TASK-204').status).toBe('in_progress');
  });
});

// ===========================================================================
// AC3 — closeTask: single validate-then-atomic pass, all-or-nothing.
// ===========================================================================
describe('AC3 — closeTask applies transition + comment + commits + prs + index in one pass', () => {
  it('close_task_happy_path_applies_everything_in_one_call', async () => {
    const { closeTask } = await import('../src/task-store.js');

    const repoDir = makeTmpDir('af-closetask-happy');
    makeRepoSkeleton(repoDir, {
      tasks: {
        'TASK-205': makeTask({
          key: 'TASK-205',
          verification_tier: 'tdd',
          comments: [{ author: 'reviewer', at: '2026-07-01T02:00:00Z', body: 'LGTM' }],
        }),
      },
    });
    writeFileSync(
      join(repoDir, 'tasks', 'index.json'),
      JSON.stringify({ generated_at: '2000-01-01T00:00:00Z', tasks: [] }, null, 2),
      'utf8',
    );

    const fixedNow = '2026-07-02T12:00:00Z';
    await closeTask({
      repoRoot: repoDir,
      key: 'TASK-205',
      comment: { author: 'developer', body: 'Ship it.' },
      linked_commits: ['abc1234'],
      linked_prs: ['https://example.com/pr/1'],
      now: () => fixedNow,
    });

    const after = readTaskFile(repoDir, 'TASK-205');
    expect(after.status).toBe('done');
    expect(after.updated_at).toBe(fixedNow);
    expect(after.comments).toHaveLength(2);
    expect(after.comments[0].author).toBe('reviewer'); // preserved, in order
    expect(after.comments[1]).toMatchObject({ author: 'developer', body: 'Ship it.' });
    expect(after.linked_commits).toContain('abc1234');
    expect(after.linked_prs).toContain('https://example.com/pr/1');

    const idx = JSON.parse(readIndexBytes(repoDir));
    const entry = idx.tasks.find((t) => t.key === 'TASK-205');
    expect(entry).toBeDefined();
    expect(entry.status).toBe('done');
  });

  it('close_task_invalid_commit_sha_leaves_task_file_and_index_byte_unchanged', async () => {
    const { closeTask } = await import('../src/task-store.js');

    const repoDir = makeTmpDir('af-closetask-badsha');
    makeRepoSkeleton(repoDir, {
      tasks: {
        'TASK-206': makeTask({ key: 'TASK-206', verification_tier: 'tdd' }),
      },
    });
    writeFileSync(
      join(repoDir, 'tasks', 'index.json'),
      JSON.stringify({ generated_at: '2000-01-01T00:00:00Z', tasks: [] }, null, 2),
      'utf8',
    );
    const beforeTask = readTaskFileBytes(repoDir, 'TASK-206');
    const beforeIndex = readIndexBytes(repoDir);

    await expect(
      closeTask({
        repoRoot: repoDir,
        key: 'TASK-206',
        comment: { author: 'developer', body: 'Ship it.' },
        linked_commits: ['not-a-real-sha!'],
        linked_prs: [],
      }),
    ).rejects.toThrow(/sha|commit/i);

    expect(readTaskFileBytes(repoDir, 'TASK-206')).toBe(beforeTask);
    expect(readIndexBytes(repoDir)).toBe(beforeIndex);
  });

  it('close_task_uat_guard_firing_leaves_task_file_and_index_byte_unchanged', async () => {
    const { closeTask, UatGuardError } = await import('../src/task-store.js');

    const repoDir = makeTmpDir('af-closetask-uatguard');
    makeRepoSkeleton(repoDir, {
      tasks: {
        'TASK-207': makeTask({ key: 'TASK-207', verification_tier: 'uat-only', comments: [] }),
      },
    });
    writeFileSync(
      join(repoDir, 'tasks', 'index.json'),
      JSON.stringify({ generated_at: '2000-01-01T00:00:00Z', tasks: [] }, null, 2),
      'utf8',
    );
    const beforeTask = readTaskFileBytes(repoDir, 'TASK-207');
    const beforeIndex = readIndexBytes(repoDir);

    let caught;
    try {
      await closeTask({
        repoRoot: repoDir,
        key: 'TASK-207',
        comment: { author: 'developer', body: 'Ship it.' },
        linked_commits: [],
        linked_prs: [],
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(UatGuardError);

    expect(readTaskFileBytes(repoDir, 'TASK-207')).toBe(beforeTask);
    expect(readIndexBytes(repoDir)).toBe(beforeIndex);
  });
});
