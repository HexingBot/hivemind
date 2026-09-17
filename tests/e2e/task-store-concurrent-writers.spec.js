// tests/e2e/task-store-concurrent-writers.spec.js
// TASK-235 (WG-H-008/WG-H-009/WG-H-012, wargaming 2026-09-16, scope corrected
// by the Orchestrator). The SINGLE-WRITER premise src/task-store.js used to
// declare ("the framework currently runs exactly one orchestrator per repo")
// is false for the shipped product: bin/task-board.js is a second writer in a
// SEPARATE OS PROCESS, and its POST endpoints call transitionStatus/createTask
// directly. Every spec below uses REAL spawned child processes (never
// in-process promises, which can hide or inflate the race — see the TASK-235
// hand-off for the measured before/after with this exact harness) so the race
// under test is genuinely between OS processes, mirroring
// tests/e2e/task-store-resilience.spec.js's AC5(c) synchronization pattern
// (a marker-file readiness barrier, no sleeps).
//
// Acceptance criteria covered (1:1, matching the ticket's 6 ACs):
//   AC2 (WG-H-008)  same_ticket_concurrent_appendComment_never_loses_a_comment
//   AC3 (WG-H-009)  distinct_ticket_concurrent_closeTask_index_stays_consistent
//   AC2/AC3 (CU3)   distinct_ticket_concurrent_transitionStatus_both_land
//   AC4 (WG-H-012)  dangling_dep_does_not_hide_ready_sibling
//   AC4 (WG-H-012)  dependency_cycle_is_detected_and_named
//   AC5 (CU7)       read_path_never_waits_on_a_held_mutation_lock

import { describe, it, expect, afterAll } from 'vitest';
import {
  readFileSync, writeFileSync, existsSync, mkdirSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

import { PROD, makeRepoSkeleton } from '../helpers/fixtures.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';

afterAll(cleanupAll);

const __thisDir = dirname(fileURLToPath(import.meta.url));

function buildTask(key, extra = {}) {
  return {
    key,
    title: `Synthetic ${key}`,
    description: 'Built inline by the TASK-235 concurrent-writers suite.',
    acceptance_criteria: ['Exists.'],
    status: 'todo',
    priority: 'medium',
    labels: [],
    assignee: null,
    depends_on: [],
    linked_commits: [],
    linked_prs: [],
    comments: [],
    created_at: '2026-09-16T00:00:00Z',
    updated_at: '2026-09-16T00:00:00Z',
    jira_key: null,
    verification_tier: 'tests-after',
    ...extra,
  };
}

// Generic child process: performs exactly ONE task-store mutation (described
// by `op`, JSON-encoded on argv), synchronized against N siblings via a
// marker-file readiness barrier so the actual calls fire as close to
// simultaneously as real OS scheduling allows.
const CHILD_SRC = `
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [, , repoRoot, holderId, resultsPath, syncDir, taskStorePath, opJson] = process.argv;
const mod = await import(pathToFileURL(taskStorePath).href);
const op = JSON.parse(opJson);

function spinUntilExists(p) {
  while (!existsSync(p)) {
    // tight synchronous poll — deterministic readiness barrier, no sleep
  }
}

writeFileSync(join(syncDir, \`ready-\${holderId}\`), '1');
spinUntilExists(join(syncDir, 'go'));

let result;
try {
  let out;
  if (op.fn === 'appendComment') {
    out = await mod.appendComment({ repoRoot, key: op.key, author: op.author, body: op.body });
  } else if (op.fn === 'closeTask') {
    out = await mod.closeTask({ repoRoot, key: op.key, comment: op.comment, exception: op.exception });
  } else if (op.fn === 'transitionStatus') {
    out = await mod.transitionStatus({ repoRoot, key: op.key, status: op.status });
  } else {
    throw new Error('unknown op.fn ' + op.fn);
  }
  result = { holderId, ok: true, out };
} catch (e) {
  result = { holderId, ok: false, code: e && e.code, message: e && e.message };
}
writeFileSync(resultsPath, JSON.stringify(result));
`;

/**
 * Spawn one real child process per entry in `ops` (each `{ holderId, ...op }`),
 * hold them at a readiness barrier until every child has reported ready, then
 * release them all at once so the mutations race as concurrently as the OS
 * scheduler allows. Returns `{ holderId -> parsed result }`.
 */
async function runConcurrentOps(repoDir, ops) {
  const syncDir = makeTmpDir('af-ts235-sync');
  const childScriptPath = join(syncDir, 'child.mjs');
  writeFileSync(childScriptPath, CHILD_SRC, 'utf8');
  const taskStorePath = fileURLToPath(PROD.taskStore);

  const children = ops.map((op) => {
    const resultsPath = join(syncDir, `result-${op.holderId}.json`);
    const child = spawn(process.execPath, [
      childScriptPath, repoDir, op.holderId, resultsPath, syncDir, taskStorePath, JSON.stringify(op),
    ]);
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    let exitInfo = null;
    child.on('exit', (code, signal) => { exitInfo = { code, signal }; });
    return {
      op, resultsPath, child, getStderr: () => stderr, getExitInfo: () => exitInfo,
    };
  });

  // Wait for every child to report ready, then release them all at once.
  //
  // Review finding LOW-2 (TASK-235 fix round) — this used to be an UNBOUNDED
  // synchronous busy-wait: a child that dies (crash, thrown error, unhandled
  // rejection) before it ever reaches the writeFileSync('ready-...') call
  // hard-blocked this whole test worker FOREVER, with no diagnostic at all —
  // the failure mode was an indefinitely hung test run, not a readable error.
  // A bounded deadline turns that into a named, actionable failure instead:
  // it names which holderId(s) never reported ready, whether their process
  // already exited (and with what code/signal), and their captured stderr.
  const READY_BARRIER_TIMEOUT_MS = 15000;
  const readyDeadline = Date.now() + READY_BARRIER_TIMEOUT_MS;
  const readyPaths = ops.map((op) => join(syncDir, `ready-${op.holderId}`));
  while (!readyPaths.every((p) => existsSync(p))) {
    if (Date.now() > readyDeadline) {
      const missing = children
        .filter((c) => !existsSync(join(syncDir, `ready-${c.op.holderId}`)))
        .map((c) => `${c.op.holderId} (exitInfo=${JSON.stringify(c.getExitInfo())}, stderr=${c.getStderr()})`);
      throw new Error(
        `runConcurrentOps: readiness barrier timed out after ${READY_BARRIER_TIMEOUT_MS}ms waiting for `
        + `${missing.length} child(ren) to report ready: ${missing.join('; ')}`,
      );
    }
    // tight synchronous poll — no sleep-based coordination
  }
  writeFileSync(join(syncDir, 'go'), '1');

  const exitCodes = await Promise.all(
    children.map(({ child }) => new Promise((resolve) => child.on('exit', (code) => resolve(code)))),
  );

  const out = {};
  children.forEach(({ op, resultsPath, getStderr }, i) => {
    expect(exitCodes[i], `child ${op.holderId} must exit 0. stderr:\n${getStderr()}`).toBe(0);
    out[op.holderId] = JSON.parse(readFileSync(resultsPath, 'utf8'));
  });
  return out;
}

// ===========================================================================
// AC2 (WG-H-008) — N accepted mutations on the SAME ticket, from N real
// processes, must produce N mutations on disk (or a named error per one that
// did not land) — never accepted-and-lost.
//
// Regla 2 harm: without this lock, an appendComment call that RETURNS
// SUCCESSFULLY can still have its comment silently discarded by a concurrent
// sibling's last-writer-wins overwrite — an audit-trail entry (a developer's
// or reviewer's comment) vanishes with no error anywhere, and nothing about
// the caller's own successful return value hints that it happened.
// ===========================================================================
describe('AC2 (WG-H-008) — same-ticket concurrent appendComment across real processes', () => {
  it('same_ticket_concurrent_appendComment_never_loses_a_comment', async () => {
    const repoDir = makeTmpDir('af-ts235-append-race');
    makeRepoSkeleton(repoDir, { tasks: { 'TASK-001': buildTask('TASK-001') } });

    const N = 8;
    const ops = Array.from({ length: N }, (_, i) => ({
      holderId: `writer-${i}`,
      fn: 'appendComment',
      key: 'TASK-001',
      author: 'developer',
      body: `concurrent-comment-${i}`,
    }));

    const results = await runConcurrentOps(repoDir, ops);

    const succeeded = Object.values(results).filter((r) => r.ok);
    const failed = Object.values(results).filter((r) => !r.ok);
    // Every failure must be the NAMED lock-timeout error, never a silent/
    // untyped failure — "accepted or a named error, never accepted-and-lost".
    for (const f of failed) {
      expect(f.code).toBe('E_TASK_MUTATION_LOCK_TIMEOUT');
    }

    const onDisk = JSON.parse(readFileSync(join(repoDir, 'tasks', 'TASK-001.json'), 'utf8'));
    const landedBodies = new Set(onDisk.comments.map((c) => c.body));
    for (let i = 0; i < N; i++) {
      const id = `writer-${i}`;
      if (results[id].ok) {
        expect(
          landedBodies.has(`concurrent-comment-${i}`),
          `writer ${i} was accepted but its comment is missing from disk — accepted-and-lost`,
        ).toBe(true);
      }
    }
    // Exactly one on-disk comment per ACCEPTED writer — no duplication either.
    expect(onDisk.comments.length).toBe(succeeded.length);
  });
});

// ===========================================================================
// AC3 (WG-H-009) — tasks/index.json must stay consistent with the per-task
// files after concurrent closeTask calls on DISTINCT tickets from N real
// processes — never silently desynced.
//
// Regla 2 harm: index.json can report a ticket as still open when its own
// file already says "done" (or vice-versa), misleading anyone who reads the
// index summary (the kanban list, a status report) without opening every
// individual task file to double-check.
// ===========================================================================
describe('AC3 (WG-H-009) — distinct-ticket concurrent closeTask across real processes', () => {
  it('distinct_ticket_concurrent_closeTask_index_stays_consistent', async () => {
    const repoDir = makeTmpDir('af-ts235-close-race');
    const N = 6;
    const keys = Array.from({ length: N }, (_, i) => `TASK-${String(i + 1).padStart(3, '0')}`);
    const tasks = {};
    for (const key of keys) tasks[key] = buildTask(key, { status: 'in_review' });
    makeRepoSkeleton(repoDir, { tasks });

    const ops = keys.map((key) => ({
      holderId: key,
      fn: 'closeTask',
      key,
      comment: { author: 'developer', body: `closing ${key}` },
      exception: { reason: 'TASK-235 concurrency fixture — bypasses predecessor/evidence checks, not the race under test.' },
    }));

    const results = await runConcurrentOps(repoDir, ops);
    for (const key of keys) {
      expect(results[key].ok, `closeTask(${key}) must be accepted or throw a named error`).toBe(true);
    }

    for (const key of keys) {
      const onDisk = JSON.parse(readFileSync(join(repoDir, 'tasks', `${key}.json`), 'utf8'));
      expect(onDisk.status, `${key}'s own file must say done`).toBe('done');
    }

    const idx = JSON.parse(readFileSync(join(repoDir, 'tasks', 'index.json'), 'utf8'));
    const idxByKey = new Map(idx.tasks.map((t) => [t.key, t.status]));
    for (const key of keys) {
      expect(
        idxByKey.get(key),
        `index.json must agree with ${key}'s own file (done) — a desync here is exactly WG-H-009`,
      ).toBe('done');
    }
  });
});

// ===========================================================================
// CU3 — two concurrent mutations on DISTINCT tickets must BOTH land — neither
// is silently overwritten by the other via the shared index.json write.
// ===========================================================================
describe('CU3 — distinct-ticket concurrent transitionStatus both land', () => {
  it('distinct_ticket_concurrent_transitionStatus_both_land', async () => {
    const repoDir = makeTmpDir('af-ts235-transition-race');
    makeRepoSkeleton(repoDir, {
      tasks: {
        'TASK-001': buildTask('TASK-001'),
        'TASK-002': buildTask('TASK-002'),
      },
    });

    const ops = [
      { holderId: 'TASK-001', fn: 'transitionStatus', key: 'TASK-001', status: 'in_progress' },
      { holderId: 'TASK-002', fn: 'transitionStatus', key: 'TASK-002', status: 'in_progress' },
    ];
    const results = await runConcurrentOps(repoDir, ops);
    expect(results['TASK-001'].ok).toBe(true);
    expect(results['TASK-002'].ok).toBe(true);

    for (const key of ['TASK-001', 'TASK-002']) {
      const onDisk = JSON.parse(readFileSync(join(repoDir, 'tasks', `${key}.json`), 'utf8'));
      expect(onDisk.status).toBe('in_progress');
    }
    const idx = JSON.parse(readFileSync(join(repoDir, 'tasks', 'index.json'), 'utf8'));
    const idxByKey = new Map(idx.tasks.map((t) => [t.key, t.status]));
    expect(idxByKey.get('TASK-001')).toBe('in_progress');
    expect(idxByKey.get('TASK-002')).toBe('in_progress');
  });
});

// ===========================================================================
// AC4 (WG-H-012) — a dangling depends_on on ONE ticket must not hide an
// otherwise-ready SIBLING ticket from listReady (the "breaks listReady for
// the whole board" harm). Pure logic, no concurrency — in-process is
// sufficient and correct here.
//
// Regla 2 harm: before this fix, a single typo'd depends_on anywhere on the
// board made list_ready throw and return NOTHING — hiding every other
// legitimately-ready ticket from whoever (a human or the Orchestrator) is
// deciding what to work on next.
// ===========================================================================
describe('AC4 (WG-H-012) — dangling depends_on does not hide a ready sibling', () => {
  it('dangling_dep_does_not_hide_ready_sibling', async () => {
    const { listReady } = await import(PROD.taskStore);
    const repoDir = makeTmpDir('af-ts235-dangling-sibling');
    makeRepoSkeleton(repoDir, {
      tasks: {
        'TASK-001': buildTask('TASK-001', { depends_on: ['TASK-999'] }), // dangling
        'TASK-002': buildTask('TASK-002'), // trivially ready
      },
    });

    const ready = await listReady({ repoRoot: repoDir });
    expect(ready.map((t) => t.key), 'the ready sibling must NOT be hidden by the unrelated dangling ref').toEqual(['TASK-002']);
    expect(ready.danglingDependencies).toEqual([{ task: 'TASK-001', dependsOn: 'TASK-999' }]);
  });
});

// ===========================================================================
// AC4 (WG-H-012) — a real depends_on cycle must be DETECTED and NAMED,
// instead of silently excluding every ticket in the loop with zero signal
// that it is a cycle (as opposed to an ordinary pending dependency).
//
// Regla 2 harm: without this, two tickets stuck in a mutual depends_on cycle
// look identical, from list_ready's output, to two tickets that are simply
// waiting on unrelated in-progress work — nobody is ever told the board has
// an unsatisfiable loop that needs a human to break it.
// ===========================================================================
describe('AC4 (WG-H-012) — a depends_on cycle is detected and named', () => {
  it('dependency_cycle_is_detected_and_named', async () => {
    const { listReady, DependencyCycleError } = await import(PROD.taskStore);
    const repoDir = makeTmpDir('af-ts235-cycle');
    makeRepoSkeleton(repoDir, {
      tasks: {
        'TASK-101': buildTask('TASK-101', { depends_on: ['TASK-102'] }),
        'TASK-102': buildTask('TASK-102', { depends_on: ['TASK-101'] }),
      },
    });

    let caught;
    try {
      await listReady({ repoRoot: repoDir });
    } catch (err) {
      caught = err;
    }
    expect(caught, 'a pure cycle with nothing else ready must throw, not silently return an empty list').toBeDefined();
    expect(caught).toBeInstanceOf(DependencyCycleError);
    expect(caught.message).toContain('TASK-101');
    expect(caught.message).toContain('TASK-102');
  });
});

// ===========================================================================
// AC5 (CU7) — the read path (listTodos/listReady) must never wait on the
// tasks mutation lock. Simulated by pre-creating tasks/.mutate.lock (as if
// another process were mid-write) and asserting a read call still resolves
// near-instantly instead of blocking for the lock's staleness/timeout window.
//
// Regla 2 harm: if the read path started acquiring the mutation lock, a
// single slow or stuck writer would make every board READ hang too — turning
// one misbehaving writer into a full outage for anyone just viewing the
// board, which is exactly the "no serializar el camino de lectura" negative
// requirement this locks against.
// ===========================================================================
describe('AC5 (CU7) — read path never waits on a held mutation lock', () => {
  it('read_path_never_waits_on_a_held_mutation_lock', async () => {
    const { listTodos } = await import(PROD.taskStore);
    const repoDir = makeTmpDir('af-ts235-read-not-locked');
    makeRepoSkeleton(repoDir, { tasks: { 'TASK-001': buildTask('TASK-001') } });

    // Prime the index (in-sync — the common case that never touches the lock).
    await listTodos({ repoRoot: repoDir });

    // Simulate another process mid-write: hold the mutation lock (fresh mtime,
    // well inside the staleness window).
    mkdirSync(join(repoDir, 'tasks'), { recursive: true });
    writeFileSync(join(repoDir, 'tasks', '.mutate.lock'), `${process.pid}\n`, 'utf8');

    const t0 = process.hrtime.bigint();
    await listTodos({ repoRoot: repoDir });
    const elapsedMs = Number(process.hrtime.bigint() - t0) / 1e6;

    // Generous margin: a regression that makes reads acquire the lock would
    // wait multiple SECONDS (staleness reclaim / lock timeout); a genuinely
    // lock-free read completes in low single-digit milliseconds even with I/O.
    expect(
      elapsedMs,
      `listTodos took ${elapsedMs}ms with the mutation lock held by another process — the read path must never wait on it`,
    ).toBeLessThan(500);
  });
});
