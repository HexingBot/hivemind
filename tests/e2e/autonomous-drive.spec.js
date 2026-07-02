// tests/e2e/autonomous-drive.spec.js
// TASK-084 — "Drive a goal autonomously (crash-resume)" primary use case.
//
// Registered in tests/use-cases/USE-CASES.md per the use-case suite policy
// (tests/use-case-policy.spec.js): this is a NEW primary use case (the loop
// surviving a mid-ticket crash), not per-ticket spec accretion.
//
// Deep-review S2 fatal defect: a crash between a ticket's in_progress
// transition and its close leaves it PERMANENTLY invisible to
// selectNextTicket (src/drive-loop.js only matches status==='todo'), so the
// loop hits goalStuck and stops. This spec proves the deterministic seams
// that close that gap end to end:
//   1. checkpoint write (writeLoopCheckpoint) — one "process" mid-ticket.
//   2. fresh bundle read (readBundleSession, simulating the loop restarting
//      after a crash — new read of the same on-disk bundle, not the same
//      in-memory object).
//   3. resumePoint decides resume-or-reset from the freshly-read bundle.
//   4. selectNextTicket over the restored task list does NOT skip the
//      recovered ticket after a reset (the S2 defect, closed).
//
// Also folds a workflow_step enum-validity assertion (TASK-071 core) into
// the checkpoint write — see the phase→workflow_step assertion below.
//
// All tests MUST FAIL until src/loop-checkpoint.js is created.
//
// Disk I/O / tmpdir -> slow tier: tests/e2e/.

import { describe, it, expect, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';

afterAll(cleanupAll);

const __thisDir = dirname(fileURLToPath(import.meta.url));
const __srcDir = join(__thisDir, '..', '..', 'src');
const CHECKPOINT_URL = pathToFileURL(join(__srcDir, 'loop-checkpoint.js')).href;
const DRIVE_LOOP_URL = pathToFileURL(join(__srcDir, 'drive-loop.js')).href;
const BUNDLE_URL = pathToFileURL(join(__srcDir, 'bundle.js')).href;

const SESSION_ID = '20260701T100000Z-fee1dead';

function seedRepo({ initialPhase = 'fetch', taskStatus = 'in_progress' } = {}) {
  const root = makeTmpDir('af-ad');
  mkdirSync(join(root, 'state'), { recursive: true });

  writeFileSync(
    join(root, 'state', 'session.json'),
    JSON.stringify({
      schema_version: 2,
      active_session_id: SESSION_ID,
      updated_at: '2026-07-01T10:00:00Z',
    }, null, 2),
    'utf8',
  );

  const bundleDir = join(root, 'state', 'sessions', SESSION_ID);
  mkdirSync(bundleDir, { recursive: true });
  writeFileSync(
    join(bundleDir, 'session.json'),
    JSON.stringify({
      schema_version: 2,
      session_id: SESSION_ID,
      lifecycle_state: 'active',
      updated_at: '2026-07-01T10:00:00Z',
      active_task: 'TASK-200',
      workflow_step: initialPhase,
      next_action: 'drive the goal',
      handoff_summary: 'autonomous loop in progress',
      open_questions: [],
      blockers: [],
      decisions: [],
      subagent_results: [],
      pending_human_confirmation: null,
      mode: 'loop',
      loop_state: {
        goal: { label: 'goal-autonomous-drive' },
        iteration: 1,
        consecutiveNoProgress: 0,
        maxIterations: 20,
        maxNoProgress: 3,
        maxReviewerRetries: 2,
      },
    }, null, 2),
    'utf8',
  );

  const tasks = [
    {
      key: 'TASK-200',
      title: 'Goal ticket under crash test',
      status: taskStatus,
      priority: 'high',
      labels: ['goal-autonomous-drive'],
      depends_on: [],
    },
    {
      key: 'TASK-201',
      title: 'Second goal ticket, still todo',
      status: 'todo',
      priority: 'medium',
      labels: ['goal-autonomous-drive'],
      depends_on: [],
    },
  ];

  return { root, tasks };
}

const GOAL = { label: 'goal-autonomous-drive' };

// ---------------------------------------------------------------------------
// Scenario A — crash mid-implementation (post-commit phase): the loop should
// RESUME the recorded ticket, carrying iteration/completed_this_run forward.
// ---------------------------------------------------------------------------

describe('Drive a goal autonomously — resume after a post-commit crash', () => {
  it('checkpoint write -> fresh bundle read -> resumePoint resumes TASK-200 with counters intact', async () => {
    const { writeLoopCheckpoint, resumePoint } = await import(CHECKPOINT_URL);
    const { readBundleSession } = await import(BUNDLE_URL);
    const { root, tasks } = seedRepo({ initialPhase: 'fetch', taskStatus: 'in_progress' });

    // 1. Checkpoint write — the loop reaches the impl phase mid-ticket.
    await writeLoopCheckpoint({
      repoRoot: root,
      checkpoint: {
        current_ticket: 'TASK-200',
        phase: 'impl',
        iteration: 4,
        completed_this_run: 2,
        run_started_at: '2026-07-01T09:30:00Z',
      },
    });

    // (simulated crash — no in-memory state carries over)

    // 2. Fresh bundle read — a brand-new read of the on-disk bundle, not the
    // same object writeLoopCheckpoint touched in step 1.
    const restoredBundle = readBundleSession(root, SESSION_ID);
    expect(restoredBundle.workflow_step).toBe('impl');

    // 3. resumePoint decides from the freshly-read state.
    const decision = resumePoint({ bundle: restoredBundle, tasks });
    expect(decision.action).toBe('resume');
    expect(decision.ticket.key).toBe('TASK-200');
    expect(decision.iteration).toBe(4);
    expect(decision.completed_this_run).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Scenario B — crash before any commit (pre-commit phase): the loop must
// RESET the ticket to todo, and selectNextTicket must then pick it back up
// rather than leaving it permanently invisible (the S2 defect).
// ---------------------------------------------------------------------------

describe('Drive a goal autonomously — reset + reselect after a pre-commit crash', () => {
  it('checkpoint write at fetch phase -> fresh read -> reset -> selectNextTicket does not skip TASK-200', async () => {
    const { writeLoopCheckpoint, resumePoint } = await import(CHECKPOINT_URL);
    const { selectNextTicket } = await import(DRIVE_LOOP_URL);
    const { readBundleSession } = await import(BUNDLE_URL);
    const { root, tasks } = seedRepo({ initialPhase: 'idle', taskStatus: 'in_progress' });

    // 1. Checkpoint write — the loop crashed while still fetching the ticket,
    // before any code was committed. The task-store transition to
    // in_progress already happened (this is the S2 scenario), so the task
    // is stranded: in_progress with a pre-commit recorded phase.
    await writeLoopCheckpoint({
      repoRoot: root,
      checkpoint: {
        current_ticket: 'TASK-200',
        phase: 'fetch',
        iteration: 1,
        completed_this_run: 0,
        run_started_at: '2026-07-01T09:45:00Z',
      },
    });

    // 2. Fresh bundle read (simulated restart).
    const restoredBundle = readBundleSession(root, SESSION_ID);

    // 3. resumePoint recognizes the stranded pre-commit crash and resets.
    const decision = resumePoint({ bundle: restoredBundle, tasks });
    expect(decision.action).toBe('reset');
    expect(decision.ticket.key).toBe('TASK-200');
    expect(typeof decision.reason).toBe('string');
    expect(decision.reason.length).toBeGreaterThan(0);

    // The loop applies the reset the way the task-store transition would:
    // TASK-200 goes back to 'todo' so it becomes visible again.
    const resetTasks = tasks.map((t) => (
      t.key === decision.ticket.key ? { ...t, status: 'todo' } : t
    ));

    // 4. Before the fix, TASK-200 would stay in_progress forever and
    // selectNextTicket would silently skip it (the S2 fatal defect). After
    // the reset it must be selectable again.
    const next = selectNextTicket(resetTasks, GOAL);
    expect(next).not.toBeNull();
    expect(next.key).toBe('TASK-200');
  });
});

// ---------------------------------------------------------------------------
// TASK-071 fold-in — workflow_step written by the loop checkpoint is always
// a legal enum value regardless of which phase triggered the crash.
// ---------------------------------------------------------------------------

describe('Drive a goal autonomously — checkpoint always writes a legal workflow_step', () => {
  it('a checkpoint at the review phase persists workflow_step="review" (bundle enum member)', async () => {
    const { writeLoopCheckpoint } = await import(CHECKPOINT_URL);
    const { root } = seedRepo({ initialPhase: 'impl', taskStatus: 'in_review' });

    await writeLoopCheckpoint({
      repoRoot: root,
      checkpoint: {
        current_ticket: 'TASK-200',
        phase: 'review',
        iteration: 5,
        completed_this_run: 2,
        run_started_at: '2026-07-01T09:30:00Z',
      },
    });

    const onDisk = JSON.parse(readFileSync(join(root, 'state', 'sessions', SESSION_ID, 'session.json'), 'utf8'));
    expect(['idle', 'fetch', 'research', 'test', 'impl', 'review', 'update']).toContain(onDisk.workflow_step);
    expect(onDisk.workflow_step).toBe('review');
  });
});
