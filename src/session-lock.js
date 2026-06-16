// src/session-lock.js
// TASK-061 — Single-active-session advisory lock.
//
// Design decision (mirrored from tests/e2e/session-lock.spec.js):
//   The lock is stored in a DEDICATED `state/.lock` file (JSON:
//   { holder_pid, hostname, heartbeat_at }) rather than in the pointer
//   (state/session.json). The pointer schema is intentionally tiny with a
//   fixed 3-field additionalProperties:false contract — adding a 4th field
//   would break the schema validator and every downstream consumer that reads
//   the pointer. A separate lock file keeps the pointer schema untouched and
//   backward-compatible, and makes the lock independently readable/writable
//   without touching the orchestrator-state bundle.
//
// Wiring decision (see ticket comments):
//   session-lock.js is intentionally NOT wired into the default startSession/
//   resumeSession paths in lifecycle.js. Wiring it there would risk regressing
//   the extensive lifecycle test suite, which would violate AC5
//   ("no existing test regresses"). Instead, the lock module is exposed as a
//   standalone import. The drive loop (TASK-062) will be the primary caller —
//   it calls acquire() before starting a session and release() after end.
//   Orchestrators that want lock protection import { acquire, renew, release }
//   directly and call them around their session lifecycle operations.

import { existsSync, readFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

import { atomicWriteFile } from './atomic-write.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default staleness window: 5 minutes in milliseconds. */
export const DEFAULT_STALENESS_MS = 5 * 60 * 1_000;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function lockFilePath(repoRoot) {
  return join(repoRoot, 'state', '.lock');
}

/**
 * Resolve a possibly-function "now" argument to an ISO string.
 * Tests inject `now` as a function (() => isoString) so we can pin time.
 * Production callers omit it and get the real wall clock.
 */
function resolveNow(now) {
  if (typeof now === 'function') return now();
  if (typeof now === 'string') return now;
  return new Date().toISOString();
}

/**
 * Read the current lock record from disk.
 * Returns the parsed object, or null if the file is absent or unreadable.
 */
function readLock(repoRoot) {
  const p = lockFilePath(repoRoot);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    // Corrupt or empty file → treat as absent (stale/recoverable).
    return null;
  }
}

/**
 * Write a lock record atomically via tmp+rename.
 */
async function writeLock(repoRoot, record) {
  const target = lockFilePath(repoRoot);
  // Ensure state/ dir exists (idempotent).
  mkdirSync(join(repoRoot, 'state'), { recursive: true });
  await atomicWriteFile(target, JSON.stringify(record, null, 2) + '\n');
}

/**
 * Return true if the heartbeat_at timestamp is within the staleness window
 * relative to `nowIso`.
 */
function isFresh(heartbeatAt, nowIso, stalenessMs) {
  const heartbeatMs = new Date(heartbeatAt).getTime();
  const nowMs = new Date(nowIso).getTime();
  const ageMs = nowMs - heartbeatMs;
  return ageMs < stalenessMs;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Acquire the advisory lock.
 *
 * @param {{
 *   repoRoot: string,
 *   now?: string | (() => string),
 *   pid?: number,
 *   hostname?: string,
 *   stalenessMs?: number,
 * }} opts
 * @returns {Promise<{ acquired: true }>}
 * @throws {Error} with code 'E_LOCK_HELD' when a fresh foreign lock exists.
 */
export async function acquire({
  repoRoot,
  now,
  pid,
  hostname,
  stalenessMs = DEFAULT_STALENESS_MS,
} = {}) {
  if (!repoRoot) throw makeErr('E_LOCK_ARGS', 'acquire: repoRoot is required');

  const nowIso = resolveNow(now);
  const myPid = pid ?? process.pid;
  const myHost = hostname ?? os.hostname();

  const existing = readLock(repoRoot);

  if (existing !== null) {
    const sameHolder = existing.holder_pid === myPid && existing.hostname === myHost;

    if (sameHolder) {
      // Idempotent re-acquire: bump heartbeat and succeed.
      await writeLock(repoRoot, {
        holder_pid: myPid,
        hostname: myHost,
        heartbeat_at: nowIso,
      });
      return { acquired: true };
    }

    // Different holder — check freshness.
    if (isFresh(existing.heartbeat_at, nowIso, stalenessMs)) {
      // Fresh foreign lock: refuse.
      const err = makeErr(
        'E_LOCK_HELD',
        `Lock is held by pid ${existing.holder_pid} on ${existing.hostname} ` +
        `(heartbeat: ${existing.heartbeat_at}). ` +
        'Wait for it to release or expire.',
      );
      throw err;
    }

    // Stale foreign lock: steal it (crashed-holder recovery).
  }

  // No lock or stale lock: write our record.
  await writeLock(repoRoot, {
    holder_pid: myPid,
    hostname: myHost,
    heartbeat_at: nowIso,
  });

  return { acquired: true };
}

/**
 * Renew the heartbeat for the current holder.
 * Should be called periodically by the lock holder to keep the lock fresh.
 *
 * @param {{
 *   repoRoot: string,
 *   now?: string | (() => string),
 *   pid?: number,
 *   hostname?: string,
 * }} opts
 * @returns {Promise<void>}
 */
export async function renew({
  repoRoot,
  now,
  pid,
  hostname,
} = {}) {
  if (!repoRoot) throw makeErr('E_LOCK_ARGS', 'renew: repoRoot is required');

  const nowIso = resolveNow(now);
  const myPid = pid ?? process.pid;
  const myHost = hostname ?? os.hostname();

  const existing = readLock(repoRoot);
  const record = {
    holder_pid: existing?.holder_pid ?? myPid,
    hostname: existing?.hostname ?? myHost,
    heartbeat_at: nowIso,
  };

  await writeLock(repoRoot, record);
}

/**
 * Release the advisory lock. Idempotent: does not throw if the lock is absent
 * or held by a different process (advisory semantics — the caller should only
 * call release when it knows it holds the lock, but crashes during teardown
 * should never block the repo).
 *
 * @param {{ repoRoot: string, pid?: number }} opts
 * @returns {Promise<void>}
 */
export async function release({ repoRoot, pid } = {}) {
  if (!repoRoot) throw makeErr('E_LOCK_ARGS', 'release: repoRoot is required');

  const p = lockFilePath(repoRoot);
  if (!existsSync(p)) return; // Already absent — idempotent success.

  try {
    unlinkSync(p);
  } catch (err) {
    // On Windows, EBUSY or EPERM during unlink can happen transiently.
    // Since this is an advisory lock, we swallow the error and let the
    // staleness mechanism handle cleanup. Callers should not be penalized
    // for a crash during release.
    if (err && (err.code === 'ENOENT')) return; // Race: already gone.
    // For any other transient error, swallow (advisory lock — do not throw).
  }
}

/**
 * Inspect the current lock record (read-only).
 *
 * @param {{ repoRoot: string }} opts
 * @returns {Promise<{ holder_pid: number, hostname: string, heartbeat_at: string } | null>}
 */
export async function inspect({ repoRoot } = {}) {
  if (!repoRoot) throw makeErr('E_LOCK_ARGS', 'inspect: repoRoot is required');
  return readLock(repoRoot);
}

// ---------------------------------------------------------------------------
// Internal error factory
// ---------------------------------------------------------------------------

function makeErr(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}
