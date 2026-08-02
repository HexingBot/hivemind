// tests/test-since.spec.js
// TASK-081 HIGH-1 — regression lock for scripts/test-since.mjs's ref-resolution
// logic. Exercises resolveSafeRef with an injected `exec` so the two silent
// false-positive modes found by the reviewer are pinned deterministically,
// without spawning a real git process or the (slow) inner vitest run:
//
//   1. An all-digit ref (e.g. "7627532") must never be forwarded to vitest
//      as-is — cac (vitest's CLI parser) coerces an all-digit positional to
//      a JS number, and vitest's git module silently drops non-string
//      `changedSince`. The wrapper must forward a value that is guaranteed
//      to contain a non-digit character.
//   2. An unresolvable ref must fail loudly (ok: false + message), never
//      silently succeed with an empty selection.

import { describe, it, expect } from 'vitest';

import { resolveSafeRef, hasAnyChangedFiles } from '../scripts/test-since.mjs';

/** Fake `spawnSync`-shaped exec for a successful `git rev-parse --verify`. */
function fakeExecOk(sha) {
  return () => ({ status: 0, stdout: `${sha}\n`, stderr: '' });
}

/** Fake `spawnSync`-shaped exec for a failed `git rev-parse --verify`. */
function fakeExecFail(stderr = 'fatal: Needed a single revision\n') {
  return () => ({ status: 128, stdout: '', stderr });
}

describe('TASK-081 HIGH-1 — resolveSafeRef never forwards a coercible-to-number ref', () => {
  it('all_digit_ref_resolves_to_a_safe_ref_that_is_never_purely_numeric', () => {
    const sha = '76275325dbc3e6f8ca29b9fea709a119c42106b4';
    const result = resolveSafeRef('7627532', fakeExecOk(sha));

    expect(result.ok).toBe(true);
    expect(result.safeRef).toBe(`${sha}~0`);
    // The exact defect: a value cac's numeric coercion would touch.
    expect(
      /^\d+$/.test(result.safeRef),
      `safeRef must not be all-digit (cac would coerce it to a number and vitest would silently drop it): "${result.safeRef}"`,
    ).toBe(false);
  });

  it('non_digit_ref_also_resolves_to_a_safe_non_numeric_ref', () => {
    const sha = '86a8c8082e912035e1574f45ad1514fc738868e7';
    const result = resolveSafeRef('86a8c80', fakeExecOk(sha));

    expect(result.ok).toBe(true);
    expect(result.safeRef).toBe(`${sha}~0`);
  });
});

describe('TASK-081 HIGH-1 — resolveSafeRef fails loudly instead of silently selecting zero specs', () => {
  it('unresolvable_ref_returns_ok_false_with_an_explanatory_message', () => {
    const result = resolveSafeRef('zzzzzzz', fakeExecFail());

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/did not resolve to a commit/);
    expect(result.message).toMatch(/silently selects zero specs/);
  });

  it('missing_ref_returns_ok_false_with_a_usage_message', () => {
    const result = resolveSafeRef(undefined, fakeExecFail());

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/usage:/);
  });
});

// TASK-192 AC4 — hasAnyChangedFiles mirrors vitest's own --changed detection
// (committed diff since ref, staged, unstaged) independently of vitest's own
// exit code, so the wrapper can tell "genuinely empty diff" apart from "diff
// non-empty but the import graph matched nothing" without trusting vitest's
// exit code (which is 0 either way — passWithNoTests defaults true).
describe('TASK-192 AC4 — hasAnyChangedFiles mirrors vitest\'s three-source change detection', () => {
  /** A fake exec returning empty stdout for every git invocation (status 0). */
  function fakeExecAllEmpty() {
    return () => ({ status: 0, stdout: '', stderr: '' });
  }

  it('all_three_sources_empty_returns_false', () => {
    expect(hasAnyChangedFiles('deadbeef~0', fakeExecAllEmpty())).toBe(false);
  });

  it('a_committed_diff_file_makes_it_true', () => {
    const exec = (git, args) => (args[0] === 'diff' && !args.includes('--cached')
      ? { status: 0, stdout: 'data.json\n', stderr: '' }
      : { status: 0, stdout: '', stderr: '' });
    expect(hasAnyChangedFiles('deadbeef~0', exec)).toBe(true);
  });

  it('a_staged_file_alone_makes_it_true', () => {
    const exec = (git, args) => (args.includes('--cached')
      ? { status: 0, stdout: 'staged.js\n', stderr: '' }
      : { status: 0, stdout: '', stderr: '' });
    expect(hasAnyChangedFiles('deadbeef~0', exec)).toBe(true);
  });

  it('an_unstaged_untracked_file_alone_makes_it_true', () => {
    const exec = (git, args) => (args[0] === 'ls-files'
      ? { status: 0, stdout: 'new-file.js\n', stderr: '' }
      : { status: 0, stdout: '', stderr: '' });
    expect(hasAnyChangedFiles('deadbeef~0', exec)).toBe(true);
  });

  it('a_git_failure_is_treated_conservatively_as_possibly_changed', () => {
    // A git error must never be read as "nothing changed" (fail-safe bias),
    // even though every stdout is empty.
    const exec = () => ({ status: 128, stdout: '', stderr: 'fatal: some git error' });
    expect(hasAnyChangedFiles('deadbeef~0', exec)).toBe(true);
  });
});
