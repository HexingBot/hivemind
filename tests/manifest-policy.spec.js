import { describe, it, expect } from 'vitest';
import {
  MANIFESTS,
  requiresManifest,
  manifestById,
  gateForTicket,
} from '../src/manifest-policy.js';

// TASK-212 — the 'tdd' tier was retired (2026-08-13 human decision); 'tests-after' is now the
// sole core tier and the absent-tier default.
// TASK-230 (2026-09-16 human decision, Mato: "Elimínalo. Ya no necesitamos esa parte. Elimina el
// TDD.") retired the pre-code manifest GATE itself: no verification_tier requires a manifest
// before code any more. These specs used to lock the opposite rule (tests-after required one);
// they are rewritten here to lock the new rule — manifests are optional for every tier — rather
// than being deleted, because "no gate exists" is exactly as testable as "a gate exists" and is
// the rule this repo now depends on.
describe('requiresManifest', () => {
  it('never requires a manifest, for any tier, including the default (TASK-230)', () => {
    expect(requiresManifest('tests-after')).toBe(false);
    expect(requiresManifest(undefined)).toBe(false); // absent == tests-after
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
  it('a tests-after ticket is never gated — manifests stay optional (TASK-230)', () => {
    const g = gateForTicket({ verification_tier: 'tests-after' });
    expect(g.required).toBe(false);
    expect(g.manifests).toHaveLength(6);
    expect(g.reason).toMatch(/optional/);
    expect(g.reason).not.toMatch(/before code/i);
  });

  it('a uat-only ticket is also never gated', () => {
    const g = gateForTicket({ verification_tier: 'uat-only' });
    expect(g.required).toBe(false);
    expect(g.reason).toMatch(/optional/);
  });

  it('narrows to the named manifests and drops unknown ids', () => {
    const g = gateForTicket({ verification_tier: 'tests-after', manifests: ['API_CONTRACTS', 'NOPE'] });
    expect(g.manifests.map((m) => m.id)).toEqual(['API_CONTRACTS']);
  });

  it('defaults to all manifests when none are named', () => {
    expect(gateForTicket({ verification_tier: 'tests-after', manifests: [] }).manifests).toHaveLength(6);
  });
});
