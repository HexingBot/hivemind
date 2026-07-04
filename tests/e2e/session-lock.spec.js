// tests/e2e/session-lock.spec.js
// TASK-061 — Failing specs for single-active-session advisory lock.
//
// Design decision (recorded here per ticket instruction):
//   The lock is stored in a DEDICATED `state/.lock` file (JSON:
//   { holder_pid, hostname, heartbeat_at }) rather than in the pointer
//   (state/session.json). The pointer schema is intentionally tiny with a
//   fixed 3-field additionalProperties:false contract — adding a 4th field
//   would break the schema validator and every downstream consumer that reads
//   the pointer. A separate lock file keeps the pointer schema untouched and
//   backward-compatible, and makes the lock independently readable/writable
//   without touching the orchestrator-state bundle.
//
// Acquire contract:
//   acquire({ repoRoot, now?, pid?, hostname? }) returns a result object on
//   success OR throws an error with code E_LOCK_HELD and a message that names
//   the current holder when a fresh foreign lock is found.
//   The caller must catch E_LOCK_HELD to handle the "repo is busy" path.
//
// Tests are intentionally slow (disk I/O via temp dirs) → lives under tests/e2e/.
//
// All tests MUST FAIL with "Cannot find module …session-lock.js" or equivalent
// until src/session-lock.js is created (IMPL phase).

import { describe, it, expect, afterAll, vi } from 'vitest';
import {
  existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, utimesSync,
} from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { spawn } from 'node:child_process';

import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';

afterAll(cleanupAll);

// ---------------------------------------------------------------------------
// Resolve the production module via file URL — same pattern as PROD in
// fixtures.js. We declare it inline here because session-lock.js is a new
// module not yet in PROD.
// ---------------------------------------------------------------------------
const __thisDir = dirname(fileURLToPath(import.meta.url));
const __srcDir = join(__thisDir, '..', '..', 'src');
const SESSION_LOCK_URL = pathToFileURL(join(__srcDir, 'session-lock.js')).href;

// ---------------------------------------------------------------------------
// Constants reused across tests.
// ---------------------------------------------------------------------------
const MY_PID = 99001;
const MY_HOST = 'test-host-alpha';
const OTHER_PID = 99002;
const OTHER_HOST = 'test-host-beta';

// A "now" well inside the staleness window (5 min default): 2 minutes ago
// relative to the test's assertion time.
const BASE_TIME = '2026-06-16T12:00:00.000Z';
const TWO_MIN_AGO = '2026-06-16T11:58:00.000Z';
const SIX_MIN_AGO = '2026-06-16T11:54:00.000Z';   // beyond default 5-min window

/** Helper: create state/ dir under repoDir. */
function makeStateDir(repoDir) {
  mkdirSync(join(repoDir, 'state'), { recursive: true });
  return repoDir;
}

/** Helper: path to lock file. */
function lockFilePath(repoDir) {
  return join(repoDir, 'state', '.lock');
}

/** Helper: write a raw lock record to disk (simulates an existing holder). */
function seedLock(repoDir, record) {
  mkdirSync(join(repoDir, 'state'), { recursive: true });
  writeFileSync(lockFilePath(repoDir), JSON.stringify(record, null, 2) + '\n', 'utf8');
}

// ---------------------------------------------------------------------------
// AC1 — acquire on clean repo succeeds (unlocked default / backward-compat)
// ---------------------------------------------------------------------------

describe('AC1/AC5 — acquire on clean repo (no lock file)', () => {
  it('acquire_on_clean_repo_writes_lock_and_returns_success', async () => {
    const { acquire } = await import(SESSION_LOCK_URL);

    const repoDir = makeStateDir(makeTmpDir('af-lock-clean'));

    const result = await acquire({
      repoRoot: repoDir,
      now: () => BASE_TIME,
      pid: MY_PID,
      hostname: MY_HOST,
    });

    // Must succeed (not throw).
    // The lock file must now exist.
    expect(existsSync(lockFilePath(repoDir)), 'state/.lock must be written').toBe(true);

    // The written record must contain the holder's identity.
    const raw = readFileSync(lockFilePath(repoDir), 'utf8');
    const lock = JSON.parse(raw);
    expect(lock.holder_pid).toBe(MY_PID);
    expect(lock.hostname).toBe(MY_HOST);
    expect(lock.heartbeat_at).toBe(BASE_TIME);

    // acquire must return a truthy success result (shape: { acquired: true }).
    expect(result).toBeDefined();
    expect(result.acquired).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC2 — fresh foreign lock refuses
// ---------------------------------------------------------------------------

describe('AC2 — fresh foreign lock refuses with E_LOCK_HELD', () => {
  it('acquire_refuses_when_fresh_foreign_lock_names_the_other_holder', async () => {
    const { acquire } = await import(SESSION_LOCK_URL);

    const repoDir = makeStateDir(makeTmpDir('af-lock-fresh-foreign'));

    // Seed a fresh lock (heartbeat 2 minutes ago) held by another process.
    seedLock(repoDir, {
      holder_pid: OTHER_PID,
      hostname: OTHER_HOST,
      heartbeat_at: TWO_MIN_AGO,   // fresh — within 5-min staleness window
    });

    let caught;
    try {
      await acquire({
        repoRoot: repoDir,
        now: () => BASE_TIME,
        pid: MY_PID,
        hostname: MY_HOST,
      });
    } catch (e) {
      caught = e;
    }

    // Must throw.
    expect(caught, 'acquire must throw when a fresh foreign lock exists').toBeDefined();
    // Error code must identify the lock-held condition.
    expect(caught.code).toBe('E_LOCK_HELD');
    // Error message must name the holder (pid or hostname) so the operator
    // can identify which process holds the repo.
    expect(caught.message).toMatch(String(OTHER_PID));
  });
});

// ---------------------------------------------------------------------------
// AC3 — same-holder re-acquire is idempotent
// ---------------------------------------------------------------------------

describe('AC3 — same-holder re-acquire is idempotent', () => {
  it('acquire_by_same_holder_succeeds_without_error', async () => {
    const { acquire } = await import(SESSION_LOCK_URL);

    const repoDir = makeStateDir(makeTmpDir('af-lock-same-holder'));

    // Seed a fresh lock already held by ME.
    seedLock(repoDir, {
      holder_pid: MY_PID,
      hostname: MY_HOST,
      heartbeat_at: TWO_MIN_AGO,
    });

    // Should not throw.
    const result = await acquire({
      repoRoot: repoDir,
      now: () => BASE_TIME,
      pid: MY_PID,
      hostname: MY_HOST,
    });

    expect(result).toBeDefined();
    expect(result.acquired).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC4 — stale lock is stolen (crashed-holder recovery)
// ---------------------------------------------------------------------------

describe('AC4 — stale lock is stolen (crashed-holder recovery)', () => {
  it('acquire_overwrites_stale_foreign_lock_and_succeeds', async () => {
    const { acquire } = await import(SESSION_LOCK_URL);

    const repoDir = makeStateDir(makeTmpDir('af-lock-stale'));

    // Seed a STALE lock (heartbeat 6 minutes ago — beyond default 5-min window).
    seedLock(repoDir, {
      holder_pid: OTHER_PID,
      hostname: OTHER_HOST,
      heartbeat_at: SIX_MIN_AGO,
    });

    // Should NOT throw — stale lock is recoverable.
    const result = await acquire({
      repoRoot: repoDir,
      now: () => BASE_TIME,
      pid: MY_PID,
      hostname: MY_HOST,
    });

    expect(result.acquired).toBe(true);

    // The lock must now belong to ME (was overwritten).
    const lock = JSON.parse(readFileSync(lockFilePath(repoDir), 'utf8'));
    expect(lock.holder_pid).toBe(MY_PID);
    expect(lock.hostname).toBe(MY_HOST);
    expect(lock.heartbeat_at).toBe(BASE_TIME);
  });
});

// ---------------------------------------------------------------------------
// AC5 — renew bumps heartbeat_at
// ---------------------------------------------------------------------------

describe('AC5 — renew bumps heartbeat_at', () => {
  it('renew_updates_heartbeat_at_for_current_holder', async () => {
    const { acquire, renew } = await import(SESSION_LOCK_URL);

    const repoDir = makeStateDir(makeTmpDir('af-lock-renew'));

    // First acquire (heartbeat = TWO_MIN_AGO to make the before/after contrast obvious).
    await acquire({
      repoRoot: repoDir,
      now: () => TWO_MIN_AGO,
      pid: MY_PID,
      hostname: MY_HOST,
    });

    const before = JSON.parse(readFileSync(lockFilePath(repoDir), 'utf8'));
    expect(before.heartbeat_at).toBe(TWO_MIN_AGO);

    // Renew with a later timestamp.
    await renew({
      repoRoot: repoDir,
      now: () => BASE_TIME,
      pid: MY_PID,
      hostname: MY_HOST,
    });

    const after = JSON.parse(readFileSync(lockFilePath(repoDir), 'utf8'));
    expect(after.heartbeat_at).toBe(BASE_TIME);
    // Identity fields unchanged.
    expect(after.holder_pid).toBe(MY_PID);
    expect(after.hostname).toBe(MY_HOST);
  });
});

// ---------------------------------------------------------------------------
// AC6 — release is idempotent
// ---------------------------------------------------------------------------

describe('AC6 — release is idempotent', () => {
  it('release_clears_the_lock', async () => {
    const { acquire, release } = await import(SESSION_LOCK_URL);

    const repoDir = makeStateDir(makeTmpDir('af-lock-release'));
    await acquire({
      repoRoot: repoDir,
      now: () => BASE_TIME,
      pid: MY_PID,
      hostname: MY_HOST,
    });

    expect(existsSync(lockFilePath(repoDir))).toBe(true);

    // Pass matching identity so holder-aware release() recognises us as the holder.
    await release({ repoRoot: repoDir, pid: MY_PID, hostname: MY_HOST });

    // Lock must be gone after release.
    expect(existsSync(lockFilePath(repoDir)), 'lock file must be removed after release').toBe(false);
  });

  it('release_when_absent_does_not_throw', async () => {
    const { release } = await import(SESSION_LOCK_URL);

    const repoDir = makeStateDir(makeTmpDir('af-lock-release-absent'));
    // No lock file present at all.
    expect(existsSync(lockFilePath(repoDir))).toBe(false);

    // Must not throw.
    await expect(release({ repoRoot: repoDir })).resolves.not.toThrow();
  });

  it('release_when_held_by_foreign_does_not_throw', async () => {
    const { release } = await import(SESSION_LOCK_URL);

    const repoDir = makeStateDir(makeTmpDir('af-lock-release-foreign'));
    // Seed a foreign lock.
    seedLock(repoDir, {
      holder_pid: OTHER_PID,
      hostname: OTHER_HOST,
      heartbeat_at: TWO_MIN_AGO,
    });

    // Must not throw (advisory lock; release is always safe).
    await expect(
      release({ repoRoot: repoDir, pid: MY_PID, hostname: MY_HOST }),
    ).resolves.not.toThrow();

    // The foreign lock MUST SURVIVE — a caller releasing their own lock
    // must never destroy a lock they do not hold.
    expect(
      existsSync(lockFilePath(repoDir)),
      'foreign lock file must still exist after a non-holder release()',
    ).toBe(true);

    // The record must still name the ORIGINAL foreign holder unchanged.
    const record = JSON.parse(readFileSync(lockFilePath(repoDir), 'utf8'));
    expect(record.holder_pid).toBe(OTHER_PID);
    expect(record.hostname).toBe(OTHER_HOST);
  });
});

// ---------------------------------------------------------------------------
// AC6b — renew is holder-aware (new regression locks added by review HIGH fix)
// ---------------------------------------------------------------------------

describe('AC6b — renew on absent lock is a no-op', () => {
  it('renew_on_absent_lock_is_noop', async () => {
    const { renew } = await import(SESSION_LOCK_URL);

    const repoDir = makeStateDir(makeTmpDir('af-lock-renew-absent'));
    // No lock file — state/ dir exists but .lock does not.
    expect(existsSync(lockFilePath(repoDir))).toBe(false);

    // renew() must not throw and must NOT create a lock file.
    await expect(
      renew({ repoRoot: repoDir, now: () => BASE_TIME, pid: MY_PID, hostname: MY_HOST }),
    ).resolves.not.toThrow();

    expect(
      existsSync(lockFilePath(repoDir)),
      'renew() on absent lock must not create the lock file',
    ).toBe(false);
  });
});

describe('AC6b — renew on foreign lock does not modify it', () => {
  it('renew_on_foreign_lock_does_not_modify_it', async () => {
    const { renew } = await import(SESSION_LOCK_URL);

    const repoDir = makeStateDir(makeTmpDir('af-lock-renew-foreign'));
    // Seed a foreign lock with a specific heartbeat.
    const FOREIGN_HEARTBEAT = TWO_MIN_AGO;
    seedLock(repoDir, {
      holder_pid: OTHER_PID,
      hostname: OTHER_HOST,
      heartbeat_at: FOREIGN_HEARTBEAT,
    });

    // renew() called by MY_PID/MY_HOST must not bump the foreign heartbeat.
    await expect(
      renew({ repoRoot: repoDir, now: () => BASE_TIME, pid: MY_PID, hostname: MY_HOST }),
    ).resolves.not.toThrow();

    // The record must be UNCHANGED — same pid, hostname, and heartbeat_at.
    const record = JSON.parse(readFileSync(lockFilePath(repoDir), 'utf8'));
    expect(record.holder_pid).toBe(OTHER_PID);
    expect(record.hostname).toBe(OTHER_HOST);
    expect(record.heartbeat_at).toBe(FOREIGN_HEARTBEAT);
  });
});

// ---------------------------------------------------------------------------
// AC7 — atomic write, no partial (tmp+rename; no .lock.tmp residue)
// ---------------------------------------------------------------------------

describe('AC7 — atomic write: no .lock.tmp residue after successful acquire', () => {
  it('acquire_leaves_no_tmp_residue_on_success', async () => {
    const { acquire } = await import(SESSION_LOCK_URL);

    const repoDir = makeStateDir(makeTmpDir('af-lock-atomic'));

    await acquire({
      repoRoot: repoDir,
      now: () => BASE_TIME,
      pid: MY_PID,
      hostname: MY_HOST,
    });

    // No tmp file should remain alongside state/.lock after a successful write.
    const stateDir = join(repoDir, 'state');
    const entries = readdirSync(stateDir);
    const tmpFiles = entries.filter((name) => name.startsWith('.lock.tmp'));
    expect(
      tmpFiles,
      'no .lock.tmp sibling files should survive a successful acquire',
    ).toHaveLength(0);

    // The canonical .lock file must be valid JSON with the expected structure.
    const raw = readFileSync(lockFilePath(repoDir), 'utf8');
    let parsed;
    expect(() => { parsed = JSON.parse(raw); }, 'state/.lock must contain valid JSON').not.toThrow();
    expect(parsed).toHaveProperty('holder_pid');
    expect(parsed).toHaveProperty('hostname');
    expect(parsed).toHaveProperty('heartbeat_at');
  });
});

// ---------------------------------------------------------------------------
// AC8 — staleness window is configurable
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// TASK-070 — stable caller-supplied holder identity (session_id) instead of
// process.pid.
//
// Problem: the orchestrator-as-driver runs every acquire/renew/release in a
// FRESH subprocess, so each call has a different pid. renew() and release()
// currently key off pid+hostname, so they always treat the caller as a
// foreign holder once the pid changes — renew() silently no-ops and never
// keeps the lock fresh, and release() silently no-ops and leaves state/.lock
// behind for manual cleanup.
//
// Seam contract assumed by these tests (for the IMPL phase):
//   acquire/renew/release all accept an additional optional `holder: string`
//   option. When `holder` is supplied by the caller, holder-match is decided
//   by comparing it against a `holder_id` field persisted in the lock record
//   (not by pid+hostname), across acquire → renew → release calls, even when
//   pid/hostname differ from call to call (fresh subprocess each time).
//   `holder_pid`/`hostname` continue to be recorded (from whatever pid/
//   hostname the caller passes, or process.pid/os.hostname() defaults) for
//   diagnostics/back-compat with `inspect()`, but are NOT used for matching
//   once a `holder_id` is present. When `holder` is omitted, behavior is
//   fully unchanged (pid+hostname identity, no `holder_id` field written).
// ---------------------------------------------------------------------------

const HOLDER_A = 'sess-holder-aaaa';
const HOLDER_B = 'sess-holder-bbbb';
const PID_B = 99003;
const HOST_B = 'test-host-gamma';

describe('TASK-070 AC1 — holder id overrides pid+hostname for identity match', () => {
  it('acquire_with_matching_holder_id_succeeds_despite_different_pid_and_hostname', async () => {
    const { acquire } = await import(SESSION_LOCK_URL);

    const repoDir = makeStateDir(makeTmpDir('af-lock-holder-acquire'));

    // Seed a FRESH lock created by holder A under one pid/hostname.
    seedLock(repoDir, {
      holder_pid: MY_PID,
      hostname: MY_HOST,
      holder_id: HOLDER_A,
      heartbeat_at: TWO_MIN_AGO,
    });

    // Re-acquire as the SAME holder, but from a different pid/hostname
    // (simulating a fresh driver subprocess). Must be treated as an
    // idempotent re-acquire, not a foreign fresh lock.
    const result = await acquire({
      repoRoot: repoDir,
      now: () => BASE_TIME,
      holder: HOLDER_A,
      pid: PID_B,
      hostname: HOST_B,
    });

    expect(result).toBeDefined();
    expect(result.acquired).toBe(true);

    const lock = JSON.parse(readFileSync(lockFilePath(repoDir), 'utf8'));
    expect(lock.holder_id).toBe(HOLDER_A);
    expect(lock.heartbeat_at).toBe(BASE_TIME);
  });
});

describe('TASK-070 AC2 — renew() and release() work across distinct pids via holder id', () => {
  it('renew_bumps_heartbeat_across_distinct_pids_when_holder_id_matches', async () => {
    const { acquire, renew } = await import(SESSION_LOCK_URL);

    const repoDir = makeStateDir(makeTmpDir('af-lock-holder-renew'));

    // Acquire from "process 1" of the driver.
    await acquire({
      repoRoot: repoDir,
      now: () => TWO_MIN_AGO,
      holder: HOLDER_A,
      pid: MY_PID,
      hostname: MY_HOST,
    });

    // Renew from "process 2" — different pid/hostname, same holder id.
    const renewed = await renew({
      repoRoot: repoDir,
      now: () => BASE_TIME,
      holder: HOLDER_A,
      pid: PID_B,
      hostname: HOST_B,
    });

    expect(renewed, 'renew() must report success for a same-holder cross-pid call').toBe(true);

    const lock = JSON.parse(readFileSync(lockFilePath(repoDir), 'utf8'));
    expect(lock.heartbeat_at).toBe(BASE_TIME);
    expect(lock.holder_id).toBe(HOLDER_A);
  });

  it('release_deletes_lock_created_by_same_holder_across_distinct_pids', async () => {
    const { acquire, release } = await import(SESSION_LOCK_URL);

    const repoDir = makeStateDir(makeTmpDir('af-lock-holder-release'));

    // Acquire from "process 1" of the driver.
    await acquire({
      repoRoot: repoDir,
      now: () => BASE_TIME,
      holder: HOLDER_A,
      pid: MY_PID,
      hostname: MY_HOST,
    });

    expect(existsSync(lockFilePath(repoDir))).toBe(true);

    // Release from "process 2" — different pid/hostname, same holder id.
    await release({
      repoRoot: repoDir,
      holder: HOLDER_A,
      pid: PID_B,
      hostname: HOST_B,
    });

    expect(
      existsSync(lockFilePath(repoDir)),
      'release() must delete a lock created by the same holder id from a different pid',
    ).toBe(false);
  });
});

describe('TASK-070 AC3 — backward compatible when no holder id is supplied', () => {
  it('no_holder_supplied_falls_back_to_pid_hostname_identity_and_omits_holder_id_field', async () => {
    const { acquire } = await import(SESSION_LOCK_URL);

    const repoDir = makeStateDir(makeTmpDir('af-lock-holder-backcompat'));

    const result = await acquire({
      repoRoot: repoDir,
      now: () => BASE_TIME,
      pid: MY_PID,
      hostname: MY_HOST,
    });

    expect(result.acquired).toBe(true);

    const lock = JSON.parse(readFileSync(lockFilePath(repoDir), 'utf8'));
    expect(lock.holder_pid).toBe(MY_PID);
    expect(lock.hostname).toBe(MY_HOST);
    // No holder_id field must be introduced when the caller never opted in.
    expect(
      Object.prototype.hasOwnProperty.call(lock, 'holder_id'),
      'lock record must not gain a holder_id field when holder was never supplied',
    ).toBe(false);
  });
});

describe('TASK-070 AC4 — staleness semantics preserved under the holder-id scheme', () => {
  it('acquire_refuses_fresh_foreign_lock_identified_by_a_different_holder_id', async () => {
    const { acquire } = await import(SESSION_LOCK_URL);

    const repoDir = makeStateDir(makeTmpDir('af-lock-holder-fresh-foreign'));

    // Fresh lock held by a DIFFERENT holder id.
    seedLock(repoDir, {
      holder_pid: OTHER_PID,
      hostname: OTHER_HOST,
      holder_id: HOLDER_A,
      heartbeat_at: TWO_MIN_AGO,
    });

    let caught;
    try {
      await acquire({
        repoRoot: repoDir,
        now: () => BASE_TIME,
        holder: HOLDER_B,
        pid: MY_PID,
        hostname: MY_HOST,
      });
    } catch (e) {
      caught = e;
    }

    expect(caught, 'acquire must still refuse a fresh foreign lock under the holder-id scheme').toBeDefined();
    expect(caught.code).toBe('E_LOCK_HELD');
  });

  it('acquire_steals_stale_foreign_lock_identified_by_a_holder_id', async () => {
    const { acquire } = await import(SESSION_LOCK_URL);

    const repoDir = makeStateDir(makeTmpDir('af-lock-holder-stale-foreign'));

    // Stale lock (beyond default 5-min window) held by a different holder id.
    seedLock(repoDir, {
      holder_pid: OTHER_PID,
      hostname: OTHER_HOST,
      holder_id: HOLDER_A,
      heartbeat_at: SIX_MIN_AGO,
    });

    const result = await acquire({
      repoRoot: repoDir,
      now: () => BASE_TIME,
      holder: HOLDER_B,
      pid: MY_PID,
      hostname: MY_HOST,
    });

    expect(result.acquired, 'a stale lock must still be re-takeable under the holder-id scheme').toBe(true);

    const lock = JSON.parse(readFileSync(lockFilePath(repoDir), 'utf8'));
    expect(lock.holder_id).toBe(HOLDER_B);
  });
});

describe('AC8 — staleness window is configurable', () => {
  it('custom_staleness_window_changes_fresh_stale_boundary', async () => {
    const { acquire } = await import(SESSION_LOCK_URL);

    // TWO_MIN_AGO is 2 minutes old — fresh under the 5-min default,
    // but STALE under a custom 1-minute window.
    const repoDir = makeStateDir(makeTmpDir('af-lock-custom-window'));
    seedLock(repoDir, {
      holder_pid: OTHER_PID,
      hostname: OTHER_HOST,
      heartbeat_at: TWO_MIN_AGO,  // 2 min old
    });

    // With a 1-minute staleness window, a 2-minute-old lock is stale → steal.
    const resultWithShortWindow = await acquire({
      repoRoot: repoDir,
      now: () => BASE_TIME,
      pid: MY_PID,
      hostname: MY_HOST,
      stalenessMs: 60_000,  // 1 minute
    });

    expect(resultWithShortWindow.acquired).toBe(true);
    const lock = JSON.parse(readFileSync(lockFilePath(repoDir), 'utf8'));
    expect(lock.holder_pid).toBe(MY_PID);

    // With a 10-minute window, a 2-minute-old lock is fresh → refuse.
    const repoDir2 = makeStateDir(makeTmpDir('af-lock-custom-window-2'));
    seedLock(repoDir2, {
      holder_pid: OTHER_PID,
      hostname: OTHER_HOST,
      heartbeat_at: TWO_MIN_AGO,  // 2 min old
    });

    let caught;
    try {
      await acquire({
        repoRoot: repoDir2,
        now: () => BASE_TIME,
        pid: MY_PID,
        hostname: MY_HOST,
        stalenessMs: 600_000, // 10 minutes — lock is still fresh
      });
    } catch (e) {
      caught = e;
    }

    expect(caught, 'with a 10-min window, a 2-min-old foreign lock must still refuse').toBeDefined();
    expect(caught.code).toBe('E_LOCK_HELD');
  });
});

// ---------------------------------------------------------------------------
// TASK-080 — loop-grade heartbeat: renew cadence + staleness override, and
// holder_id surfacing in the E_LOCK_HELD message.
//
// Note on scope (recorded here per Test design instructions):
//   AC2 ("acquire() accepts a caller-supplied stalenessMs override, default
//   unchanged at 5 min") is ALREADY fully implemented (see the `stalenessMs`
//   parameter on `acquire()` in src/session-lock.js) AND already fully
//   covered by the pre-existing 'AC8 — staleness window is configurable'
//   spec above: it exercises both a short override that steals a lock that
//   would otherwise be fresh, and a long override that keeps a lock fresh
//   that would otherwise be stale — i.e. both the "override changes the
//   boundary" and "default-without-override is unchanged" halves of AC2's
//   code behavior. No new spec is added here for AC2 to respect the
//   new-test budget (CLAUDE.md: "every new spec must encode an acceptance
//   criterion or a real regression — nothing else"); a duplicate spec here
//   would be redundant coverage of the same code path.
// ---------------------------------------------------------------------------

describe('TASK-080 AC1 — E_LOCK_HELD message surfaces holder_id', () => {
  it('acquire_refuses_and_message_names_the_holder_id_alongside_pid_and_hostname', async () => {
    const { acquire } = await import(SESSION_LOCK_URL);

    const repoDir = makeStateDir(makeTmpDir('af-lock-message-holder-id'));

    // Holder A acquires first (real acquire, not a seeded record) so the
    // persisted lock carries a holder_id the way a real caller would leave it.
    await acquire({
      repoRoot: repoDir,
      now: () => TWO_MIN_AGO,
      holder: HOLDER_A,
      pid: MY_PID,
      hostname: MY_HOST,
    });

    // Holder B attempts to acquire the still-fresh lock.
    let caught;
    try {
      await acquire({
        repoRoot: repoDir,
        now: () => BASE_TIME,
        holder: HOLDER_B,
        pid: PID_B,
        hostname: HOST_B,
      });
    } catch (e) {
      caught = e;
    }

    expect(caught, 'acquire must throw when a fresh foreign holder_id-bearing lock exists').toBeDefined();
    expect(caught.code).toBe('E_LOCK_HELD');

    // The message must surface the holder_id (currently missing — this is
    // the RED behavior this spec pins) ...
    expect(
      caught.message,
      'E_LOCK_HELD message must include the holder_id of the current holder',
    ).toContain(HOLDER_A);

    // ... while still retaining pid/hostname for diagnostics (unchanged).
    expect(caught.message).toContain(String(MY_PID));
    expect(caught.message).toContain(MY_HOST);
  });
});

describe('TASK-080 AC3(a) — fresh lock WITH holder_id refuses a caller WITHOUT holder, but is stealable once stale', () => {
  it('acquire_without_holder_is_refused_by_fresh_holder_id_lock', async () => {
    const { acquire } = await import(SESSION_LOCK_URL);

    const repoDir = makeStateDir(makeTmpDir('af-lock-asym-fresh-no-holder-caller'));

    // Fresh lock carries a holder_id.
    seedLock(repoDir, {
      holder_pid: OTHER_PID,
      hostname: OTHER_HOST,
      holder_id: HOLDER_A,
      heartbeat_at: TWO_MIN_AGO,
    });

    // Caller supplies NO holder at all (plain pid/hostname caller).
    let caught;
    try {
      await acquire({
        repoRoot: repoDir,
        now: () => BASE_TIME,
        pid: MY_PID,
        hostname: MY_HOST,
      });
    } catch (e) {
      caught = e;
    }

    expect(
      caught,
      'a holder-less caller must be refused by a fresh lock that carries a holder_id',
    ).toBeDefined();
    expect(caught.code).toBe('E_LOCK_HELD');
  });

  it('acquire_without_holder_steals_a_stale_holder_id_lock', async () => {
    const { acquire } = await import(SESSION_LOCK_URL);

    const repoDir = makeStateDir(makeTmpDir('af-lock-asym-stale-no-holder-caller'));

    // Same holder_id-bearing lock, but now STALE.
    seedLock(repoDir, {
      holder_pid: OTHER_PID,
      hostname: OTHER_HOST,
      holder_id: HOLDER_A,
      heartbeat_at: SIX_MIN_AGO,
    });

    // Caller supplies NO holder — must still be able to steal a stale lock.
    const result = await acquire({
      repoRoot: repoDir,
      now: () => BASE_TIME,
      pid: MY_PID,
      hostname: MY_HOST,
    });

    expect(
      result.acquired,
      'a holder-less caller must still be able to steal a STALE holder_id-bearing lock',
    ).toBe(true);

    const lock = JSON.parse(readFileSync(lockFilePath(repoDir), 'utf8'));
    expect(lock.holder_pid).toBe(MY_PID);
    expect(lock.hostname).toBe(MY_HOST);
  });
});

describe('TASK-080 AC3(b) — legacy record WITHOUT holder_id treats a holder-carrying caller as foreign', () => {
  it('acquire_with_holder_is_refused_by_a_fresh_legacy_record_lacking_holder_id', async () => {
    const { acquire } = await import(SESSION_LOCK_URL);

    const repoDir = makeStateDir(makeTmpDir('af-lock-asym-legacy-record-holder-caller'));

    // Legacy record: no holder_id field at all (pre-TASK-070 shape).
    seedLock(repoDir, {
      holder_pid: OTHER_PID,
      hostname: OTHER_HOST,
      heartbeat_at: TWO_MIN_AGO, // fresh
    });

    // Caller opts into holder-id identity.
    let caught;
    try {
      await acquire({
        repoRoot: repoDir,
        now: () => BASE_TIME,
        holder: HOLDER_B,
        pid: MY_PID,
        hostname: MY_HOST,
      });
    } catch (e) {
      caught = e;
    }

    expect(
      caught,
      'a holder-carrying caller must be treated as foreign against a legacy record with no holder_id',
    ).toBeDefined();
    expect(caught.code).toBe('E_LOCK_HELD');
  });
});

// ---------------------------------------------------------------------------
// TASK-085 — deep-review S4: exclusive acquire + verify-after-write + contention.
//
// Problem restated: acquire()'s "no lock" branch (readLock() returned null —
// either the file is truly absent OR present-but-unparseable) proceeds
// straight to writeLock(), which is atomicWriteFile()'s tmp+rename recipe.
// renameSync unconditionally replaces whatever is at the target path with NO
// existence/identity check — so two callers racing this branch (or one
// caller racing a corrupt/partial file left by another actor) can each
// believe they "won" with no error surfaced to either side. Composes badly
// with the stale-steal branch too: two callers that both observe the same
// stale foreign lock both write their own record; the loser's write still
// physically succeeds (rename doesn't check what it's replacing) and today
// nothing re-reads afterward to notice.
//
// AC1 — first acquisition must use an actual exclusive create (fs open
//   O_CREAT|O_EXCL / 'wx', or equivalent) directly against the real lock
//   file path — NOT a tmp-file-then-rename dance, since rename() is not
//   exclusive at the OS level. Two racing FIRST acquires must not both
//   succeed.
// AC2 — verify-after-write: after ANY write to the lock record (including
//   the stale-steal path), acquire() must re-read the lock file and confirm
//   the persisted record actually identifies as ours; if not (a competitor's
//   write landed in between), throw E_LOCK_HELD rather than reporting a
//   false success.
// AC3 — the observable, black-box contract of AC1+AC2 together: race two
//   independent node CHILD PROCESSES (not just in-process interleaving)
//   against the same repoRoot; across many synchronized rounds, exactly one
//   wins each round.
// ---------------------------------------------------------------------------

describe('TASK-085 AC1 — first acquisition must not silently clobber a pre-existing (even unparseable) lock file', () => {
  it('acquire_does_not_silently_clobber_an_existing_but_unparseable_lock_file', async () => {
    const { acquire } = await import(SESSION_LOCK_URL);

    const repoDir = makeStateDir(makeTmpDir('af-lock-preexisting-corrupt'));

    // A file already exists at the lock path but its content is not valid
    // JSON — e.g. the residue of another actor's exclusive-create call that
    // won the race but crashed before finishing the write. readLock()
    // treats this as `existing === null` (same as truly absent), so TODAY's
    // read-check-write acquire() falls through to the unconditional
    // writeLock() and silently replaces it. A correct exclusive-create
    // implementation must observe that a file ALREADY occupies the target
    // path (O_CREAT|O_EXCL fails with EEXIST regardless of the existing
    // file's content) and must not treat this as a clean first acquisition.
    writeFileSync(lockFilePath(repoDir), '', 'utf8');

    let caught;
    try {
      await acquire({
        repoRoot: repoDir,
        now: () => BASE_TIME,
        pid: MY_PID,
        hostname: MY_HOST,
      });
    } catch (e) {
      caught = e;
    }

    expect(
      caught,
      'acquire must not treat an existing-but-unparseable lock file as "no lock" and silently overwrite it',
    ).toBeDefined();
    expect(caught.code).toBe('E_LOCK_HELD');
  });
});

// ---------------------------------------------------------------------------
// TASK-085 review MEDIUM-2 — a fresh unparseable lock file must fail closed
// (covered by AC1 above, unchanged); a STALE unparseable lock file must NOT
// deadlock every future acquire() forever — it must be reclaimable exactly
// like a stale foreign lock, decided by the corrupt file's own mtime (since
// there is no parseable heartbeat_at to compare against the staleness
// window).
// ---------------------------------------------------------------------------
describe('TASK-085 MEDIUM-2 — a STALE unparseable lock file is reclaimed, not a permanent deadlock', () => {
  it('acquire_reclaims_a_stale_unparseable_lock_file_via_mtime', async () => {
    const { acquire } = await import(SESSION_LOCK_URL);

    const repoDir = makeStateDir(makeTmpDir('af-lock-stale-corrupt'));
    const p = lockFilePath(repoDir);

    // Corrupt (unparseable) content, backdated well past the default 5-min
    // staleness window — simulates a crash mid-exclusive-create long enough
    // ago that it must now be treated like any other stale/crashed holder.
    writeFileSync(p, '{not valid json', 'utf8');
    const staleAt = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes ago
    utimesSync(p, staleAt, staleAt);

    const result = await acquire({
      repoRoot: repoDir,
      pid: MY_PID,
      hostname: MY_HOST,
      // No `now` override — MEDIUM-2's staleness check is against the
      // corrupt file's real mtime (wall clock), not the caller's injected
      // clock, since there is no parseable heartbeat_at to compare against.
    });

    expect(result.acquired, 'a stale unparseable lock file must be reclaimable, not a permanent deadlock').toBe(true);

    const lock = JSON.parse(readFileSync(p, 'utf8'));
    expect(lock.holder_pid).toBe(MY_PID);
    expect(lock.hostname).toBe(MY_HOST);
  });
});

describe('TASK-085 AC2 — the stale-steal race is closed (CAS-steal + verify-after-write)', () => {
  it('acquire_throws_e_lock_held_when_a_competitor_claims_the_freshly_vacated_lock_immediately_after_our_steal_rename', async () => {
    vi.resetModules();

    const repoDir = makeStateDir(makeTmpDir('af-lock-verify-after-write'));
    const targetLockPath = lockFilePath(repoDir);

    // Seed a STALE foreign lock so acquire() takes the stale-steal branch
    // (AC1 above already covers the "no lock at all" first-acquisition case).
    seedLock(repoDir, {
      holder_pid: OTHER_PID,
      hostname: OTHER_HOST,
      heartbeat_at: SIX_MIN_AGO,
    });

    // POST fresh-context-review (MEDIUM-1 CAS-steal fix) design: acquire()'s
    // stale-steal branch no longer writes its new record via a tmp+rename
    // ONTO the lock path — it first does a compare-and-swap
    // renameSync(lockPath, uniqueClaimPath) to MOVE the stale record OUT
    // (source === lockPath; the random claim-path suffix makes the
    // destination unpredictable to a test, so we match on the SOURCE
    // instead), then writes the new record via the SAME O_CREAT|O_EXCL
    // exclusive-create primitive used for first acquisition — there is no
    // rename to mock ONTO the lock path anymore for this branch. This spec
    // now simulates the one residual scenario a legitimate competitor CAN
    // still land in: an instant after our CAS-steal rename vacates the lock
    // path, a competing acquirer's own fresh "no lock" acquire (exclusive
    // create) wins the now-empty slot before we get to write ours —
    // resulting in OUR OWN exclusive-create attempt failing EEXIST, which
    // acquire() must surface as E_LOCK_HELD (not silently report success).
    let injected = false;
    vi.doMock('node:fs', async (importOriginal) => {
      const real = await importOriginal();
      return {
        ...real,
        renameSync: (src, dest) => {
          const result = real.renameSync(src, dest);
          if (!injected && String(src) === targetLockPath) {
            injected = true;
            // Simulate the competitor's fresh acquire winning the freshly-
            // vacated slot: plant a record directly at the lock path, exactly
            // as their own writeLockExclusive would have.
            real.writeFileSync(
              targetLockPath,
              JSON.stringify({
                holder_pid: OTHER_PID,
                hostname: OTHER_HOST,
                heartbeat_at: BASE_TIME,
              }, null, 2) + '\n',
              'utf8',
            );
          }
          return result;
        },
      };
    });

    const { acquire } = await import(SESSION_LOCK_URL);

    let caught;
    try {
      await acquire({
        repoRoot: repoDir,
        now: () => BASE_TIME,
        pid: MY_PID,
        hostname: MY_HOST,
      });
    } catch (e) {
      caught = e;
    }

    expect(
      caught,
      'acquire must detect that a competitor claimed the freshly-vacated lock slot immediately after our steal-rename, and throw instead of reporting a false success',
    ).toBeDefined();
    expect(caught.code).toBe('E_LOCK_HELD');

    // The competitor's record must survive untouched — our failed attempt
    // must not have clobbered it.
    const onDisk = JSON.parse(readFileSync(targetLockPath, 'utf8'));
    expect(onDisk.holder_pid).toBe(OTHER_PID);
    expect(onDisk.hostname).toBe(OTHER_HOST);

    vi.doUnmock('node:fs');
    vi.resetModules();
  });
});

// ---------------------------------------------------------------------------
// AC3 — child-process contention race. Two independent `node` processes
// import session-lock.js directly and race `acquire()` against the SAME
// repoRoot, for many rounds, synchronized by a marker-file readiness barrier
// (no sleeps as synchronization — see CLAUDE.md / ticket instructions).
//
// Barrier design per round:
//   1. Each child writes `ready-<round>-<holderId>` as soon as it enters the
//      round, then busy-polls (tight sync spin, NOT a timed sleep) for
//      `go-<round>`.
//   2. The PARENT (this test) busy-polls for BOTH children's ready markers,
//      then writes `go-<round>` — releasing both children to call acquire()
//      at essentially the same instant.
//   3. Each child writes `done-<round>-<holderId>` immediately after
//      recording its own outcome (win OR lose). TASK-085 review LOW-3 —
//      structural flake fix: the WINNER must not release until it has
//      observed the OTHER child's `done-<round>-*` marker too. Without this,
//      a winner that releases immediately can re-open the lock while a slow
//      loser is still mid-attempt, letting that "loser" acquire the
//      now-vacated lock and spuriously record a double-win for the SAME
//      round. Waiting for both outcomes to be recorded before releasing
//      guarantees the loser's attempt already resolved against the winner's
//      still-held lock.
//   4. Whichever child wins releases only after that barrier; the loser just
//      waits for the lock file to disappear. This guarantees the NEXT round
//      starts from a genuinely empty lock (a real "first acquisition"
//      race), not a leftover fresh lock from the prior round.
// ---------------------------------------------------------------------------

const LOCK_RACE_CHILD_SRC = `
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [, , repoRoot, holderId, otherHolderId, resultsPath, roundsArg, syncDir, sessionLockPath] = process.argv;
const ROUNDS = parseInt(roundsArg, 10);

const { acquire, release } = await import(pathToFileURL(sessionLockPath).href);

function spinUntilExists(p) {
  while (!existsSync(p)) {
    // tight synchronous poll — deterministic readiness barrier, no sleep
  }
}
function spinUntilAbsent(p) {
  while (existsSync(p)) {
    // tight synchronous poll
  }
}

const lockPath = join(repoRoot, 'state', '.lock');
const results = [];

for (let round = 0; round < ROUNDS; round++) {
  const readyPath = join(syncDir, \`ready-\${round}-\${holderId}\`);
  const goPath = join(syncDir, \`go-\${round}\`);
  const donePath = join(syncDir, \`done-\${round}-\${holderId}\`);
  const otherDonePath = join(syncDir, \`done-\${round}-\${otherHolderId}\`);

  writeFileSync(readyPath, '1');
  spinUntilExists(goPath);

  let result;
  try {
    await acquire({ repoRoot, holder: holderId, now: () => new Date().toISOString() });
    result = { round, acquired: true };
  } catch (e) {
    result = { round, acquired: false, code: e && e.code };
  }
  results.push(result);

  // Record our own outcome for this round BEFORE the winner is allowed to
  // release (TASK-085 review LOW-3 — see the barrier-design comment above).
  writeFileSync(donePath, '1');

  if (result.acquired) {
    // Wait for the OTHER child's outcome to be recorded too — guarantees its
    // attempt already resolved (win or lose) against OUR still-held lock,
    // not a lock we've already vacated.
    spinUntilExists(otherDonePath);
    await release({ repoRoot, holder: holderId });
  }
  // Ensure the lock is fully clear before the next round's contention
  // begins — whichever child won must finish releasing first.
  spinUntilAbsent(lockPath);
}

writeFileSync(resultsPath, JSON.stringify(results));
`;

// ---------------------------------------------------------------------------
// TASK-090 — follow-up from the TASK-085 re-review: the CAS-steal and
// corrupt-reclaim paths are path-based, not inode-based. A stealer
// descheduled between its staleness read and its renameSync/unlinkSync call
// can rename away (or delete) a competitor's FRESHLY-RE-CREATED lock at the
// same path — a silent double-win (or silent lock destruction) that the
// existing verify-after-write does not catch, because by the time it reads
// back, our own record is already correctly persisted.
//
// AC1/AC2 — a content check closes the read-to-rename/unlink gap: capture
//   the exact raw bytes observed when staleness was decided, and after the
//   rename-away, verify the claimed file's bytes byte-match. On mismatch,
//   restore (best-effort, via exclusive-create so a third party who has
//   since reclaimed the slot is never clobbered) and fail closed with
//   E_LOCK_HELD.
// AC4 — leftover claim files (state/.lock.claim.<pid>-<hex>), which can only
//   be left behind by a crash between the CAS rename and the finally-unlink
//   (or a failed restore-on-mismatch), are swept opportunistically during
//   acquire() once they age past the staleness window.
//
// Injection seam: reuses the SAME node:fs `renameSync` mock seam already
// exercised by the TASK-085 AC2 spec above (no new seam added to production
// code) — but triggers the mutation BEFORE the real rename executes, so the
// content that gets moved to the claim path is the fresh competitor's, not
// the stale record acquire() originally observed and decided to steal.
// ---------------------------------------------------------------------------

describe('TASK-090 AC1 — content-checked CAS steal detects a fresh competitor record renamed away by mistake', () => {
  it('acquire_restores_and_fails_closed_when_the_renamed_away_content_does_not_match_the_stale_record_observed_pre_steal', async () => {
    vi.resetModules();

    const repoDir = makeStateDir(makeTmpDir('af-lock-content-check-steal'));
    const targetLockPath = lockFilePath(repoDir);

    // Seed a STALE foreign lock so acquire() takes the stale-steal branch.
    seedLock(repoDir, {
      holder_pid: OTHER_PID,
      hostname: OTHER_HOST,
      heartbeat_at: SIX_MIN_AGO,
    });

    const FRESH_COMPETITOR_RECORD = {
      holder_pid: 88888,
      hostname: 'fresh-competitor-host',
      heartbeat_at: BASE_TIME, // fresh
    };

    let injected = false;
    vi.doMock('node:fs', async (importOriginal) => {
      const real = await importOriginal();
      return {
        ...real,
        renameSync: (src, dest) => {
          if (!injected && String(src) === targetLockPath) {
            injected = true;
            // Simulate a fresh competitor re-creating a live lock at this
            // path in the narrow gap between acquire()'s staleness read
            // (which observed the STALE record above) and this very rename
            // call. The rename below will now move THIS content away
            // instead of the stale record acquire() intended to steal.
            real.writeFileSync(
              targetLockPath,
              JSON.stringify(FRESH_COMPETITOR_RECORD, null, 2) + '\n',
              'utf8',
            );
          }
          return real.renameSync(src, dest);
        },
      };
    });

    const { acquire } = await import(SESSION_LOCK_URL);

    let caught;
    try {
      await acquire({
        repoRoot: repoDir,
        now: () => BASE_TIME,
        pid: MY_PID,
        hostname: MY_HOST,
      });
    } catch (e) {
      caught = e;
    }

    expect(
      caught,
      'acquire must detect the content mismatch and refuse instead of proceeding on the wrong record',
    ).toBeDefined();
    expect(caught.code).toBe('E_LOCK_HELD');

    // The fresh competitor's record must be RESTORED to the lock path — it
    // must not be lost just because acquire() grabbed the wrong file off
    // the path.
    const onDisk = JSON.parse(readFileSync(targetLockPath, 'utf8'));
    expect(onDisk.holder_pid).toBe(FRESH_COMPETITOR_RECORD.holder_pid);
    expect(onDisk.hostname).toBe(FRESH_COMPETITOR_RECORD.hostname);

    vi.doUnmock('node:fs');
    vi.resetModules();
  });
});

describe('TASK-090 AC2 — corrupt-reclaim gets the same content-checked guard', () => {
  it('acquire_restores_and_fails_closed_when_a_fresh_competitor_record_is_renamed_away_during_corrupt_reclaim', async () => {
    vi.resetModules();

    const repoDir = makeStateDir(makeTmpDir('af-lock-content-check-corrupt-reclaim'));
    const targetLockPath = lockFilePath(repoDir);

    // Corrupt (unparseable) content, backdated past the staleness window —
    // takes acquire() into the stale-corrupt-lock reclaim branch.
    writeFileSync(targetLockPath, '{not valid json', 'utf8');
    const staleAt = new Date(Date.now() - 10 * 60 * 1000);
    utimesSync(targetLockPath, staleAt, staleAt);

    const FRESH_COMPETITOR_RECORD = {
      holder_pid: 77777,
      hostname: 'fresh-competitor-host-2',
      heartbeat_at: new Date().toISOString(),
    };

    let injected = false;
    vi.doMock('node:fs', async (importOriginal) => {
      const real = await importOriginal();
      return {
        ...real,
        renameSync: (src, dest) => {
          if (!injected && String(src) === targetLockPath) {
            injected = true;
            // A fresh competitor re-creates a live lock at this path in the
            // gap between acquire()'s corrupt-staleness read and this
            // rename (only reachable once the impl phase reclaims corrupt
            // locks via the same rename-based CAS as stale foreign locks).
            real.writeFileSync(
              targetLockPath,
              JSON.stringify(FRESH_COMPETITOR_RECORD, null, 2) + '\n',
              'utf8',
            );
          }
          return real.renameSync(src, dest);
        },
      };
    });

    const { acquire } = await import(SESSION_LOCK_URL);

    let caught;
    try {
      await acquire({
        repoRoot: repoDir,
        pid: MY_PID,
        hostname: MY_HOST,
      });
    } catch (e) {
      caught = e;
    }

    expect(
      caught,
      'corrupt-reclaim must detect the content mismatch and refuse rather than destroying a fresh competitor lock',
    ).toBeDefined();
    expect(caught.code).toBe('E_LOCK_HELD');

    const onDisk = JSON.parse(readFileSync(targetLockPath, 'utf8'));
    expect(onDisk.holder_pid).toBe(FRESH_COMPETITOR_RECORD.holder_pid);
    expect(onDisk.hostname).toBe(FRESH_COMPETITOR_RECORD.hostname);

    vi.doUnmock('node:fs');
    vi.resetModules();
  });
});

// ---------------------------------------------------------------------------
// TASK-090 re-review MEDIUM-1 (AC2/AC3 follow-up) — the corrupt-reclaim
// content check above is anchored to a POST-DECISION re-read (a fresh
// readFileSync taken right before the steal), not the bytes the staleness
// DECISION itself was made on (rawExisting, captured once at the top of
// acquire()). If a fresh competitor re-creates a live, valid lock in the gap
// between the staleness-deciding statSync and that later re-read, the
// re-read captures the COMPETITOR'S content, which then trivially "matches
// itself" once renamed away — the double-win this whole ticket exists to
// close, reopened on the corrupt-reclaim leg specifically. The fix anchors
// the content check to rawExisting (the original pre-decision read) instead.
// ---------------------------------------------------------------------------

describe('TASK-090 MEDIUM-1 — corrupt-reclaim content check must anchor to the ORIGINAL pre-decision read, not a fresh re-read taken after staleness is decided', () => {
  it('acquire_restores_and_fails_closed_when_a_fresh_competitor_record_lands_between_the_staleness_stat_and_the_reclaim_content_read', async () => {
    vi.resetModules();

    const repoDir = makeStateDir(makeTmpDir('af-lock-medium1-stat-to-read-gap'));
    const targetLockPath = lockFilePath(repoDir);

    // Corrupt (unparseable) content, backdated past the staleness window —
    // this is ALSO the exact content acquire()'s very first raw read
    // (rawExisting) observes and uses to decide "unparseable -> corrupt
    // branch" in the first place.
    const ORIGINAL_CORRUPT_CONTENT = '{not valid json';
    writeFileSync(targetLockPath, ORIGINAL_CORRUPT_CONTENT, 'utf8');
    const staleAt = new Date(Date.now() - 10 * 60 * 1000);
    utimesSync(targetLockPath, staleAt, staleAt);

    const FRESH_COMPETITOR_RECORD = {
      holder_pid: 66666,
      hostname: 'fresh-competitor-host-3',
      heartbeat_at: new Date().toISOString(),
    };

    let injected = false;
    vi.doMock('node:fs', async (importOriginal) => {
      const real = await importOriginal();
      return {
        ...real,
        statSync: (p, ...rest) => {
          // Capture the OLD (stale) stat BEFORE mutating — this is the read
          // the staleness decision trusts.
          const result = real.statSync(p, ...rest);
          if (!injected && String(p) === targetLockPath) {
            injected = true;
            // Simulate a fresh competitor re-creating a LIVE, valid lock at
            // this path in the gap between this staleness-deciding statSync
            // call and whatever the reclaim logic reads afterward to decide
            // what to rename away. A content check anchored to a
            // POST-decision re-read will capture THIS fresh content and
            // trivially "match" itself.
            real.writeFileSync(
              targetLockPath,
              JSON.stringify(FRESH_COMPETITOR_RECORD, null, 2) + '\n',
              'utf8',
            );
          }
          return result;
        },
      };
    });

    const { acquire } = await import(SESSION_LOCK_URL);

    let caught;
    try {
      await acquire({
        repoRoot: repoDir,
        pid: MY_PID,
        hostname: MY_HOST,
      });
    } catch (e) {
      caught = e;
    }

    expect(
      caught,
      'acquire must detect that the content changed between the staleness decision and the reclaim, and refuse instead of silently stealing a fresh competitor lock',
    ).toBeDefined();
    expect(caught.code).toBe('E_LOCK_HELD');

    // The fresh competitor's record must be RESTORED — it must not be
    // destroyed just because it happened to occupy the path when the
    // reclaim logic went looking for "what's there to rename away".
    const onDisk = JSON.parse(readFileSync(targetLockPath, 'utf8'));
    expect(onDisk.holder_pid).toBe(FRESH_COMPETITOR_RECORD.holder_pid);
    expect(onDisk.hostname).toBe(FRESH_COMPETITOR_RECORD.hostname);

    vi.doUnmock('node:fs');
    vi.resetModules();
  });
});

describe('TASK-090 AC4 — stale claim files are swept opportunistically during acquire()', () => {
  it('sweep_reaps_stale_claim_files_but_leaves_fresh_ones_untouched', async () => {
    const { acquire } = await import(SESSION_LOCK_URL);

    const repoDir = makeStateDir(makeTmpDir('af-lock-claim-sweep'));
    const stateDir = join(repoDir, 'state');

    const staleClaimPath = join(stateDir, '.lock.claim.12345-deadbeef01');
    const freshClaimPath = join(stateDir, '.lock.claim.67890-cafef00d02');

    writeFileSync(staleClaimPath, '{"holder_pid":12345}', 'utf8');
    const staleAt = new Date(Date.now() - 10 * 60 * 1000); // 10 min ago — beyond default 5-min window
    utimesSync(staleClaimPath, staleAt, staleAt);

    writeFileSync(freshClaimPath, '{"holder_pid":67890}', 'utf8');
    // fresh mtime (just written) — must survive the sweep.

    // No pre-existing lock — acquire() takes the first-acquisition branch,
    // but the sweep must run regardless of which branch acquire() takes.
    const result = await acquire({
      repoRoot: repoDir,
      now: () => BASE_TIME,
      pid: MY_PID,
      hostname: MY_HOST,
    });

    expect(result.acquired).toBe(true);
    expect(existsSync(staleClaimPath), 'stale claim file must be reaped').toBe(false);
    expect(existsSync(freshClaimPath), 'fresh claim file must survive the sweep').toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TASK-094 — follow-up from the TASK-090 review (LOW-4): renew()/release()/
// the same-holder re-acquire branch carry the SAME path-vs-inode residue
// TASK-090 closed on the steal/reclaim paths above. AC1/AC3 close it on
// release() and the same-holder re-acquire branch via the SAME
// content-checked CAS primitive (stealAwayContentChecked) already exercised
// by the TASK-090 specs; AC2 (renew()) is accepted, documented residue per
// the plan's "guard where near-free, honest comment where disproportionate"
// standard — see the comment on renew()'s writeLock() call in
// src/session-lock.js. No new spec for renew() (documented paths are not
// testable behavior, per the ticket).
//
// Injection seam: reuses the SAME node:fs `renameSync` mock seam as the
// TASK-090 specs above — write a fresh competitor record onto the lock path
// immediately BEFORE the real rename fires, simulating a steal that landed
// in the narrow gap between this call's own decision-read and its own
// mutating rename.
// ---------------------------------------------------------------------------

describe("TASK-094 AC1 — release() content-checked delete detects a stolen lock and does not destroy the stealer's fresh record", () => {
  it('release_restores_and_no_ops_when_the_renamed_away_content_does_not_match_the_record_observed_pre_delete', async () => {
    vi.resetModules();

    const repoDir = makeStateDir(makeTmpDir('af-lock-release-content-check'));
    const targetLockPath = lockFilePath(repoDir);

    // Seed a lock held by ME.
    seedLock(repoDir, {
      holder_pid: MY_PID,
      hostname: MY_HOST,
      heartbeat_at: TWO_MIN_AGO,
    });

    const FRESH_COMPETITOR_RECORD = {
      holder_pid: 55555,
      hostname: 'fresh-competitor-host-release',
      heartbeat_at: BASE_TIME,
    };

    let injected = false;
    vi.doMock('node:fs', async (importOriginal) => {
      const real = await importOriginal();
      return {
        ...real,
        renameSync: (src, dest) => {
          if (!injected && String(src) === targetLockPath) {
            injected = true;
            // Simulate a competitor stealing the lock (it went stale and was
            // reclaimed by another process) in the gap between release()'s
            // own decision-read and this mutating rename.
            real.writeFileSync(
              targetLockPath,
              JSON.stringify(FRESH_COMPETITOR_RECORD, null, 2) + '\n',
              'utf8',
            );
          }
          return real.renameSync(src, dest);
        },
      };
    });

    const { release } = await import(SESSION_LOCK_URL);

    await expect(
      release({ repoRoot: repoDir, pid: MY_PID, hostname: MY_HOST }),
    ).resolves.not.toThrow();

    // The stealer's fresh record must survive — release() must not have
    // destroyed it just because it happened to occupy the path release()
    // went looking for "what's there to delete".
    const onDisk = JSON.parse(readFileSync(targetLockPath, 'utf8'));
    expect(onDisk.holder_pid).toBe(FRESH_COMPETITOR_RECORD.holder_pid);
    expect(onDisk.hostname).toBe(FRESH_COMPETITOR_RECORD.hostname);

    vi.doUnmock('node:fs');
    vi.resetModules();
  });
});

describe("TASK-094 AC3 — same-holder re-acquire content-checked write detects a stolen lock and does not clobber the stealer's fresh record", () => {
  it('acquire_throws_e_lock_held_and_restores_when_a_fresh_competitor_record_is_renamed_away_during_same_holder_reacquire', async () => {
    vi.resetModules();

    const repoDir = makeStateDir(makeTmpDir('af-lock-reacquire-content-check'));
    const targetLockPath = lockFilePath(repoDir);

    // Seed a lock already held by ME.
    seedLock(repoDir, {
      holder_pid: MY_PID,
      hostname: MY_HOST,
      heartbeat_at: TWO_MIN_AGO,
    });

    const FRESH_COMPETITOR_RECORD = {
      holder_pid: 44444,
      hostname: 'fresh-competitor-host-reacquire',
      heartbeat_at: BASE_TIME,
    };

    let injected = false;
    vi.doMock('node:fs', async (importOriginal) => {
      const real = await importOriginal();
      return {
        ...real,
        renameSync: (src, dest) => {
          if (!injected && String(src) === targetLockPath) {
            injected = true;
            // Simulate a competitor stealing the lock (it went stale and was
            // reclaimed by another process) in the gap between acquire()'s
            // own decision-read (rawExisting, at the top of acquire()) and
            // this same-holder-reacquire branch's mutating rename.
            real.writeFileSync(
              targetLockPath,
              JSON.stringify(FRESH_COMPETITOR_RECORD, null, 2) + '\n',
              'utf8',
            );
          }
          return real.renameSync(src, dest);
        },
      };
    });

    const { acquire } = await import(SESSION_LOCK_URL);

    let caught;
    try {
      await acquire({
        repoRoot: repoDir,
        now: () => BASE_TIME,
        pid: MY_PID,
        hostname: MY_HOST,
      });
    } catch (e) {
      caught = e;
    }

    expect(
      caught,
      'acquire must detect the content mismatch during same-holder re-acquire and refuse instead of clobbering a fresh competitor lock',
    ).toBeDefined();
    expect(caught.code).toBe('E_LOCK_HELD');

    const onDisk = JSON.parse(readFileSync(targetLockPath, 'utf8'));
    expect(onDisk.holder_pid).toBe(FRESH_COMPETITOR_RECORD.holder_pid);
    expect(onDisk.hostname).toBe(FRESH_COMPETITOR_RECORD.hostname);

    vi.doUnmock('node:fs');
    vi.resetModules();
  });
});

describe('TASK-085 AC3 — two concurrent child processes race acquire(); exactly one wins each round', () => {
  it('race_two_child_processes_exactly_one_winner_per_round', async () => {
    const ROUNDS = 15;
    const repoDir = makeStateDir(makeTmpDir('af-lock-race-repo'));
    const syncDir = makeTmpDir('af-lock-race-sync');

    const childScriptPath = join(syncDir, 'lock-race-child.mjs');
    writeFileSync(childScriptPath, LOCK_RACE_CHILD_SRC, 'utf8');

    const sessionLockPath = join(__srcDir, 'session-lock.js');

    const resultsA = join(syncDir, 'results-A.json');
    const resultsB = join(syncDir, 'results-B.json');

    function spawnChild(holder, otherHolder, resultsPath) {
      return spawn(process.execPath, [
        childScriptPath, repoDir, holder, otherHolder, resultsPath, String(ROUNDS), syncDir, sessionLockPath,
      ]);
    }

    const childA = spawnChild('race-holder-A', 'race-holder-B', resultsA);
    const childB = spawnChild('race-holder-B', 'race-holder-A', resultsB);

    let stderrA = '';
    let stderrB = '';
    childA.stderr.on('data', (d) => { stderrA += d.toString(); });
    childB.stderr.on('data', (d) => { stderrB += d.toString(); });

    // Dispense a "go" signal for each round only once BOTH children have
    // marked themselves ready for that round.
    for (let round = 0; round < ROUNDS; round++) {
      const readyA = join(syncDir, `ready-${round}-race-holder-A`);
      const readyB = join(syncDir, `ready-${round}-race-holder-B`);
      while (!existsSync(readyA) || !existsSync(readyB)) {
        // tight synchronous poll — no sleep-based coordination
      }
      writeFileSync(join(syncDir, `go-${round}`), '1');
    }

    const [codeA, codeB] = await Promise.all([
      new Promise((resolve) => childA.on('exit', (code) => resolve(code))),
      new Promise((resolve) => childB.on('exit', (code) => resolve(code))),
    ]);

    expect(codeA, `child A must exit 0. stderr:\n${stderrA}`).toBe(0);
    expect(codeB, `child B must exit 0. stderr:\n${stderrB}`).toBe(0);

    const a = JSON.parse(readFileSync(resultsA, 'utf8'));
    const b = JSON.parse(readFileSync(resultsB, 'utf8'));

    expect(a).toHaveLength(ROUNDS);
    expect(b).toHaveLength(ROUNDS);

    for (let round = 0; round < ROUNDS; round++) {
      const aWon = a[round].acquired;
      const bWon = b[round].acquired;
      expect(
        aWon !== bWon,
        `round ${round}: exactly one child must win the race (A acquired=${aWon}, B acquired=${bWon})`,
      ).toBe(true);
      if (!aWon) {
        expect(a[round].code, `round ${round}: loser A must see E_LOCK_HELD`).toBe('E_LOCK_HELD');
      }
      if (!bWon) {
        expect(b[round].code, `round ${round}: loser B must see E_LOCK_HELD`).toBe('E_LOCK_HELD');
      }
    }
  }, 15000);
});
