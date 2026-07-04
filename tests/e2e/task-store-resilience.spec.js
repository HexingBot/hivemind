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
import { spawn } from 'node:child_process';

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

// ===========================================================================
// TASK-085 AC5 — deep-review S4 scope extension (M1 from the TASK-083
// review): the existsSync collision guard above (AC4) is itself a
// check-before-write — the existsSync() check and the eventual atomicWriteFiles
// rename are NOT atomic with each other, so a second concurrent writer can
// still slip in between them and get silently clobbered by the FIRST
// writer's later rename. Two hardenings are required:
//   (a) The thrown collision error must be TYPED (`.code === 'E_KEY_COLLISION'`)
//       rather than a plain untyped Error, so callers can distinguish this
//       failure mode programmatically.
//   (b) createTask must verify-after-write: re-read the derived-key target
//       AFTER its own rename lands and compare it to the payload it intended
//       to write; a mismatch (a competitor's payload is what's actually
//       there) must throw the same typed E_KEY_COLLISION error.
//   (c) The observable, black-box contract of (a)+(b): two concurrent
//       `node` CHILD PROCESSES both calling createTask against the same
//       empty repoRoot must not both "win" — exactly one succeeds, the
//       other throws E_KEY_COLLISION.
// ===========================================================================

describe('TASK-085 AC5(a) — createTask key-collision error is TYPED (E_KEY_COLLISION)', () => {
  it('create_task_collision_error_carries_code_e_key_collision', async () => {
    vi.resetModules();
    vi.doMock('node:fs/promises', async (importOriginal) => {
      const real = await importOriginal();
      return { ...real, readdir: vi.fn(real.readdir) };
    });

    const fsp = await import('node:fs/promises');
    const { createTask } = await import(PROD.taskStore);

    const repoDir = makeTmpDir('af-ts85-typed-collision');
    makeRepoSkeleton(repoDir, {}); // empty tasks/ -> deriveNextKey will pick TASK-001

    const collisionPath = join(repoDir, 'tasks', 'TASK-001.json');

    let injected = false;
    fsp.readdir.mockImplementation(async (dir, ...rest) => {
      const real = await vi.importActual('node:fs/promises');
      const listing = await real.readdir(dir, ...rest);
      if (!injected && String(dir) === join(repoDir, 'tasks')) {
        injected = true;
        writeFileSync(collisionPath, JSON.stringify({ marker: 'written-by-concurrent-writer' }), 'utf8');
      }
      return listing;
    });

    let caught;
    try {
      await createTask({
        repoRoot: repoDir,
        title: 'Racer (typed-error variant)',
        description: 'Loses the race for TASK-001 to a concurrent writer.',
        acceptance_criteria: ['AC1'],
        priority: 'medium',
        now: () => '2026-07-04T00:00:00Z',
      });
    } catch (e) {
      caught = e;
    }

    expect(caught, 'createTask must throw on a derived-key collision').toBeDefined();
    expect(
      caught.code,
      'the thrown collision error must be TYPED (E_KEY_COLLISION), not a plain untyped Error',
    ).toBe('E_KEY_COLLISION');

    vi.doUnmock('node:fs/promises');
    vi.resetModules();
  });
});

describe('TASK-085 AC5(b) — createTask verify-after-write catches a post-rename collision', () => {
  it('create_task_throws_e_key_collision_when_a_competitor_write_lands_immediately_after_our_rename', async () => {
    vi.resetModules();

    const repoDir = makeTmpDir('af-ts85-verify-after-write');
    makeRepoSkeleton(repoDir, {});

    const expectedTaskPath = join(repoDir, 'tasks', 'TASK-001.json');

    // Mock node:fs's renameSync so that immediately after OUR rename lands
    // on the derived-key target, we simulate a COMPETITOR's createTask call
    // landing ITS rename a moment later — the residual TOCTOU window the
    // pre-write existsSync guard (AC4) cannot see, since at existsSync-check
    // time neither writer's file exists yet. A correct verify-after-write
    // step must catch this by re-reading the target and noticing its own
    // intended payload is no longer what's on disk.
    let injected = false;
    vi.doMock('node:fs', async (importOriginal) => {
      const real = await importOriginal();
      return {
        ...real,
        renameSync: (src, dest) => {
          const result = real.renameSync(src, dest);
          if (!injected && String(dest) === expectedTaskPath) {
            injected = true;
            real.writeFileSync(
              expectedTaskPath,
              JSON.stringify({ key: 'TASK-001', title: 'COMPETITOR WON THE RACE', marker: 'competitor' }, null, 2) + '\n',
              'utf8',
            );
          }
          return result;
        },
      };
    });

    const { createTask } = await import(PROD.taskStore);

    let caught;
    try {
      await createTask({
        repoRoot: repoDir,
        title: 'Ours - verify-after-write racer',
        description: 'A competitor writes over our target immediately after our rename.',
        acceptance_criteria: ['AC1'],
        priority: 'medium',
        now: () => '2026-07-04T00:00:00Z',
      });
    } catch (e) {
      caught = e;
    }

    expect(
      caught,
      'createTask must detect (via verify-after-write) that a competitor overwrote its target immediately after its own rename',
    ).toBeDefined();
    expect(caught.code).toBe('E_KEY_COLLISION');

    vi.doUnmock('node:fs');
    vi.resetModules();
  });
});

// ---------------------------------------------------------------------------
// AC5(c) — child-process contention race: two concurrent createTask calls,
// both racing to derive/claim TASK-001 against the same empty repoRoot,
// synchronized by a marker-file readiness barrier (no sleeps).
// ---------------------------------------------------------------------------

const CREATE_TASK_RACE_CHILD_SRC = `
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [, , repoRoot, holderId, resultsPath, syncDir, taskStorePath] = process.argv;

const { createTask } = await import(pathToFileURL(taskStorePath).href);

function spinUntilExists(p) {
  while (!existsSync(p)) {
    // tight synchronous poll — deterministic readiness barrier, no sleep
  }
}

const readyPath = join(syncDir, \`ready-\${holderId}\`);
const goPath = join(syncDir, 'go');

writeFileSync(readyPath, '1');
spinUntilExists(goPath);

let result;
try {
  const { key, path } = await createTask({
    repoRoot,
    title: \`Racer \${holderId}\`,
    description: \`Concurrent creator \${holderId}\`,
    acceptance_criteria: ['AC1'],
    priority: 'medium',
    now: () => new Date().toISOString(),
  });
  result = { holderId, created: true, key, path };
} catch (e) {
  result = { holderId, created: false, code: e && e.code, message: e && e.message };
}

writeFileSync(resultsPath, JSON.stringify(result));
`;

describe('TASK-085 AC5(c) — two concurrent createTask child processes race for the same derived key', () => {
  it('race_two_createTask_child_processes_exactly_one_winner', async () => {
    const repoDir = makeTmpDir('af-ts85-create-race-repo');
    makeRepoSkeleton(repoDir, {}); // empty tasks/ -> both children derive TASK-001
    const syncDir = makeTmpDir('af-ts85-create-race-sync');

    const childScriptPath = join(syncDir, 'create-task-race-child.mjs');
    writeFileSync(childScriptPath, CREATE_TASK_RACE_CHILD_SRC, 'utf8');

    const taskStorePath = fileURLToPath(PROD.taskStore);

    const resultsA = join(syncDir, 'result-A.json');
    const resultsB = join(syncDir, 'result-B.json');

    function spawnChild(holder, resultsPath) {
      return spawn(process.execPath, [
        childScriptPath, repoDir, holder, resultsPath, syncDir, taskStorePath,
      ]);
    }

    const childA = spawnChild('creator-A', resultsA);
    const childB = spawnChild('creator-B', resultsB);

    let stderrA = '';
    let stderrB = '';
    childA.stderr.on('data', (d) => { stderrA += d.toString(); });
    childB.stderr.on('data', (d) => { stderrB += d.toString(); });

    const readyA = join(syncDir, 'ready-creator-A');
    const readyB = join(syncDir, 'ready-creator-B');
    while (!existsSync(readyA) || !existsSync(readyB)) {
      // tight synchronous poll — no sleep-based coordination
    }
    writeFileSync(join(syncDir, 'go'), '1');

    const [codeA, codeB] = await Promise.all([
      new Promise((resolve) => childA.on('exit', (code) => resolve(code))),
      new Promise((resolve) => childB.on('exit', (code) => resolve(code))),
    ]);

    expect(codeA, `child A must exit 0. stderr:\n${stderrA}`).toBe(0);
    expect(codeB, `child B must exit 0. stderr:\n${stderrB}`).toBe(0);

    const a = JSON.parse(readFileSync(resultsA, 'utf8'));
    const b = JSON.parse(readFileSync(resultsB, 'utf8'));

    expect(
      a.created !== b.created,
      `exactly one concurrent createTask call must win the derived-key race (A created=${a.created}, B created=${b.created})`,
    ).toBe(true);

    const loser = a.created ? b : a;
    expect(
      loser.code,
      'the losing createTask call must throw a TYPED collision error (E_KEY_COLLISION)',
    ).toBe('E_KEY_COLLISION');
  }, 15000);
});
