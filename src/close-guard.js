// src/close-guard.js
// TASK-082 — the injectable loop-mode close guard: the `closeGuard` seam that
// task-store.js's transitionStatus/closeTask accept and call BEFORE any disk
// write when status === 'done'. task-store.js itself imports nothing from
// this module (or bundle.js/operating-mode.js/loop-auth.js) — the MCP layer
// (src/mcp-server.js) is what imports loopModeCloseGuard and passes it in as
// `closeGuard`, keeping task-store decoupled from session/bundle internals.

import { readPointer } from './pointer.js';
import { readBundleSession } from './bundle.js';
import { getMode } from './operating-mode.js';

/**
 * Thrown when loop mode is active but the human has not granted
 * auto_close_on_green_review. `.code` lets callers distinguish this from any
 * other rejection.
 */
export class LoopCloseGuardError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LoopCloseGuardError';
    this.code = 'LOOP_CLOSE_GUARD_DENIED';
  }
}

/**
 * loopModeCloseGuard({ repoRoot, task, key }) — the closeGuard implementation
 * for autonomous loop mode.
 *
 *   - Reads the operating mode via src/operating-mode.js's getMode, which
 *     already defaults to 'harness' on any missing/corrupt pointer or bundle.
 *   - mode !== 'loop' (including 'harness' or no active session) -> resolves
 *     without throwing (no-op).
 *   - mode === 'loop' -> reads the active bundle's loop_auth directly (the
 *     same readPointer/readBundleSession primitives operating-mode.js and
 *     loop-auth.js already use) and throws LoopCloseGuardError unless
 *     loop_auth.auto_close_on_green_review === true.
 */
export async function loopModeCloseGuard({ repoRoot }) {
  const mode = await getMode({ repoRoot });
  if (mode !== 'loop') return;

  let loopAuth = {};
  try {
    const pointer = readPointer(repoRoot);
    if (pointer && pointer.active_session_id != null) {
      const bundle = readBundleSession(repoRoot, pointer.active_session_id);
      loopAuth = (bundle && bundle.loop_auth) || {};
    }
  } catch (_err) {
    loopAuth = {};
  }

  if (loopAuth.auto_close_on_green_review !== true) {
    throw new LoopCloseGuardError(
      'loop mode is active but auto_close_on_green_review has not been granted — cannot close this task automatically',
    );
  }
}
