// src/loop-auth.js
// TASK-075 — Unattended-mode loop authorization: a single up-front human
// grant that lets the autonomous drive loop run without per-step
// supervision. Mirrors the src/operating-mode.js seam (readPointer /
// readBundleSession / writeBundleSession, same atomic-write path).

import { readPointer } from './pointer.js';
import { readBundleSession, writeBundleSession } from './bundle.js';

// ---------------------------------------------------------------------------
// Single source-of-truth enum. The five known standing-authorization
// switches. Gate 3 (ambiguous scope) is deliberately NOT representable here
// — it has no switch and is never liftable.
// ---------------------------------------------------------------------------
export const LOOP_AUTH_SWITCHES = [
  'auto_close_on_green_review',
  'auto_push_after_close',
  'uat_delegated_to_orchestrator',
  'auto_version_bump_on_milestone',
  'auto_consolidate',
];

// ---------------------------------------------------------------------------
// UNATTENDED_PRESET — the single up-front grant that lets the loop run
// without supervision. auto_push_after_close and auto_version_bump_on_milestone
// stay false — those remain strictly opt-in even under the preset.
// ---------------------------------------------------------------------------
export const UNATTENDED_PRESET = {
  auto_close_on_green_review: true,
  uat_delegated_to_orchestrator: true,
  auto_consolidate: true,
  auto_push_after_close: false,
  auto_version_bump_on_milestone: false,
};

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
  const bundle = readBundleSession(repoRoot, sessionId);

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
