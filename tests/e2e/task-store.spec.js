// tests/task-store.spec.js
// TASK-001 — local task store adapter.
// Acceptance criteria covered (1:1):
//   AC1 list_todos_*                   (listTodos returns status=='todo', sorted by key, sourced from per-task files)
//   AC2 transition_status_*            (updates status + updated_at, validates enum, atomic write)
//   AC3 append_comment_*               (pushes well-formed {author, at, body}, preserves existing comments)
//   AC4 *_regenerates_index            (tasks/index.json is regenerated after every write)
//   ATOMIC writes_go_through_atomic_write (vi.mock('node:fs') confirms temp+rename invariant)

import { describe, it, expect, vi, afterEach, afterAll } from 'vitest';
import {
  readFileSync, writeFileSync, existsSync, readdirSync, statSync,
  mkdirSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PROD, makeRepoSkeleton } from '../helpers/fixtures.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';

afterAll(cleanupAll);

// ---------------------------------------------------------------------------
// Fixture loader. Per-task JSON lives at tests/fixtures/tasks/*.json so the
// payloads stay diffable and reusable across suites. Tests pass them through
// makeRepoSkeleton({tasks}) which writes them under the tmp repo's tasks/.
// ---------------------------------------------------------------------------
const __thisDir = dirname(fileURLToPath(import.meta.url));
const __fixturesDir = join(__thisDir, '..', 'fixtures', 'tasks');

function loadFixtureTask(key) {
  const payload = JSON.parse(
    readFileSync(join(__fixturesDir, `${key}.json`), 'utf8'),
  );
  return payload;
}

function loadFixtureTasks(keys) {
  const out = {};
  for (const k of keys) out[k] = loadFixtureTask(k);
  return out;
}

function readTaskFile(repoDir, key) {
  return JSON.parse(readFileSync(join(repoDir, 'tasks', `${key}.json`), 'utf8'));
}

function readIndex(repoDir) {
  return JSON.parse(readFileSync(join(repoDir, 'tasks', 'index.json'), 'utf8'));
}

// ===========================================================================
// AC1 — listTodos returns only status=='todo', sorted by key, sourced from
//        per-task files (never from index.json).
// ===========================================================================
describe('AC1 — listTodos', () => {
  it('list_todos_returns_only_status_todo', async () => {
    const { listTodos } = await import(PROD.taskStore);

    const repoDir = makeTmpDir('af-ts-list-todos');
    makeRepoSkeleton(repoDir, {
      tasks: loadFixtureTasks(['TASK-101', 'TASK-102', 'TASK-103', 'TASK-104']),
    });

    const result = await listTodos({ repoRoot: repoDir });

    expect(Array.isArray(result)).toBe(true);
    const keys = result.map((t) => t.key);
    // Only the two todos, sorted ascending by key.
    expect(keys).toEqual(['TASK-101', 'TASK-103']);
    for (const task of result) {
      expect(task.status).toBe('todo');
    }
    // Sanity: returned payloads carry the headline fields the orchestrator
    // needs to make a planning decision without a second file read.
    const first = result[0];
    expect(first.title).toBe('Alpha todo task');
    expect(first.priority).toBe('high');
  });

  it('list_todos_empty_store', async () => {
    const { listTodos } = await import(PROD.taskStore);

    const repoDir = makeTmpDir('af-ts-list-empty');
    // makeRepoSkeleton creates an empty tasks/ when no tasks are passed.
    makeRepoSkeleton(repoDir, {});

    const result = await listTodos({ repoRoot: repoDir });
    expect(result).toEqual([]);
  });

  it('list_todos_ignores_index_json', async () => {
    // Even when index.json is missing OR stale, listTodos must derive its
    // answer from the per-task files. This is what makes index.json safely
    // regenerable.
    const { listTodos } = await import(PROD.taskStore);

    const repoDir = makeTmpDir('af-ts-list-ignores-index');
    makeRepoSkeleton(repoDir, {
      tasks: loadFixtureTasks(['TASK-101', 'TASK-102', 'TASK-103', 'TASK-104']),
    });

    // Write a deliberately stale + lying index.json. If listTodos reads from
    // it, the test will catch us by returning the wrong shape/keys.
    writeFileSync(
      join(repoDir, 'tasks', 'index.json'),
      JSON.stringify({
        generated_at: '2000-01-01T00:00:00Z',
        tasks: [
          // Wrong statuses on purpose: claim 101 is done and 104 is todo.
          { key: 'TASK-101', title: 'lies', status: 'done', priority: 'high' },
          { key: 'TASK-104', title: 'lies', status: 'todo', priority: 'medium' },
        ],
      }, null, 2),
      'utf8',
    );

    const result = await listTodos({ repoRoot: repoDir });
    expect(result.map((t) => t.key)).toEqual(['TASK-101', 'TASK-103']);
    // 104 must not appear (its on-disk status is 'done') even though the
    // stale index lies.
    expect(result.find((t) => t.key === 'TASK-104')).toBeUndefined();

    // And the same holds when index.json is missing outright.
    const repoDir2 = makeTmpDir('af-ts-list-no-index');
    makeRepoSkeleton(repoDir2, {
      tasks: loadFixtureTasks(['TASK-101', 'TASK-102']),
    });
    expect(existsSync(join(repoDir2, 'tasks', 'index.json'))).toBe(false);

    const result2 = await listTodos({ repoRoot: repoDir2 });
    expect(result2.map((t) => t.key)).toEqual(['TASK-101']);
  });
});

// ===========================================================================
// AC2 — transitionStatus writes new status, bumps updated_at, validates the
//        enum, errors on unknown key, and never leaves partial writes.
// ===========================================================================
describe('AC2 — transitionStatus', () => {
  it('transition_status_writes_new_status_and_bumps_updated_at', async () => {
    const { transitionStatus } = await import(PROD.taskStore);

    const repoDir = makeTmpDir('af-ts-transition-happy');
    makeRepoSkeleton(repoDir, {
      tasks: loadFixtureTasks(['TASK-101']),
    });

    const before = readTaskFile(repoDir, 'TASK-101');
    expect(before.status).toBe('todo');
    const fixedNow = '2026-06-15T12:34:56Z';

    await transitionStatus({
      repoRoot: repoDir,
      key: 'TASK-101',
      status: 'in_progress',
      now: () => fixedNow,
    });

    const after = readTaskFile(repoDir, 'TASK-101');
    expect(after.status).toBe('in_progress');
    expect(after.updated_at).toBe(fixedNow);
    // Nothing else about the payload should mutate.
    expect(after.key).toBe(before.key);
    expect(after.title).toBe(before.title);
    expect(after.created_at).toBe(before.created_at);
  });

  it('transition_status_rejects_invalid_status', async () => {
    const { transitionStatus } = await import(PROD.taskStore);

    const repoDir = makeTmpDir('af-ts-transition-bad-status');
    makeRepoSkeleton(repoDir, {
      tasks: loadFixtureTasks(['TASK-101']),
    });
    const beforeBytes = readFileSync(
      join(repoDir, 'tasks', 'TASK-101.json'),
      'utf8',
    );

    await expect(
      transitionStatus({
        repoRoot: repoDir,
        key: 'TASK-101',
        status: 'bogus',
        now: () => '2026-06-15T12:34:56Z',
      }),
    ).rejects.toThrow(/status/i);

    // File on disk must be byte-identical — no partial write.
    const afterBytes = readFileSync(
      join(repoDir, 'tasks', 'TASK-101.json'),
      'utf8',
    );
    expect(afterBytes).toBe(beforeBytes);
  });

  it('transition_status_rejects_unknown_key', async () => {
    const { transitionStatus } = await import(PROD.taskStore);

    const repoDir = makeTmpDir('af-ts-transition-unknown');
    makeRepoSkeleton(repoDir, {
      tasks: loadFixtureTasks(['TASK-101']),
    });

    const beforeFiles = readdirSync(join(repoDir, 'tasks')).sort();

    await expect(
      transitionStatus({
        repoRoot: repoDir,
        key: 'TASK-999',
        status: 'in_progress',
        now: () => '2026-06-15T12:34:56Z',
      }),
    ).rejects.toThrow(/TASK-999/);

    // No new task file or partial write created.
    const afterFiles = readdirSync(join(repoDir, 'tasks')).sort();
    expect(afterFiles).toEqual(beforeFiles);
    // The existing task is untouched.
    expect(readTaskFile(repoDir, 'TASK-101').status).toBe('todo');
  });

  it('transition_status_regenerates_index_after_write', async () => {
    const { transitionStatus } = await import(PROD.taskStore);

    const repoDir = makeTmpDir('af-ts-transition-index');
    makeRepoSkeleton(repoDir, {
      tasks: loadFixtureTasks(['TASK-101', 'TASK-102', 'TASK-103', 'TASK-104']),
    });
    // Seed an obviously-stale index so we can detect it has been refreshed.
    const staleGen = '2000-01-01T00:00:00Z';
    writeFileSync(
      join(repoDir, 'tasks', 'index.json'),
      JSON.stringify({
        generated_at: staleGen,
        tasks: [
          { key: 'TASK-101', title: 'stale', status: 'todo', priority: 'high' },
        ],
      }, null, 2),
      'utf8',
    );

    const fixedNow = '2026-07-01T09:00:00Z';
    await transitionStatus({
      repoRoot: repoDir,
      key: 'TASK-101',
      status: 'in_progress',
      now: () => fixedNow,
    });

    const idx = readIndex(repoDir);
    // generated_at must advance past the stale value.
    expect(idx.generated_at).not.toBe(staleGen);
    expect(new Date(idx.generated_at).getTime())
      .toBeGreaterThan(new Date(staleGen).getTime());

    // Index must list ALL four tasks, not just the one we touched.
    const idxKeys = idx.tasks.map((t) => t.key).sort();
    expect(idxKeys).toEqual(['TASK-101', 'TASK-102', 'TASK-103', 'TASK-104']);

    // The transitioned task's index entry must reflect the new status.
    const entry = idx.tasks.find((t) => t.key === 'TASK-101');
    expect(entry).toBeDefined();
    expect(entry.status).toBe('in_progress');
  });
});

// ===========================================================================
// AC3 — appendComment pushes well-formed comment, preserves existing comments,
//        bumps updated_at, regenerates index.
// ===========================================================================
describe('AC3 — appendComment', () => {
  it('append_comment_pushes_well_formed_object', async () => {
    const { appendComment } = await import(PROD.taskStore);

    const repoDir = makeTmpDir('af-ts-comment-shape');
    makeRepoSkeleton(repoDir, {
      tasks: loadFixtureTasks(['TASK-101']),
    });

    const fixedNow = '2026-08-10T15:00:00Z';
    await appendComment({
      repoRoot: repoDir,
      key: 'TASK-101',
      author: 'developer',
      body: '## heading\n\nMarkdown body with **bold**.',
      now: () => fixedNow,
    });

    const after = readTaskFile(repoDir, 'TASK-101');
    expect(after.comments).toHaveLength(1);
    const c = after.comments[0];
    // Shape MUST be {author, at, body} exactly — no extra/missing keys.
    expect(Object.keys(c).sort()).toEqual(['at', 'author', 'body']);
    expect(c.author).toBe('developer');
    expect(c.at).toBe(fixedNow);
    expect(c.body).toBe('## heading\n\nMarkdown body with **bold**.');
  });

  it('append_comment_preserves_existing_comments', async () => {
    const { appendComment } = await import(PROD.taskStore);

    const repoDir = makeTmpDir('af-ts-comment-preserve');
    makeRepoSkeleton(repoDir, {
      tasks: loadFixtureTasks(['TASK-103']),
    });

    const before = readTaskFile(repoDir, 'TASK-103');
    expect(before.comments).toHaveLength(1);
    const seeded = before.comments[0];

    await appendComment({
      repoRoot: repoDir,
      key: 'TASK-103',
      author: 'reviewer',
      body: 'Second comment.',
      now: () => '2026-08-11T10:00:00Z',
    });

    const after = readTaskFile(repoDir, 'TASK-103');
    expect(after.comments).toHaveLength(2);
    // Pre-existing comment is byte-identical (no mutation, no reorder).
    expect(after.comments[0]).toEqual(seeded);
    // New comment appended at the END.
    expect(after.comments[1].author).toBe('reviewer');
    expect(after.comments[1].body).toBe('Second comment.');
  });

  it('append_comment_bumps_updated_at_and_regenerates_index', async () => {
    const { appendComment } = await import(PROD.taskStore);

    const repoDir = makeTmpDir('af-ts-comment-index');
    makeRepoSkeleton(repoDir, {
      tasks: loadFixtureTasks(['TASK-101', 'TASK-102']),
    });

    const beforeTask = readTaskFile(repoDir, 'TASK-101');
    const staleGen = '2000-01-01T00:00:00Z';
    writeFileSync(
      join(repoDir, 'tasks', 'index.json'),
      JSON.stringify({ generated_at: staleGen, tasks: [] }, null, 2),
      'utf8',
    );

    const fixedNow = '2026-08-12T08:00:00Z';
    await appendComment({
      repoRoot: repoDir,
      key: 'TASK-101',
      author: 'developer',
      body: 'note',
      now: () => fixedNow,
    });

    // updated_at refreshed on the task.
    const afterTask = readTaskFile(repoDir, 'TASK-101');
    expect(afterTask.updated_at).toBe(fixedNow);
    expect(afterTask.updated_at).not.toBe(beforeTask.updated_at);

    // Index regenerated and includes BOTH tasks.
    const idx = readIndex(repoDir);
    expect(idx.generated_at).not.toBe(staleGen);
    const idxKeys = idx.tasks.map((t) => t.key).sort();
    expect(idxKeys).toEqual(['TASK-101', 'TASK-102']);
  });
});

// ===========================================================================
// ATOMIC — all writes flow through src/atomic-write.js (temp+rename), not raw
//          writeFileSync. We mock node:fs the same way atomic-write.spec.js
//          already does and assert the recipe was followed.
// ===========================================================================
describe('writes go through src/atomic-write.js', () => {
  // Spy on the same node:fs methods that atomic-write.js uses. We do NOT trap
  // writeFileSync — the test fixture (makeRepoSkeleton) uses writeFileSync to
  // seed the on-disk task files, so trapping it would catch the fixture, not
  // the production code. The positive assertion (O_CREAT|O_EXCL open of a
  // sibling tmp file + rename(tmp, target)) is sufficient to prove the recipe.
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

  it('writes_go_through_atomic_write', async () => {
    const fs = await import('node:fs');
    const { transitionStatus } = await import(PROD.taskStore);

    const repoDir = makeTmpDir('af-ts-atomic');
    makeRepoSkeleton(repoDir, {
      tasks: loadFixtureTasks(['TASK-101']),
    });
    const taskTarget = join(repoDir, 'tasks', 'TASK-101.json');

    // Clear any open/rename calls the fixture emitted during seeding so the
    // assertions below scope to the production code path.
    fs.openSync.mockClear();
    fs.renameSync.mockClear();
    fs.fsyncSync.mockClear();

    await transitionStatus({
      repoRoot: repoDir,
      key: 'TASK-101',
      status: 'in_progress',
      now: () => '2026-09-01T00:00:00Z',
    });

    // 1. Some sibling tmp file was opened with O_CREAT|O_EXCL — the signature
    //    of src/atomic-write.js.
    const openCalls = fs.openSync.mock.calls;
    const tmpOpens = openCalls.filter(
      ([p, flags]) =>
        typeof p === 'string' &&
        p.includes('.tmp.') &&
        typeof flags === 'number' &&
        (flags & fs.constants.O_EXCL) !== 0 &&
        (flags & fs.constants.O_CREAT) !== 0,
    );
    expect(
      tmpOpens.length,
      'expected at least one O_CREAT|O_EXCL open on a sibling tmp file',
    ).toBeGreaterThan(0);

    // 2. fsync ran before rename, proving the recipe order.
    expect(fs.fsyncSync.mock.invocationCallOrder.length).toBeGreaterThan(0);
    expect(fs.renameSync.mock.invocationCallOrder.length).toBeGreaterThan(0);
    const lastFsync = Math.max(...fs.fsyncSync.mock.invocationCallOrder);
    const firstRename = Math.min(...fs.renameSync.mock.invocationCallOrder);
    expect(lastFsync).toBeLessThan(firstRename);

    // 3. A rename targeted the task file itself (proves the task write went
    //    through tmp+rename, not direct writeFileSync).
    const renameToTask = fs.renameSync.mock.calls.find(
      ([src, dst]) =>
        typeof src === 'string' &&
        src.startsWith(taskTarget + '.tmp.') &&
        dst === taskTarget,
    );
    expect(
      renameToTask,
      'expected rename(tmp, TASK-101.json) — task file write must be atomic',
    ).toBeDefined();
  });
});
