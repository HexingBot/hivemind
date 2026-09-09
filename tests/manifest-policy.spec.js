import { describe, it, expect } from 'vitest';
import {
  MANIFESTS,
  requiresManifest,
  manifestById,
  gateForTicket,
} from '../src/manifest-policy.js';

// TASK-212 — the 'tdd' tier was retired (2026-08-13 human decision); 'tests-after' is now the
// sole core tier and the absent-tier default. These specs previously used 'tdd' purely as
// example data exercising the same requiresManifest/gateForTicket machinery — updated to
// 'tests-after', not removed (the machinery itself is unchanged and still needs coverage).
describe('requiresManifest', () => {
  it('requires a manifest for the core tier (tests-after) incl. the default', () => {
    expect(requiresManifest('tests-after')).toBe(true);
    expect(requiresManifest(undefined)).toBe(true); // absent == tests-after
  });

  it('skips manifests for uat-only glue', () => {
    expect(requiresManifest('uat-only')).toBe(false);
  });
});

describe('catalog + lookup', () => {
  it('exposes the six manifests', () => {
    expect(MANIFESTS).toHaveLength(6);
    expect(MANIFESTS.map((m) => m.id)).toContain('API_CONTRACTS');
  });

  it('looks up by id and returns null for unknown', () => {
    expect(manifestById('BLOCK_TASKS').skill).toBe('impl-block-tasks');
    expect(manifestById('NOPE')).toBeNull();
  });
});

describe('gateForTicket', () => {
  it('a tests-after ticket is gated to emit manifests before code', () => {
    const g = gateForTicket({ verification_tier: 'tests-after' });
    expect(g.required).toBe(true);
    expect(g.manifests).toHaveLength(6);
    expect(g.reason).toMatch(/before code/);
  });

  it('a uat-only ticket skips manifests', () => {
    const g = gateForTicket({ verification_tier: 'uat-only' });
    expect(g.required).toBe(false);
    expect(g.reason).toMatch(/skipped/);
  });

  it('narrows to the named manifests and drops unknown ids', () => {
    const g = gateForTicket({ verification_tier: 'tests-after', manifests: ['API_CONTRACTS', 'NOPE'] });
    expect(g.manifests.map((m) => m.id)).toEqual(['API_CONTRACTS']);
  });

  it('defaults to all manifests when none are named', () => {
    expect(gateForTicket({ verification_tier: 'tests-after', manifests: [] }).manifests).toHaveLength(6);
  });
});
