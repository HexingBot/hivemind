import { describe, it, expect } from 'vitest';
import {
  validateMarkers,
  validateMarkerForwarding,
  validateTiers,
  extractTier,
  partition,
  renderViolations,
} from '../src/calibration.js';

describe('validateMarkers', () => {
  it('flags uncalibrated [INFERRED]', () => {
    const v = validateMarkers('f.md', 'The API caches responses [INFERRED].');
    expect(v).toHaveLength(1);
    expect(v[0].severity).toBe('FLAG');
    expect(v[0].rule).toMatch(/uncalibrated/);
  });

  it('does NOT flag calibrated [INFERRED:strong] / [INFERRED:weak]', () => {
    expect(validateMarkers('f.md', 'x [INFERRED:strong]\ny [INFERRED:weak]')).toEqual([]);
  });

  it('flags an unmarked "confirmed/decided" list claim', () => {
    const v = validateMarkers('f.md', '- The retry limit was confirmed to be 3.');
    expect(v).toHaveLength(1);
    expect(v[0].rule).toMatch(/no marker/);
  });

  it('does not flag a "confirmed" claim that carries a marker', () => {
    expect(validateMarkers('f.md', '- The retry limit was confirmed to be 3. [EXPLICIT]')).toEqual([]);
  });
});

describe('validateMarkerForwarding (assumption laundering — BLOCKER)', () => {
  const source = 'The rate limit is probably 60 rpm [ASSUMED]\nUsers may prefer dark mode [INFERRED:weak]';

  it('BLOCKS a weak source claim that lost its marker downstream', () => {
    const derived = '- The rate limit is probably 60 rpm and we depend on it.';
    const v = validateMarkerForwarding(source, derived, 'context/TECH.md', 'tasks/TASK-1.json');
    expect(v).toHaveLength(1);
    expect(v[0].severity).toBe('BLOCKER');
    expect(v[0].rule).toMatch(/marker dropped/);
    expect(v[0].file).toBe('tasks/TASK-1.json');
  });

  it('passes when the marker is preserved downstream', () => {
    const derived = '- The rate limit is probably 60 rpm [ASSUMED] — do not hard-code.';
    expect(validateMarkerForwarding(source, derived, 's', 'd')).toEqual([]);
  });

  it('passes when the downstream does not restate the weak claim at all', () => {
    expect(validateMarkerForwarding(source, 'totally unrelated text', 's', 'd')).toEqual([]);
  });
});

describe('extractTier + validateTiers (ceiling)', () => {
  it('extracts the tier from frontmatter', () => {
    expect(extractTier('---\nsource_tier: T3\n---')).toBe('T3');
    expect(extractTier('no tier here')).toBeNull();
  });

  it('FLAGS a missing source_tier', () => {
    const v = validateTiers('f.md', 'no frontmatter');
    expect(v).toHaveLength(1);
    expect(v[0].severity).toBe('FLAG');
  });

  it('BLOCKS [EXPLICIT] in a T3 file', () => {
    const v = validateTiers('f.md', 'source_tier: T3\n\nThe value is 5 [EXPLICIT]');
    expect(v.some((x) => x.severity === 'BLOCKER' && /T3 but uses \[EXPLICIT\]/.test(x.rule))).toBe(true);
  });

  it('BLOCKS any [INFERRED] in a T4 file', () => {
    const v = validateTiers('f.md', 'source_tier: T4\n\nLikely true [INFERRED:strong]');
    expect(v.some((x) => x.severity === 'BLOCKER' && /T4/.test(x.rule))).toBe(true);
  });

  it('allows [EXPLICIT] in a T1/T2 file', () => {
    expect(validateTiers('f.md', 'source_tier: T1\n\nReturns 200 [EXPLICIT]')).toEqual([]);
    expect(validateTiers('f.md', 'source_tier: T2\n\nReturns 200 [EXPLICIT]')).toEqual([]);
  });

  it('rejects a whole TX file as a single BLOCKER', () => {
    const v = validateTiers('f.md', 'source_tier: TX\n\nanything [EXPLICIT]');
    expect(v).toHaveLength(1);
    expect(v[0].severity).toBe('BLOCKER');
    expect(v[0].rule).toMatch(/rejected/);
  });
});

describe('helpers', () => {
  it('partition splits blockers and flags', () => {
    const v = [...validateTiers('f.md', 'source_tier: T3\n\nx [EXPLICIT]'), ...validateMarkers('f.md', 'y [INFERRED]')];
    const { blockers, flags } = partition(v);
    expect(blockers).toHaveLength(1);
    expect(flags).toHaveLength(1);
  });

  it('renderViolations is friendly when empty', () => {
    expect(renderViolations([])).toMatch(/No calibration violations/);
  });
});
