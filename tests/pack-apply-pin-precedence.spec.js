// tests/pack-apply-pin-precedence.spec.js
// TASK-182 — pure-logic specs for src/pack-apply.js#comparePinPrecedence, the
// dual-copy precedence decision (human direction (a), recorded on TASK-182):
// "the reconciler retires the project-scope resource when the plugin ships
// the same resource id at an equal-or-newer pin; the project-scope copy
// survives only when it is ahead."
//
// The wrinkle the direction does not settle (also recorded on the ticket):
// pins are commit-shas OR exact semver (state/integrations-lock.schema.json's
// own `pin` description) — a git-sha pin has no natural order. This
// comparison is decidable ONLY when both pins parse as semver
// (major.minor.patch); anything else (a git sha on either side, or a
// mismatched shape) is 'undecidable' by construction, never guessed at. Per
// the repo's Empty-result contract, "cannot determine which is newer" must
// stay distinguishable from "they are the same" and must never silently
// resolve to retiring the project's copy — callers (src/pack-apply.js's
// executeInstall/applyPlan) treat 'undecidable' as the safe keep-both-and-
// surface outcome.
//
// Fast tier: no disk I/O, no process spawn — comparePinPrecedence is pure.
// The end-to-end behavioral proof (which copy actually gets materialized,
// what the lock/report end up saying) lives in tests/e2e/pack-apply.spec.js's
// "TASK-182 — dual-copy precedence" describe block.

import { describe, it, expect } from 'vitest';

import { comparePinPrecedence } from '../src/pack-apply.js';

describe('comparePinPrecedence — equal pins', () => {
  it('identical semver pins are equal', () => {
    expect(comparePinPrecedence('1.2.3', '1.2.3')).toBe('equal');
  });

  it('identical git-sha pins are equal (string equality never needs semver parsing)', () => {
    const sha = '83da59fa78c3eee9e20f515fe75c438bb5166efd';
    expect(comparePinPrecedence(sha, sha)).toBe('equal');
  });
});

describe('comparePinPrecedence — decidable divergence (both pins parse as semver)', () => {
  it('a strictly newer shipped (plugin) pin is "shipped-newer"', () => {
    expect(comparePinPrecedence('1.0.0', '2.0.0')).toBe('shipped-newer');
    expect(comparePinPrecedence('1.2.3', '1.3.0')).toBe('shipped-newer');
    expect(comparePinPrecedence('1.2.3', '1.2.4')).toBe('shipped-newer');
  });

  it('a strictly newer installed (project) pin is "installed-newer"', () => {
    expect(comparePinPrecedence('2.0.0', '1.0.0')).toBe('installed-newer');
    expect(comparePinPrecedence('1.3.0', '1.2.9')).toBe('installed-newer');
  });

  it('a pre-release/build suffix does not change the ordering of the numeric triad', () => {
    // Same major.minor.patch, different suffix -- treated as equal (never
    // undecidable just because a suffix string differs).
    expect(comparePinPrecedence('1.2.3-beta.1', '1.2.3')).toBe('equal');
  });
});

describe('comparePinPrecedence — undecidable divergence (the residual that must never silently retire)', () => {
  it('two DIFFERENT git-sha pins cannot be ordered', () => {
    expect(comparePinPrecedence(
      '83da59fa78c3eee9e20f515fe75c438bb5166efd',
      'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
    )).toBe('undecidable');
  });

  it('a semver pin against a git-sha pin cannot be ordered (mixed shape)', () => {
    expect(comparePinPrecedence('1.0.0', '83da59fa78c3eee9e20f515fe75c438bb5166efd')).toBe('undecidable');
    expect(comparePinPrecedence('83da59fa78c3eee9e20f515fe75c438bb5166efd', '1.0.0')).toBe('undecidable');
  });

  it('opaque, non-semver, non-identical tokens (e.g. "v1"/"v2") cannot be ordered', () => {
    // Regression guard: "v1"/"v2" is the exact fixture the pre-existing
    // pack-apply.spec.js "replace op is surfaced ... deferred" test already
    // uses -- it must stay undecidable so that lock stays green unchanged.
    expect(comparePinPrecedence('v1', 'v2')).toBe('undecidable');
  });
});
