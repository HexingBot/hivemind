// tests/vitest-changed-algorithm-pin.spec.js
// TASK-194 folded scope (MEDIUM-2 from TASK-192's review): `hasAnyChangedFiles`
// and `hasAnyUncommittedChanges` (scripts/test-since.mjs) reimplement vitest's
// own `VitestGit` change-detection by issuing the identical git commands
// vitest 2.1.9 issues (node_modules/vitest/dist/chunks/git.<hash>.js —
// content-hash-named, so this spec globs it rather than hardcoding the
// filename, which would silently stop matching on the next vitest bump).
// That mirror was verified verbatim at write time but was not pinned for
// future vitest upgrades — nothing previously asserted the three git-argument
// sequences it depends on still match what vitest actually runs.
//
// Blast radius if this drifts: bounded. A wrong mirror can only mislabel
// WHY a zero-selection happened (reason=empty-diff vs reason=no-spec-matched
// for test:since; a spuriously-present/absent TEST_CHANGED_ZERO_SELECTION
// marker for test:changed) — it can never change the real vitest exit code,
// since the real `vitest run --changed` always executes afterward regardless
// of what this mirror concludes. But the label IS the entire deliverable of
// this seam, so a silently-wrong reason defeats its purpose. This spec fails
// loudly, naming the missing sequence, the moment vitest changes its
// algorithm — instead of the mirror silently drifting and quietly mislabeling
// results on every future vitest upgrade.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

// TASK-198 defect 2 fix: the previous version hardcoded a REPO_ROOT-relative
// fs path (`<repoRoot>/node_modules/vitest/dist/chunks`), which breaks
// inside an isolated worktree — a worktree's own `node_modules` is an EMPTY
// directory (see src/worktree-provision.js), so that literal path resolves
// to nothing there even though real module resolution (this file's approach
// now) would still find vitest via Node's own ancestor walk up into the
// primary checkout. Locating vitest via `require.resolve` instead means this
// spec is correct regardless of whether the worktree's node_modules has been
// junction-provisioned yet — it asks Node the same question Node itself asks
// when `import 'vitest'` runs anywhere in this codebase.
function findVitestPackageRoot() {
  const require = createRequire(import.meta.url);
  return dirname(require.resolve('vitest/package.json'));
}

/** node:fs has no stable, engine-compatible glob (>=20) — a directory listing
 * plus a prefix/suffix filter is the "native feature" rung of the minimalism
 * ladder for a single-directory, single-pattern match like this one. */
function findVitestGitChunk() {
  const chunksDir = join(findVitestPackageRoot(), 'dist', 'chunks');
  const matches = readdirSync(chunksDir).filter((name) => name.startsWith('git.') && name.endsWith('.js'));
  expect(
    matches.length,
    'expected exactly one node_modules/vitest/dist/chunks/git.*.js chunk — '
      + `found: ${JSON.stringify(matches)}. If vitest no longer ships a git.*.js `
      + 'chunk at all, its --changed algorithm moved and this pin needs updating.',
  ).toBe(1);
  return readFileSync(join(chunksDir, matches[0]), 'utf8');
}

describe('TASK-194 folded scope — the git.*.js VitestGit chunk still issues the three mirrored commands', () => {
  it('committed_since_ref_diff_sequence_is_present', () => {
    const text = findVitestGitChunk();
    expect(
      /"diff"\s*,\s*"--name-only"\s*,\s*`\$\{[^}]+\}\.\.\.HEAD`/.test(text),
      'expected a ["diff", "--name-only", `${<ref>}...HEAD`] call (getFilesSince) '
        + 'in the vitest git chunk — hasAnyChangedFiles mirrors this exactly',
    ).toBe(true);
  });

  it('staged_diff_sequence_is_present', () => {
    const text = findVitestGitChunk();
    expect(
      /\["diff"\s*,\s*"--cached"\s*,\s*"--name-only"\]/.test(text),
      'expected a ["diff", "--cached", "--name-only"] call (getStagedFiles) '
        + 'in the vitest git chunk — both hasAnyChangedFiles and '
        + 'hasAnyUncommittedChanges mirror this exactly',
    ).toBe(true);
  });

  it('unstaged_ls_files_sequence_is_present', () => {
    const text = findVitestGitChunk();
    expect(
      /"ls-files"\s*,\s*"--other"\s*,\s*"--modified"\s*,\s*"--exclude-standard"/.test(text),
      'expected a ["ls-files", "--other", "--modified", "--exclude-standard"] call '
        + '(getUnstagedFiles) in the vitest git chunk — both hasAnyChangedFiles and '
        + 'hasAnyUncommittedChanges mirror this exactly',
    ).toBe(true);
  });

  it('refless_changed_still_skips_the_committed_since_source_only', () => {
    // Pins the OTHER half of the design: findChangedFiles branches on
    // `typeof changedSince === 'string'` and only calls getStagedFiles +
    // getUnstagedFiles when it's not a string — this is what makes
    // hasAnyUncommittedChanges a correct mirror of the refless case (not an
    // approximation of it).
    const text = findVitestGitChunk();
    expect(
      text.includes('typeof changedSince'),
      'expected findChangedFiles to still branch on typeof changedSince — '
        + 'hasAnyUncommittedChanges relies on this branch existing to justify '
        + 'skipping the committed-since-ref source',
    ).toBe(true);
  });
});
