// src/loop-auth.js
// TASK-075 — Unattended-mode loop authorization: a single up-front human
// grant that lets the autonomous drive loop run without per-step
// supervision. Mirrors the src/operating-mode.js seam (readPointer /
// readBundleSession / writeBundleSession, same atomic-write path).

import { readPointer } from './pointer.js';
import { readBundleSession, writeBundleSession, bundleSessionPath } from './bundle.js';

// ---------------------------------------------------------------------------
// Single source-of-truth enum. The five known standing-authorization
// switches. Gate 3 (ambiguous scope) is deliberately NOT representable here
// — it has no switch and is never liftable.
//
// Object.freeze (TASK-088 LOW #1): both this array and UNATTENDED_PRESET
// below are exported live bindings. Without freezing, a caller that mutates
// them in place (e.g. `LOOP_AUTH_SWITCHES.push(...)` or
// `UNATTENDED_PRESET.auto_close_on_green_review = false`) poisons every later
// grantUnattended call in the same process, since setLoopAuth/grantUnattended
// read these constants directly rather than cloning them per call.
// ---------------------------------------------------------------------------
export const LOOP_AUTH_SWITCHES = Object.freeze([
  'auto_close_on_green_review',
  'auto_push_after_close',
  'uat_delegated_to_orchestrator',
  'auto_version_bump_on_milestone',
  'auto_consolidate',
]);

// ---------------------------------------------------------------------------
// UNATTENDED_PRESET — the single up-front grant that lets the loop run
// without supervision. auto_push_after_close and auto_version_bump_on_milestone
// stay false — those remain strictly opt-in even under the preset.
// ---------------------------------------------------------------------------
export const UNATTENDED_PRESET = Object.freeze({
  auto_close_on_green_review: true,
  uat_delegated_to_orchestrator: true,
  auto_consolidate: true,
  auto_push_after_close: false,
  auto_version_bump_on_milestone: false,
});

function makeErr(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

// ---------------------------------------------------------------------------
// validateGrantKeys(grants) — throws synchronously if any key is not a
// member of LOOP_AUTH_SWITCHES. Called before any I/O so rejected calls
// never touch the filesystem.
// ---------------------------------------------------------------------------
function validateGrantKeys(grants) {
  for (const key of Object.keys(grants || {})) {
    if (!LOOP_AUTH_SWITCHES.includes(key)) {
      throw new Error(
        `Unknown loop-auth switch ${JSON.stringify(key)}. Must be one of: ${LOOP_AUTH_SWITCHES.join(', ')}.`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// setLoopAuth({ repoRoot, grants }) → void
//
// Validates every key in `grants` against LOOP_AUTH_SWITCHES BEFORE any I/O.
// Resolves the active bundle via the pointer, merges `grants` into
// bundle.loop_auth (creating it if absent), refreshes updated_at, and writes
// atomically. Touches nothing else in the bundle.
// ---------------------------------------------------------------------------
export async function setLoopAuth({ repoRoot, grants = {} }) {
  validateGrantKeys(grants);

  const pointer = readPointer(repoRoot);
  if (!pointer || pointer.active_session_id == null) {
    throw new Error('No active session — cannot set loop auth without an active bundle.');
  }

  const sessionId = pointer.active_session_id;

  // TASK-088 LOW #2 — tailor the missing-bundle-dir path. The pointer can
  // name a session whose bundle directory was deleted or moved out from
  // under it; readBundleSession's raw ENOENT gives no clue which session or
  // where it was expected. Wrapped here (rather than in bundle.js's
  // readBundleSession itself) to keep the change narrow: readBundleSession
  // has other callers — src/close-guard.js (already wraps every call in a
  // swallowing try/catch), src/lifecycle.js (already existsSync-guards
  // before every call site, throwing its own typed E_BUNDLE_MISSING first),
  // and src/loop-checkpoint.js / src/operating-mode.js's setMode (unwrapped,
  // like this one, but out of scope for this ticket). Changing
  // readBundleSession's throw shape would ripple into all of them; a
  // caller-side wrap in this module alone does not.
  let bundle;
  try {
    bundle = readBundleSession(repoRoot, sessionId);
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      throw makeErr(
        'E_BUNDLE_MISSING',
        `setLoopAuth: bundle for session ${sessionId} is missing — the pointer names it but no session.json was found at ${bundleSessionPath(repoRoot, sessionId)}.`,
      );
    }
    throw err;
  }

  const updated = {
    ...bundle,
    loop_auth: {
      ...(bundle.loop_auth || {}),
      ...grants,
    },
    updated_at: new Date().toISOString(),
  };

  await writeBundleSession(repoRoot, sessionId, updated);
}

// ---------------------------------------------------------------------------
// grantUnattended({ repoRoot, optIns }) → void
//
// Validates `optIns` keys the same way as setLoopAuth (before any I/O), then
// calls setLoopAuth with the unattended preset merged with the caller's
// opt-ins (opt-ins may enable auto_push_after_close /
// auto_version_bump_on_milestone, which the preset alone leaves false).
// ---------------------------------------------------------------------------
export async function grantUnattended({ repoRoot, optIns = {} }) {
  validateGrantKeys(optIns);

  await setLoopAuth({
    repoRoot,
    grants: { ...UNATTENDED_PRESET, ...optIns },
  });
}
