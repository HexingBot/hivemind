import { describe, it, expect } from 'vitest';
import { collectFileViolations, collectForwarding } from '../bin/check-calibration.js';
import { partition } from '../src/calibration.js';

describe('collectFileViolations', () => {
  it('aggregates marker + tier violations across files', () => {
    const files = {
      'a.md': 'source_tier: T3\n\nThe value is 5 [EXPLICIT]',   // tier-ceiling BLOCKER
      'b.md': 'something [INFERRED]',                            // uncalibrated FLAG
    };
    const v = collectFileViolations(Object.keys(files), (f) => files[f]);
    const { blockers, flags } = partition(v);
    expect(blockers).toHaveLength(1);
    expect(blockers[0].file).toBe('a.md');
    expect(flags.some((x) => x.file === 'b.md')).toBe(true);
  });

  it('returns no violations for clean, well-calibrated files', () => {
    const files = { 'ok.md': 'source_tier: T1\n\nReturns 200 [EXPLICIT]\nMaybe slow [INFERRED:weak]' };
    expect(collectFileViolations(Object.keys(files), (f) => files[f])).toEqual([]);
  });
});

describe('collectForwarding (assumption laundering)', () => {
  const read = (f) => ({
    'src.md': 'The limit is probably 60 rpm [ASSUMED]',
    'derived.md': '- The limit is probably 60 rpm and we rely on it.',
    'derived-ok.md': '- The limit is probably 60 rpm [ASSUMED].',
  }[f]);

  it('BLOCKS a laundered claim', () => {
    const v = collectForwarding('src.md', 'derived.md', read);
    expect(v).toHaveLength(1);
    expect(v[0].severity).toBe('BLOCKER');
  });

  it('passes when the marker is preserved', () => {
    expect(collectForwarding('src.md', 'derived-ok.md', read)).toEqual([]);
  });
});
