// tests/e2e/worktree-handback-partial-removal.spec.js
// TASK-206 — removeMergedWorktree's E_GIT_FAILED cannot distinguish "nothing
// happened" from "mostly happened".
//
// Real incident (2026-08-06, during TASK-198's close-gate verification): a
// long in-worktree `npm run test:all` run left a Windows directory handle
// open; the subsequent `removeMergedWorktree` disposal threw E_GIT_FAILED
// ("Permission denied" unlinking the worktree root) AFTER git had already
// deregistered the worktree (`git worktree list` showed only the primary)
// and emptied its contents — only the final root-directory unlink failed. A
// caller receiving a bare E_GIT_FAILED could not tell that apart from a
// no-op, which is the natural (and here wrong) assumption for a typed error
// from a destructive operation.
//
// HONEST SCOPE (per this ticket's own guidance): forcing a REAL held Windows
// directory handle, or a REAL non-ENOENT lstat/realpath failure, on demand
// is impractical to do deterministically in a test — the same reasoning
// tests/worktree-handback-probe.spec.js and
// tests/worktree-handback-merge-base-failclosed.spec.js already give for
// mocking node:child_process's spawnSync, and tests/e2e/
// worktree-handback-lstat-failopen.spec.js gives for partially mocking
// node:fs's lstatSync. This spec follows both exact precedents: spawnSync is
// fully mocked (git behaviour), and lstatSync is partially mocked (fs
// behaviour, real implementation by default, one path intercepted per
// test) — so what is under test is this module's post-failure PROBING and
// REPORTING logic, not git's or the OS's own disk behaviour. This does NOT
// reproduce the Windows handle-contention trigger itself; it reproduces (and
// locks) the caller-visible CONTRACT that trigger exposed.
//
// What this sensor covers: all three fields removeMergedWorktree's thrown
// E_GIT_FAILED now carries (worktreeRegistration, worktreeDirectory,
// nodeModulesSever per the module doc comment's "POST-CONDITION LEGIBILITY
// ON E_GIT_FAILED" section), including BOTH independent 'unknown' sources
// fixed in this round: a non-ENOENT lstat failure on worktreePath itself
// (HIGH-1), and an uncanonicalizable worktreePath folding a "no match" into
// the wrong benign 'deregistered' reading (MEDIUM-1). It fails if any of
// that reporting is removed, reverted to a bare throw, or reverted to the
// two-valued (existsSync-boolean / found-implies-deregistered) shapes this
// round replaced — red-green planted for the original two-field shape before
// the first commit (see that hand-off) and re-verified for this round's two
// three-valuing fixes (see this hand-off).

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { join } from 'node:path';

import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';

const spawnSyncMock = vi.fn();

// vi.mock is hoisted above imports by vitest, so this replaces node:child_process
// for the whole file before worktree-handback.js (imported below) gets its own
// binding via `import { spawnSync } from 'node:child_process'` — same
// precedent as tests/worktree-handback-probe.spec.js and
// tests/worktree-handback-merge-base-failclosed.spec.js.
vi.mock('node:child_process', () => ({
  spawnSync: (...args) => spawnSyncMock(...args),
}));

// Partial fs mock — same precedent as tests/e2e/worktree-handback-lstat-
// failopen.spec.js: only lstatSync is wrapped, every other fs call (this
// file's own mkdirSync/realpathSync, and worktree-handback.js's own rmSync)
// passes straight through to the real implementation.
vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    lstatSync: vi.fn(real.lstatSync),
  };
});

import { mkdirSync, realpathSync, lstatSync } from 'node:fs';
import { removeMergedWorktree, normalizeForCompare } from '../../src/worktree-handback.js';

afterAll(() => cleanupAll());
beforeEach(() => {
  spawnSyncMock.mockReset();
});
afterEach(() => {
  // Clears call history only — a per-test mockImplementation override (if
  // any) is deliberately left in place, same rationale as
  // worktree-handback-lstat-failopen.spec.js: every test below targets a
  // distinct path, so a leftover conditional override is a no-op elsewhere.
  lstatSync.mockClear();
});

/** Same normalization the real e2e worktree specs use: realpath + forward
 * slashes, matching what `git worktree list --porcelain` reports and what
 * this module's own `normalizeForCompare` produces. */
function toPosix(p) {
  return realpathSync.native(p).replace(/\\/g, '/');
}

/** Build `git worktree list --porcelain` output for a primary + one worktree
 * entry, in the shape parseWorktreeList expects. */
function porcelainWithWorktree(primaryPosix, wtPosix, branch) {
  return (
    `worktree ${primaryPosix}\n` +
    'HEAD deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n' +
    'branch refs/heads/main\n' +
    '\n' +
    `worktree ${wtPosix}\n` +
    'HEAD cafebabecafebabecafebabecafebabecafebabe\n' +
    `branch refs/heads/${branch}\n` +
    '\n'
  );
}

/** Same shape, but the worktree entry is ABSENT — simulating git having
 * already deregistered it. */
function porcelainWithoutWorktree(primaryPosix) {
  return (
    `worktree ${primaryPosix}\n` +
    'HEAD deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n' +
    'branch refs/heads/main\n' +
    '\n'
  );
}

describe('TASK-206 — removeMergedWorktree reports partial-completion post-conditions instead of a bare, ambiguous throw', () => {
  it('a_git_worktree_remove_failure_after_deregistration_reports_deregistered_and_present_instead_of_looking_like_a_no_op', () => {
    const repoRoot = makeTmpDir('wt-partial-repo');
    const worktreePath = join(makeTmpDir('wt-partial-wt-parent'), 'wt');
    // Real, empty directory — matches the real incident's observed state:
    // git had already emptied the worktree's contents, only the final
    // root-directory unlink failed, so the path still exists but is bare.
    mkdirSync(worktreePath);

    const repoRootPosix = toPosix(repoRoot);
    const wtPosix = toPosix(worktreePath);

    // Exact call order inside removeMergedWorktree for this happy-path-up-to-
    // disposal case:
    //   1. findWorktreeEntry       -> `git worktree list --porcelain`
    //   2. countUnmergedCommits    -> `git rev-list --count HEAD..agent-x`
    //   3. dirty check             -> `git status --porcelain` (cwd=worktree)
    //   4. `git worktree remove <worktreePath>` — THE load-bearing failure
    //   5. probeWorktreeRegistered -> `git worktree list --porcelain` (re-read)
    // (the node_modules lstat between steps 3 and 4, and the worktreeDirectory
    // lstat after step 4, are real, non-mocked-by-default fs calls against a
    // genuinely-present/absent path — no queued spawnSync entry needed.)
    spawnSyncMock
      .mockReturnValueOnce({ status: 0, stdout: porcelainWithWorktree(repoRootPosix, wtPosix, 'agent-x'), stderr: '' })
      .mockReturnValueOnce({ status: 0, stdout: '0\n', stderr: '' })
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' })
      .mockReturnValueOnce({
        status: 255,
        stdout: '',
        stderr: `error: failed to delete '${worktreePath}': Permission denied\n`,
      })
      .mockReturnValueOnce({ status: 0, stdout: porcelainWithoutWorktree(repoRootPosix), stderr: '' });

    let thrown = null;
    try {
      removeMergedWorktree({ repoRoot, worktreePath, branch: 'agent-x', targetBranch: 'HEAD' });
    } catch (e) {
      thrown = e;
    }

    expect(
      thrown,
      'expected removeMergedWorktree to throw E_GIT_FAILED when the mocked `git worktree remove` exits 255',
    ).not.toBeNull();
    expect(thrown.code).toBe('E_GIT_FAILED');

    // The load-bearing assertions (AC2/AC4): the caller reads the outcome,
    // it does not have to infer it.
    expect(thrown.worktreeRegistration).toBe('deregistered');
    expect(thrown.worktreeDirectory).toBe('present');
    expect(thrown.nodeModulesSever).toBe('absent');

    // The message itself must not read like an ordinary "nothing happened"
    // failure — it must name the partial-completion ambiguity explicitly.
    expect(thrown.message).toContain('PARTIAL');
    expect(thrown.message).toContain('deregistered');
    expect(thrown.message).toContain('present');

    // Exactly 5 git calls — the post-failure probe ran (a 6th, spurious call
    // would mean an extra/duplicate probe; fewer would mean the probe never
    // ran at all).
    expect(spawnSyncMock).toHaveBeenCalledTimes(5);

    // LOW-1 (fix round) — the mock queue above is purely positional; without
    // asserting the actual arguments, swapping the failing call for a
    // different git command (or the re-probe for a differently-shaped one)
    // would still pass. Pin both load-bearing calls by argument.
    expect(spawnSyncMock.mock.calls[3][1]).toEqual(['worktree', 'remove', worktreePath]);
    expect(spawnSyncMock.mock.calls[4][1]).toEqual(['worktree', 'list', '--porcelain']);
  });

  it('a_registration_re_check_that_itself_cannot_answer_is_reported_as_unknown_not_folded_into_either_state', () => {
    const repoRoot = makeTmpDir('wt-partial-unknown-repo');
    const worktreePath = join(makeTmpDir('wt-partial-unknown-wt-parent'), 'wt');
    mkdirSync(worktreePath);

    const repoRootPosix = toPosix(repoRoot);
    const wtPosix = toPosix(worktreePath);

    spawnSyncMock
      .mockReturnValueOnce({ status: 0, stdout: porcelainWithWorktree(repoRootPosix, wtPosix, 'agent-y'), stderr: '' })
      .mockReturnValueOnce({ status: 0, stdout: '0\n', stderr: '' })
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' })
      .mockReturnValueOnce({ status: 255, stdout: '', stderr: 'error: failed to delete: Permission denied\n' })
      // The post-failure re-probe itself cannot answer (e.g. an environmental
      // git-level failure while merely trying to describe the first one) —
      // this must NOT be silently folded into either 'registered' or
      // 'deregistered' (the module invariant's three-valued contract).
      .mockReturnValueOnce({ status: 128, stdout: '', stderr: 'fatal: unable to fork' });

    let thrown = null;
    try {
      removeMergedWorktree({ repoRoot, worktreePath, branch: 'agent-y', targetBranch: 'HEAD' });
    } catch (e) {
      thrown = e;
    }

    expect(thrown).not.toBeNull();
    expect(thrown.code).toBe('E_GIT_FAILED');
    expect(thrown.worktreeRegistration).toBe('unknown');
    expect(thrown.worktreeDirectory).toBe('present');
    expect(thrown.message).toContain('registration re-check itself failed');

    // The ORIGINAL git worktree remove failure is still the error that
    // surfaces — a failure in the secondary probe must not mask or replace
    // it with an unrelated "unable to fork" error instead.
    expect(thrown.message).toContain('worktree remove');
  });

  it('a_non_ENOENT_lstat_failure_on_worktreePath_itself_is_reported_as_unknown_not_read_as_no_longer_exists', () => {
    // HIGH-1 (fix round) — existsSync used to collapse a permission-denied
    // (or otherwise unreadable) worktreePath to the same `false` as a
    // genuine absence, and the message asserted "no longer exists on disk"
    // as a statement of fact it could not actually back up. This is exactly
    // the incident's own Windows box under handle/AV contention — a plausible
    // real shape, not a theoretical one.
    const repoRoot = makeTmpDir('wt-unknown-dir-repo');
    const worktreePath = join(makeTmpDir('wt-unknown-dir-wt-parent'), 'wt');
    mkdirSync(worktreePath);

    const repoRootPosix = toPosix(repoRoot);
    const wtPosix = toPosix(worktreePath);

    spawnSyncMock
      .mockReturnValueOnce({ status: 0, stdout: porcelainWithWorktree(repoRootPosix, wtPosix, 'agent-z'), stderr: '' })
      .mockReturnValueOnce({ status: 0, stdout: '0\n', stderr: '' })
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' })
      .mockReturnValueOnce({ status: 255, stdout: '', stderr: 'error: failed to delete: Permission denied\n' })
      .mockReturnValueOnce({ status: 0, stdout: porcelainWithoutWorktree(repoRootPosix), stderr: '' });

    // Intercept lstatSync ONLY for the exact worktreePath (the post-failure
    // directory check) — every other lstatSync call (the pre-existing
    // node_modules sever check, at a DIFFERENT path) passes through to the
    // real implementation untouched.
    const realLstat = lstatSync.getMockImplementation();
    lstatSync.mockImplementation((p, ...rest) => {
      if (String(p) === worktreePath) {
        const e = new Error(`EPERM: operation not permitted, lstat '${p}'`);
        e.code = 'EPERM';
        throw e;
      }
      return realLstat(p, ...rest);
    });

    let thrown = null;
    try {
      removeMergedWorktree({ repoRoot, worktreePath, branch: 'agent-z', targetBranch: 'HEAD' });
    } catch (e) {
      thrown = e;
    }

    expect(thrown).not.toBeNull();
    expect(thrown.code).toBe('E_GIT_FAILED');
    expect(thrown.worktreeDirectory).toBe('unknown');
    expect(thrown.nodeModulesSever).toBe('absent');
    // The failing e.code is carried into the message, the same way a
    // registration-probe failure already is.
    expect(thrown.message).toContain('lstat failed');
    expect(thrown.message).toContain('EPERM');
    // Must NOT claim a fact it cannot back up.
    expect(thrown.message).not.toContain('no longer exists');
  });

  it('an_uncanonicalizable_worktreePath_with_no_matching_entry_is_reported_as_unknown_not_deregistered', () => {
    // MEDIUM-1 (fix round) — a "no match" result from the post-failure
    // registration re-read is only trustworthy proof of "deregistered" if
    // worktreePath itself canonicalized successfully. This test never
    // creates worktreePath on disk at all, so `realpathSync.native` fails
    // for it on every call, exactly the "just been removed, or never
    // resolvable" situation the fix addresses — entirely via the real,
    // unmocked realpath/lstat behaviour against a genuinely absent path
    // (no fs mock needed for this one).
    const repoRoot = makeTmpDir('wt-uncanon-repo');
    const repoRootPosix = toPosix(repoRoot);
    const worktreePath = join(repoRoot, 'never-created-wt');

    // The exact fallback string normalizeForCompare produces for this path
    // (realpath fails since it never existed) — used so the FIRST list read
    // (findWorktreeEntry) still finds a match despite never canonicalizing,
    // isolating this test to the SECOND (post-failure) probe's behaviour.
    const fallbackForm = normalizeForCompare(worktreePath);

    spawnSyncMock
      .mockReturnValueOnce({ status: 0, stdout: porcelainWithWorktree(repoRootPosix, fallbackForm, 'agent-w'), stderr: '' })
      .mockReturnValueOnce({ status: 0, stdout: '0\n', stderr: '' })
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' })
      .mockReturnValueOnce({ status: 255, stdout: '', stderr: 'error: failed to delete: Permission denied\n' })
      // Post-failure re-read: no matching entry at all — the pre-fix code
      // would read this as proof of 'deregistered'; the fix must not, since
      // worktreePath still cannot be canonicalized to compare reliably.
      .mockReturnValueOnce({ status: 0, stdout: porcelainWithoutWorktree(repoRootPosix), stderr: '' });

    let thrown = null;
    try {
      removeMergedWorktree({ repoRoot, worktreePath, branch: 'agent-w', targetBranch: 'HEAD' });
    } catch (e) {
      thrown = e;
    }

    expect(thrown).not.toBeNull();
    expect(thrown.code).toBe('E_GIT_FAILED');
    expect(thrown.worktreeRegistration).toBe('unknown');
    expect(thrown.worktreeDirectory).toBe('absent');
    expect(thrown.message).toContain('could not be canonicalized');
  });
});
