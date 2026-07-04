// tests/atomic-write.spec.js
// AC4 — lifecycle ops perform atomic temp+rename. Crash safety.
// Maps research §H:
//   #6 pause_atomic_write_temp_then_rename
//   #8 crash_during_pause_recovered_on_next_read

import { describe, it, expect, vi, afterEach, afterAll } from 'vitest';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  PROD, makeSessionId, seedActiveBundle, bundlePath, makeRepoSkeleton, pointerPath,
} from '../helpers/fixtures.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';

afterAll(cleanupAll);

// Spy on selected node:fs methods so we can assert the call order.
// Note: we do NOT trap writeFileSync. The fixture helper seedActiveBundle uses
// writeFileSync to seed the bundle on disk before the test runs; trapping it
// would catch the fixture, not the production code. The positive assertions
// below (O_EXCL open, fsync-before-rename, rename(tmp,target)) are sufficient
// to prove the recipe was followed.
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

describe('AC4 — atomic write recipe', () => {
  it('pause_atomic_write_temp_then_rename', async () => {
    const fs = await import('node:fs');
    const { pauseSession } = await import(PROD.lifecycle);

    const repoDir = makeTmpDir('af-atomic');
    const id = makeSessionId(2);
    const bundleDir = bundlePath(repoDir, id);
    seedActiveBundle(bundleDir, { session_id: id });
    makeRepoSkeleton(repoDir, {
      pointer: { schema_version: 2, active_session_id: id, updated_at: '2026-05-24T12:00:00Z' },
    });

    const target = join(bundleDir, 'session.json');

    await pauseSession({
      repoRoot: repoDir,
      handoffSummary: 'mid-task pause',
      nextAction: 'resume tomorrow',
    });

    // 1. A sibling tmp file was opened with O_CREAT|O_EXCL.
    const openCalls = fs.openSync.mock.calls;
    const tmpOpen = openCalls.find(([p, flags]) =>
      String(p).startsWith(target + '.tmp.') &&
      typeof flags === 'number' &&
      (flags & fs.constants.O_EXCL) !== 0 &&
      (flags & fs.constants.O_CREAT) !== 0,
    );
    expect(tmpOpen, 'expected O_CREAT|O_EXCL open on a sibling tmp file').toBeDefined();
    const tmpPath = String(tmpOpen[0]);

    // 2. fsync was called on the tmp fd BEFORE rename.
    expect(fs.fsyncSync.mock.invocationCallOrder.length).toBeGreaterThan(0);
    expect(fs.renameSync.mock.invocationCallOrder.length).toBeGreaterThan(0);
    const lastFsync = Math.max(...fs.fsyncSync.mock.invocationCallOrder);
    const firstRename = Math.min(...fs.renameSync.mock.invocationCallOrder);
    expect(lastFsync).toBeLessThan(firstRename);

    // 3. rename moved tmp -> target.
    const renameTmpToTarget = fs.renameSync.mock.calls.find(
      ([src, dst]) => src === tmpPath && dst === target,
    );
    expect(renameTmpToTarget, 'rename(tmp, target) must have been called').toBeDefined();

    // 4. Post-condition: target contains lifecycle_state=paused and the new handoff_summary.
    const written = JSON.parse(readFileSync(target, 'utf8'));
    expect(written.lifecycle_state).toBe('paused');
    expect(written.handoff_summary).toBe('mid-task pause');
    expect(written.next_action).toBe('resume tomorrow');
  });
});

describe('AC4 — crash safety', () => {
  it('crash_during_pause_recovered_on_next_read', async () => {
    const { pauseSession } = await import(PROD.lifecycle);
    const { sweepAndRecover } = await import(PROD.recovery);
    const fs = await import('node:fs');

    const repoDir = makeTmpDir('af-crash');
    const id = makeSessionId(3);
    const bundleDir = bundlePath(repoDir, id);
    seedActiveBundle(bundleDir, { session_id: id });
    makeRepoSkeleton(repoDir, {
      pointer: { schema_version: 2, active_session_id: id, updated_at: '2026-05-24T12:00:00Z' },
    });
    const target = join(bundleDir, 'session.json');

    // Simulate crash mid-write: make renameSync throw the FIRST time it is called
    // on a tmp -> session.json move. The production code should leave the tmp
    // file on disk; the next read calls sweepAndRecover which promotes it.
    let crashed = false;
    const realRename = fs.renameSync.getMockImplementation()
      ?? (await vi.importActual('node:fs')).renameSync;
    fs.renameSync.mockImplementation((src, dst) => {
      if (!crashed &&
          typeof src === 'string' && src.includes('.tmp.') &&
          typeof dst === 'string' && dst.endsWith('session.json')) {
        crashed = true;
        const err = new Error('simulated crash before rename completed');
        err.code = 'EIO';
        throw err;
      }
      return realRename(src, dst);
    });

    await expect(pauseSession({
      repoRoot: repoDir,
      handoffSummary: 'will crash',
      nextAction: 'resume',
    })).rejects.toThrow();

    // Tmp file should be present on disk; target may be intact (active) or missing.
    const tmpSurvivors = fs
      .readdirSync(bundleDir)
      .filter((n) => n.startsWith('session.json.tmp.'));
    expect(tmpSurvivors.length, 'expected at least one orphaned tmp file').toBeGreaterThan(0);

    // TASK-085 AC6 — sweepAndRecover now age-gates its "target parseable ->
    // delete every tmp" branch (mirrors task-store.js's TMP_SWEEP_MIN_AGE_MS)
    // so a concurrent writer's still-in-flight tmp is never reaped out from
    // under it. In real usage, a crash orphan is discovered on some LATER
    // read (a fresh chat's RESUME FIRST step, well after the crash), not in
    // the same tick the crash happened — so backdate the survivor(s) here to
    // simulate that realistic gap and keep this test's intent (a genuine
    // crash orphan is reaped) accurate under the new age-gate.
    const staleAt = new Date(Date.now() - 5 * 60 * 1000);
    for (const name of tmpSurvivors) {
      fs.utimesSync(join(bundleDir, name), staleAt, staleAt);
    }

    // Now: run sweepAndRecover. It must produce a consistent state:
    //   - If target exists and parses, delete the tmp.
    //   - If target is missing, promote the tmp (rename tmp -> target).
    // Restore renameSync for the sweep itself.
    fs.renameSync.mockImplementation(realRename);

    const result = sweepAndRecover({ bundleDir });
    expect(result.actions.length).toBeGreaterThan(0);

    // Post-state: exactly one session.json, no tmp siblings.
    const after = fs.readdirSync(bundleDir);
    expect(after.filter((n) => n.startsWith('session.json.tmp.'))).toEqual([]);
    expect(after).toContain('session.json');

    // session.json parses.
    expect(() => JSON.parse(readFileSync(target, 'utf8'))).not.toThrow();
  });
});

describe('AC4 — antivirus EBUSY retry', () => {
  it('rename_retries_on_EBUSY', async () => {
    // Documented behavior from research §C: retry up to 5 times with 50ms backoff.
    // This test asserts the retry happens and ultimately succeeds.
    const fs = await import('node:fs');
    const { pauseSession } = await import(PROD.lifecycle);

    const repoDir = makeTmpDir('af-ebusy');
    const id = makeSessionId(4);
    const bundleDir = bundlePath(repoDir, id);
    seedActiveBundle(bundleDir, { session_id: id });
    makeRepoSkeleton(repoDir, {
      pointer: { schema_version: 2, active_session_id: id, updated_at: '2026-05-24T12:00:00Z' },
    });

    const realRename = (await vi.importActual('node:fs')).renameSync;
    let failures = 0;
    fs.renameSync.mockImplementation((src, dst) => {
      if (failures < 2 &&
          typeof src === 'string' && src.includes('.tmp.') &&
          typeof dst === 'string' && dst.endsWith('session.json')) {
        failures++;
        const err = new Error('EBUSY: resource busy or locked, rename');
        err.code = 'EBUSY';
        throw err;
      }
      return realRename(src, dst);
    });

    await pauseSession({
      repoRoot: repoDir,
      handoffSummary: 'retry path',
      nextAction: 'verify recovery',
    });

    expect(failures).toBe(2);
    const written = JSON.parse(readFileSync(join(bundleDir, 'session.json'), 'utf8'));
    expect(written.lifecycle_state).toBe('paused');
  });
});
