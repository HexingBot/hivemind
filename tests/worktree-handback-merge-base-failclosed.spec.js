// tests/worktree-handback-merge-base-failclosed.spec.js
// TASK-197 fix round — HIGH: detectGeneratedArtifactCollision (reached via
// mergeWorktreeBranch) must fail CLOSED, not open, when `git merge-base`
// itself cannot answer for a reason OTHER than "no common ancestor" (exit 1)
// or "branch does not exist" (checked separately, first, via probeRefExists).
//
// A transient/environmental merge-base failure (spawn error, EMFILE, an
// AV/indexer lock — the exact class this module's own docs already cite
// elsewhere for Windows) is impractical to force on demand against real git
// (same reasoning tests/worktree-handback-probe.spec.js gives for its own
// mocked spec), so this stubs node:child_process's spawnSync directly,
// following that exact precedent. Pure logic, no real disk I/O (fast tier).

import { describe, it, expect, vi, beforeEach } from 'vitest';

const spawnSyncMock = vi.fn();

// vi.mock is hoisted above imports by vitest, so this replaces node:child_process
// for the whole file before worktree-handback.js (imported below) gets its own
// binding via `import { spawnSync } from 'node:child_process'`.
vi.mock('node:child_process', () => ({
  spawnSync: (...args) => spawnSyncMock(...args),
}));

import { mergeWorktreeBranch } from '../src/worktree-handback.js';

describe('mergeWorktreeBranch -> detectGeneratedArtifactCollision — fails CLOSED on an unanswerable git merge-base', () => {
  beforeEach(() => {
    spawnSyncMock.mockReset();
  });

  it('throws_E_GIT_FAILED_instead_of_silently_treating_an_unenumerated_merge_base_failure_as_no_collision', () => {
    // Exact call order inside mergeWorktreeBranch for a branch that is NOT
    // already merge-parked and DOES resolve:
    //   1. probeMergeHead -> `git rev-parse --verify -q MERGE_HEAD`  (absent: exit 1)
    //   2. detectGeneratedArtifactCollision's probeRefExists(branch) ->
    //      `git rev-parse --verify -q <branch>` (present: exit 0)
    //   3. `git merge-base HEAD <branch>` -> the load-bearing failure: NOT
    //      exit 0 (a real base), NOT exit 1 (git's documented "no common
    //      ancestor" signal) — an unenumerated, environmental-style failure.
    // Mocks 4-5 simulate what would happen NEXT if the collision check were
    // (wrongly) bypassed — the real `git merge` "succeeding" — so that a
    // fail-OPEN regression here shows up as a clean, diagnostic "expected a
    // refusal but got a successful merge" assertion failure, not an
    // incidental TypeError from the mock queue simply running out.
    spawnSyncMock
      .mockReturnValueOnce({ status: 1, stdout: '', stderr: '' })
      .mockReturnValueOnce({ status: 0, stdout: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n', stderr: '' })
      .mockReturnValueOnce({ status: 2, stdout: '', stderr: 'fatal: unable to fork for merge-base' })
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' })
      .mockReturnValueOnce({ status: 0, stdout: 'cafebabecafebabecafebabecafebabecafebabe\n', stderr: '' });

    let thrown = null;
    let mergeResult = null;
    try {
      mergeResult = mergeWorktreeBranch({ repoRoot: '/fake/repo', branch: 'agent-x' });
    } catch (e) {
      thrown = e;
    }

    expect(
      thrown,
      `expected mergeWorktreeBranch to fail CLOSED (E_GIT_FAILED) when git merge-base itself could not answer, ` +
      `but it returned ${JSON.stringify(mergeResult)} instead — i.e. the collision check was silently bypassed ` +
      'and the merge proceeded (the TASK-197 fix-round HIGH defect this test reproduces).',
    ).not.toBeNull();
    expect(thrown.code).toBe('E_GIT_FAILED');
    expect(thrown.message).toContain('merge-base');
    // Only 3 git calls happened — the guard threw before ever attempting the
    // real `git merge`, i.e. before any state-mutating call could run.
    expect(spawnSyncMock).toHaveBeenCalledTimes(3);
  });
});
