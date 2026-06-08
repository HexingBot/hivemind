// tests/round-trip.spec.js
// AC12 — cross-machine bundle round-trip.
//
// Maps research §H test #25 (cross_machine_bundle_roundtrip) and its sub-test
// where the task is missing in the destination repo.

import { describe, it, expect, afterAll } from 'vitest';
import {
  cpSync, readFileSync, writeFileSync, existsSync, statSync, readdirSync,
} from 'node:fs';
import { join } from 'node:path';

import {
  PROD, makeSessionId, seedActiveBundle, bundlePath, makeRepoSkeleton, pointerPath,
} from '../helpers/fixtures.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';

afterAll(cleanupAll);

describe('AC12 — cross-machine bundle round-trip', () => {
  it('cross_machine_bundle_roundtrip', async () => {
    const { resumeFromPointer } = await import(PROD.lifecycle);

    // GIVEN: repoA with an active bundle.
    const repoA = makeTmpDir('af-rt-A');
    const id = makeSessionId(77);
    const taskPayload = {
      key: 'TASK-004', title: 'Portable session bundles', status: 'todo',
      acceptance_criteria: [], linked_commits: [],
    };
    makeRepoSkeleton(repoA, {
      pointer: { schema_version: 2, active_session_id: id, updated_at: '2026-05-24T12:00:00Z' },
      tasks: { 'TASK-004': taskPayload },
    });
    seedActiveBundle(bundlePath(repoA, id), {
      session_id: id,
      session_json_extra: {
        active_task: 'TASK-004',
        next_action: 'continue with the implementation phase',
        handoff_summary: 'paused mid-implementation, ready to resume',
      },
    });

    // Snapshot repoA state to confirm it is not mutated.
    const repoABundleBefore = readFileSync(
      join(bundlePath(repoA, id), 'session.json'),
      'utf8',
    );
    const repoABundleMtimeBefore = statSync(
      join(bundlePath(repoA, id), 'session.json'),
    ).mtimeMs;

    // WHEN: copy bundle to repoB and set the pointer there.
    const repoB = makeTmpDir('af-rt-B');
    makeRepoSkeleton(repoB, {
      pointer: { schema_version: 2, active_session_id: id, updated_at: '2026-05-24T12:00:00Z' },
      tasks: { 'TASK-004': taskPayload }, // task travels via git, not via bundle
    });
    cpSync(bundlePath(repoA, id), bundlePath(repoB, id), { recursive: true });

    // Snapshot repoB top-level state to confirm only state/* is mutated, if at all.
    const repoBNonStateMtimesBefore = Object.fromEntries(
      readdirSync(repoB)
        .filter((n) => n !== 'state')
        .map((n) => [n, statSync(join(repoB, n)).mtimeMs]),
    );

    const payload = await resumeFromPointer({ repoRoot: repoB });

    // THEN: payload matches what repoA had.
    expect(payload.handoff_summary).toBe('paused mid-implementation, ready to resume');
    expect(payload.next_action).toBe('continue with the implementation phase');
    expect(payload.active_task).toBe('TASK-004');

    // repoA bundle untouched.
    expect(
      readFileSync(join(bundlePath(repoA, id), 'session.json'), 'utf8'),
    ).toBe(repoABundleBefore);
    expect(
      statSync(join(bundlePath(repoA, id), 'session.json')).mtimeMs,
    ).toBe(repoABundleMtimeBefore);

    // repoB tasks/* not mutated.
    for (const [n, mt] of Object.entries(repoBNonStateMtimesBefore)) {
      expect(statSync(join(repoB, n)).mtimeMs, `repoB/${n} should not be mutated`).toBe(mt);
    }
  });

  it('cross_machine_resume_errors_when_task_missing_in_destination', async () => {
    const { resumeFromPointer } = await import(PROD.lifecycle);

    const repoA = makeTmpDir('af-rt-A2');
    const id = makeSessionId(88);
    makeRepoSkeleton(repoA, {
      pointer: { schema_version: 2, active_session_id: id, updated_at: '2026-05-24T12:00:00Z' },
      tasks: { 'TASK-004': { key: 'TASK-004', title: 'Portable bundles', status: 'todo' } },
    });
    seedActiveBundle(bundlePath(repoA, id), {
      session_id: id,
      session_json_extra: {
        active_task: 'TASK-004',
        next_action: 'whatever',
        handoff_summary: 'something',
      },
    });

    // repoB has the bundle copied over but NO tasks/TASK-004.json on disk.
    const repoB = makeTmpDir('af-rt-B2');
    makeRepoSkeleton(repoB, {
      pointer: { schema_version: 2, active_session_id: id, updated_at: '2026-05-24T12:00:00Z' },
      tasks: {}, // intentionally empty
    });
    cpSync(bundlePath(repoA, id), bundlePath(repoB, id), { recursive: true });

    await expect(resumeFromPointer({ repoRoot: repoB }))
      .rejects.toThrow(/TASK-004|task.*missing|not found/i);
  });
});
