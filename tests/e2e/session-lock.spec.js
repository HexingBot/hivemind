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

    await release({ repoRoot: repoDir });

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
    await expect(release({ repoRoot: repoDir })).resolves.not.toThrow();
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
