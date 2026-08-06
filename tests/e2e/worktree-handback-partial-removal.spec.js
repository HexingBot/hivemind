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
// directory handle on demand is impractical to do deterministically in a
// test — the same reasoning tests/worktree-handback-probe.spec.js and
// tests/worktree-handback-merge-base-failclosed.spec.js already give for
// mocking node:child_process's spawnSync rather than forcing the equivalent
// real git failure. This spec follows that exact precedent: spawnSync is
// fully mocked to deterministically reproduce a `git worktree remove`
// failure with EXACTLY the real incident's post-conditions (deregistered +
// still-present-on-disk), so what is under test is this module's new
// post-failure PROBING and REPORTING logic, not git's own disk behaviour.
// The worktree/repo directories themselves are real (`makeTmpDir`) so the
// `existsSync` half of the post-condition check exercises a genuine
// filesystem read, not a second mock — only the `git` calls are faked. This
// does NOT reproduce the Windows handle-contention trigger itself; it
// reproduces (and locks) the caller-visible CONTRACT that trigger exposed.
//
// What this sensor covers: both new fields removeMergedWorktree's thrown
// E_GIT_FAILED now carries (worktreeRegistration, worktreeDirectoryExists,
// nodeModulesSever per the module doc comment's "POST-CONDITION LEGIBILITY
// ON E_GIT_FAILED" section), including the probe's own three-valued
// could-not-answer fallback ('unknown'). It fails if that reporting is
// removed or reverted to a bare throw: reverting the post-failure block back
// to a plain `runGitOrThrow(repoRoot, ['worktree', 'remove', worktreePath],
// 'removeMergedWorktree')` was used to red-green-plant this spec before
// commit (see the hand-off) and produced exactly the expected failures below
// (undefined fields / a generic git-failure message with none of the
// post-condition text).

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { mkdirSync, realpathSync } from 'node:fs';
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

import { removeMergedWorktree } from '../../src/worktree-handback.js';

afterAll(() => cleanupAll());
beforeEach(() => {
  spawnSyncMock.mockReset();
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
  it('a_git_worktree_remove_failure_after_deregistration_reports_deregistered_and_still_on_disk_instead_of_looking_like_a_no_op', () => {
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
    // (the node_modules lstat between steps 3 and 4 is a real, non-mocked fs
    // call against a genuinely-absent path — no queued spawnSync entry needed
    // for it.)
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
    expect(thrown.worktreeDirectoryExists).toBe(true);
    expect(thrown.nodeModulesSever).toBe('absent');

    // The message itself must not read like an ordinary "nothing happened"
    // failure — it must name the partial-completion ambiguity explicitly.
    expect(thrown.message).toContain('PARTIAL');
    expect(thrown.message).toContain('deregistered');
    expect(thrown.message).toContain('still exists');

    // Exactly 5 git calls — the post-failure probe ran (a 6th, spurious call
    // would mean an extra/duplicate probe; fewer would mean the probe never
    // ran at all).
    expect(spawnSyncMock).toHaveBeenCalledTimes(5);
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
    expect(thrown.worktreeDirectoryExists).toBe(true);
    expect(thrown.message).toContain('registration re-check itself failed');

    // The ORIGINAL git worktree remove failure is still the error that
    // surfaces — a failure in the secondary probe must not mask or replace
    // it with an unrelated "unable to fork" error instead.
    expect(thrown.message).toContain('worktree remove');
  });
});
