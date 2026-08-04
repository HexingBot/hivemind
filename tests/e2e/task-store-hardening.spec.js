// tests/task-store-hardening.spec.js
// TASK-009 — task-store hardening (7 ACs accumulated from TASK-001, TASK-002,
// TASK-014 reviewer audits). Tests-first phase: every spec below is expected
// to FAIL until the IMPL dev lands the matching production change.
//
// Acceptance criteria covered (1:1):
//   AC1 verify_and_repair_index_*       (drift-detect-and-repair before listTodos returns stale data)
//   AC2 single_writer_assumption_comment(source-grep for the assumption note)
//   AC3 sweep_tasks_tmp_files_*         (orphan tasks/*.tmp.* sweeper + listTodos hook)
//   AC4 list_ready_excludes_blocked_*   (new listReady honors depends_on)
//   AC5 validate_before_write_*         (ajv schema validation BEFORE atomicWriteFiles)
//   AC6 numeric_sort_by_trailing_int    (TASK-999 before TASK-1000 in index + listTodos)
//   AC7 create_task_self_bootstraps_*   (createTask mkdirs tasks/; backlog-seeder workaround removed)

import { describe, it, expect, afterAll } from 'vitest';
import {
  readFileSync, writeFileSync, existsSync, readdirSync, statSync, rmSync, utimesSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PROD, makeRepoSkeleton } from '../helpers/fixtures.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';

afterAll(cleanupAll);

// ---------------------------------------------------------------------------
// Fixture loader, mirroring tests/task-store.spec.js and tests/new-task.spec.js.
// ---------------------------------------------------------------------------
const __thisDir = dirname(fileURLToPath(import.meta.url));
const __fixturesDir = join(__thisDir, '..', 'fixtures', 'tasks');
const __repoRoot = join(__thisDir, '..', '..');

function loadFixtureTask(key) {
  return JSON.parse(readFileSync(join(__fixturesDir, `${key}.json`), 'utf8'));
}
function loadFixtureTasks(keys) {
  const out = {};
  for (const k of keys) out[k] = loadFixtureTask(k);
  return out;
}
function readIndex(repoDir) {
  return JSON.parse(readFileSync(join(repoDir, 'tasks', 'index.json'), 'utf8'));
}
function readTaskFile(repoDir, key) {
  return JSON.parse(readFileSync(join(repoDir, 'tasks', `${key}.json`), 'utf8'));
}

// Build a synthetic task object on-the-fly (no fixture file required).
function buildTask(overrides = {}) {
  return {
    key: 'TASK-200',
    title: 'Synthetic task',
    description: 'Built inline by the hardening suite.',
    acceptance_criteria: ['Exists.'],
    status: 'todo',
    priority: 'medium',
    labels: [],
    assignee: null,
    depends_on: [],
    linked_commits: [],
    linked_prs: [],
    comments: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    jira_key: null,
    ...overrides,
  };
}

// ===========================================================================
// AC1 — atomicWriteFiles partial-commit window is covered by an automatic
//        drift-detect-and-repair path. Locked design: option B — a new
//        `verifyAndRepairIndex(repoRoot)` runs at the top of `listTodos` and
//        rewrites tasks/index.json from the per-task files (source of truth)
//        whenever the on-disk index disagrees with the file set.
// ===========================================================================
describe('AC1 — drift-detect-and-repair before listTodos', () => {
  it('verify_and_repair_index_rewrites_when_index_overcounts', async () => {
    // index.json claims two tickets exist, but only one is on disk. The
    // canonical answer is the file set — listTodos must filter to the file
    // set AND repair the index to match.
    const { listTodos } = await import(PROD.taskStore);

    const repoDir = makeTmpDir('af-ts9-drift-over');
    makeRepoSkeleton(repoDir, {
      tasks: loadFixtureTasks(['TASK-101']), // only TASK-101 exists on disk
    });
    // Lying index — references a TASK-102 that has no per-task file.
    writeFileSync(
      join(repoDir, 'tasks', 'index.json'),
      JSON.stringify({
        generated_at: '2000-01-01T00:00:00Z',
        tasks: [
          { key: 'TASK-101', title: 'Alpha', status: 'todo', priority: 'high' },
          { key: 'TASK-102', title: 'GHOST',  status: 'todo', priority: 'low' },
        ],
      }, null, 2),
      'utf8',
    );

    const result = await listTodos({ repoRoot: repoDir });

    // Only the on-disk ticket is listed (listTodos sources from files, not index).
    expect(result.map((t) => t.key)).toEqual(['TASK-101']);

    // Repair fired: the on-disk index now agrees with the file set.
    const idx = readIndex(repoDir);
    expect(idx.tasks.map((t) => t.key).sort()).toEqual(['TASK-101']);
    expect(idx.tasks.find((t) => t.key === 'TASK-102')).toBeUndefined();
    // generated_at must have advanced past the stale value.
    expect(idx.generated_at).not.toBe('2000-01-01T00:00:00Z');
  });

  it('verify_and_repair_index_rewrites_when_index_undercounts', async () => {
    // The inverse: two tickets exist on disk but the index lists only one.
    const { listTodos } = await import(PROD.taskStore);

    const repoDir = makeTmpDir('af-ts9-drift-under');
    makeRepoSkeleton(repoDir, {
      tasks: loadFixtureTasks(['TASK-101', 'TASK-103']),
    });
    writeFileSync(
      join(repoDir, 'tasks', 'index.json'),
      JSON.stringify({
        generated_at: '2000-01-01T00:00:00Z',
        tasks: [
          { key: 'TASK-101', title: 'Alpha', status: 'todo', priority: 'high' },
        ],
      }, null, 2),
      'utf8',
    );

    const result = await listTodos({ repoRoot: repoDir });
    // Both on-disk todos surface, regardless of what the stale index claimed.
    expect(result.map((t) => t.key).sort()).toEqual(['TASK-101', 'TASK-103']);

    // The index now reflects the full on-disk set.
    const idx = readIndex(repoDir);
    expect(idx.tasks.map((t) => t.key).sort()).toEqual(['TASK-101', 'TASK-103']);
    expect(idx.generated_at).not.toBe('2000-01-01T00:00:00Z');
  });

  it('verify_and_repair_index_no_churn_when_in_sync', async () => {
    // Happy path: index agrees with the file set byte-for-byte. listTodos
    // must NOT rewrite the index (no spurious churn — generated_at unchanged,
    // mtime unchanged would be even stricter, but we settle for generated_at).
    const { listTodos, createTask } = await import(PROD.taskStore);

    const repoDir = makeTmpDir('af-ts9-drift-clean');
    makeRepoSkeleton(repoDir, {});
    // Build the store via createTask so the index it produces is authoritative.
    await createTask({
      repoRoot: repoDir,
      title: 'Alpha clean',
      description: 'Authored via createTask so the index is in sync.',
      acceptance_criteria: ['AC1'],
      priority: 'medium',
      now: () => '2026-05-01T00:00:00Z',
    });

    const before = readIndex(repoDir);
    const beforeBytes = readFileSync(join(repoDir, 'tasks', 'index.json'), 'utf8');

    await listTodos({ repoRoot: repoDir });

    const after = readIndex(repoDir);
    const afterBytes = readFileSync(join(repoDir, 'tasks', 'index.json'), 'utf8');

    // generated_at is the cheapest "did the index rewrite?" canary.
    expect(after.generated_at).toBe(before.generated_at);
    // Byte-identical: no churn whatsoever on the happy path.
    expect(afterBytes).toBe(beforeBytes);
  });
});

// ===========================================================================
// AC2 — single-writer assumption is documented in the source. A future ticket
//        will lift this constraint; until then the assumption must be findable
//        with a substring grep so a multi-writer change can't quietly land.
// ===========================================================================
describe('AC2 — single-writer assumption is documented in source', () => {
  it('single_writer_assumption_comment_present', async () => {
    const srcPath = join(__repoRoot, 'src', 'task-store.js');
    const src = readFileSync(srcPath, 'utf8');
    // Case-insensitive substring search keeps the test stable across minor
    // copy edits ("single-writer", "Single writer", "SINGLE WRITER", etc.).
    expect(/single[\s-]?writer/i.test(src), 'src/task-store.js must contain a single-writer assumption comment').toBe(true);
  });
});

// ===========================================================================
// AC3 — orphan tasks/*.tmp.* files left by interrupted writes are reaped by a
//        new exported `sweepTasksTmpFiles({ repoRoot })`. Locked design: the
//        sweeper lives in src/task-store.js (task-scoped; recovery.js stays
//        bundle-scoped). The hook point is `listTodos` — every read trims
//        orphan tmps so a long-running orchestrator never accretes garbage.
// ===========================================================================
describe('AC3 — sweepTasksTmpFiles', () => {
  it('sweep_tasks_tmp_files_removes_orphans_and_preserves_canonicals', async () => {
    const mod = await import(PROD.taskStore);
    expect(
      typeof mod.sweepTasksTmpFiles,
      'task-store must export sweepTasksTmpFiles({ repoRoot })',
    ).toBe('function');

    const repoDir = makeTmpDir('af-ts9-sweep-shape');
    makeRepoSkeleton(repoDir, {
      tasks: loadFixtureTasks(['TASK-101', 'TASK-102']),
    });
    const tasksDir = join(repoDir, 'tasks');

    // Drop three orphan tmp files — the exact shape src/atomic-write.js writes.
    const orphans = [
      'TASK-001.json.tmp.12345-abcdef',
      'TASK-101.json.tmp.99999-bad000',
      'index.json.tmp.77777-cafe11',
    ];
    // TASK-083 AC3 backdates these past the sweep's mtime age-gate (~60s) —
    // otherwise a freshly-written tmp is indistinguishable from a genuine
    // in-flight write and the sweep must not touch it (see
    // tests/e2e/task-store-resilience.spec.js AC3 for the fresh-tmp-survives case).
    const staleAt = new Date(Date.now() - 5 * 60 * 1000);
    for (const name of orphans) {
      const p = join(tasksDir, name);
      writeFileSync(p, 'partial-write-bytes', 'utf8');
      utimesSync(p, staleAt, staleAt);
    }

    // Pre-sweep sanity: orphans + canonicals present.
    for (const name of orphans) {
      expect(existsSync(join(tasksDir, name)), `seed: ${name}`).toBe(true);
    }
    expect(existsSync(join(tasksDir, 'TASK-101.json'))).toBe(true);
    expect(existsSync(join(tasksDir, 'TASK-102.json'))).toBe(true);

    await mod.sweepTasksTmpFiles({ repoRoot: repoDir });

    // Every orphan is gone.
    for (const name of orphans) {
      expect(
        existsSync(join(tasksDir, name)),
        `orphan ${name} should be deleted by sweepTasksTmpFiles`,
      ).toBe(false);
    }
    // The legitimate task files survive untouched.
    expect(existsSync(join(tasksDir, 'TASK-101.json'))).toBe(true);
    expect(existsSync(join(tasksDir, 'TASK-102.json'))).toBe(true);
    // And the canonical content of TASK-101 was not mistakenly clobbered.
    expect(readTaskFile(repoDir, 'TASK-101').key).toBe('TASK-101');
  });

  it('sweep_tasks_tmp_files_handles_missing_tasks_dir', async () => {
    // A wiped or never-initialized repo must not throw — orphan sweep is a
    // best-effort housekeeping op.
    const { sweepTasksTmpFiles } = await import(PROD.taskStore);
    const repoDir = makeTmpDir('af-ts9-sweep-noent');
    // No makeRepoSkeleton — repo has no tasks/ at all.
    expect(existsSync(join(repoDir, 'tasks'))).toBe(false);
    await expect(sweepTasksTmpFiles({ repoRoot: repoDir })).resolves.toBeDefined();
  });

  it('list_todos_invokes_sweep_tasks_tmp_files', async () => {
    // Hook-point assertion: calling listTodos must transparently clean up
    // any orphan tmp files in tasks/. This is the orchestrator-start hook
    // promised by the AC text.
    const { listTodos } = await import(PROD.taskStore);

    const repoDir = makeTmpDir('af-ts9-sweep-hook');
    makeRepoSkeleton(repoDir, {
      tasks: loadFixtureTasks(['TASK-101']),
    });
    const tasksDir = join(repoDir, 'tasks');
    const orphan = join(tasksDir, 'TASK-101.json.tmp.55555-deadcafe');
    writeFileSync(orphan, 'half-written-bytes', 'utf8');
    // TASK-083 AC3 — backdate past the age-gate so the sweep treats this as a
    // genuine crash orphan rather than a possibly in-flight write.
    const staleAt = new Date(Date.now() - 5 * 60 * 1000);
    utimesSync(orphan, staleAt, staleAt);
    expect(existsSync(orphan)).toBe(true);

    await listTodos({ repoRoot: repoDir });

    expect(
      existsSync(orphan),
      'listTodos must call sweepTasksTmpFiles so orchestrator-start cleans orphans',
    ).toBe(false);
  });
});

// ===========================================================================
// AC4 — `listReady` excludes tasks whose depends_on dependencies are not yet
//        `done`. `listTodos` keeps its raw status-filter semantics (so existing
//        tests/task-store.spec.js still pass).
// ===========================================================================
describe('AC4 — listReady honors depends_on', () => {
  it('list_ready_excludes_tasks_with_unsatisfied_deps', async () => {
    const mod = await import(PROD.taskStore);
    expect(
      typeof mod.listReady,
      'task-store must export listReady({ repoRoot })',
    ).toBe('function');

    const repoDir = makeTmpDir('af-ts9-ready-blocked');
    makeRepoSkeleton(repoDir, {
      tasks: {
        'TASK-201': buildTask({ key: 'TASK-201', status: 'todo', depends_on: [] }),
        'TASK-202': buildTask({ key: 'TASK-202', status: 'todo', depends_on: ['TASK-201'] }),
        'TASK-203': buildTask({ key: 'TASK-203', status: 'done', depends_on: [] }),
      },
    });

    // Sanity: vanilla listTodos returns both TODOs regardless of deps.
    const todos = await mod.listTodos({ repoRoot: repoDir });
    expect(todos.map((t) => t.key).sort()).toEqual(['TASK-201', 'TASK-202']);

    // listReady excludes TASK-202 because TASK-201 (its dep) is not done.
    const ready = await mod.listReady({ repoRoot: repoDir });
    expect(ready.map((t) => t.key)).toEqual(['TASK-201']);
  });

  it('list_ready_unblocks_after_dep_transitions_to_done', async () => {
    const { listReady, transitionStatus } = await import(PROD.taskStore);

    const repoDir = makeTmpDir('af-ts9-ready-unblock');
    makeRepoSkeleton(repoDir, {
      tasks: {
        'TASK-201': buildTask({ key: 'TASK-201', status: 'todo', depends_on: [] }),
        'TASK-202': buildTask({ key: 'TASK-202', status: 'todo', depends_on: ['TASK-201'] }),
      },
    });

    let ready = await listReady({ repoRoot: repoDir });
    expect(ready.map((t) => t.key)).toEqual(['TASK-201']);

    // TASK-187 AC6 — this test's subject is listReady's dependency-unblock
    // logic, not the AC2/AC3 close preconditions; the escape hatch keeps the
    // fixture minimal instead of fabricating an unrelated review trail.
    await transitionStatus({
      repoRoot: repoDir,
      key: 'TASK-201',
      status: 'done',
      now: () => '2026-06-01T00:00:00Z',
      exception: { reason: 'AC4 listReady dependency-unblock fixture — unrelated to review evidence.' },
    });

    ready = await listReady({ repoRoot: repoDir });
    // Once the dep is done, TASK-202 surfaces (TASK-201 is no longer status=todo).
    expect(ready.map((t) => t.key)).toEqual(['TASK-202']);
  });

  // TASK-107 (L1) — a depends_on entry that points at a non-existent task key
  // used to be silently treated as "unsatisfied" (ready excluded the task with
  // no signal why). That is the same silent-stranding class TASK-096 fixed in
  // drive-loop's depsAreDone (which throws naming the ticket and the missing
  // dep). listReady is now aligned: it throws a typed DanglingDependencyError
  // naming both the stranded ticket and the dangling depends_on key, instead
  // of letting the ticket vanish from list_ready with zero signal.
  it('list_ready_throws_on_dangling_depends_on', async () => {
    const { listReady, DanglingDependencyError } = await import(PROD.taskStore);

    const repoDir = makeTmpDir('af-ts9-ready-missing-dep');
    makeRepoSkeleton(repoDir, {
      tasks: {
        'TASK-201': buildTask({ key: 'TASK-201', status: 'todo', depends_on: ['TASK-999'] }),
      },
    });

    let caught;
    try {
      await listReady({ repoRoot: repoDir });
    } catch (err) {
      caught = err;
    }
    expect(caught, 'listReady must throw rather than silently omit the stranded ticket').toBeDefined();
    expect(caught).toBeInstanceOf(DanglingDependencyError);
    expect(caught.message).toContain('TASK-201');
    expect(caught.message).toContain('TASK-999');
  });

  it('list_ready_still_lists_a_valid_dependency_graph_correctly', async () => {
    // Regression lock: a legitimate graph (satisfied dep + a genuinely
    // pending dep, no dangling keys) must NOT trip the new loud-throw path.
    const { listReady } = await import(PROD.taskStore);

    const repoDir = makeTmpDir('af-ts9-ready-valid-graph');
    makeRepoSkeleton(repoDir, {
      tasks: {
        'TASK-301': buildTask({ key: 'TASK-301', status: 'done', depends_on: [] }),
        'TASK-302': buildTask({ key: 'TASK-302', status: 'todo', depends_on: ['TASK-301'] }),
        'TASK-303': buildTask({ key: 'TASK-303', status: 'todo', depends_on: ['TASK-302'] }),
      },
    });

    const ready = await listReady({ repoRoot: repoDir });
    // TASK-302's dep (TASK-301) is done -> ready. TASK-303's dep (TASK-302) is
    // still todo -> excluded, but must not throw (a pending-but-real dep is a
    // normal in-progress case, not a dangling reference).
    expect(ready.map((t) => t.key)).toEqual(['TASK-302']);
  });
});

// ===========================================================================
// AC5 — Writes via transitionStatus, appendComment, createTask validate the
//        resulting payload against tasks/schema.json BEFORE the atomic write.
//        Invalid payload throws; on-disk bytes unchanged.
//
//        We force an invalid payload by passing a `now` that returns a string
//        the schema's `format: "date-time"` will reject. The thrown error's
//        message must reference the ajv-stable phrase `must match format`.
// ===========================================================================
describe('AC5 — ajv validation before write', () => {
  const BAD_NOW = () => 'definitely-not-an-iso-datetime';
  const FORMAT_RE = /must match format/i;

  it('transition_status_validates_before_write', async () => {
    const { transitionStatus } = await import(PROD.taskStore);

    const repoDir = makeTmpDir('af-ts9-validate-transition');
    makeRepoSkeleton(repoDir, {
      tasks: loadFixtureTasks(['TASK-101']),
    });
    const taskPath = join(repoDir, 'tasks', 'TASK-101.json');
    const beforeBytes = readFileSync(taskPath, 'utf8');
    const beforeFiles = readdirSync(join(repoDir, 'tasks')).sort();

    await expect(
      transitionStatus({
        repoRoot: repoDir,
        key: 'TASK-101',
        status: 'in_progress',
        now: BAD_NOW,
      }),
    ).rejects.toThrow(FORMAT_RE);

    // No partial write of the task file.
    expect(readFileSync(taskPath, 'utf8')).toBe(beforeBytes);
    // No new orphan tmp files left behind either (validation runs BEFORE the
    // atomic-write opens any tmp fd).
    const afterFiles = readdirSync(join(repoDir, 'tasks')).sort();
    expect(afterFiles).toEqual(beforeFiles);
  });

  it('append_comment_validates_before_write', async () => {
    const { appendComment } = await import(PROD.taskStore);

    const repoDir = makeTmpDir('af-ts9-validate-comment');
    makeRepoSkeleton(repoDir, {
      tasks: loadFixtureTasks(['TASK-101']),
    });
    const taskPath = join(repoDir, 'tasks', 'TASK-101.json');
    const beforeBytes = readFileSync(taskPath, 'utf8');
    const beforeFiles = readdirSync(join(repoDir, 'tasks')).sort();

    await expect(
      appendComment({
        repoRoot: repoDir,
        key: 'TASK-101',
        author: 'developer',
        body: 'note',
        now: BAD_NOW,
      }),
    ).rejects.toThrow(FORMAT_RE);

    expect(readFileSync(taskPath, 'utf8')).toBe(beforeBytes);
    const afterFiles = readdirSync(join(repoDir, 'tasks')).sort();
    expect(afterFiles).toEqual(beforeFiles);
  });

  it('create_task_validates_before_write', async () => {
    const { createTask } = await import(PROD.taskStore);

    const repoDir = makeTmpDir('af-ts9-validate-create');
    makeRepoSkeleton(repoDir, {
      tasks: loadFixtureTasks(['TASK-101']),
    });
    const beforeFiles = readdirSync(join(repoDir, 'tasks')).sort();

    await expect(
      createTask({
        repoRoot: repoDir,
        title: 'New task with bad timestamp',
        description: 'Payload will fail the date-time format check.',
        acceptance_criteria: ['AC1'],
        priority: 'medium',
        now: BAD_NOW,
      }),
    ).rejects.toThrow(FORMAT_RE);

    // No new task file was created and no orphan tmp files survive.
    const afterFiles = readdirSync(join(repoDir, 'tasks')).sort();
    expect(afterFiles).toEqual(beforeFiles);
  });
});

// ===========================================================================
// AC6 — numeric sort by the trailing integer of the key. Lexical sort places
//        'TASK-1000' between 'TASK-100' and 'TASK-101' (because '1' < '9').
//        Fix: compare parseInt(key.slice(5),10).
// ===========================================================================
describe('AC6 — numeric key sort across the 999 -> 1000 boundary', () => {
  it('list_todos_sorts_by_numeric_suffix', async () => {
    const { listTodos } = await import(PROD.taskStore);

    const repoDir = makeTmpDir('af-ts9-num-sort-list');
    makeRepoSkeleton(repoDir, {
      tasks: {
        // Build three tasks straddling the padding boundary.
        'TASK-001':  buildTask({ key: 'TASK-001',  status: 'todo' }),
        'TASK-999':  buildTask({ key: 'TASK-999',  status: 'todo' }),
        'TASK-1000': buildTask({ key: 'TASK-1000', status: 'todo' }),
      },
    });

    const result = await listTodos({ repoRoot: repoDir });
    // The lexical comparator currently in src/task-store.js orders these as
    // ['TASK-001', 'TASK-1000', 'TASK-999']. The fix must put 999 BEFORE 1000.
    expect(result.map((t) => t.key)).toEqual(['TASK-001', 'TASK-999', 'TASK-1000']);
  });

  it('build_index_sorts_by_numeric_suffix', async () => {
    // We can't call buildIndexBytes directly (it's an internal helper), so we
    // exercise it through transitionStatus — which triggers a full index
    // regeneration.
    const { transitionStatus } = await import(PROD.taskStore);

    const repoDir = makeTmpDir('af-ts9-num-sort-index');
    makeRepoSkeleton(repoDir, {
      tasks: {
        'TASK-001':  buildTask({ key: 'TASK-001',  status: 'todo' }),
        'TASK-999':  buildTask({ key: 'TASK-999',  status: 'todo' }),
        'TASK-1000': buildTask({ key: 'TASK-1000', status: 'todo' }),
      },
    });

    await transitionStatus({
      repoRoot: repoDir,
      key: 'TASK-001',
      status: 'in_progress',
      now: () => '2026-05-01T00:00:00Z',
    });

    const idx = readIndex(repoDir);
    const idxKeys = idx.tasks.map((t) => t.key);
    // Index must list them in numeric order, not lex order.
    expect(idxKeys).toEqual(['TASK-001', 'TASK-999', 'TASK-1000']);
  });
});

// ===========================================================================
// AC7 — createTask self-bootstraps tasks/ via mkdirSync(..., {recursive:true})
//        so callers on a fresh repo (no prior task store) don't ENOENT on the
//        sibling tmp file. The workaround mkdirSync in src/backlog-seeder.js
//        is dropped once this lands.
// ===========================================================================
describe('AC7 — createTask self-bootstraps tasks/', () => {
  it('create_task_bootstraps_tasks_dir_on_fresh_repo', async () => {
    const { createTask } = await import(PROD.taskStore);

    // Bare tmp dir — NO tasks/ subdir, no state/ subdir, nothing.
    const repoDir = makeTmpDir('af-ts9-bootstrap');
    expect(existsSync(join(repoDir, 'tasks'))).toBe(false);

    const { key, path } = await createTask({
      repoRoot: repoDir,
      title: 'First ticket on a virgin repo',
      description: 'createTask must mkdir tasks/ before writing.',
      acceptance_criteria: ['AC1'],
      priority: 'medium',
      now: () => '2026-05-01T00:00:00Z',
    });

    // First key in an empty store is TASK-001.
    expect(key).toBe('TASK-001');
    expect(existsSync(path)).toBe(true);
    // tasks/ now exists and contains the ticket + the regenerated index.
    expect(existsSync(join(repoDir, 'tasks'))).toBe(true);
    expect(existsSync(join(repoDir, 'tasks', 'TASK-001.json'))).toBe(true);
    expect(existsSync(join(repoDir, 'tasks', 'index.json'))).toBe(true);
  });

  it('backlog_seeder_no_longer_mkdirs_tasks', async () => {
    // The workaround mkdir at src/backlog-seeder.js:313 must be removed once
    // AC7 lands. We grep the source for any mkdirSync call that targets a
    // path containing 'tasks' so a future regression (e.g. recreating the
    // workaround) trips the test.
    const seederPath = join(__repoRoot, 'src', 'backlog-seeder.js');
    const src = readFileSync(seederPath, 'utf8');

    // Allow `mkdirSync` to remain imported / used elsewhere, but it must not
    // be applied to the tasks directory.
    const offendingPatterns = [
      /mkdirSync\s*\(\s*join\s*\(\s*repoRoot\s*,\s*['"]tasks['"]/,
      /mkdirSync\s*\(\s*[^)]*['"]tasks['"][^)]*\)/,
    ];
    for (const pat of offendingPatterns) {
      expect(
        pat.test(src),
        `src/backlog-seeder.js still contains a mkdirSync against tasks/ — drop the workaround per AC7 (pattern: ${pat})`,
      ).toBe(false);
    }
  });
});
