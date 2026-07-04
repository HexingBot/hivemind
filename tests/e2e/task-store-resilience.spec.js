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
// check-before-write — the existsSync() check and the eventual write are NOT
// atomic with each other, so a second concurrent writer can still slip in
// between them and get silently clobbered. Hardenings required:
//   (a) The thrown collision error must be TYPED (`.code === 'E_KEY_COLLISION'`)
//       rather than a plain untyped Error, so callers can distinguish this
//       failure mode programmatically.
//   (b) createTask must verify-after-write: re-read the derived-key target
//       after writing it and compare it to the payload it intended to write;
//       a mismatch (someone else's payload is what's actually there) must
//       throw the same typed E_KEY_COLLISION error. NOTE (post fresh-context
//       review, HIGH fix): createTask's collision guard is now an O_CREAT|
//       O_EXCL reservation directly against the derived-key path, and the
//       FULL validated payload is written through that SAME reserved fd
//       (write+fsync+close) — there is no separate tmp+rename step for the
//       task file anymore (closing the observable zero-byte-file window a
//       tmp+rename-based reservation left open). A LEGITIMATE second
//       createTask call can therefore never reach "after" our write anymore
//       (it fails EEXIST at the reservation step, see AC5(a)) — verify-after-
//       write is retained purely as belt-and-braces against a ROGUE direct
//       mutation of the file landing in the window between our write and our
//       own re-read (see AC5(b) below, which now mocks that fd-write window
//       instead of renameSync).
//   (c) The observable, black-box contract of (a)+(b): two concurrent
//       `node` CHILD PROCESSES both calling createTask against the same
//       empty repoRoot must not both claim the SAME key — see AC5(c) below
//       for the exact (post fresh-context-review) invariant.
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

describe('TASK-085 AC5(b) — createTask verify-after-write catches a rogue post-write mutation', () => {
  it('create_task_throws_e_key_collision_when_the_reserved_task_file_is_overwritten_immediately_after_our_write', async () => {
    vi.resetModules();

    const repoDir = makeTmpDir('af-ts85-verify-after-write');
    makeRepoSkeleton(repoDir, {});

    const expectedTaskPath = join(repoDir, 'tasks', 'TASK-001.json');

    // POST fresh-context-review (HIGH fix) design: createTask no longer
    // writes the task file via a separate tmp+rename — it writes the FULL
    // validated payload directly through the O_CREAT|O_EXCL-reserved fd
    // (write+fsync+close), so there is no renameSync call to mock for this
    // path anymore. A LEGITIMATE second createTask call can never reach
    // "after" our write (it fails EEXIST at the reservation step — see
    // AC5(a)/(c)), so this spec instead simulates the ONE residual scenario
    // verify-after-write still guards: a ROGUE direct mutation of the
    // just-created file landing in the tiny window between our write and our
    // own re-read. We mock openSync (to capture which fd corresponds to our
    // target path) + fsyncSync (called immediately after our real bytes are
    // written, right before we close and re-read) to inject that mutation at
    // exactly that point — the closest equivalent of the retired
    // "immediately after our rename" injection point for the new no-rename
    // design.
    let injected = false;
    let reservedFd = null;
    vi.doMock('node:fs', async (importOriginal) => {
      const real = await importOriginal();
      return {
        ...real,
        openSync: (path, flags, mode) => {
          const fd = real.openSync(path, flags, mode);
          if (String(path) === expectedTaskPath) reservedFd = fd;
          return fd;
        },
        fsyncSync: (fd) => {
          const result = real.fsyncSync(fd);
          if (!injected && fd === reservedFd) {
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
        description: 'A rogue direct mutation lands on our reserved task file immediately after our own write.',
        acceptance_criteria: ['AC1'],
        priority: 'medium',
        now: () => '2026-07-04T00:00:00Z',
      });
    } catch (e) {
      caught = e;
    }

    expect(
      caught,
      'createTask must detect (via verify-after-write) that its just-written task file was mutated immediately afterward',
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

    // TASK-085 fresh-context review HIGH-2 — "exactly one winner" is NOT the
    // universal invariant: a loser whose derive+claim attempt happens to run
    // entirely AFTER the winner's write has already landed will legitimately
    // see TASK-001 taken and derive TASK-002 instead — same title never means
    // same key forever, and both writers succeeding on DISTINCT keys is
    // correct store semantics, not a race bug. The real, always-true
    // invariant across every possible interleaving is:
    //   - EITHER both succeed, with DISTINCT keys, both task files present
    //     and intact, and index.json consistent with both;
    //   - OR exactly one succeeds and the other throws the TYPED
    //     E_KEY_COLLISION error;
    //   - NEVER two writers landing on the SAME key both "succeeding" (data
    //     loss/silent-clobber), and NEVER an untyped/unexpected failure.
    if (a.created && b.created) {
      expect(
        a.key,
        'two concurrent createTask calls that BOTH succeed must never claim the same key',
      ).not.toBe(b.key);
      expect(existsSync(a.path), `winner A's task file ${a.path} must exist`).toBe(true);
      expect(existsSync(b.path), `winner B's task file ${b.path} must exist`).toBe(true);
      const taskA = JSON.parse(readFileSync(a.path, 'utf8'));
      const taskB = JSON.parse(readFileSync(b.path, 'utf8'));
      expect(taskA.key).toBe(a.key);
      expect(taskB.key).toBe(b.key);
      const idx = JSON.parse(readFileSync(join(repoDir, 'tasks', 'index.json'), 'utf8'));
      expect(idx.tasks.map((t) => t.key).sort()).toEqual([a.key, b.key].sort());
    } else if (a.created !== b.created) {
      const loser = a.created ? b : a;
      const winner = a.created ? a : b;
      expect(
        loser.code,
        `the losing createTask call must throw a TYPED collision error (E_KEY_COLLISION); got code=${loser.code} message=${loser.message}`,
      ).toBe('E_KEY_COLLISION');
      expect(existsSync(winner.path), `winner's task file ${winner.path} must exist`).toBe(true);
    } else {
      // Both failed — never a legitimate outcome (the loser of a SAME-key
      // race always has a winner on the other side).
      throw new Error(
        `neither concurrent createTask call succeeded — A: code=${a.code} message=${a.message}; `
        + `B: code=${b.code} message=${b.message}`,
      );
    }

    // Never an untyped error on either side, regardless of which branch above fired.
    if (!a.created) expect(a.code, `A's failure must be typed E_KEY_COLLISION, got ${JSON.stringify(a)}`).toBe('E_KEY_COLLISION');
    if (!b.created) expect(b.code, `B's failure must be typed E_KEY_COLLISION, got ${JSON.stringify(b)}`).toBe('E_KEY_COLLISION');
  }, 15000);
});

// ===========================================================================
// TASK-085 fresh-context review HIGH — createTask's O_CREAT|O_EXCL
// reservation on the derived-key task file leaves a µs-scale window (between
// openSync succeeding and writeSync landing the real payload) where the
// target holds ZERO bytes; a crash exactly then leaves it that way forever.
// Two independent defenses, each covered by its own minimal spec:
//   - readAllTasks (exercised via listTodos) must SKIP a zero-byte task file
//     rather than throwing an untyped SyntaxError out of JSON.parse('').
//   - sweepTasksTmpFiles must reap a STALE (>60s) zero-byte task file (crash
//     orphan) while preserving a FRESH one (may be another writer's in-flight
//     reservation) — mirrors the existing tmp-file age-gate exactly.
// Neither spec touches non-empty corrupt JSON handling, which is unchanged
// (still throws — see tests/e2e/task-018-corruption-policy.spec.js's locked
// policy).
// ===========================================================================
describe('TASK-085 HIGH — readAllTasks skips a zero-byte task file', () => {
  it('list_todos_skips_zero_byte_task_file_without_throwing', async () => {
    const { listTodos } = await import(PROD.taskStore);

    const repoDir = makeTmpDir('af-ts85-zerobyte-reader');
    makeRepoSkeleton(repoDir, {
      tasks: loadFixtureTasks(['TASK-101']),
    });
    const tasksDir = join(repoDir, 'tasks');

    // A zero-byte task file — the observable createTask reservation window
    // (or a crash orphan of it), NOT corruption.
    writeFileSync(join(tasksDir, 'TASK-102.json'), '', 'utf8');

    const result = await listTodos({ repoRoot: repoDir });

    // Must not throw, and the zero-byte file must be silently excluded —
    // only the genuinely populated TASK-101 surfaces.
    expect(result.map((t) => t.key)).toEqual(['TASK-101']);
  });
});

describe('TASK-085 HIGH — sweepTasksTmpFiles age-gates zero-byte task files', () => {
  it('sweep_preserves_fresh_zero_byte_task_file_but_reaps_stale_one', async () => {
    const { sweepTasksTmpFiles } = await import(PROD.taskStore);

    const repoDir = makeTmpDir('af-ts85-zerobyte-sweep');
    makeRepoSkeleton(repoDir, {
      tasks: loadFixtureTasks(['TASK-101']),
    });
    const tasksDir = join(repoDir, 'tasks');

    // Fresh zero-byte task file — mtime is "now", simulating a writer that is
    // mid-way through createTask's exclusive-create reservation window.
    const freshZeroByte = join(tasksDir, 'TASK-102.json');
    writeFileSync(freshZeroByte, '', 'utf8');

    // Stale zero-byte task file — backdated well past the age-gate threshold,
    // simulating a genuine crash orphan from a prior process.
    const staleZeroByte = join(tasksDir, 'TASK-103.json');
    writeFileSync(staleZeroByte, '', 'utf8');
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    utimesSync(staleZeroByte, fiveMinutesAgo, fiveMinutesAgo);

    await sweepTasksTmpFiles({ repoRoot: repoDir });

    expect(
      existsSync(freshZeroByte),
      'a fresh (just-created) zero-byte task file must survive the sweep — it may be an in-flight reservation',
    ).toBe(true);
    expect(
      existsSync(staleZeroByte),
      'a stale (>60s old) zero-byte task file must still be reaped as a crash orphan',
    ).toBe(false);
    // The legitimate, populated task file survives untouched either way.
    expect(existsSync(join(tasksDir, 'TASK-101.json'))).toBe(true);
  });
});
