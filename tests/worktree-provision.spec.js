// tests/worktree-provision.spec.js
// TASK-198 defect 2 — pure decision-matrix coverage for
// src/worktree-provision.js's decideNodeModulesAction. No disk I/O here
// (fast tier); the real fs side effects (symlinkSync/junction creation,
// removal, refusal-to-clobber) are exercised against real git worktrees in
// tests/e2e/worktree-node-modules-provisioning.spec.js.

import { describe, it, expect } from 'vitest';
import { decideNodeModulesAction } from '../src/worktree-provision.js';

describe('decideNodeModulesAction — the full state matrix', () => {
  it('nothing at the path yet -> create-link', () => {
    expect(decideNodeModulesAction({
      exists: false, isSymlinkOrJunction: false, linksToPrimary: false, isEmptyDir: false,
    })).toBe('create-link');
  });

  it('already a junction/symlink pointing at the primary -> already-linked (idempotent no-op)', () => {
    expect(decideNodeModulesAction({
      exists: true, isSymlinkOrJunction: true, linksToPrimary: true, isEmptyDir: false,
    })).toBe('already-linked');
  });

  it('a junction/symlink pointing somewhere else -> relink', () => {
    expect(decideNodeModulesAction({
      exists: true, isSymlinkOrJunction: true, linksToPrimary: false, isEmptyDir: false,
    })).toBe('relink');
  });

  it('a real, EMPTY directory (the TASK-198 defect shape itself) -> replace-empty-dir', () => {
    expect(decideNodeModulesAction({
      exists: true, isSymlinkOrJunction: false, linksToPrimary: false, isEmptyDir: true,
    })).toBe('replace-empty-dir');
  });

  it('a real, NON-empty directory -> refuse-nonempty-dir (never silently discard real content)', () => {
    expect(decideNodeModulesAction({
      exists: true, isSymlinkOrJunction: false, linksToPrimary: false, isEmptyDir: false,
    })).toBe('refuse-nonempty-dir');
  });
});
