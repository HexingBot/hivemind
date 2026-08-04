// tests/worktree-handback-probe.spec.js
// TASK-195 fix round 3 — MEDIUM: a probe failure was being read as a state
// assertion. `probeMergeHead` is the shared three-valued helper (present /
// absent / throw) both call sites in src/worktree-handback.js now use — see
// the module invariant at the top of that file.
//
// A real git failure on `rev-parse --verify -q MERGE_HEAD` is impractical to
// force on demand against real git (per the review's own guidance) — this
// stubs node:child_process's spawnSync to unit-test the helper's 128 -> throw
// arm directly, pure logic, no real disk I/O (fast tier).

import { describe, it, expect, vi, beforeEach } from 'vitest';

const spawnSyncMock = vi.fn();

// vi.mock is hoisted above imports by vitest, so this replaces node:child_process
// for the whole file before worktree-handback.js (imported below) gets its own
// binding via `import { spawnSync } from 'node:child_process'`.
vi.mock('node:child_process', () => ({
  spawnSync: (...args) => spawnSyncMock(...args),
}));

import { probeMergeHead } from '../src/worktree-handback.js';

describe('probeMergeHead — three-valued contract (present / absent / throw)', () => {
  beforeEach(() => {
    spawnSyncMock.mockReset();
  });

  it('throws_E_GIT_FAILED_on_a_git_level_error_exit_status_instead_of_reading_it_as_absent', () => {
    // Exit 128 is git's documented general-error status — distinct from the
    // 0 ("present") and 1 ("absent", per `--verify -q`'s own contract) exits
    // the helper's other two branches handle. Reading a 128 as "absent" (the
    // pre-fix `status === 0` boolean read did exactly this, since 128 !== 0
    // was silently the same "not present" bucket as a genuine 1) is the
    // defect this round closes.
    spawnSyncMock.mockReturnValue({ status: 128, stdout: '', stderr: 'fatal: not a git repository' });

    let thrown = null;
    try {
      probeMergeHead('/fake/repo', 'unit-test');
    } catch (e) {
      thrown = e;
    }

    expect(thrown).not.toBeNull();
    expect(thrown.code).toBe('E_GIT_FAILED');
  });
});
