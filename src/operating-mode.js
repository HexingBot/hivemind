// src/operating-mode.js
// TASK-063 — Operating-mode state (loop vs harness).
//
// Exposes getMode / setMode for reading and writing the session's operating
// mode ('harness' | 'loop') via the active bundle.  Uses the existing pointer
// + bundle helpers so there is one atomic-write path for all session state.

import { readPointer } from './pointer.js';
import {
  readBundleSession, readBundleSessionOrThrow, writeBundleSession, bundleSessionPath,
} from './bundle.js';

// ---------------------------------------------------------------------------
// Single source-of-truth enum.  All callers MUST reference this constant so
// a future value addition (e.g. 'dry-run') only needs to be added here.
// ---------------------------------------------------------------------------
export const OPERATING_MODES = ['harness', 'loop'];

// TASK-236 (WG-H-007/WG-H-010, wargaming 2026-09-16) — thrown by getMode when
// the pointer or the active bundle EXISTS but cannot be trusted: corrupt JSON
// (truncated file), a pointer naming a session whose bundle directory does
// not exist (a "ghost" pointer), or a pointer declaring a schema_version this
// code does not recognize. `.code` lets a caller distinguish which of the
// three happened instead of inferring from a generic Error. This is the
// empty-result contract (TASK-192, CLAUDE.md) applied to getMode: 'harness'
// now means ONLY "no session / no mode declared" (legitimate, silent); any
// state that EXISTS but is unreadable is a NAMED error, never a silent
// 'harness' default — see getMode's doc comment below for the full case
// table and why the prior "swallow everything" behavior let corrupting a
// state file turn a denied close into a permitted one.
export class ModeStateError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ModeStateError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// getMode({ repoRoot }) → 'harness' | 'loop'
//
// Reads the pointer, then reads the active bundle, and returns bundle.mode
// if present and valid.
//
// TASK-236 (WG-H-007/WG-H-010) — getMode used to catch EVERY error (missing
// pointer, missing bundle, corrupt JSON, unrecognized schema_version) in one
// blanket try/catch and return 'harness' regardless of which happened. That
// made a truncated/corrupted state file indistinguishable from a legitimate
// idle repo — and because src/close-guard.js's loopModeCloseGuard only acts
// when mode === 'loop', corrupting a state file silently turned a DENIED
// close into a PERMITTED one (a safety guard failing open, the wrong
// direction for a safety guard).
//
// getMode now distinguishes exactly two families of outcome:
//   - LEGITIMATE 'harness' (returned normally, no error): no pointer file at
//     all, pointer.active_session_id is null, or the bundle exists and
//     simply does not declare a `mode` field. This is the documented idle
//     state and MUST keep working unmodified (a fresh repo with no state/ is
//     the common case, not a defect).
//   - CORRUPT STATE (thrown ModeStateError, never masked as 'harness'): the
//     pointer file exists but is not valid JSON (E_MODE_POINTER_CORRUPT);
//     the pointer declares a schema_version other than the one this code
//     understands (E_MODE_POINTER_INVALID); the pointer names a session
//     whose bundle directory/session.json does not exist, i.e. a ghost
//     pointer (E_MODE_BUNDLE_MISSING); the bundle's own session.json
//     exists but is not valid JSON — truncated or otherwise corrupted
//     (E_MODE_BUNDLE_CORRUPT); or the bundle IS valid JSON and DOES declare
//     a `mode` field, but the value is not one of OPERATING_MODES (e.g.
//     'loop' byte-corrupted in place to 'lo0p') (E_MODE_BUNDLE_INVALID).
//     This last case is deliberately distinct from "no mode field at all"
//     (legitimate harness, above): a bundle that never mentions `mode` is
//     the documented idle/legacy shape, but a bundle that mentions `mode`
//     with a value this code does not recognize is state that exists and
//     cannot be trusted — the same distinguishability contract the other
//     three corrupt-state cases already apply.
//
// Callers that do not catch ModeStateError (e.g. src/close-guard.js's
// loopModeCloseGuard/loopModeUatCommentGuard) let it propagate, which aborts
// whatever guarded operation was in flight — denying/escalating rather than
// silently permitting, which is the property WG-H-007 requires: a corrupted
// bundle must never make a guard MORE permissive than the same guard is with
// a healthy bundle.
// ---------------------------------------------------------------------------
export async function getMode({ repoRoot }) {
  let pointer;
  try {
    pointer = readPointer(repoRoot);
  } catch (err) {
    throw new ModeStateError(
      `getMode: state/session.json exists but could not be parsed (${err.message})`,
      'E_MODE_POINTER_CORRUPT',
    );
  }

  // TASK-236 LOW-3 (review 2026-09-17) — two DELIBERATE silent-'harness'
  // edges live in this short-circuit and the ordering below; write down why
  // so a future pass does not "fix" them by accident:
  //   (a) a pointer that parses to a non-object, or one that parses fine but
  //       simply lacks `active_session_id` (a legacy v1 pointer shape, which
  //       predates schema_version and active_session_id both), bypasses ALL
  //       validation below via this `== null` short-circuit and returns
  //       'harness' with no error.
  //   (b) the schema_version check right below is ordered AFTER this
  //       short-circuit, so `{schema_version: 999, active_session_id: null}`
  //       ALSO returns 'harness' silently instead of hitting
  //       E_MODE_POINTER_INVALID — schema_version is never even inspected
  //       when there's no active session to report on.
  // Both are correct as written, not oversights: they are what lets a
  // legacy v1 state file (no active_session_id at all) keep reading as
  // ordinary idle harness instead of a hard error, per AC5 and this
  // ticket's own out-of-scope note (v1→v2 migration is not this ticket's
  // job). The schema_version/ghost-bundle/corrupt-bundle checks below only
  // ever fire once there IS a real active_session_id to validate against.
  if (!pointer || pointer.active_session_id == null) return 'harness';

  if (pointer.schema_version !== 2) {
    throw new ModeStateError(
      'getMode: state/session.json has an unrecognized schema_version '
        + `(${JSON.stringify(pointer.schema_version)}, expected 2)`,
      'E_MODE_POINTER_INVALID',
    );
  }

  let bundle;
  try {
    bundle = readBundleSession(repoRoot, pointer.active_session_id);
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      throw new ModeStateError(
        `getMode: the pointer names session ${pointer.active_session_id} but no bundle was `
          + `found at ${bundleSessionPath(repoRoot, pointer.active_session_id)}`,
        'E_MODE_BUNDLE_MISSING',
      );
    }
    throw new ModeStateError(
      `getMode: the bundle for session ${pointer.active_session_id} exists but could not be `
        + `read (${err.message})`,
      'E_MODE_BUNDLE_CORRUPT',
    );
  }

  // TASK-236 MEDIUM-1 (review 2026-09-17) — `bundle.mode == null` (no `mode`
  // field at all) is the legitimate, silent 'harness' default (CU5). A
  // bundle that DOES declare `mode` but with a value outside
  // OPERATING_MODES is corrupt state, not idle state, and must be a named
  // error like the other three corrupt-state cases above — the prior
  // "anything not recognized silently becomes harness" collapsed "no mode
  // declared" and "mode declared but garbage" into one indistinguishable
  // outcome, which is exactly the TASK-192 distinguishability contract this
  // whole ticket exists to restore.
  if (bundle.mode != null && !OPERATING_MODES.includes(bundle.mode)) {
    throw new ModeStateError(
      `getMode: the bundle for session ${pointer.active_session_id} declares an unrecognized `
        + `mode (${JSON.stringify(bundle.mode)}, expected one of: ${OPERATING_MODES.join(', ')})`,
      'E_MODE_BUNDLE_INVALID',
    );
  }

  return bundle.mode == null ? 'harness' : bundle.mode;
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
