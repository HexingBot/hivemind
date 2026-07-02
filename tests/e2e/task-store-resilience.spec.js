// tests/e2e/task-store-resilience.spec.js
// TASK-083 AC3 + AC4 — two silent-corruption classes in src/task-store.js
// that only surface under a genuinely concurrent/unattended writer, which is
// exactly the loop-mode scenario this framework is built for:
//
//   AC3 — sweepTasksTmpFiles({repoRoot}) currently deletes ANY tasks/*.tmp.*
//         file with no age threshold. src/atomic-write.js's own two-phase
//         atomicWriteFiles() has a real (if narrow, ~tens of ms, wider under
//         the Windows EBUSY retry path) window where a tmp file is durably
//         on disk but not yet renamed onto its target. A sweep landing in
//         that window today deletes the in-flight tmp out from under the
//         writer, corrupting the pending mutation. An mtime age-gate (~60s)
//         means only tmps old enough to be crash orphans (not in-flight
//         writes) are ever reaped.
//
//   AC4 — createTask derives its key via deriveNextKey (scan tasks/ for the
//         max numeric suffix, +1) and then unconditionally rename()s onto
//         that path. Two concurrent createTask calls that both derive the
//         same next key race: the second writer's rename silently clobbers
//         the first writer's file with no error to either caller. createTask
//         must detect the collision and throw instead of overwriting.
//
// Both specs fail today (sweep has no age-gate; createTask has no collision
// guard).

import { describe, it, expect, afterAll } from 'vitest';
import {
  readFileSync, writeFileSync, existsSync, utimesSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { vi } from 'vitest';

import { PROD, makeRepoSkeleton } from '../helpers/fixtures.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';

afterAll(cleanupAll);

const __thisDir = dirname(fileURLToPath(import.meta.url));
const __fixturesDir = join(__thisDir, '..', 'fixtures', 'tasks');

function loadFixtureTasks(keys) {
  const out = {};
  for (const k of keys) {
    out[k] = JSON.parse(readFileSync(join(__fixturesDir, `${k}.json`), 'utf8'));
  }
  return out;
}

// ===========================================================================
// AC3 — sweepTasksTmpFiles age-gate. A fresh (in-flight) tmp survives; a
//        stale (crash-orphaned) tmp is reaped.
// ===========================================================================
describe('AC3 — sweepTasksTmpFiles mtime age-gate', () => {
  it('sweep_preserves_fresh_tmp_but_deletes_stale_tmp', async () => {
    const { sweepTasksTmpFiles } = await import(PROD.taskStore);

    const repoDir = makeTmpDir('af-ts83-agegate');
    makeRepoSkeleton(repoDir, {
      tasks: loadFixtureTasks(['TASK-101']),
    });
    const tasksDir = join(repoDir, 'tasks');

    // Fresh tmp — mtime is "now" (just written), simulating a writer that is
    // mid-way through atomicWriteFiles's phase-1/phase-2 window.
    const freshTmp = join(tasksDir, 'TASK-102.json.tmp.11111-aaaaaaaaaaaa');
    writeFileSync(freshTmp, 'in-flight-write-bytes', 'utf8');

    // Stale tmp — backdated well past any reasonable age-gate threshold,
    // simulating a genuine crash orphan from a prior process.
    const staleTmp = join(tasksDir, 'TASK-103.json.tmp.22222-bbbbbbbbbbbb');
    writeFileSync(staleTmp, 'orphaned-crash-bytes', 'utf8');
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    utimesSync(staleTmp, fiveMinutesAgo, fiveMinutesAgo);

    await sweepTasksTmpFiles({ repoRoot: repoDir });

    expect(
      existsSync(freshTmp),
      'a fresh (just-written) tmp must survive the sweep — it may be an in-flight write',
    ).toBe(true);
    expect(
      existsSync(staleTmp),
      'a stale (>60s old) tmp must still be reaped as a crash orphan',
    ).toBe(false);
  });
});

// ===========================================================================
// AC4 — createTask must not silently overwrite an existing task file when a
//        concurrent writer wins the race to the same derived key.
// ===========================================================================
describe('AC4 — createTask key-collision guard', () => {
  it('create_task_throws_instead_of_overwriting_on_derived_key_collision', async () => {
    vi.resetModules();
    vi.doMock('node:fs/promises', async (importOriginal) => {
      const real = await importOriginal();
      return { ...real, readdir: vi.fn(real.readdir) };
    });

    const fsp = await import('node:fs/promises');
    const { createTask } = await import(PROD.taskStore);

    const repoDir = makeTmpDir('af-ts83-toctou');
    makeRepoSkeleton(repoDir, {}); // empty tasks/ -> deriveNextKey will pick TASK-001

    const collidingContent = JSON.stringify({ marker: 'written-by-concurrent-writer' });
    const collisionPath = join(repoDir, 'tasks', 'TASK-001.json');

    let injected = false;
    fsp.readdir.mockImplementation(async (dir, ...rest) => {
      const real = await vi.importActual('node:fs/promises');
      const listing = await real.readdir(dir, ...rest);
      // Fire once, on deriveNextKey's very first readdir of tasks/ — this is
      // the moment createTask has "seen" an empty directory and committed to
      // deriving TASK-001. Writing the collision here reproduces the TOCTOU:
      // a second concurrent writer creates TASK-001.json between our read and
      // our eventual write.
      if (!injected && String(dir) === join(repoDir, 'tasks')) {
        injected = true;
        writeFileSync(collisionPath, collidingContent, 'utf8');
      }
      return listing;
    });

    await expect(
      createTask({
        repoRoot: repoDir,
        title: 'Racer',
        description: 'Loses the race for TASK-001 to a concurrent writer.',
        acceptance_criteria: ['AC1'],
        priority: 'medium',
        now: () => '2026-07-02T00:00:00Z',
      }),
      'createTask must reject when its derived key collides with a file that ' +
        'appeared on disk after the key was derived',
    ).rejects.toThrow(/exists|collision/i);

    // The concurrent writer's file must be untouched — no silent overwrite.
    expect(readFileSync(collisionPath, 'utf8')).toBe(collidingContent);

    vi.doUnmock('node:fs/promises');
    vi.resetModules();
  });
});
