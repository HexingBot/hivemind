// tests/assimilate-reviewer-verdict.spec.js
// TASK-144 AC3 -- validateReviewerVerdict: a pure, synchronous shape-check
// (no disk/network I/O) over src/assimilate.js's opts.reviewerVerdict, so it
// stays in the fast tier. Regression lock for the code seam that makes a
// present-but-off-shape verdict a HARD, SURFACED error rather than something
// that can silently ride the loose `verdict === 'safe'` check through to a
// write.
//
// Deliberately scoped to match the ALREADY-LOCKED TASK-140 default-deny
// contract (tests/e2e/assimilate.spec.js's DEFAULT_DENY_MATRIX,
// tests/e2e/pack-ctl.spec.js's no-verdict-at-all case): an entirely absent
// verdict, or a well-typed-but-unrecognized verdict STRING ('unsafe', 'Safe',
// ''), is NOT a shape violation -- those are legitimate values the existing
// default-deny gate already denies without throwing, and this spec locks
// that those cases still do not throw.

import { describe, it, expect } from 'vitest';

import { validateReviewerVerdict } from '../src/assimilate.js';

describe('validateReviewerVerdict -- accepts well-formed or absent verdicts', () => {
  it('does not throw for an absent verdict (null/undefined) -- the legitimate "not yet reviewed" state', () => {
    expect(() => validateReviewerVerdict(null)).not.toThrow();
    expect(() => validateReviewerVerdict(undefined)).not.toThrow();
  });

  it('does not throw for a well-formed { verdict, reasoning } object, whatever the verdict string', () => {
    expect(() => validateReviewerVerdict({ verdict: 'safe', reasoning: 'no risky patterns' })).not.toThrow();
    expect(() => validateReviewerVerdict({ verdict: 'suspicious', reasoning: 'prompt-injection risk' })).not.toThrow();
    // TASK-140-locked deny values: well-typed strings, wrong/unrecognized
    // content -- shape is fine, so this validator must NOT throw; the
    // existing default-deny gate is what denies these, not this seam.
    expect(() => validateReviewerVerdict({ verdict: 'unsafe', reasoning: 'flagged' })).not.toThrow();
    expect(() => validateReviewerVerdict({ verdict: 'Safe', reasoning: 'flagged' })).not.toThrow();
    expect(() => validateReviewerVerdict({ verdict: '', reasoning: 'flagged' })).not.toThrow();
  });
});

describe('validateReviewerVerdict -- hard, surfaced error on an off-shape verdict', () => {
  it('throws when reviewerVerdict is not an object (string, array, number, boolean)', () => {
    expect(() => validateReviewerVerdict('safe')).toThrow(/must be an object/);
    expect(() => validateReviewerVerdict(['safe', 'reasoning'])).toThrow(/must be an object/);
    expect(() => validateReviewerVerdict(42)).toThrow(/must be an object/);
    expect(() => validateReviewerVerdict(true)).toThrow(/must be an object/);
  });

  it('throws when the reasoning key is missing (off-shape key set)', () => {
    expect(() => validateReviewerVerdict({ verdict: 'safe' })).toThrow(/off-shape key set/);
  });

  it('throws when the verdict key is missing (off-shape key set)', () => {
    expect(() => validateReviewerVerdict({ reasoning: 'no risky patterns' })).toThrow(/off-shape key set/);
  });

  it('throws when an extra, unexpected key is present alongside a well-formed verdict', () => {
    // The dangerous case this seam exists for: an object that WOULD pass the
    // loose `verdict === 'safe'` check but carries extra, unvetted fields.
    expect(() => validateReviewerVerdict({ verdict: 'safe', reasoning: 'ok', extra: true })).toThrow(/off-shape key set/);
  });

  it('throws when reasoning is not a string', () => {
    expect(() => validateReviewerVerdict({ verdict: 'safe', reasoning: 123 })).toThrow(/reasoning must be a string/);
  });

  it('throws when verdict is not a string', () => {
    expect(() => validateReviewerVerdict({ verdict: true, reasoning: 'ok' })).toThrow(/verdict must be a string/);
  });
});
