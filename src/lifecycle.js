// src/lifecycle.js
// Lifecycle operations: start, pause, resume, end + resumeFromPointer reader.
// State transitions per research §C table.

import {
  existsSync, mkdirSync, readFileSync, readdirSync, statSync,
} from 'node:fs';
import { join } from 'node:path';

import { readPointer, writePointer, pointerFilePath } from './pointer.js';
import {
  newSessionId, bundleDirFor, bundleSessionPath, readBundleSession,
  writeBundleSession, writeManifest, makeManifest, appendLifecycleLog,
} from './bundle.js';
import { captureTranscriptRefs, snapshotTranscripts } from './transcript.js';
import { generateSummary } from './summary.js';
import { atomicWriteFile } from './atomic-write.js';
import { sweepAndRecover } from './recovery.js';

/* -------------------------------------------------------------------------- */
/*                                   start                                    */
/* -------------------------------------------------------------------------- */

/**
 * Start a new session. Creates the bundle, writes manifest + lifecycle.log + session.json,
 * then writes the pointer last.
 *
 * @param {{
 *   repoRoot: string,
 *   activeTask?: string|null,
 *   workflowStep?: string,
 *   handoffSummary?: string,
 *   nextAction?: string|null,
 *   snapshotTranscript?: boolean,
 * }} opts
 */
export async function startSession(opts) {
  const {
    repoRoot,
    activeTask = null,
    workflowStep = 'idle',
    handoffSummary = 'session started',
    nextAction = null,
    snapshotTranscript = false,
  } = opts;

  if (!repoRoot) throw makeErr('E_LIFECYCLE_ARGS', 'startSession: repoRoot is required');

  const now = new Date();
  const nowIso = now.toISOString();
  const sessionId = newSessionId(now);
  const bundleDir = bundleDirFor(repoRoot, sessionId);
  mkdirSync(bundleDir, { recursive: true });

  // Manifest first (informational; never re-written).
  await writeManifest(
    repoRoot,
    sessionId,
    makeManifest({ sessionId, createdAt: nowIso, snapshotTranscript }),
  );

  // Bundle session.json.
  await writeBundleSession(repoRoot, sessionId, {
    schema_version: 2,
    session_id: sessionId,
    lifecycle_state: 'active',
    updated_at: nowIso,
    active_task: activeTask,
    workflow_step: workflowStep,
    next_action: nextAction,
    handoff_summary: handoffSummary,
    open_questions: [],
    blockers: [],
    decisions: [],
    subagent_results: [],
    pending_human_confirmation: null,
  });

  appendLifecycleLog(repoRoot, sessionId, {
    at: nowIso,
    op: 'start',
    from_step: null,
    to_step: workflowStep,
    idempotent_noop: false,
  });

  // Transcript snapshot policy (per resolved Q #2): when opted in, snapshot on
  // every pause and end. Start itself just captures a reference doc; if also
  // opted-in we take an initial snapshot so a crash right after start still
  // has portable history.
  if (snapshotTranscript) {
    await captureTranscriptRefs({ repoRoot, sessionId });
    await snapshotTranscripts({ repoRoot, sessionId });
  }
  // When NOT opted in, we deliberately do not even write transcript.ref.json;
  // the bundle-shape test asserts the file is either absent or contentless.

  // Pointer last.
  await writePointer(repoRoot, { activeSessionId: sessionId, updatedAt: nowIso });

  return { sessionId };
}

/* -------------------------------------------------------------------------- */
/*                                   pause                                    */
/* -------------------------------------------------------------------------- */

export async function pauseSession({ repoRoot, handoffSummary, nextAction }) {
  if (!repoRoot) throw makeErr('E_LIFECYCLE_ARGS', 'pauseSession: repoRoot is required');
  if (typeof handoffSummary !== 'string' || handoffSummary.length === 0) {
    throw makeErr('E_LIFECYCLE_ARGS', 'pauseSession: handoffSummary is required');
  }

  const { sessionId, bundleState } = await loadActiveBundleForPauseResume(repoRoot);

  if (bundleState.lifecycle_state === 'ended') {
    throw makeErr('E_INVALID_TRANSITION',
      'pauseSession: cannot pause an ended session');
  }

  if (bundleState.lifecycle_state === 'paused') {
    // No-op: append log only, do not touch session.json.
    appendLifecycleLog(repoRoot, sessionId, {
      at: new Date().toISOString(),
      op: 'pause',
      from_step: bundleState.workflow_step,
      to_step: bundleState.workflow_step,
      idempotent_noop: true,
    });
    return { sessionId, noop: true };
  }

  // Active -> paused. Refresh updated_at, lifecycle_state, handoff_summary, next_action.
  // Pending_human_confirmation is preserved (resolved Q #7).
  const nowIso = new Date().toISOString();
  const next = {
    ...bundleState,
    lifecycle_state: 'paused',
    updated_at: nowIso,
    handoff_summary: handoffSummary,
    next_action: nextAction ?? bundleState.next_action,
  };
  await writeBundleSession(repoRoot, sessionId, next);

  // Snapshot transcript on every pause if the bundle was opted in at start time
  // (resolved Q #2).
  await maybeSnapshot(repoRoot, sessionId);

  appendLifecycleLog(repoRoot, sessionId, {
    at: nowIso,
    op: 'pause',
    from_step: bundleState.workflow_step,
    to_step: next.workflow_step,
    idempotent_noop: false,
  });

  return { sessionId, noop: false };
}

/* -------------------------------------------------------------------------- */
/*                                   resume                                   */
/* -------------------------------------------------------------------------- */

export async function resumeSession({ repoRoot }) {
  if (!repoRoot) throw makeErr('E_LIFECYCLE_ARGS', 'resumeSession: repoRoot is required');

  const { sessionId, bundleState } = await loadActiveBundleForPauseResume(repoRoot);

  if (bundleState.lifecycle_state === 'ended') {
    throw makeErr('E_INVALID_TRANSITION',
      'resumeSession: cannot resume an ended session; start a new one');
  }

  if (bundleState.lifecycle_state === 'active') {
    appendLifecycleLog(repoRoot, sessionId, {
      at: new Date().toISOString(),
      op: 'resume',
      from_step: bundleState.workflow_step,
      to_step: bundleState.workflow_step,
      idempotent_noop: true,
    });
    return { sessionId, noop: true };
  }

  const nowIso = new Date().toISOString();
  const next = { ...bundleState, lifecycle_state: 'active', updated_at: nowIso };
  await writeBundleSession(repoRoot, sessionId, next);

  appendLifecycleLog(repoRoot, sessionId, {
    at: nowIso,
    op: 'resume',
    from_step: bundleState.workflow_step,
    to_step: next.workflow_step,
    idempotent_noop: false,
  });

  return { sessionId, noop: false };
}

/* -------------------------------------------------------------------------- */
/*                                    end                                     */
/* -------------------------------------------------------------------------- */

export async function endSession({ repoRoot, handoffSummary }) {
  if (!repoRoot) throw makeErr('E_LIFECYCLE_ARGS', 'endSession: repoRoot is required');

  // Loading "the active bundle" for `end` tolerates pointer=null (already-ended
  // case) by falling back to the most recent bundle on disk.
  const { sessionId, bundleState } = await loadActiveBundleWithFallback(repoRoot);

  if (bundleState.lifecycle_state === 'ended') {
    appendLifecycleLog(repoRoot, sessionId, {
      at: new Date().toISOString(),
      op: 'end',
      from_step: bundleState.workflow_step,
      to_step: bundleState.workflow_step,
      idempotent_noop: true,
    });
    return { sessionId, noop: true };
  }

  if (typeof handoffSummary !== 'string' || handoffSummary.length === 0) {
    throw makeErr('E_LIFECYCLE_ARGS', 'endSession: handoffSummary is required');
  }

  const nowIso = new Date().toISOString();
  const next = {
    ...bundleState,
    lifecycle_state: 'ended',
    updated_at: nowIso,
    handoff_summary: handoffSummary,
    next_action: null,
  };
  await writeBundleSession(repoRoot, sessionId, next);

  // Always snapshot on end if opted in.
  await maybeSnapshot(repoRoot, sessionId);

  // summary.md is generated from the bundle's session.json + lifecycle.log
  // and from each touched task's linked_commits. generateSummary is pure;
  // we do the actual write here so endSession owns the file-system side
  // effects. Routed through atomicWriteFile (TASK-008 LOW #3) so the
  // tmp+fsync+rename recipe is consistent with every other bundle write.
  // Idempotency: end-on-ended returns above as a noop, so this path runs
  // at most once per session — summary.md mtime is stable across any
  // subsequent noop end calls.
  const summaryContent = generateSummary({ repoRoot, sessionId });
  await atomicWriteFile(
    join(bundleDirFor(repoRoot, sessionId), 'summary.md'),
    summaryContent,
  );

  appendLifecycleLog(repoRoot, sessionId, {
    at: nowIso,
    op: 'end',
    from_step: bundleState.workflow_step,
    to_step: next.workflow_step,
    idempotent_noop: false,
  });

  // Clear pointer.
  await writePointer(repoRoot, { activeSessionId: null, updatedAt: nowIso });

  return { sessionId, noop: false };
}

/* -------------------------------------------------------------------------- */
/*                              resumeFromPointer                             */
/* -------------------------------------------------------------------------- */

/**
 * Read-only resume payload: reads the pointer, the bundle's session.json,
 * and verifies the referenced task exists on disk. Returns the bundle state
 * (the handoff payload). Does NOT mutate anything in the repo.
 *
 * @param {{ repoRoot: string }} args
 * @returns {Promise<object>} bundle session.json contents
 */
export async function resumeFromPointer({ repoRoot }) {
  if (!repoRoot) throw makeErr('E_LIFECYCLE_ARGS', 'resumeFromPointer: repoRoot is required');
  const ptr = readPointer(repoRoot);
  if (!ptr) throw makeErr('E_NO_POINTER', 'resumeFromPointer: state/session.json not found');
  if (ptr.schema_version !== 2) {
    throw makeErr('E_STATE_SHAPE',
      `resumeFromPointer: pointer schema_version=${ptr.schema_version}, expected 2`);
  }
  if (!ptr.active_session_id) {
    throw makeErr('E_NO_ACTIVE_SESSION',
      'resumeFromPointer: pointer.active_session_id is null (idle)');
  }

  // AC1 (TASK-083) — sweep orphan tmps / recover a corrupt target BEFORE any
  // read of the bundle. See src/recovery.js's header for the case table.
  sweepAndRecover({ bundleDir: bundleDirFor(repoRoot, ptr.active_session_id) });

  const sessionPath = bundleSessionPath(repoRoot, ptr.active_session_id);
  if (!existsSync(sessionPath)) {
    throw makeErr('E_BUNDLE_MISSING',
      `resumeFromPointer: bundle session.json missing at ${sessionPath}`);
  }
  const state = readBundleSession(repoRoot, ptr.active_session_id);

  // Self-contained contract: the bundle carries the session state, but the
  // task itself travels via git. If active_task is set, the task file must
  // exist in repoRoot/tasks/.
  if (state.active_task) {
    const taskPath = join(repoRoot, 'tasks', `${state.active_task}.json`);
    if (!existsSync(taskPath)) {
      throw makeErr('E_TASK_MISSING',
        `resumeFromPointer: active_task ${state.active_task} not found at ${taskPath}`);
    }
  }

  return state;
}

/* -------------------------------------------------------------------------- */
/*                                  helpers                                   */
/* -------------------------------------------------------------------------- */

async function loadActiveBundle(repoRoot) {
  const ptr = readPointer(repoRoot);
  if (!ptr) {
    throw makeErr('E_NO_POINTER', 'No pointer file at state/session.json');
  }
  if (!ptr.active_session_id) {
    throw makeErr('E_NO_ACTIVE_SESSION',
      'pointer.active_session_id is null (no active session)');
  }
  const sessionId = ptr.active_session_id;

  // AC1 (TASK-083) — sweep before reading, same as resumeFromPointer.
  sweepAndRecover({ bundleDir: bundleDirFor(repoRoot, sessionId) });

  const sp = bundleSessionPath(repoRoot, sessionId);
  if (!existsSync(sp)) {
    throw makeErr('E_BUNDLE_MISSING', `bundle session.json missing at ${sp}`);
  }
  const bundleState = readBundleSession(repoRoot, sessionId);
  return { sessionId, bundleState };
}

/**
 * Pause/resume bundle loader (TASK-008 LOW #2). No mtime-fallback: if the
 * pointer is missing or null, surface E_NO_ACTIVE_SESSION rather than silently
 * targeting the most-recently-modified bundle (which produced a confusing
 * E_INVALID_TRANSITION when that bundle happened to be ended). Pause/resume
 * require an explicit non-null pointer; the "ended bundle still reachable via
 * pointer" branch keeps emitting E_INVALID_TRANSITION through the caller's
 * lifecycle_state check.
 */
async function loadActiveBundleForPauseResume(repoRoot) {
  return loadActiveBundle(repoRoot);
}

/**
 * end-only bundle loader. Tolerates pointer=null by falling back to the
 * most-recently-modified bundle on disk. This is what `endSession` needs so
 * the idempotent end-on-ended noop branch can find the previously-ended
 * bundle (whose pointer was cleared by the prior `end`).
 */
async function loadActiveBundleWithFallback(repoRoot) {
  try {
    return await loadActiveBundle(repoRoot);
  } catch (err) {
    if (err.code !== 'E_NO_ACTIVE_SESSION' && err.code !== 'E_NO_POINTER') throw err;
    const fallback = findMostRecentBundle(repoRoot);
    if (!fallback) throw err;
    const bundleState = readBundleSession(repoRoot, fallback);
    return { sessionId: fallback, bundleState };
  }
}

async function maybeSnapshot(repoRoot, sessionId) {
  // Read manifest for the snapshot_transcript flag (set once at start time).
  try {
    const manifestRaw = readFileSync(
      join(bundleDirFor(repoRoot, sessionId), 'manifest.json'),
      'utf8',
    );
    const manifest = JSON.parse(manifestRaw);
    if (manifest.snapshot_transcript === true) {
      await snapshotTranscripts({ repoRoot, sessionId });
      await captureTranscriptRefs({ repoRoot, sessionId });
    }
  } catch {
    // manifest unreadable -> skip snapshot quietly. The lifecycle.log
    // remains the audit trail; a broken manifest is logged elsewhere.
  }
}

function findMostRecentBundle(repoRoot) {
  // Best-effort: pick the bundle whose session.json has the highest mtime.
  // Only used as a fallback when the pointer is null but the caller is
  // ending a session.
  const dir = join(repoRoot, 'state', 'sessions');
  if (!existsSync(dir)) return null;
  const entries = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => ({
      name: d.name,
      mtimeMs: safeMtime(join(dir, d.name, 'session.json')),
    }))
    .filter((e) => e.mtimeMs > 0)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return entries[0]?.name ?? null;
}

function safeMtime(p) {
  try {
    return statSync(p).mtimeMs;
  } catch {
    return 0;
  }
}

function makeErr(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}
