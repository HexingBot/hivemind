// src/operating-mode.js
// TASK-063 — Operating-mode state (loop vs harness).
//
// Exposes getMode / setMode for reading and writing the session's operating
// mode ('harness' | 'loop') via the active bundle.  Uses the existing pointer
// + bundle helpers so there is one atomic-write path for all session state.

import { readPointer } from './pointer.js';
import { readBundleSession, writeBundleSession } from './bundle.js';

// ---------------------------------------------------------------------------
// Single source-of-truth enum.  All callers MUST reference this constant so
// a future value addition (e.g. 'dry-run') only needs to be added here.
// ---------------------------------------------------------------------------
export const OPERATING_MODES = ['harness', 'loop'];

// ---------------------------------------------------------------------------
// getMode({ repoRoot }) → 'harness' | 'loop'
//
// Reads the pointer, then reads the active bundle.  Returns bundle.mode if
// present and valid, otherwise returns 'harness' (backward-compatible default).
// Never throws — a missing/corrupt pointer or bundle → 'harness'.
// ---------------------------------------------------------------------------
export async function getMode({ repoRoot }) {
  try {
    const pointer = readPointer(repoRoot);
    if (!pointer || pointer.active_session_id == null) return 'harness';

    const bundle = readBundleSession(repoRoot, pointer.active_session_id);
    return OPERATING_MODES.includes(bundle.mode) ? bundle.mode : 'harness';
  } catch (_err) {
    return 'harness';
  }
}

// ---------------------------------------------------------------------------
// setMode({ repoRoot, mode }) → void
//
// Validates `mode` against OPERATING_MODES (throws on anything invalid,
// including non-strings, null, '', numbers, unknown strings).  Resolves the
// active bundle via the pointer, merges `mode` into the bundle session object,
// and writes it back atomically via writeBundleSession.  Idempotent.
// ---------------------------------------------------------------------------
export async function setMode({ repoRoot, mode }) {
  if (!OPERATING_MODES.includes(mode)) {
    throw new Error(
      `Invalid mode ${JSON.stringify(mode)}. Must be one of: harness, loop.`,
    );
  }

  const pointer = readPointer(repoRoot);
  if (!pointer || pointer.active_session_id == null) {
    throw new Error('No active session — cannot set mode without an active bundle.');
  }

  const sessionId = pointer.active_session_id;
  const bundle = readBundleSession(repoRoot, sessionId);

  // Merge mode and refresh updated_at, then write atomically.
  const updated = {
    ...bundle,
    mode,
    updated_at: new Date().toISOString(),
  };

  await writeBundleSession(repoRoot, sessionId, updated);
}
