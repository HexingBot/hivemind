// tests/pack-registry.spec.js
// TASK-126 — Pack registry: load + validate active packs, resolve core_compat
// (Phase D-1, docs/design/addon-packs-plan.md §5/§8). First link of the
// Option-C hybrid hook: the DESCRIPTOR is the declarative allowlist; this
// module resolves which loaded descriptors are ADMITTED into the active-pack
// set core hands to the (later, Phase D-2+) pipeline/question injectors.
//
// AC1 — HOOK_API_VERSION is exported; a pack is admitted IFF its descriptor's
//        core_compat range is satisfied by HOOK_API_VERSION, and an
//        incompatible pack is excluded LOUDLY (a pack-attributed skip
//        entry), never silently dropped. Table-driven: satisfied + unsatisfied.
// AC2 — every descriptor is run through validatePackDescriptor before
//        admission; an invalid descriptor is rejected (not admitted) with its
//        validation error surfaced in the skip entry.
// AC3 — the active-pack set is returned in a deterministic order (by id), so
//        downstream question/field injection is reproducible regardless of
//        input order.
// AC4 — the compat+validation resolution is a PURE function of (loaded
//        descriptors, HOOK_API_VERSION) — no I/O. Table-driven: compatible,
//        incompatible-core_compat, invalid-descriptor, and the EMPTY case
//        (no packs -> empty active set).
//
// Pure logic, no disk I/O in the resolver under test — fast tier.

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'node:fs';

import { HOOK_API_VERSION, resolveActivePacks } from '../src/pack-registry.js';

// Minimal-but-schema-valid descriptor (state/pack-descriptor.schema.json),
// mirroring the fixture shape used by tests/pack-descriptor.spec.js — kept
// local here since resolveActivePacks() only cares about descriptor-level
// admission, not the resource table's internals.
function makeDescriptor(overrides = {}) {
  return {
    id: 'design-power',
    name: 'Diseño Poderoso',
    version: '0.1.0',
    core_compat: '>=1.0.0',
    trigger: {},
    project_md_contribution: [],
    profile: {},
    resources: [],
    gate_scopes: [],
    pipeline: [],
    ...overrides,
  };
}

describe('TASK-126 — HOOK_API_VERSION', () => {
  it('is_exported_as_a_semver_string', () => {
    expect(typeof HOOK_API_VERSION).toBe('string');
    expect(HOOK_API_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('TASK-126 AC1 — core_compat admits/excludes, loudly, table-driven', () => {
  it('admits_a_pack_whose_core_compat_range_is_satisfied', () => {
    const pack = makeDescriptor({ id: 'satisfied-pack', core_compat: '>=1.0.0' });
    const { active, skipped } = resolveActivePacks([pack], '1.0.0');

    expect(active.map((d) => d.id)).toEqual(['satisfied-pack']);
    expect(skipped).toEqual([]);
  });

  it('excludes_a_pack_whose_core_compat_range_is_unsatisfied_with_a_pack_attributed_reason', () => {
    const pack = makeDescriptor({ id: 'unsatisfied-pack', core_compat: '>=2.0.0' });
    const { active, skipped } = resolveActivePacks([pack], '1.0.0');

    expect(active).toEqual([]);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].pack_id).toBe('unsatisfied-pack');
    expect(typeof skipped[0].reason).toBe('string');
    expect(skipped[0].reason.length).toBeGreaterThan(0);
    // The reason must name the incompatible range so a human/log consumer
    // can act on it without re-deriving it — "loudly", per AC1.
    expect(skipped[0].reason).toContain('>=2.0.0');
  });
});

describe('TASK-126 AC2 — every descriptor runs through validatePackDescriptor first', () => {
  it('rejects_an_invalid_descriptor_and_surfaces_its_validation_error_never_admitting_it', () => {
    const bad = makeDescriptor({ id: 'broken-pack' });
    delete bad.pipeline; // required by state/pack-descriptor.schema.json

    const { active, skipped } = resolveActivePacks([bad], HOOK_API_VERSION);

    expect(active).toEqual([]);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].pack_id).toBe('broken-pack');
    expect(skipped[0].reason).toMatch(/pipeline/);
  });

  it('a_valid_pack_alongside_an_invalid_one_still_admits_the_valid_one', () => {
    const good = makeDescriptor({ id: 'good-pack' });
    const bad = makeDescriptor({ id: 'bad-pack' });
    delete bad.gate_scopes; // required field

    const { active, skipped } = resolveActivePacks([good, bad], HOOK_API_VERSION);

    expect(active.map((d) => d.id)).toEqual(['good-pack']);
    expect(skipped.map((s) => s.pack_id)).toEqual(['bad-pack']);
  });
});

describe('TASK-126 AC3 — deterministic, documented ordering (by id)', () => {
  it('returns_the_active_set_sorted_by_id_regardless_of_input_order', () => {
    const zeta = makeDescriptor({ id: 'zeta-pack' });
    const alpha = makeDescriptor({ id: 'alpha-pack' });
    const mike = makeDescriptor({ id: 'mike-pack' });

    const orderA = resolveActivePacks([zeta, alpha, mike], HOOK_API_VERSION);
    const orderB = resolveActivePacks([mike, zeta, alpha], HOOK_API_VERSION);
    const orderC = resolveActivePacks([alpha, mike, zeta], HOOK_API_VERSION);

    expect(orderA.active.map((d) => d.id)).toEqual(['alpha-pack', 'mike-pack', 'zeta-pack']);
    expect(orderB.active.map((d) => d.id)).toEqual(['alpha-pack', 'mike-pack', 'zeta-pack']);
    expect(orderC.active.map((d) => d.id)).toEqual(['alpha-pack', 'mike-pack', 'zeta-pack']);
  });
});

describe('TASK-126 AC4 — pure function of (descriptors, HOOK_API_VERSION), table-driven', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('performs_no_disk_io_during_resolution', () => {
    const readSpy = vi.spyOn(fs, 'readFileSync');
    const existsSpy = vi.spyOn(fs, 'existsSync');

    const pack = makeDescriptor({ id: 'pure-check-pack' });
    resolveActivePacks([pack], HOOK_API_VERSION);

    expect(readSpy).not.toHaveBeenCalled();
    expect(existsSpy).not.toHaveBeenCalled();
  });

  it('is_deterministic_across_repeat_calls_with_the_same_inputs', () => {
    const pack = makeDescriptor({ id: 'repeat-pack' });
    const first = resolveActivePacks([pack], HOOK_API_VERSION);
    const second = resolveActivePacks([pack], HOOK_API_VERSION);

    expect(first).toEqual(second);
  });

  const compatible = makeDescriptor({ id: 'case-compatible', core_compat: '>=1.0.0' });
  const incompatible = makeDescriptor({ id: 'case-incompatible', core_compat: '>=9.9.9' });
  const invalidDescriptor = (() => {
    const d = makeDescriptor({ id: 'case-invalid' });
    delete d.resources;
    return d;
  })();

  it.each([
    ['compatible', [compatible], ['case-compatible'], []],
    ['incompatible-core_compat', [incompatible], [], ['case-incompatible']],
    ['invalid-descriptor', [invalidDescriptor], [], ['case-invalid']],
    ['empty', [], [], []],
  ])('case_%s', (_label, input, expectedActiveIds, expectedSkippedIds) => {
    const { active, skipped } = resolveActivePacks(input, '1.0.0');
    expect(active.map((d) => d.id)).toEqual(expectedActiveIds);
    expect(skipped.map((s) => s.pack_id)).toEqual(expectedSkippedIds);
  });

  it('the_empty_case_keeps_core_behavior_unchanged_zero_packs_yields_empty_active_set', () => {
    const { active, skipped } = resolveActivePacks([], HOOK_API_VERSION);
    expect(active).toEqual([]);
    expect(skipped).toEqual([]);
  });
});
