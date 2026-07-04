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

import { describe, it, expect, afterAll } from 'vitest';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

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
