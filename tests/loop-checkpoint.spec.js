// tests/loop-checkpoint.spec.js
// TASK-084 — Pure-logic tests for src/loop-checkpoint.js (fast tier, no disk I/O).
//
// Deep-review S2: a crash between the in_progress transition and ticket close
// leaves the ticket permanently invisible to selectNextTicket (status stays
// in_progress forever, selectNextTicket only matches status==='todo'). This
// module gives the loop a documented checkpoint contract + a pure decision
// helper (resumePoint) that either resumes the recorded ticket at its
// recorded phase, or resets it to 'todo' with an explanatory comment — never
// leaves it invisible.
//
// Also folds the TASK-071 core (workflow_step enum-validity for loop writes):
// LOOP_PHASES maps every canonical phase name onto a value from the bundle
// workflow_step enum ['idle','fetch','research','test','impl','review','update'].
//
// ACs covered:
//   AC1/AC3 — LOOP_PHASES is the documented phase set, each mapping onto a
//             valid workflow_step enum value (TASK-071 core, subsumed here).
//   AC2     — resumePoint is PURE and decides resume vs reset vs none:
//               resume  — current_ticket exists and task is in_progress/in_review
//                         at a post-commit phase; iteration/completed_this_run/
//                         run_started_at are carried over from loop_state
//                         (counter restoration — never resets on resume).
//               reset   — recorded ticket is stranded: in_progress but
//                         loop_state says a pre-commit phase (idle/fetch/research),
//                         or task status is inconsistent with loop_state at all
//                         (todo/blocked while still recorded as current_ticket).
//               none    — no current_ticket recorded, or the ticket is already done.
//   AC1     — writeLoopCheckpoint validates phase against LOOP_PHASES BEFORE
//             any I/O (TASK-075 writer style) — proven here via a
//             non-existent repoRoot the same way tests/loop-auth.spec.js does.
//
// All tests MUST FAIL with "Cannot find module …loop-checkpoint.js" until
// src/loop-checkpoint.js is created in the IMPL phase.
//
// Pure-logic tier — top-level tests/, no real disk I/O.

import { describe, it, expect } from 'vitest';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __thisDir = dirname(fileURLToPath(import.meta.url));
const __srcDir = join(__thisDir, '..', 'src');
const CHECKPOINT_URL = pathToFileURL(join(__srcDir, 'loop-checkpoint.js')).href;

const FAKE_ROOT = '/fake/root/that/does/not/exist';

const WORKFLOW_STEP_ENUM = ['idle', 'fetch', 'research', 'test', 'impl', 'review', 'update'];

// ---------------------------------------------------------------------------
// Module shape
// ---------------------------------------------------------------------------

describe('module exports the expected seam', () => {
  it('exports LOOP_PHASES, writeLoopCheckpoint, resumePoint', async () => {
    const mod = await import(CHECKPOINT_URL);
    expect(typeof mod.LOOP_PHASES).toBe('object');
    expect(mod.LOOP_PHASES).not.toBeNull();
    expect(typeof mod.writeLoopCheckpoint).toBe('function');
    expect(typeof mod.resumePoint).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// AC1/AC3 — LOOP_PHASES maps onto the bundle workflow_step enum (TASK-071 core)
// ---------------------------------------------------------------------------

describe('LOOP_PHASES maps every phase name onto a valid workflow_step enum value', () => {
  it('every LOOP_PHASES value is a member of the bundle workflow_step enum', async () => {
    const { LOOP_PHASES } = await import(CHECKPOINT_URL);
    for (const [phase, step] of Object.entries(LOOP_PHASES)) {
      expect(
        WORKFLOW_STEP_ENUM.includes(step),
        `LOOP_PHASES['${phase}'] = '${step}' must be one of: ${WORKFLOW_STEP_ENUM.join(', ')}`,
      ).toBe(true);
    }
  });

  it('LOOP_PHASES covers at least fetch, research, test, impl, review, update', async () => {
    const { LOOP_PHASES } = await import(CHECKPOINT_URL);
    const names = Object.keys(LOOP_PHASES);
    for (const required of ['fetch', 'research', 'test', 'impl', 'review', 'update']) {
      expect(names, `LOOP_PHASES must document a '${required}' phase`).toContain(required);
    }
  });
});

// ---------------------------------------------------------------------------
// AC1 — writeLoopCheckpoint validates phase before touching disk.
// ---------------------------------------------------------------------------

describe('writeLoopCheckpoint validates the phase before touching disk', () => {
  it('rejects an unknown phase with a validation error, not a filesystem error', async () => {
    const { writeLoopCheckpoint } = await import(CHECKPOINT_URL);
    await expect(
      writeLoopCheckpoint({
        repoRoot: FAKE_ROOT,
        checkpoint: {
          current_ticket: 'TASK-001',
          phase: 'not_a_real_phase',
          iteration: 1,
          completed_this_run: 0,
          run_started_at: '2026-07-01T00:00:00Z',
        },
      }),
    ).rejects.toThrow(/unknown|invalid/i);
  });

  it('a valid phase does not throw a validation error (may throw a not-found error instead)', async () => {
    const { writeLoopCheckpoint } = await import(CHECKPOINT_URL);
    let caughtErr;
    try {
      await writeLoopCheckpoint({
        repoRoot: FAKE_ROOT,
        checkpoint: {
          current_ticket: 'TASK-001',
          phase: 'impl',
          iteration: 1,
          completed_this_run: 0,
          run_started_at: '2026-07-01T00:00:00Z',
        },
      });
    } catch (err) {
      caughtErr = err;
    }
    if (caughtErr) {
      expect(caughtErr.message).not.toMatch(/unknown.*phase|invalid.*phase/i);
    }
  });
  // Note: the absent-bundle (non-existent repoRoot) case is covered by
  // tests/e2e/loop-checkpoint.spec.js's no-pointer-file spec — not duplicated
  // here (new-test budget).
});

// ---------------------------------------------------------------------------
// AC2 — resumePoint is pure and decides resume / reset / none.
// ---------------------------------------------------------------------------

function bundleWith(loop_state) {
  return {
    schema_version: 2,
    session_id: '20260701T000000Z-deadbeef',
    lifecycle_state: 'active',
    updated_at: '2026-07-01T00:00:00Z',
    active_task: loop_state?.current_ticket ?? null,
    workflow_step: 'impl',
    next_action: null,
    handoff_summary: 'in progress',
    mode: 'loop',
    loop_state,
  };
}

function task(overrides) {
  return {
    key: 'TASK-100',
    status: 'todo',
    priority: 'medium',
    labels: [],
    depends_on: [],
    ...overrides,
  };
}

describe('resumePoint — no crash evidence', () => {
  it('returns { action: "none" } when loop_state has no current_ticket, carrying counters over verbatim', async () => {
    const { resumePoint } = await import(CHECKPOINT_URL);
    const bundle = bundleWith({
      current_ticket: null, phase: 'idle', iteration: 7, completed_this_run: 2, run_started_at: '2026-07-01T08:00:00Z',
    });
    const result = resumePoint({ bundle, tasks: [task()] });
    expect(result.action).toBe('none');
    // Counter-restoration contract: 'none' must not silently reset the run's
    // counters to zero just because current_ticket is absent — only the
    // ticket pointer is stale/absent, not the run's progress.
    expect(result.iteration).toBe(7);
    expect(result.completed_this_run).toBe(2);
    expect(result.run_started_at).toBe('2026-07-01T08:00:00Z');
  });

  it('returns { action: "none" } when the recorded ticket is already done, carrying counters over verbatim', async () => {
    const { resumePoint } = await import(CHECKPOINT_URL);
    const bundle = bundleWith({
      current_ticket: 'TASK-100', phase: 'update', iteration: 3, completed_this_run: 1, run_started_at: '2026-07-01T09:00:00Z',
    });
    const tasks = [task({ status: 'done' })];
    const result = resumePoint({ bundle, tasks });
    expect(result.action).toBe('none');
    expect(result.iteration).toBe(3);
    expect(result.completed_this_run).toBe(1);
    expect(result.run_started_at).toBe('2026-07-01T09:00:00Z');
  });

  it('returns { action: "none" } with no counters when loop_state is entirely absent from the bundle', async () => {
    const { resumePoint } = await import(CHECKPOINT_URL);
    const bundle = bundleWith(undefined);
    const result = resumePoint({ bundle, tasks: [task()] });
    expect(result.action).toBe('none');
    expect(result.iteration).toBeUndefined();
    expect(result.completed_this_run).toBeUndefined();
    expect(result.run_started_at).toBeUndefined();
  });
});

describe('resumePoint — resume: mid-ticket crash at a post-commit phase', () => {
  it('resumes an in_progress ticket recorded at the impl phase, carrying counters over', async () => {
    const { resumePoint } = await import(CHECKPOINT_URL);
    const bundle = bundleWith({
      current_ticket: 'TASK-100',
      phase: 'impl',
      iteration: 4,
      completed_this_run: 2,
      run_started_at: '2026-07-01T09:00:00Z',
    });
    const tasks = [task({ status: 'in_progress' })];
    const result = resumePoint({ bundle, tasks });

    expect(result.action).toBe('resume');
    expect(result.ticket.key).toBe('TASK-100');
    expect(result.phase).toBe('impl');
    // Counter-restoration contract: iteration/completed_this_run/run_started_at
    // must be carried from loop_state, never reset to zero.
    expect(result.iteration).toBe(4);
    expect(result.completed_this_run).toBe(2);
    expect(result.run_started_at).toBe('2026-07-01T09:00:00Z');
  });

  it('resumes an in_review ticket regardless of recorded phase', async () => {
    const { resumePoint } = await import(CHECKPOINT_URL);
    const bundle = bundleWith({
      current_ticket: 'TASK-100', phase: 'review', iteration: 5, completed_this_run: 3,
    });
    const tasks = [task({ status: 'in_review' })];
    const result = resumePoint({ bundle, tasks });
    expect(result.action).toBe('resume');
    expect(result.ticket.key).toBe('TASK-100');
  });
});

describe('resumePoint — reset: stranded pre-commit crash', () => {
  it('resets when in_progress but recorded phase is fetch (pre-commit)', async () => {
    const { resumePoint } = await import(CHECKPOINT_URL);
    const bundle = bundleWith({
      current_ticket: 'TASK-100', phase: 'fetch', iteration: 1, completed_this_run: 0,
    });
    const tasks = [task({ status: 'in_progress' })];
    const result = resumePoint({ bundle, tasks });
    expect(result.action).toBe('reset');
    expect(result.ticket.key).toBe('TASK-100');
    expect(typeof result.reason).toBe('string');
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it('resets when in_progress but recorded phase is research (pre-commit)', async () => {
    const { resumePoint } = await import(CHECKPOINT_URL);
    const bundle = bundleWith({
      current_ticket: 'TASK-100', phase: 'research', iteration: 1, completed_this_run: 0,
    });
    const tasks = [task({ status: 'in_progress' })];
    const result = resumePoint({ bundle, tasks });
    expect(result.action).toBe('reset');
  });

  it('resets when in_progress but recorded phase is idle (pre-commit)', async () => {
    const { resumePoint } = await import(CHECKPOINT_URL);
    const bundle = bundleWith({
      current_ticket: 'TASK-100', phase: 'idle', iteration: 0, completed_this_run: 0,
    });
    const tasks = [task({ status: 'in_progress' })];
    const result = resumePoint({ bundle, tasks });
    expect(result.action).toBe('reset');
  });
});

describe('resumePoint — reset: inconsistent state', () => {
  it('resets when loop_state still names a ticket whose task status has already gone back to todo', async () => {
    const { resumePoint } = await import(CHECKPOINT_URL);
    const bundle = bundleWith({
      current_ticket: 'TASK-100', phase: 'impl', iteration: 2, completed_this_run: 1,
    });
    const tasks = [task({ status: 'todo' })];
    const result = resumePoint({ bundle, tasks });
    expect(result.action).toBe('reset');
  });

  it('resets when the recorded ticket is blocked', async () => {
    const { resumePoint } = await import(CHECKPOINT_URL);
    const bundle = bundleWith({
      current_ticket: 'TASK-100', phase: 'test', iteration: 2, completed_this_run: 1,
    });
    const tasks = [task({ status: 'blocked' })];
    const result = resumePoint({ bundle, tasks });
    expect(result.action).toBe('reset');
  });

  it('resets when the recorded ticket key is not found in the task list at all', async () => {
    const { resumePoint } = await import(CHECKPOINT_URL);
    const bundle = bundleWith({
      current_ticket: 'TASK-999', phase: 'impl', iteration: 2, completed_this_run: 1,
    });
    const tasks = [task({ key: 'TASK-100', status: 'todo' })];
    const result = resumePoint({ bundle, tasks });
    // Missing ticket is not "already done" — it is unresolvable evidence of a
    // crash with a stale/dangling pointer, which must not be silently ignored.
    // The implementation is deterministic: dangling pointers always reset.
    expect(result.action).toBe('reset');
  });
});

// ---------------------------------------------------------------------------
// TASK-100 AC2 — all three 'reset' branches carry iteration/completed_this_run/
// run_started_at verbatim from loop_state, same restore contract 'none' and
// 'resume' already honor. Before the fix these three fields were silently
// dropped on every reset path, restarting maxIterations/consolidation ceilings.
// ---------------------------------------------------------------------------

describe('resumePoint — TASK-100 AC2: reset carries the run counters verbatim', () => {
  it('carries counters on reset via a dangling ticket key (missing from task list)', async () => {
    const { resumePoint } = await import(CHECKPOINT_URL);
    const bundle = bundleWith({
      current_ticket: 'TASK-999', phase: 'impl', iteration: 6, completed_this_run: 4, run_started_at: '2026-07-06T10:00:00Z',
    });
    const tasks = [task({ key: 'TASK-100', status: 'todo' })];
    const result = resumePoint({ bundle, tasks });
    expect(result.action).toBe('reset');
    expect(result.iteration).toBe(6);
    expect(result.completed_this_run).toBe(4);
    expect(result.run_started_at).toBe('2026-07-06T10:00:00Z');
  });

  it('carries counters on reset via an inconsistent status (todo while still recorded as current)', async () => {
    const { resumePoint } = await import(CHECKPOINT_URL);
    const bundle = bundleWith({
      current_ticket: 'TASK-100', phase: 'impl', iteration: 8, completed_this_run: 5, run_started_at: '2026-07-06T11:00:00Z',
    });
    const tasks = [task({ status: 'todo' })];
    const result = resumePoint({ bundle, tasks });
    expect(result.action).toBe('reset');
    expect(result.iteration).toBe(8);
    expect(result.completed_this_run).toBe(5);
    expect(result.run_started_at).toBe('2026-07-06T11:00:00Z');
  });

  it('carries counters on reset via a pre-commit-phase crash (fetch)', async () => {
    const { resumePoint } = await import(CHECKPOINT_URL);
    const bundle = bundleWith({
      current_ticket: 'TASK-100', phase: 'fetch', iteration: 2, completed_this_run: 1, run_started_at: '2026-07-06T12:00:00Z',
    });
    const tasks = [task({ status: 'in_progress' })];
    const result = resumePoint({ bundle, tasks });
    expect(result.action).toBe('reset');
    expect(result.iteration).toBe(2);
    expect(result.completed_this_run).toBe(1);
    expect(result.run_started_at).toBe('2026-07-06T12:00:00Z');
  });
});

// ---------------------------------------------------------------------------
// TASK-100 AC4 — the new pre-Developer-spawn checkpoint cadence writes phase
// 'test' for tdd-tier tickets (in addition to the existing 'impl' coverage).
// resumePoint's existing PRE_COMMIT_PHASES logic already excludes 'test', so
// this is a spec-coverage lock, not a behavior change.
// ---------------------------------------------------------------------------

describe('resumePoint — TASK-100 AC4: resumes at the "test" phase (tdd pre-spawn checkpoint)', () => {
  it('resumes an in_progress ticket recorded at the test phase, carrying counters over', async () => {
    const { resumePoint } = await import(CHECKPOINT_URL);
    const bundle = bundleWith({
      current_ticket: 'TASK-100', phase: 'test', iteration: 1, completed_this_run: 0, run_started_at: '2026-07-06T13:00:00Z',
    });
    const tasks = [task({ status: 'in_progress' })];
    const result = resumePoint({ bundle, tasks });
    expect(result.action).toBe('resume');
    expect(result.ticket.key).toBe('TASK-100');
    expect(result.phase).toBe('test');
    expect(result.iteration).toBe(1);
    expect(result.completed_this_run).toBe(0);
    expect(result.run_started_at).toBe('2026-07-06T13:00:00Z');
  });
});

// ---------------------------------------------------------------------------
// TASK-100 AC3 — ticketHasLandedCommits: pure helper the reset protocol uses
// to check `git log` for commits referencing the ticket key BEFORE discarding
// work. Takes a git-log string (e.g. `git log --oneline` output) so it stays
// fast-tier testable without spawning git — the doc protocol feeds it the
// real git-log output; direct git invocation is an e2e concern, not this
// module's.
// ---------------------------------------------------------------------------

describe('ticketHasLandedCommits — TASK-100 AC3: pure git-log scan for a ticket key', () => {
  it('returns true when a git-log line references the ticket key', async () => {
    const { ticketHasLandedCommits } = await import(CHECKPOINT_URL);
    const gitLog = [
      'a1b2c3d fix(TASK-101): unrelated fix',
      'e4f5g6h test(TASK-100): add failing spec',
      'i7j8k9l chore: bump version',
    ].join('\n');
    expect(ticketHasLandedCommits({ gitLog, key: 'TASK-100' })).toBe(true);
  });

  it('returns false when no git-log line references the ticket key', async () => {
    const { ticketHasLandedCommits } = await import(CHECKPOINT_URL);
    const gitLog = [
      'a1b2c3d fix(TASK-101): unrelated fix',
      'i7j8k9l chore: bump version',
    ].join('\n');
    expect(ticketHasLandedCommits({ gitLog, key: 'TASK-100' })).toBe(false);
  });

  it('does not false-positive on a key that is a substring of another key (TASK-1 vs TASK-100)', async () => {
    const { ticketHasLandedCommits } = await import(CHECKPOINT_URL);
    const gitLog = 'a1b2c3d fix(TASK-1000): unrelated fix\ne4f5g6h chore(TASK-10): another';
    expect(ticketHasLandedCommits({ gitLog, key: 'TASK-100' })).toBe(false);
  });

  // TASK-100 review R1/L1 — a lowercased commit message (e.g. a human typing
  // 'task-100' in a commit subject) must still match; a case-sensitive miss
  // here produces exactly the silent reset this helper exists to prevent.
  it('matches case-insensitively (a commit referencing "task-100" lowercase)', async () => {
    const { ticketHasLandedCommits } = await import(CHECKPOINT_URL);
    const gitLog = 'a1b2c3d fix(task-100): lowercase reference';
    expect(ticketHasLandedCommits({ gitLog, key: 'TASK-100' })).toBe(true);
  });

  it('returns false for empty/undefined git log or key without throwing', async () => {
    const { ticketHasLandedCommits } = await import(CHECKPOINT_URL);
    expect(ticketHasLandedCommits({ gitLog: '', key: 'TASK-100' })).toBe(false);
    expect(ticketHasLandedCommits({ gitLog: undefined, key: 'TASK-100' })).toBe(false);
    expect(ticketHasLandedCommits({ gitLog: 'fix(TASK-100): x', key: undefined })).toBe(false);
  });
});

describe('resumePoint — purity', () => {
  it('does not mutate the bundle or tasks it is given', async () => {
    const { resumePoint } = await import(CHECKPOINT_URL);
    const bundle = bundleWith({
      current_ticket: 'TASK-100', phase: 'impl', iteration: 4, completed_this_run: 2,
    });
    const tasks = [task({ status: 'in_progress' })];
    const bundleSnapshot = JSON.parse(JSON.stringify(bundle));
    const tasksSnapshot = JSON.parse(JSON.stringify(tasks));

    resumePoint({ bundle, tasks });

    expect(bundle).toEqual(bundleSnapshot);
    expect(tasks).toEqual(tasksSnapshot);
  });
});
