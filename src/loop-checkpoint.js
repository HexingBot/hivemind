// src/loop-checkpoint.js
// TASK-084 — Mid-ticket crash-resume for the autonomous drive loop.
//
// Deep-review S2: a crash between a ticket's in_progress transition and its
// close leaves it permanently invisible to selectNextTicket (status stays
// in_progress forever). This module gives the loop:
//   1. A documented checkpoint writer (writeLoopCheckpoint) that records
//      current_ticket/phase/iteration/completed_this_run/run_started_at in
//      the bundle's loop_state, and maps the phase onto the bundle's
//      workflow_step enum (folds in TASK-071's enum-validity rule).
//   2. A pure decision helper (resumePoint) that inspects a freshly-read
//      bundle + task list and decides whether the recorded ticket should be
//      resumed, reset to todo, or ignored — never left invisible.
//
// Mirrors the src/operating-mode.js / src/loop-auth.js seam: readPointer /
// readBundleSession / writeBundleSession, same atomic-write path.

import { readPointer } from './pointer.js';
import { readBundleSession, writeBundleSession } from './bundle.js';

// ---------------------------------------------------------------------------
// LOOP_PHASES — identity map onto the bundle's workflow_step enum
// (['idle','fetch','research','test','impl','review','update']). Documents
// which loop phase writes which workflow_step value; a future workflow_step
// addition only needs to be added here and in state/bundle.schema.json.
// ---------------------------------------------------------------------------
export const LOOP_PHASES = {
  idle: 'idle',
  fetch: 'fetch',
  research: 'research',
  test: 'test',
  impl: 'impl',
  review: 'review',
  update: 'update',
};

// Phases reached before any commit lands — a crash recorded at one of these
// means the ticket's in_progress transition happened but nothing durable was
// produced, so the ticket must be reset rather than resumed.
const PRE_COMMIT_PHASES = ['idle', 'fetch', 'research'];

// ---------------------------------------------------------------------------
// writeLoopCheckpoint({ repoRoot, checkpoint }) → void
//
// Validates checkpoint.phase against LOOP_PHASES BEFORE any I/O — a rejected
// call never touches the filesystem. Resolves the active bundle via the
// pointer, merges the five checkpoint fields into loop_state (preserving any
// existing loop_state keys like goal/maxIterations), maps phase onto
// workflow_step, refreshes updated_at, and writes atomically. Touches
// nothing else in the bundle.
// ---------------------------------------------------------------------------
export async function writeLoopCheckpoint({ repoRoot, checkpoint }) {
  const {
    current_ticket, phase, iteration, completed_this_run, run_started_at,
  } = checkpoint || {};

  if (!Object.prototype.hasOwnProperty.call(LOOP_PHASES, phase)) {
    throw new Error(
      `Unknown loop phase ${JSON.stringify(phase)}. Must be one of: ${Object.keys(LOOP_PHASES).join(', ')}.`,
    );
  }

  const pointer = readPointer(repoRoot);
  if (!pointer) {
    throw new Error('No session pointer found — cannot write loop checkpoint without an active bundle.');
  }
  if (pointer.active_session_id == null) {
    throw new Error('No active session — cannot write loop checkpoint without an active bundle.');
  }

  const sessionId = pointer.active_session_id;
  const bundle = readBundleSession(repoRoot, sessionId);

  const updated = {
    ...bundle,
    workflow_step: LOOP_PHASES[phase],
    loop_state: {
      ...(bundle.loop_state || {}),
      current_ticket,
      phase,
      iteration,
      completed_this_run,
      run_started_at,
    },
    updated_at: new Date().toISOString(),
  };

  await writeBundleSession(repoRoot, sessionId, updated);
}

// ---------------------------------------------------------------------------
// resumePoint({ bundle, tasks }) → { action: 'none' | 'reset' | 'resume', ... }
//
// PURE — no I/O, no Date.now, no mutation of bundle or tasks.
//
//   'none'   — no loop_state, no current_ticket recorded, or the recorded
//              ticket is already done.
//   'reset'  — the recorded ticket is stranded: in_progress at a pre-commit
//              phase (idle/fetch/research), any status other than
//              in_progress/in_review while still recorded as current, or the
//              ticket key is missing from the task list entirely (dangling
//              pointer). Includes a non-empty human-readable `reason`.
//   'resume' — in_progress at a post-commit phase, or in_review regardless
//              of phase. iteration/completed_this_run/run_started_at are
//              copied VERBATIM from loop_state — never defaulted.
// ---------------------------------------------------------------------------
export function resumePoint({ bundle, tasks }) {
  const loopState = bundle && bundle.loop_state;
  if (!loopState || !loopState.current_ticket) {
    return { action: 'none' };
  }

  const {
    current_ticket, phase, iteration, completed_this_run, run_started_at,
  } = loopState;

  const list = Array.isArray(tasks) ? tasks : [];
  const found = list.find((t) => t.key === current_ticket);

  if (!found) {
    return {
      action: 'reset',
      ticket: { key: current_ticket },
      reason: `recorded ticket ${current_ticket} was not found in the task list — dangling checkpoint pointer.`,
    };
  }

  if (found.status === 'done') {
    return { action: 'none' };
  }

  if (found.status !== 'in_progress' && found.status !== 'in_review') {
    return {
      action: 'reset',
      ticket: found,
      reason: `recorded ticket ${current_ticket} has status '${found.status}', inconsistent with an active checkpoint.`,
    };
  }

  if (found.status === 'in_progress' && PRE_COMMIT_PHASES.includes(phase)) {
    return {
      action: 'reset',
      ticket: found,
      reason: `recorded ticket ${current_ticket} crashed at pre-commit phase '${phase}' — no durable work landed, resetting to todo.`,
    };
  }

  return {
    action: 'resume',
    ticket: found,
    phase,
    iteration,
    completed_this_run,
    run_started_at,
  };
}
