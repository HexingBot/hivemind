// tests/e2e/worktree-handback-lstat-failopen.spec.js
// TASK-198 deferral item 1 (MEDIUM-2) — removeMergedWorktree's node_modules
// guard used to swallow EVERY lstat error, not just ENOENT:
//
//   try {
//     nodeModulesLstat = lstatSync(worktreeNodeModules);
//   } catch {                       // <-- fails OPEN on a data-loss path
//     nodeModulesLstat = null;
//   }
//
// A transient EPERM/EBUSY (AV scan, ACL contention) on a STILL-PRESENT
// junction used to be read as "nothing to sever" — the sever step would be
// silently skipped and `git worktree remove` would proceed to recurse
// through the junction into the primary's real node_modules, exactly the
// HIGH-severity hazard TASK-198's fix round closed. This spec drives that
// non-ENOENT path directly (real EPERM/EBUSY is impractical to force
// on-demand) and asserts the fixed behaviour: refuse with a typed error
// BEFORE `git worktree remove` ever runs, leaving both the worktree and the
// primary's real node_modules untouched. A second test asserts the ENOENT
// path is unaffected — a legitimately-missing node_modules must still be
// read as "absent", not newly fail closed.
//
// Follows the established `vi.mock('node:fs', async (importOriginal) => ...)`
// spy pattern (10+ existing uses, e.g. tests/e2e/atomic-write.spec.js,
// tests/pack-reconcile.spec.js) rather than a DI refactor — only lstatSync is
// wrapped; every other fs call (including the ones this file's own git/tmp
// helpers use) passes straight through to the real implementation.

import { describe, it, expect, vi, afterAll, afterEach } from 'vitest';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';

vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    lstatSync: vi.fn(real.lstatSync),
  };
});

import {
  writeFileSync, mkdirSync, symlinkSync, existsSync, readdirSync, realpathSync, lstatSync,
} from 'node:fs';

import { removeMergedWorktree } from '../../src/worktree-handback.js';

afterAll(() => cleanupAll());
afterEach(() => {
  // Clears call history only — a per-test mockImplementation override (if
  // any) is deliberately left in place: every test below targets a distinct
  // tmp-dir path, so a leftover conditional override from an earlier test is
  // a no-op for any later test's (different) path.
  lstatSync.mockClear();
});

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed (exit ${r.status}): ${r.stderr}`);
  }
  return r.stdout;
}

function initRepo(dir) {
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 'dev@example.com']);
  git(dir, ['config', 'user.name', 'Test Dev']);
}

/** Same normalization git-worktree-handback.spec.js uses: realpath + forward
 * slashes, since `git worktree list` reports forward-slash paths even on
 * Windows and os.tmpdir() can hand back an 8.3 short form. */
function toPosix(p) {
  return realpathSync.native(p).replace(/\\/g, '/');
}

describe('MEDIUM-2 (TASK-198 deferral item 1) — removeMergedWorktree must not fail OPEN on a non-ENOENT lstat error', () => {
  it('refuses_with_a_typed_error_instead_of_treating_a_transient_lstat_failure_on_a_still_present_junction_as_absent', () => {
    const dir = makeTmpDir('wt-lstat-failopen');
    initRepo(dir);
    writeFileSync(join(dir, '.gitignore'), 'node_modules/\n');
    git(dir, ['add', '.gitignore']);
    git(dir, ['commit', '-q', '-m', 'baseline']);

    // The primary checkout's own REAL node_modules, populated with content
    // that must survive this refusal untouched.
    const primaryNodeModules = join(dir, 'node_modules');
    mkdirSync(join(primaryNodeModules, 'real-package'), { recursive: true });
    writeFileSync(join(primaryNodeModules, 'real-package', 'index.js'), 'module.exports = "primary";\n');

    const wt = join(makeTmpDir('wt-lstat-failopen-wt'), 'wt');
    git(dir, ['worktree', 'add', '-b', 'agent-lstat-failopen', wt]);
    const wtPosix = toPosix(wt);

    // Provision the worktree's node_modules as a junction/symlink to the
    // primary's — the exact shape src/worktree-provision.js produces, and
    // the shape that must be severed before disposal.
    const worktreeNodeModules = join(wt, 'node_modules');
    symlinkSync(primaryNodeModules, worktreeNodeModules, process.platform === 'win32' ? 'junction' : 'dir');

    // Capture the real implementation BEFORE overriding, so the override
    // below can delegate every non-matching path to genuine lstat behaviour
    // — only the exact junction path under test is intercepted.
    const realLstat = lstatSync.getMockImplementation();
    lstatSync.mockImplementation((p, ...rest) => {
      if (String(p) === worktreeNodeModules) {
        const e = new Error(`EPERM: operation not permitted, lstat '${p}'`);
        e.code = 'EPERM';
        throw e;
      }
      return realLstat(p, ...rest);
    });

    let thrown = null;
    try {
      removeMergedWorktree({
        repoRoot: dir, worktreePath: wt, branch: 'agent-lstat-failopen', targetBranch: 'HEAD',
      });
    } catch (e) {
      thrown = e;
    }

    expect(thrown).not.toBeNull();
    expect(thrown.code).toBe('E_NODE_MODULES_LSTAT_FAILED');

    // Refused BEFORE `git worktree remove` ever ran — the worktree is still
    // present, not disposed of.
    const listAfter = git(dir, ['worktree', 'list']);
    expect(listAfter).toContain(wtPosix);

    // The primary's real node_modules — reachable through the still-intact
    // junction — is untouched: this is the load-bearing assertion proving
    // the fix actually prevents the recurrence, not just that it throws.
    expect(existsSync(primaryNodeModules)).toBe(true);
    expect(readdirSync(primaryNodeModules)).toContain('real-package');
    expect(existsSync(join(primaryNodeModules, 'real-package', 'index.js'))).toBe(true);
  });
});

describe('ENOENT still yields "absent" (TASK-198 deferral item 1) — a legitimately missing node_modules is not newly fail-closed', () => {
  it('disposes_of_a_worktree_normally_when_node_modules_does_not_exist_at_all', () => {
    const dir = makeTmpDir('wt-lstat-enoent');
    initRepo(dir);
    writeFileSync(join(dir, 'baseline.txt'), 'baseline\n');
    git(dir, ['add', 'baseline.txt']);
    git(dir, ['commit', '-q', '-m', 'baseline']);

    const wt = join(makeTmpDir('wt-lstat-enoent-wt'), 'wt');
    git(dir, ['worktree', 'add', '-b', 'agent-lstat-enoent', wt]);
    const wtPosix = toPosix(wt);

    // No node_modules created at all — lstatSync throws a real ENOENT, no
    // mock override needed; this exercises the fix's ENOENT branch via the
    // genuine fs call.
    expect(() => removeMergedWorktree({
      repoRoot: dir, worktreePath: wt, branch: 'agent-lstat-enoent', targetBranch: 'HEAD',
    })).not.toThrow();

    const listAfter = git(dir, ['worktree', 'list']);
    expect(listAfter).not.toContain(wtPosix);
  });
});
