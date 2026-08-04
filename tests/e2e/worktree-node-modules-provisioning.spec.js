// tests/e2e/worktree-node-modules-provisioning.spec.js
// TASK-198 defect 2 — real fs + real git coverage for
// src/worktree-provision.js. The fast-tier decision matrix
// (tests/worktree-provision.spec.js) covers the pure branch logic; this
// spec proves the real symlinkSync/junction side effects against a real
// filesystem, and against a REAL `git worktree` (the analogous demonstration
// AC1 asks for, adapted: `git worktree add <path> HEAD` explicitly, since
// the harness's own default-base-ref behavior is outside this repo's
// control to invoke directly — see the TASK-198 hand-off).
//
// AC4 (defect 2's regression sensor): `already_linked_worktree_resolves_a_
// real_package_through_the_junction_not_the_empty_shadow` is the sensor. It
// fails if provisionWorktreeNodeModules stops correctly linking, OR if
// something reintroduces an empty-directory shadow that Node's `require`
// would resolve INTO (finding nothing) instead of past it.
//
// The build-byte-parity symptom (AC2's "npm run build:plugin produces bytes
// identical to a build in the primary checkout") is already covered by the
// EXISTING tests/e2e/dist-parity.spec.js — that spec is REPO_ROOT-relative
// (tests/helpers/repoRoot.js walks up from the spec file's own location), so
// running `npm run test:all` from inside a properly-provisioned worktree
// exercises it there too, comparing a fresh build inside the worktree
// against the worktree's own checked-out dist/ (identical git blob to the
// primary's, same commit) — no new spec needed for that half; see the
// TASK-198 hand-off for the from-inside-a-worktree run that proves it green.

import { describe, it, expect, afterAll } from 'vitest';
import {
  writeFileSync, mkdirSync, existsSync, readdirSync, lstatSync, realpathSync, rmSync, symlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';
import { provisionWorktreeNodeModules } from '../../src/worktree-provision.js';

afterAll(() => cleanupAll());

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed (exit ${r.status}): ${r.stderr}`);
  }
  return r.stdout;
}

function toPosix(p) {
  return realpathSync.native(p).replace(/\\/g, '/');
}

/** Build a synthetic "primary checkout" node_modules carrying a fake package
 * shaped like vitest's own dist/chunks layout, so the same two symptoms
 * TASK-198 named (a literal fs path lookup, and real module resolution) can
 * both be exercised without depending on the real vitest package. */
function seedPrimaryNodeModules(primaryRoot) {
  const pkgDir = join(primaryRoot, 'node_modules', 'fakepkg');
  const chunksDir = join(pkgDir, 'dist', 'chunks');
  mkdirSync(chunksDir, { recursive: true });
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: 'fakepkg', version: '1.0.0', main: 'index.js' }));
  writeFileSync(join(pkgDir, 'index.js'), 'module.exports = { marker: "primary" };\n');
  writeFileSync(join(chunksDir, 'git.deadbeef.js'), '// content-hashed chunk marker\n');
}

describe('provisionWorktreeNodeModules — real fs side effects', () => {
  it('nothing_present_creates_a_link_that_resolves_to_the_primary', () => {
    const primaryRoot = makeTmpDir('wt-prov-primary-a');
    const worktreePath = makeTmpDir('wt-prov-wt-a');
    seedPrimaryNodeModules(primaryRoot);

    const result = provisionWorktreeNodeModules({ worktreePath, primaryRoot });
    expect(result.action).toBe('create-link');

    const worktreeNodeModules = join(worktreePath, 'node_modules');
    expect(lstatSync(worktreeNodeModules).isSymbolicLink()).toBe(true);
    expect(toPosix(worktreeNodeModules)).toBe(toPosix(join(primaryRoot, 'node_modules')));
  });

  it('an_empty_node_modules_directory_the_task_198_defect_shape_is_replaced_with_a_link', () => {
    const primaryRoot = makeTmpDir('wt-prov-primary-b');
    const worktreePath = makeTmpDir('wt-prov-wt-b');
    seedPrimaryNodeModules(primaryRoot);

    // Reproduce the exact defect shape: an EMPTY node_modules directory
    // already sitting in the worktree (observed on TASK-195's first real
    // use; see TASK-198's description).
    mkdirSync(join(worktreePath, 'node_modules'));
    expect(readdirSync(join(worktreePath, 'node_modules'))).toEqual([]);

    const result = provisionWorktreeNodeModules({ worktreePath, primaryRoot });
    expect(result.action).toBe('replace-empty-dir');

    const worktreeNodeModules = join(worktreePath, 'node_modules');
    expect(lstatSync(worktreeNodeModules).isSymbolicLink()).toBe(true);
    expect(toPosix(worktreeNodeModules)).toBe(toPosix(join(primaryRoot, 'node_modules')));
  });

  it('running_it_twice_is_idempotent_already_linked_no_op', () => {
    const primaryRoot = makeTmpDir('wt-prov-primary-c');
    const worktreePath = makeTmpDir('wt-prov-wt-c');
    seedPrimaryNodeModules(primaryRoot);

    const first = provisionWorktreeNodeModules({ worktreePath, primaryRoot });
    const second = provisionWorktreeNodeModules({ worktreePath, primaryRoot });
    expect(first.action).toBe('create-link');
    expect(second.action).toBe('already-linked');
  });

  // TASK-198 fix round, MEDIUM-1 — real-fs proof that a vitest-cache-only
  // shadow directory (observed live: .claude/worktrees/.../node_modules
  // containing only .vite/ and .vite-temp/) is replaced, not refused.
  it('a_node_modules_directory_containing_only_known_vitest_cache_dirs_is_replaced_with_a_link', () => {
    const primaryRoot = makeTmpDir('wt-prov-primary-cache');
    const worktreePath = makeTmpDir('wt-prov-wt-cache');
    seedPrimaryNodeModules(primaryRoot);

    const worktreeNodeModules = join(worktreePath, 'node_modules');
    mkdirSync(join(worktreeNodeModules, '.vite'), { recursive: true });
    mkdirSync(join(worktreeNodeModules, '.vite-temp'), { recursive: true });
    writeFileSync(join(worktreeNodeModules, '.vite-temp', 'cache-entry.json'), '{}');

    const result = provisionWorktreeNodeModules({ worktreePath, primaryRoot });
    expect(result.action).toBe('replace-cache-only-dir');
    expect(lstatSync(worktreeNodeModules).isSymbolicLink()).toBe(true);
    expect(toPosix(worktreeNodeModules)).toBe(toPosix(join(primaryRoot, 'node_modules')));
  });

  it('a_node_modules_directory_with_cache_dirs_PLUS_unknown_content_still_refuses', () => {
    const primaryRoot = makeTmpDir('wt-prov-primary-cache-mixed');
    const worktreePath = makeTmpDir('wt-prov-wt-cache-mixed');
    seedPrimaryNodeModules(primaryRoot);

    const worktreeNodeModules = join(worktreePath, 'node_modules');
    mkdirSync(join(worktreeNodeModules, '.vite'), { recursive: true });
    mkdirSync(join(worktreeNodeModules, 'some-real-package'), { recursive: true });

    expect(() => provisionWorktreeNodeModules({ worktreePath, primaryRoot }))
      .toThrow(/refusing to touch/);
    expect(existsSync(join(worktreeNodeModules, 'some-real-package'))).toBe(true);
  });

  // TASK-198 fix round, LOW-2 — the `relink` action had no real-fs coverage.
  // That `rmSync(recursive: false)` removes the LINK without deleting
  // through it is the Windows-critical behaviour; asserting the foreign
  // target survives is the same class of check as the HIGH-severity
  // disposal-time guard in git-worktree-handback.spec.js.
  it('a_symlink_junction_pointing_at_the_WRONG_target_is_relinked_and_the_foreign_target_survives', () => {
    const primaryRoot = makeTmpDir('wt-prov-primary-relink');
    const worktreePath = makeTmpDir('wt-prov-wt-relink');
    const foreignRoot = makeTmpDir('wt-prov-foreign-relink');
    seedPrimaryNodeModules(primaryRoot);

    // A foreign target that looks like it too has real content — the
    // population this test protects: some OTHER directory a stale/incorrect
    // link points at, which must survive the relink untouched.
    const foreignNodeModules = join(foreignRoot, 'node_modules');
    mkdirSync(join(foreignNodeModules, 'foreign-package'), { recursive: true });
    writeFileSync(join(foreignNodeModules, 'foreign-package', 'marker.txt'), 'do not delete me\n');

    const worktreeNodeModules = join(worktreePath, 'node_modules');
    // worktreePath itself doesn't exist yet as a directory — symlinkSync
    // needs its parent to exist, which makeTmpDir already created.
    symlinkSync(
      foreignNodeModules,
      worktreeNodeModules,
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    const result = provisionWorktreeNodeModules({ worktreePath, primaryRoot });
    expect(result.action).toBe('relink');
    expect(lstatSync(worktreeNodeModules).isSymbolicLink()).toBe(true);
    expect(toPosix(worktreeNodeModules)).toBe(toPosix(join(primaryRoot, 'node_modules')));

    // The foreign target the stale link used to point at is untouched —
    // this is the exact class of check the HIGH finding's reproduction used.
    expect(existsSync(join(foreignNodeModules, 'foreign-package', 'marker.txt'))).toBe(true);
    expect(readdirSync(foreignNodeModules)).toContain('foreign-package');
  });

  // TASK-198 fix round, LOW-2 — a dangling link (primary since removed/moved)
  // must also relink cleanly rather than throwing EEXIST on symlinkSync.
  it('a_dangling_symlink_junction_left_over_from_a_removed_primary_is_relinked', () => {
    const primaryRoot = makeTmpDir('wt-prov-primary-dangling');
    const worktreePath = makeTmpDir('wt-prov-wt-dangling');
    const goneRoot = makeTmpDir('wt-prov-gone-dangling');
    seedPrimaryNodeModules(primaryRoot);

    const worktreeNodeModules = join(worktreePath, 'node_modules');
    const goneNodeModules = join(goneRoot, 'node_modules');
    mkdirSync(goneNodeModules, { recursive: true });
    symlinkSync(
      goneNodeModules,
      worktreeNodeModules,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    // Remove the target itself (not the link) — the link is now dangling.
    rmSync(goneNodeModules, { recursive: true, force: true });

    const result = provisionWorktreeNodeModules({ worktreePath, primaryRoot });
    expect(result.action).toBe('relink');
    expect(lstatSync(worktreeNodeModules).isSymbolicLink()).toBe(true);
    expect(toPosix(worktreeNodeModules)).toBe(toPosix(join(primaryRoot, 'node_modules')));
  });

  it('a_real_non_empty_node_modules_directory_is_never_touched', () => {
    const primaryRoot = makeTmpDir('wt-prov-primary-d');
    const worktreePath = makeTmpDir('wt-prov-wt-d');
    seedPrimaryNodeModules(primaryRoot);

    const realNodeModules = join(worktreePath, 'node_modules');
    mkdirSync(realNodeModules);
    writeFileSync(join(realNodeModules, 'sentinel.txt'), 'do not delete me\n');

    expect(() => provisionWorktreeNodeModules({ worktreePath, primaryRoot }))
      .toThrow(/refusing to touch/);
    // The sentinel file must still be there — never silently discarded.
    expect(existsSync(join(realNodeModules, 'sentinel.txt'))).toBe(true);
  });

  // ---------------------------------------------------------------------
  // AC4 — the defect-2 regression sensor: after provisioning, BOTH failure
  // symptoms named in TASK-198 must be closed — a literal fs path lookup
  // AND real module resolution must both find the SAME package the primary
  // checkout has, not an empty shadow.
  // ---------------------------------------------------------------------
  it('already_linked_worktree_resolves_a_real_package_through_the_junction_not_the_empty_shadow', () => {
    const primaryRoot = makeTmpDir('wt-prov-primary-e');
    const worktreePath = makeTmpDir('wt-prov-wt-e');
    seedPrimaryNodeModules(primaryRoot);
    mkdirSync(join(worktreePath, 'node_modules')); // the defect shape

    provisionWorktreeNodeModules({ worktreePath, primaryRoot });

    // Symptom 1 — literal fs path lookup (what the OLD pin sensor did):
    // must find the chunk file through the worktree's own node_modules path.
    const chunksViaWorktree = readdirSync(join(worktreePath, 'node_modules', 'fakepkg', 'dist', 'chunks'));
    expect(chunksViaWorktree).toContain('git.deadbeef.js');

    // Symptom 2 — real module resolution from a file INSIDE the worktree
    // must resolve to the SAME package.json the primary checkout has.
    const req = createRequire(pathToFileURL(join(worktreePath, 'probe.js')).href);
    const resolvedPkgJson = req.resolve('fakepkg/package.json');
    expect(toPosix(resolvedPkgJson)).toBe(toPosix(join(primaryRoot, 'node_modules', 'fakepkg', 'package.json')));
  });
});

describe('AC1 demonstration — a worktree explicitly created off HEAD has merge-base == HEAD', () => {
  // This demonstrates the git mechanics `worktree.baseRef: "head"` invokes
  // (`git worktree add <path> HEAD`), NOT the harness's own config-driven
  // behavior (that boundary is outside this repo's testable surface — see
  // the TASK-198 hand-off). tests/worktree-baseref-setting.spec.js is the
  // sensor for whether the SETTING itself regresses.
  it('a_worktree_added_explicitly_off_HEAD_has_a_merge_base_equal_to_HEAD', () => {
    const repoDir = makeTmpDir('wt-baseref-demo-repo');
    git(repoDir, ['init', '-q']);
    git(repoDir, ['config', 'user.email', 'dev@example.com']);
    git(repoDir, ['config', 'user.name', 'Test Dev']);
    writeFileSync(join(repoDir, 'file.txt'), 'baseline\n');
    git(repoDir, ['add', 'file.txt']);
    git(repoDir, ['commit', '-q', '-m', 'baseline']);
    const headSha = git(repoDir, ['rev-parse', 'HEAD']).trim();

    const worktreeParent = makeTmpDir('wt-baseref-demo-wt-parent');
    const worktreePath = join(worktreeParent, 'wt');
    git(repoDir, ['worktree', 'add', '-b', 'agent-demo', worktreePath, 'HEAD']);

    const mergeBase = git(repoDir, ['merge-base', 'agent-demo', 'HEAD']).trim();
    expect(mergeBase).toBe(headSha);

    // Cleanup: remove the worktree registration before the tmp dir is swept
    // (git keeps a reference to it otherwise).
    try { git(repoDir, ['worktree', 'remove', '--force', worktreePath]); } catch { /* best-effort */ }
  });
});
