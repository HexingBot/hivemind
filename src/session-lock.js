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

import {
  existsSync, readFileSync, unlinkSync, mkdirSync, statSync, renameSync,
  openSync, writeSync, fsyncSync, closeSync, constants,
} from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
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
 * Write a lock record atomically via tmp+rename. Used for the two cases where
 * a lock file ALREADY occupies the target path and we intend to overwrite it
 * (idempotent same-holder re-acquire, and stealing a stale foreign lock).
 */
async function writeLock(repoRoot, record) {
  const target = lockFilePath(repoRoot);
  // Ensure state/ dir exists (idempotent).
  mkdirSync(join(repoRoot, 'state'), { recursive: true });
  await atomicWriteFile(target, JSON.stringify(record, null, 2) + '\n');
}

/**
 * TASK-085 AC1 — write a lock record via an OS-level exclusive create
 * (O_CREAT|O_EXCL) directly against the real lock path, NOT the tmp+rename
 * recipe. This is used ONLY for the "no lock" branch of acquire() (readLock()
 * returned null — either the file is truly absent, or a file is present but
 * unparseable). renameSync (used by writeLock/atomicWriteFile) unconditionally
 * replaces whatever occupies the target with no existence/identity check, so
 * it cannot fail closed against a pre-existing-but-corrupt file, and it gives
 * two racing "first acquire" callers no way to detect that they collided.
 * O_CREAT|O_EXCL, by contrast, fails with EEXIST whenever ANY file already
 * occupies the path (regardless of its content) — so a corrupt leftover fails
 * closed, and only one of two racing callers can ever win the create.
 */
function writeLockExclusive(repoRoot, record) {
  const target = lockFilePath(repoRoot);
  mkdirSync(join(repoRoot, 'state'), { recursive: true });
  const payload = Buffer.from(JSON.stringify(record, null, 2) + '\n', 'utf8');

  let fd;
  try {
    fd = openSync(target, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  } catch (err) {
    if (err && err.code === 'EEXIST') {
      throw makeErr(
        'E_LOCK_HELD',
        `Lock file already exists at ${target} — refusing to clobber a ` +
        'pre-existing (possibly corrupt) lock via exclusive create. ' +
        'Wait for it to release or expire.',
      );
    }
    throw err;
  }
  try {
    let written = 0;
    while (written < payload.length) {
      written += writeSync(fd, payload, written, payload.length - written);
    }
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
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

/**
 * Decide whether `existing` (a lock record, possibly null) belongs to the
 * caller identified by (myHolder, myPid, myHost).
 *
 * When either side carries a `holder_id` (the caller passed `holder`, or the
 * persisted record has one), identity is decided purely by holder_id
 * equality — pid/hostname are ignored, since a caller-supplied holder id is
 * meant to survive across fresh subprocesses with different pids. Otherwise,
 * identity falls back to the original pid+hostname comparison so behavior
 * is byte-for-byte unchanged when no caller ever opts into holder ids.
 */
function isSameHolder(existing, myHolder, myPid, myHost) {
  if (existing === null) return false;
  if (myHolder !== undefined || existing.holder_id !== undefined) {
    return existing.holder_id === myHolder;
  }
  return existing.holder_pid === myPid && existing.hostname === myHost;
}

/**
 * Build a lock record, including `holder_id` only when `holder` is defined
 * so that omitting it never introduces the field (back-compat, AC3).
 */
function makeLockRecord(myPid, myHost, nowIso, holder) {
  const record = {
    holder_pid: myPid,
    hostname: myHost,
    heartbeat_at: nowIso,
  };
  if (holder !== undefined) record.holder_id = holder;
  return record;
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
 *   holder?: string,
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
  holder,
  stalenessMs = DEFAULT_STALENESS_MS,
} = {}) {
  if (!repoRoot) throw makeErr('E_LOCK_ARGS', 'acquire: repoRoot is required');

  const nowIso = resolveNow(now);
  const myPid = pid ?? process.pid;
  const myHost = hostname ?? os.hostname();

  const existing = readLock(repoRoot);

  if (existing !== null) {
    if (isSameHolder(existing, holder, myPid, myHost)) {
      // Idempotent re-acquire: bump heartbeat and succeed. TASK-085 review
      // LOW-2 — verify-after-write kept as belt-and-braces symmetry with the
      // stale-steal branch below (a same-holder re-acquire has no realistic
      // competing writer, but the check is free and consistent).
      await writeLock(repoRoot, makeLockRecord(myPid, myHost, nowIso, holder));
      const afterRebump = readLock(repoRoot);
      if (!isSameHolder(afterRebump, holder, myPid, myHost)) {
        throw makeErr(
          'E_LOCK_HELD',
          `Lock re-acquire race detected at ${lockFilePath(repoRoot)}: a ` +
          'competing writer\'s record is now persisted instead of ours. ' +
          'Wait for it to release or expire.',
        );
      }
      return { acquired: true };
    }

    // Different holder — check freshness.
    if (isFresh(existing.heartbeat_at, nowIso, stalenessMs)) {
      // Fresh foreign lock: refuse. When the record carries a holder_id,
      // surface it alongside pid/hostname (still kept for diagnostics);
      // records without holder_id keep the original message shape.
      const holderIdPart = existing.holder_id !== undefined
        ? `holder ${existing.holder_id} (pid ${existing.holder_pid} on ${existing.hostname})`
        : `pid ${existing.holder_pid} on ${existing.hostname}`;
      const err = makeErr(
        'E_LOCK_HELD',
        `Lock is held by ${holderIdPart} ` +
        `(heartbeat: ${existing.heartbeat_at}). ` +
        'Wait for it to release or expire.',
      );
      throw err;
    }

    // Stale foreign lock: steal it (crashed-holder recovery). TASK-085 review
    // MEDIUM-1 — CAS-steal. The original design wrote our new record via the
    // tmp+rename recipe (writeLock) directly onto the lock path, which has no
    // existence/identity check at rename time; a naive re-read-after-write
    // ("verify-after-write") check does NOT close this deterministically —
    // if stealer A's entire write+verify sequence completes strictly BEFORE
    // stealer B's write lands, A sees its own content (success), B's later
    // write then silently clobbers it, and B ALSO sees its own content on
    // ITS OWN later verify (success): a double-win, with no synchronization
    // forcing the two sequences to overlap.
    //
    // Fixed via a real compare-and-swap: renameSync(lockPath, uniqueClaimPath)
    // MOVES the stale record we just observed OUT of the lock path. This is
    // atomic at the OS level — of two racing stealers who both read the SAME
    // stale record, only ONE can successfully rename that SAME source path;
    // the other gets ENOENT (the winner already moved it) and fails closed
    // with E_LOCK_HELD, deterministically, with no timing window at all. The
    // winner then writes the NEW record via the same exclusive-create
    // primitive used for first acquisition (writeLockExclusive) — the lock
    // path is now guaranteed absent, so this either succeeds outright, or
    // (residual race: a THIRD acquirer's fresh "no lock" acquire slipped in
    // during the moving-out gap) fails EEXIST, which is ALSO a legitimate
    // E_LOCK_HELD outcome (won the steal, lost the freshly-vacated slot to a
    // third party). The claim file (the dead stale record) is cleaned up
    // best-effort either way — nobody needs it again.
    const lockPath = lockFilePath(repoRoot);
    const claimPath = `${lockPath}.claim.${myPid}-${randomBytes(6).toString('hex')}`;
    try {
      renameSync(lockPath, claimPath);
    } catch (stealErr) {
      if (stealErr && stealErr.code === 'ENOENT') {
        throw makeErr(
          'E_LOCK_HELD',
          `Lock steal race lost at ${lockPath}: a competing stealer already ` +
          'claimed the stale lock an instant earlier. Wait for it to release or expire.',
        );
      }
      throw stealErr;
    }
    try {
      writeLockExclusive(repoRoot, makeLockRecord(myPid, myHost, nowIso, holder));
    } finally {
      try { unlinkSync(claimPath); } catch { /* best-effort cleanup — the claim is dead either way */ }
    }

    // Verify-after-write, kept as belt-and-braces: a legitimate competitor
    // can no longer land here (see above), but this still catches a rogue
    // direct mutation of the just-written record.
    const afterSteal = readLock(repoRoot);
    if (!isSameHolder(afterSteal, holder, myPid, myHost)) {
      throw makeErr(
        'E_LOCK_HELD',
        `Lock steal race detected at ${lockPath}: a competing writer's ` +
        'record is now persisted instead of ours. Wait for it to release or expire.',
      );
    }
    return { acquired: true };
  }

  // No valid lock record (readLock() returned null): either the file is
  // truly absent, or a file is present but unparseable. TASK-085 AC1 —
  // decide via an OS-level exclusive create directly against the real lock
  // path so a corrupt leftover fails closed instead of being silently
  // clobbered, and so two racing FIRST acquires cannot both succeed (see
  // writeLockExclusive).
  //
  // TASK-085 review MEDIUM-2 — an unparseable lock file must not deadlock
  // acquire() forever: isFresh() needs a parseable heartbeat_at, which a
  // corrupt record doesn't have, so without this check a corrupt leftover
  // would ALWAYS hit writeLockExclusive's EEXIST branch and throw
  // E_LOCK_HELD — permanently, with no staleness escape hatch. When a file
  // exists at the lock path but is unparseable, fall back to ITS MTIME: if
  // older than stalenessMs, unlink it and fall through to the same
  // exclusive-create attempt below (a one-shot "retry" that costs nothing
  // extra, since control simply continues); if still fresh, fail closed with
  // an ACCURATE message (there's no holder identity to name here, only a
  // staleness clock to wait out).
  const lockPath = lockFilePath(repoRoot);
  if (existsSync(lockPath)) {
    let corruptStat = null;
    try {
      corruptStat = statSync(lockPath);
    } catch {
      corruptStat = null; // vanished between existsSync and statSync — treat as absent
    }
    if (corruptStat) {
      const ageMs = Date.now() - corruptStat.mtimeMs;
      if (ageMs < stalenessMs) {
        throw makeErr(
          'E_LOCK_HELD',
          `Lock file at ${lockPath} is present but unparseable (corrupt or ` +
          `zero-byte) and not yet stale (age ${Math.round(ageMs)}ms < ` +
          `staleness window ${stalenessMs}ms). It will become reclaimable ` +
          'automatically once its age exceeds the staleness window.',
        );
      }
      // Stale corrupt lock — unlink and fall through to the exclusive-create
      // attempt below (a competitor may still win that attempt: EEXIST ->
      // E_LOCK_HELD, thrown by writeLockExclusive).
      try { unlinkSync(lockPath); } catch { /* best-effort; a competitor may already have reclaimed it */ }
    }
  }

  writeLockExclusive(repoRoot, makeLockRecord(myPid, myHost, nowIso, holder));

  return { acquired: true };
}

/**
 * Renew the heartbeat for the current holder.
 * Should be called periodically by the lock holder to keep the lock fresh.
 *
 * NO-OP when:
 *   - The lock file is absent (caller never acquired; minting a phantom lock
 *     would be a bug).
 *   - The lock is held by a different holder identity (keeping a foreign lock
 *     alive on the caller's clock is the exact corruption this module
 *     prevents). Identity is decided by holder_id when either side supplies
 *     one, otherwise by pid+hostname — see isSameHolder().
 *
 * @param {{
 *   repoRoot: string,
 *   now?: string | (() => string),
 *   pid?: number,
 *   hostname?: string,
 *   holder?: string,
 * }} opts
 * @returns {Promise<boolean>} true if the heartbeat was bumped, false if no-op.
 */
export async function renew({
  repoRoot,
  now,
  pid,
  hostname,
  holder,
} = {}) {
  if (!repoRoot) throw makeErr('E_LOCK_ARGS', 'renew: repoRoot is required');

  const nowIso = resolveNow(now);
  const myPid = pid ?? process.pid;
  const myHost = hostname ?? os.hostname();

  const existing = readLock(repoRoot);

  // Absent lock — no-op.
  if (existing === null) return false;

  // Foreign lock — no-op: do not keep someone else's lock alive.
  if (!isSameHolder(existing, holder, myPid, myHost)) return false;

  // We are the holder — bump heartbeat.
  await writeLock(repoRoot, makeLockRecord(myPid, myHost, nowIso, holder));
  return true;
}

/**
 * Release the advisory lock. Holder-aware and idempotent:
 *   - Same holder (decided by isSameHolder — holder_id match when either side
 *     carries one, otherwise pid + hostname match) → deletes the lock file.
 *   - Foreign lock present → NO-OP (do not delete a lock you don't hold).
 *   - Absent lock → NO-OP (idempotent, no throw).
 *
 * Callers that crash during teardown and no longer know their identity should
 * rely on the staleness mechanism: the lock will expire automatically.
 *
 * @param {{ repoRoot: string, pid?: number, hostname?: string, holder?: string }} opts
 * @returns {Promise<void>}
 */
export async function release({ repoRoot, pid, hostname, holder } = {}) {
  if (!repoRoot) throw makeErr('E_LOCK_ARGS', 'release: repoRoot is required');

  const p = lockFilePath(repoRoot);
  if (!existsSync(p)) return; // Absent — idempotent success.

  // Read who holds the lock before deciding whether to delete.
  const existing = readLock(repoRoot);
  if (existing === null) return; // Absent or corrupt — treat as already gone.

  const myPid = pid ?? process.pid;
  const myHost = hostname ?? os.hostname();

  // Foreign lock — do NOT delete it.
  if (!isSameHolder(existing, holder, myPid, myHost)) return;

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
 * @returns {Promise<{ holder_pid: number, hostname: string, heartbeat_at: string, holder_id?: string } | null>}
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
