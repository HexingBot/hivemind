// tests/e2e/requires-uat-persistence.spec.js
// TASK-221 fix round (REQUEST-CHANGES MEDIUM) — AC5 persistence/round-trip
// locks for requires_uat.
//
// tests/requires-uat.spec.js (fast tier) covers AC1/AC2/AC7 (schema shape,
// default, requiresUat() helper) but never exercises createTask's actual
// disk write — the ...(requires_uat !== undefined ? { requires_uat } : {})
// spread at src/task-store.js:~1420. Nothing pinned that createTask
// PERSISTS the field (as opposed to merely accepting it without a schema
// rejection), nor that it survives appendComment/transitionStatus
// re-serializing the whole task object. TASK-220/TASK-222 depend on that
// persistence for UAT gating, so a silently reverted spread would fail
// open with no test noticing. This file closes that gap. Needs real disk
// I/O (makeTmpDir) to read back the JSON createTask actually wrote, so it
// lives under tests/e2e/, not the fast tier.
//
// AC covered: AC5 (createTask/create_task accept requires_uat and it
// survives a real read/write round-trip).

import { afterAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PROD, makeRepoSkeleton } from '../helpers/fixtures.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';

afterAll(cleanupAll);

function readTaskFile(repoDir, key) {
  return JSON.parse(readFileSync(join(repoDir, 'tasks', `${key}.json`), 'utf8'));
}

describe('AC5 — createTask: requires_uat persists to disk', () => {
  it('createTask_persists_requires_uat_true', async () => {
    const { createTask } = await import(PROD.taskStore);

    const repoDir = makeTmpDir('af-ru-create-true');
    makeRepoSkeleton(repoDir, {});

    const { key } = await createTask({
      repoRoot: repoDir,
      title: 'Observable behavior task',
      description: 'requires_uat true must land on disk.',
      acceptance_criteria: ['requires_uat true is persisted'],
      priority: 'medium',
      requires_uat: true,
      now: () => '2026-09-10T12:00:00Z',
    });

    const written = readTaskFile(repoDir, key);
    expect(written.requires_uat).toBe(true);
  });

  // The important case: false is the falsy, backward-compatible default —
  // a spread rewritten with a truthiness check (e.g. `requires_uat ? {...}
  // : {}` instead of `requires_uat !== undefined ? {...} : {}`) would drop
  // an explicit false silently, and the written file would look identical
  // to "field never set" (both simply lack the key). Assert the key is
  // actually PRESENT and === false, not just falsy/absent.
  it('createTask_persists_requires_uat_false_and_does_not_drop_it', async () => {
    const { createTask } = await import(PROD.taskStore);

    const repoDir = makeTmpDir('af-ru-create-false');
    makeRepoSkeleton(repoDir, {});

    const { key } = await createTask({
      repoRoot: repoDir,
      title: 'Non-observable task',
      description: 'requires_uat false must still be written explicitly.',
      acceptance_criteria: ['requires_uat false is persisted, not dropped'],
      priority: 'medium',
      requires_uat: false,
      now: () => '2026-09-10T12:00:00Z',
    });

    const written = readTaskFile(repoDir, key);
    expect(
      Object.prototype.hasOwnProperty.call(written, 'requires_uat'),
      'requires_uat: false must be written to disk as an explicit key, not silently dropped',
    ).toBe(true);
    expect(written.requires_uat).toBe(false);
  });

  it('createTask_omits_requires_uat_when_not_provided', async () => {
    const { createTask } = await import(PROD.taskStore);

    const repoDir = makeTmpDir('af-ru-create-absent');
    makeRepoSkeleton(repoDir, {});

    const { key } = await createTask({
      repoRoot: repoDir,
      title: 'No requires_uat supplied',
      description: 'Field omitted entirely by the caller.',
      acceptance_criteria: ['requires_uat key is absent'],
      priority: 'low',
      now: () => '2026-09-10T12:00:00Z',
    });

    const written = readTaskFile(repoDir, key);
    expect(
      Object.prototype.hasOwnProperty.call(written, 'requires_uat'),
      'requires_uat must be absent when the caller never passed it',
    ).toBe(false);
  });
});

describe('AC5 — requires_uat survives a real create/comment/transition/reread round-trip', () => {
  it('requires_uat_true_survives_appendComment_and_transitionStatus', async () => {
    const { createTask, appendComment, transitionStatus } = await import(PROD.taskStore);

    const repoDir = makeTmpDir('af-ru-roundtrip-true');
    makeRepoSkeleton(repoDir, {});

    const { key } = await createTask({
      repoRoot: repoDir,
      title: 'Round-trip task',
      description: 'requires_uat must survive downstream writes.',
      acceptance_criteria: ['requires_uat survives appendComment + transitionStatus'],
      priority: 'medium',
      requires_uat: true,
      now: () => '2026-09-10T12:00:00Z',
    });

    await appendComment({
      repoRoot: repoDir,
      key,
      author: 'developer',
      body: 'Working on this.',
      now: () => '2026-09-10T12:05:00Z',
    });
    expect(readTaskFile(repoDir, key).requires_uat).toBe(true);

    await transitionStatus({
      repoRoot: repoDir,
      key,
      status: 'in_progress',
      now: () => '2026-09-10T12:10:00Z',
    });

    const written = readTaskFile(repoDir, key);
    expect(written.status).toBe('in_progress');
    expect(written.requires_uat).toBe(true);
  });

  it('requires_uat_false_survives_appendComment_and_transitionStatus', async () => {
    const { createTask, appendComment, transitionStatus } = await import(PROD.taskStore);

    const repoDir = makeTmpDir('af-ru-roundtrip-false');
    makeRepoSkeleton(repoDir, {});

    const { key } = await createTask({
      repoRoot: repoDir,
      title: 'Round-trip task (false)',
      description: 'requires_uat: false must survive downstream writes too.',
      acceptance_criteria: ['requires_uat false survives appendComment + transitionStatus'],
      priority: 'medium',
      requires_uat: false,
      now: () => '2026-09-10T12:00:00Z',
    });

    await appendComment({
      repoRoot: repoDir,
      key,
      author: 'developer',
      body: 'Glue work, no UAT needed.',
      now: () => '2026-09-10T12:05:00Z',
    });
    await transitionStatus({
      repoRoot: repoDir,
      key,
      status: 'in_progress',
      now: () => '2026-09-10T12:10:00Z',
    });

    const written = readTaskFile(repoDir, key);
    expect(written.status).toBe('in_progress');
    expect(
      Object.prototype.hasOwnProperty.call(written, 'requires_uat'),
      'requires_uat: false must still be present after appendComment + transitionStatus',
    ).toBe(true);
    expect(written.requires_uat).toBe(false);
  });
});
