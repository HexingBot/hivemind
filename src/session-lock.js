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
  existsSync, readFileSync, readdirSync, unlinkSync, mkdirSync, statSync, renameSync,
  openSync, writeSync, fsyncSync, closeSync, constants, utimesSync,
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

/** Matches a leftover CAS-steal claim file: state/.lock.claim.<pid>-<hex>. */
const CLAIM_FILE_RE = /^\.lock\.claim\.\d+-[0-9a-f]+$/;

/**
 * Read the raw bytes of the lock file, or null if absent/unreadable.
 * Kept separate from readLock() so callers that need to content-check a
 * CAS-steal (TASK-090 AC1/AC2) can capture the exact bytes observed, not
 * just the parsed object.
 */
function readLockRaw(repoRoot) {
  const p = lockFilePath(repoRoot);
  if (!existsSync(p)) return null;
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

/** Parse a lock record's raw bytes; returns null on invalid JSON. */
function tryParseLock(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Read the current lock record from disk.
 * Returns the parsed object, or null if the file is absent or unreadable.
 */
function readLock(repoRoot) {
  const raw = readLockRaw(repoRoot);
  return raw !== null ? tryParseLock(raw) : null;
}

/**
 * TASK-090 AC4 — opportunistically reap leftover CAS-steal claim files
 * (state/.lock.claim.*) once they age past the staleness window. A claim
 * file is a transient artifact of an in-flight steal (see
 * stealAwayContentChecked below); it is normally unlinked within the same
 * acquire() call. One can be left behind only if the process crashes
 * between the CAS rename and the finally-unlink (or, per AC1/AC2, when a
 * content mismatch is detected and the best-effort restore itself loses to
 * a third party) — nothing else ever sweeps it. Best-effort and
 * non-blocking: any per-file error (including Windows EPERM/EBUSY against a
 * file another process still has open) is swallowed, since this is a
 * courtesy cleanup, not a correctness requirement.
 *
 * Review LOW-3 — a claim file's mtime reflects time-since-claimed, not
 * time-since-the-original-lock-went-stale: stealAwayContentChecked() bumps
 * it to "now" via utimesSync immediately after the CAS rename, specifically
 * because renameSync would otherwise preserve the stale source lock's own
 * (already old) mtime, which would make every claim instantly reap-eligible
 * the moment it's created — a liveness bug that could reap a claim still
 * legitimately mid-steal.
 */
function sweepStaleClaimFiles(repoRoot, stalenessMs) {
  const stateDir = join(repoRoot, 'state');
  let entries;
  try {
    entries = readdirSync(stateDir);
  } catch {
    return; // state dir absent/unreadable — nothing to sweep
  }
  // Nit — this uses the REAL wall clock, not the injectable `now` that
  // acquire()'s own lock-staleness decisions accept (resolveNow(now)).
  // Claim-file housekeeping is an operational concern, not a test-pinned
  // business rule, so no injection seam is threaded through here; tests
  // that need control over claim-file age backdate mtime directly via
  // utimesSync instead (see the AC4 spec).
  const nowMs = Date.now();
  for (const name of entries) {
    if (!CLAIM_FILE_RE.test(name)) continue;
    const p = join(stateDir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue; // vanished already — fine
    }
    if (nowMs - st.mtimeMs < stalenessMs) continue; // fresh — may be in-flight
    try {
      unlinkSync(p);
    } catch {
      // best-effort — swallow (Windows EPERM/EBUSY, or already gone)
    }
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
 * TASK-090 AC1/AC2 — content-checked CAS steal: rename whatever currently
 * occupies the lock path away to a unique claim path, then verify the claim
 * file's raw bytes byte-match `expectedRaw` — the exact content observed
 * when the caller decided this lock was reclaimable (a stale foreign lock,
 * or a stale corrupt/unparseable one).
 *
 * Honest accounting of what this does and does not close: renameSync (like
 * unlinkSync) acts purely on the PATH, with no identity or content check of
 * its own — POSIX offers no direct "rename only if the target still has
 * inode X" primitive here. A reclaimer descheduled between its staleness
 * read and this rename can still walk away with a fresh competitor's
 * brand-new, perfectly live record if that competitor re-creates the lock
 * at the same path in that exact gap. The content check narrows the window
 * to precisely that gap (read-to-rename) and turns what would otherwise be
 * a silent double-win (or, on the unlink side, silent lock destruction)
 * into a detected, fail-closed E_LOCK_HELD — it does not, and cannot,
 * eliminate the window outright without filesystem-level CAS support.
 *
 * On a content mismatch, best-effort restores the captured content to the
 * lock path via exclusive-create (so a third party who has since reclaimed
 * the slot is never clobbered), then throws.
 *
 * @returns {string} the claim path, once the content check has passed.
 * @throws {Error} E_LOCK_HELD — either the rename lost a race (ENOENT), the
 *   claimed file vanished before it could be verified, or its content did
 *   not match what was observed pre-steal.
 */
function stealAwayContentChecked(repoRoot, myPid, expectedRaw) {
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

  // Review LOW-3 — renameSync PRESERVES the source's mtime, so a claim
  // minted from an already-stale lock (that's the whole reason we're
  // stealing it) is born with an mtime that already looks old to
  // sweepStaleClaimFiles(). Left uncorrected, a concurrent acquire()'s sweep
  // could reap this claim file while THIS steal is still mid-flight (between
  // this rename and the caller's finally-unlink), well before it has
  // actually been sitting idle for a full staleness window. This is a
  // liveness quirk only, not a safety hole — if the claim vanishes out from
  // under us, the readFileSync below simply fails and we throw E_LOCK_HELD
  // rather than silently succeeding on missing content. Bumping the mtime to
  // "now" here gives the claim file an honest age (time-since-claimed, not
  // time-since-the-lock-went-stale) so the sweep's staleness window means
  // what it says.
  try {
    const claimedAt = new Date();
    utimesSync(claimPath, claimedAt, claimedAt);
  } catch {
    // best-effort — a failure here only reintroduces the liveness quirk
    // above, never a correctness issue.
  }

  let claimRaw;
  try {
    claimRaw = readFileSync(claimPath, 'utf8');
  } catch {
    throw makeErr(
      'E_LOCK_HELD',
      `Lock steal race at ${lockPath}: the claimed file vanished before it ` +
      'could be content-verified. Wait for it to release or expire.',
    );
  }

  if (claimRaw !== expectedRaw) {
    // Content mismatch: what we renamed away is NOT the stale record we
    // decided to reclaim — a fresh competitor re-created a live record at
    // this path in the gap between our staleness read and this rename.
    // Restore it (best-effort) so their lock is not lost, then fail closed
    // ourselves rather than proceeding on borrowed/misattributed content.
    //
    // Review LOW-2 — restoreExclusive() can itself throw a raw fs error
    // (e.g. Windows EPERM/EBUSY against the now-vacant path, for reasons
    // other than the EEXIST it already handles). That raw error must never
    // escape in place of E_LOCK_HELD — a caller catching for E_LOCK_HELD
    // would otherwise see an unrelated, undocumented error shape. Any
    // restore failure — EEXIST (handled, returns false) or any other thrown
    // error (caught here) — is treated identically: restored = false.
    let restored = false;
    try {
      restored = restoreExclusive(lockPath, claimRaw);
    } catch {
      restored = false;
    }
    if (restored) {
      try { unlinkSync(claimPath); } catch { /* best-effort cleanup */ }
    }
    // else: either a third party has since reclaimed the slot at lockPath,
    // or the restore attempt itself failed — either way leave the claim
    // file behind rather than risk clobbering whoever holds lockPath now.
    // Consequence: the competitor's own captured record is left stranded in
    // the claim file — they still believe they hold the lock, but their
    // record is no longer at the canonical lock path, so nothing re-attaches
    // it as their live lock. This is an accepted, narrow residual:
    // sweepStaleClaimFiles() (AC4) reaps the stranded claim file once it
    // ages past the staleness window, same as any other dead claim.
    throw makeErr(
      'E_LOCK_HELD',
      `Lock steal content-check failed at ${lockPath}: the record renamed ` +
      'away did not byte-match the record observed before stealing — a ' +
      'fresh competitor likely re-created the lock in the narrow read-to-' +
      'rename window. Refusing to proceed; wait for it to release or expire.',
    );
  }

  return claimPath;
}

/**
 * Best-effort exclusive-create restore of previously-captured raw content.
 * Returns false (no-op) if the target path is already occupied — the
 * caller must not clobber whoever holds it now.
 */
function restoreExclusive(targetPath, rawContent) {
  const payload = Buffer.from(rawContent, 'utf8');
  let fd;
  try {
    fd = openSync(targetPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  } catch (err) {
    if (err && err.code === 'EEXIST') return false;
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
  return true;
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

  // TASK-090 AC4 — opportunistic sweep of leftover CAS-steal claim files.
  // Cheap (one readdir) and safe to run unconditionally on every acquire().
  sweepStaleClaimFiles(repoRoot, stalenessMs);

  // Capture the raw bytes alongside the parsed record so a later steal (see
  // below) can content-check exactly what was observed here (TASK-090 AC1).
  const rawExisting = readLockRaw(repoRoot);
  const existing = rawExisting !== null ? tryParseLock(rawExisting) : null;

  if (existing !== null) {
    if (isSameHolder(existing, holder, myPid, myHost)) {
      // Idempotent re-acquire: bump heartbeat and succeed.
      //
      // TASK-094 AC3 — content-checked re-acquire write, reusing the
      // TASK-090 CAS primitive (stealAwayContentChecked). Previously this
      // branch wrote the bumped heartbeat via the unconditional tmp+rename
      // writeLock(), which — like renameSync anywhere else in this module —
      // has no identity check of what it replaces. A holder descheduled
      // between the rawExisting read above and this write, whose lock has
      // since gone stale and been stolen by another party, would silently
      // clobber the stealer's fresh record with a stale heartbeat bump on
      // wake. DETECTION-NOT-PREVENTION, same honesty standard as the
      // foreign-lock steal below: the content check narrows the window to
      // read-to-rename and turns a silent clobber into a detected,
      // fail-closed E_LOCK_HELD (with the stealer's record restored
      // best-effort) — it cannot eliminate the window outright without
      // filesystem-level CAS.
      const claimPath = stealAwayContentChecked(repoRoot, myPid, rawExisting);
      try {
        writeLockExclusive(repoRoot, makeLockRecord(myPid, myHost, nowIso, holder));
      } finally {
        try { unlinkSync(claimPath); } catch { /* best-effort cleanup — the claim is dead either way */ }
      }

      // Verify-after-write, kept as belt-and-braces (TASK-085 review LOW-2):
      // a legitimate competitor can no longer land here undetected (the
      // content check above already rules out the read-to-rename gap), but
      // this still catches a rogue direct mutation of the just-written
      // record.
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
    // Fixed via renameSync(lockPath, uniqueClaimPath), which MOVES the
    // record we just observed OUT of the lock path. TASK-090 review — the
    // original version of this comment overclaimed: it called this "atomic
    // at the OS level ... deterministically, with no timing window at all".
    // That is true only of the rename operation ITSELF (of two racing
    // stealers renaming the SAME source path, only one succeeds — the other
    // gets ENOENT). It is NOT true of the larger steal: renameSync has no
    // identity or content check of what it moves, so a stealer descheduled
    // between its staleness READ (above) and THIS rename can walk away with
    // a fresh competitor's brand-new, perfectly live lock that happens to
    // occupy the same path an instant later — a real residual window,
    // bounded only by how long that deschedule can last. stealAwayContentChecked()
    // closes it: it verifies, byte-for-byte, that what the rename actually
    // moved matches rawExisting (the exact bytes read above), restoring and
    // failing closed on any mismatch. The winner then writes the NEW record
    // via the same exclusive-create primitive used for first acquisition
    // (writeLockExclusive) — the lock path is now guaranteed absent, so this
    // either succeeds outright, or (residual race: a THIRD acquirer's fresh
    // "no lock" acquire slipped in during the moving-out gap) fails EEXIST,
    // which is ALSO a legitimate E_LOCK_HELD outcome (won the content-checked
    // steal, lost the freshly-vacated slot to a third party). The claim file
    // is cleaned up best-effort either way — nobody needs it again.
    const claimPath = stealAwayContentChecked(repoRoot, myPid, rawExisting);
    try {
      writeLockExclusive(repoRoot, makeLockRecord(myPid, myHost, nowIso, holder));
    } finally {
      try { unlinkSync(claimPath); } catch { /* best-effort cleanup — the claim is dead either way */ }
    }

    // Verify-after-write, kept as belt-and-braces: a legitimate competitor
    // can no longer land here undetected (the content check above already
    // rules out the read-to-rename gap), but this still catches a rogue
    // direct mutation of the just-written record.
    const afterSteal = readLock(repoRoot);
    if (!isSameHolder(afterSteal, holder, myPid, myHost)) {
      throw makeErr(
        'E_LOCK_HELD',
        `Lock steal race detected at ${lockFilePath(repoRoot)}: a competing ` +
        'writer\'s record is now persisted instead of ours. Wait for it to release or expire.',
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
  // older than stalenessMs, reclaim it (TASK-090 AC2 — via the same
  // content-checked CAS as the foreign-lock steal path, not a raw unlink;
  // see below) and fall through to the same exclusive-create attempt below
  // (a one-shot "retry" that costs nothing extra, since control simply
  // continues); if still fresh, fail closed with an ACCURATE message
  // (there's no holder identity to name here, only a staleness clock to
  // wait out).
  const lockPath = lockFilePath(repoRoot);
  if (rawExisting !== null) {
    // A file exists at the lock path but didn't parse (tryParseLock above
    // returned null) — decide reclaimability via its own mtime.
    let corruptStat = null;
    try {
      corruptStat = statSync(lockPath);
    } catch {
      corruptStat = null; // vanished between our raw read and here — treat as absent
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
      // Stale corrupt lock — TASK-090 AC2 — reclaim via the SAME
      // content-checked CAS used for stale foreign locks above. A raw
      // unlinkSync here has no identity check of its own: a fresh
      // competitor's lock re-created in the gap between this staleness
      // check and the unlink would be silently destroyed, with nothing to
      // detect it.
      //
      // Review MEDIUM-1 (re-review) — the content check MUST be anchored to
      // rawExisting, the read that made the staleness DECISION in the first
      // place (routing control into this branch at all), NOT a fresh
      // re-read taken here. A fresh re-read only proves "the rename moved
      // what we read a moment ago" — which is true almost by construction
      // and does not defend against a competitor who re-created the lock
      // any time between the statSync staleness check above and that later
      // re-read: the re-read would simply capture the competitor's content
      // and trivially "match itself" once renamed away, silently stealing a
      // live lock. Anchoring to rawExisting instead means ANY change since
      // the original decision — however it happened, at whatever point in
      // this branch — surfaces as a mismatch, restore, and fail-closed
      // E_LOCK_HELD, exactly like the foreign-lock steal path.
      const claimPath = stealAwayContentChecked(repoRoot, myPid, rawExisting);
      // The reclaimed content was garbage (that's why we're here) — there
      // is nothing worth preserving, just discard the claim and fall
      // through to create our own record on the now-vacant path.
      try { unlinkSync(claimPath); } catch { /* best-effort cleanup */ }
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
  //
  // TASK-094 AC2 — this unconditional tmp+rename write carries the SAME
  // path-vs-inode residue TASK-090 closed on the steal/reclaim paths and
  // TASK-094 closed on release() and the same-holder re-acquire branch
  // above: a holder descheduled between the readLock() above and this
  // write, whose lock has since gone stale and been stolen by another
  // party, would silently clobber the stealer's fresh record with a stale
  // heartbeat bump on wake.
  //
  // ACCEPTED, undetected residue — left unguarded by design (document-only,
  // per the "guard where near-free, honest comment where disproportionate"
  // standard): renew() runs on the holder's own heartbeat cadence, typically
  // every few seconds for the life of a session, so wrapping every tick in
  // the CAS rename+read+unlink used above would multiply claim-file churn on
  // a hot path to shrink a window that only opens once the LOCAL holder has
  // already failed to renew in time for a full staleness period — by which
  // point its own lock is already legitimately gone. This is an honest
  // trade-off, not a claim that the window is closed: on plain fs there is
  // no way to prevent it, only detect it, and here we choose not to pay the
  // detection cost on every tick.
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

  // TASK-094 AC1 — capture raw bytes so the delete below can be
  // content-checked against exactly what we observed here, closing the
  // same path-vs-inode residue TASK-090 closed on the steal/reclaim paths:
  // a holder descheduled between this read and the unlink that used to
  // follow it, whose lock has since gone stale and been stolen, must not
  // delete the stealer's fresh record.
  const rawExisting = readLockRaw(repoRoot);
  if (rawExisting === null) return; // Absent — idempotent success.

  const existing = tryParseLock(rawExisting);
  if (existing === null) return; // Corrupt — treat as already gone.

  const myPid = pid ?? process.pid;
  const myHost = hostname ?? os.hostname();

  // Foreign lock — do NOT delete it.
  if (!isSameHolder(existing, holder, myPid, myHost)) return;

  // Content-checked delete, reusing the TASK-090 CAS primitive
  // (stealAwayContentChecked): rename the record we're about to delete OUT
  // of the lock path first, and verify its bytes still match rawExisting
  // before discarding it for good. DETECTION-NOT-PREVENTION, same honesty
  // standard as the steal path: the read-to-rename gap cannot be eliminated
  // on plain fs, only shrunk and detected. A mismatch here means our lock
  // went stale and was stolen in that gap; stealAwayContentChecked's
  // mismatch handling restores the stealer's fresh record (best-effort)
  // rather than losing it, and this release() call becomes a no-op instead
  // of destroying a lock we no longer hold.
  let claimPath;
  try {
    claimPath = stealAwayContentChecked(repoRoot, myPid, rawExisting);
  } catch (err) {
    if (err && err.code === 'E_LOCK_HELD') return; // Detected a takeover (or the lock is already gone) — leave it alone.
    throw err;
  }

  try {
    unlinkSync(claimPath);
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
