// src/operating-mode.js
// TASK-063 — Operating-mode state (loop vs harness).
//
// Exposes getMode / setMode for reading and writing the session's operating
// mode ('harness' | 'loop') via the active bundle.  Uses the existing pointer
// + bundle helpers so there is one atomic-write path for all session state.

import { readPointer } from './pointer.js';
import { readBundleSession, readBundleSessionOrThrow, writeBundleSession } from './bundle.js';

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
  // TASK-092 — tailor the missing-bundle-dir case into a typed
  // E_BUNDLE_MISSING rather than a raw ENOENT (shared with src/loop-auth.js
  // and src/loop-checkpoint.js's writeLoopCheckpoint). getMode above is
  // deliberately NOT migrated — it already swallows every error and
  // defaults to 'harness', so the raw readBundleSession there is unchanged.
  const bundle = readBundleSessionOrThrow(repoRoot, sessionId, 'setMode');

  // Merge mode and refresh updated_at, then write atomically.
  const updated = {
    ...bundle,
    mode,
    updated_at: new Date().toISOString(),
  };

  await writeBundleSession(repoRoot, sessionId, updated);
}

// ---------------------------------------------------------------------------
// toggleMode({ repoRoot }) → 'harness' | 'loop'
//
// Reads the current mode via getMode, flips harness↔loop, calls setMode with
// the inverted value, then returns the NEW mode.  Requires an active session
// (setMode will throw if none).
// ---------------------------------------------------------------------------
export async function toggleMode({ repoRoot }) {
  const current = await getMode({ repoRoot });
  const next = current === 'loop' ? 'harness' : 'loop';
  await setMode({ repoRoot, mode: next });
  return next;
}
