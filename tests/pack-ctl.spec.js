// tests/pack-ctl.spec.js
// TASK-134 — pure-logic specs for bin/pack-ctl.js, the zero-external-dep CLI
// wrapper exposing the addon-pack ops (resolveDesired / pack-reconcile /
// pack-orchestrator) to a plugin-installed project with no cleanly-reachable
// src/ (mirrors bin/loop-ctl.js -> dist/loop-ctl.cjs exactly, see that file's
// header for the established CLI-shape precedent this ticket copies).
//
// Fast tier: no disk I/O, no process spawn. The reconstruction helper
// (profileResultFromFrontmatter) and the flag parser (parseFlags) are pure;
// run()'s own argument-validation guard (missing --repo-root / unknown
// subcommand) throws BEFORE any fs access, so it is exercised here too.
//
// Real disk I/O + spawned-CLI coverage (resolve/reconcile-plan/reconcile-apply
// end to end against the BUILT dist/pack-ctl.cjs) lives in
// tests/e2e/pack-ctl.spec.js.
//
// AC map:
//   AC1 (partial) — profileResultFromFrontmatter round-trips deriveProfileFields'
//     perfil_proyecto/tier output back into the exact {tier, axes, activations}
//     shape resourceActivations()/resolveDesired() expect, byte-for-byte
//     identical to a real scoreComplexity(answers) call for the same answers.
//   AC1 (partial) — aggregateDesired flattens resolveDesired() across every
//     active pack, in pack order, without reimplementing resolveDesired.
//   AC5 — --repo-root is required (missing flag rejected before any I/O);
//     unknown subcommand rejected by run()'s own default branch.

import { describe, it, expect } from 'vitest';

import {
  parseFlags, run, profileResultFromFrontmatter, aggregateDesired,
} from '../bin/pack-ctl.js';
import { scoreComplexity, resourceActivations } from '../src/design-profile.js';
import { deriveProfileFields } from '../src/design-profile.js';
import { resolveDesired } from '../src/pack-resources.js';
import { DESIGN_POWER_DESCRIPTOR } from '../src/builtin-packs.js';

// ---------------------------------------------------------------------------
// profileResultFromFrontmatter — reverse of deriveProfileFields.
// ---------------------------------------------------------------------------
describe('profileResultFromFrontmatter — reconstructs a real scoreComplexity() shape from PROJECT.md fields', () => {
  const MEDIO_ANSWERS = {
    design_heavy: 'yes',
    estimated_screens: 10,
    stakes: 'real',
    design_ambition: 'tidy',
    ui_framework: 'other',
    has_canvas_render: 'no',
    motion_required: 'no',
    needs_research: 'have-direction',
    assets_required: ['none'],
  };

  it('round_trips_a_design_heavy_profile_back_to_the_exact_scoreComplexity_shape', () => {
    const real = scoreComplexity(MEDIO_ANSWERS);
    const { tier, perfil_proyecto } = deriveProfileFields(MEDIO_ANSWERS);
    expect(tier).toBe(real.tier); // sanity: deriveProfileFields agrees with scoreComplexity

    const reconstructed = profileResultFromFrontmatter({ tier, perfil_proyecto });

    expect(reconstructed.tier).toBe(real.tier);
    expect(reconstructed.axes).toEqual(real.axes);
    expect(reconstructed.activations).toEqual(real.activations);
    // resourceActivations() only ever reads {tier, activations} — proving the
    // reconstructed object drives it identically is the actual load-bearing
    // guarantee (this is what resolve/reconcile-plan/reconcile-apply rely on).
    expect(resourceActivations(reconstructed)).toEqual(resourceActivations(real));
  });

  it('round_trips_a_profile_with_motion_and_assets_populated', () => {
    const answers = {
      design_heavy: 'yes',
      estimated_screens: 25,
      stakes: 'real',
      design_ambition: 'signature',
      ui_framework: 'react',
      has_canvas_render: 'no',
      motion_required: 'yes',
      motion_layer: 'both',
      needs_research: 'need-research',
      assets_required: ['icons-custom', 'illustrations'],
    };
    const real = scoreComplexity(answers);
    const { tier, perfil_proyecto } = deriveProfileFields(answers);
    const reconstructed = profileResultFromFrontmatter({ tier, perfil_proyecto });

    expect(reconstructed).toEqual(real);
  });

  it('absent_tier_and_perfil_proyecto_reconstructs_the_LIGERO_no_design_default', () => {
    const reconstructed = profileResultFromFrontmatter({});
    expect(reconstructed).toEqual(scoreComplexity({}));
    expect(reconstructed.tier).toBe('LIGERO');
    expect(reconstructed.activations.design_heavy).toBe(false);
  });

  it('empty_perfil_proyecto_object_also_falls_back_to_the_no_design_default', () => {
    const reconstructed = profileResultFromFrontmatter({ tier: undefined, perfil_proyecto: {} });
    expect(reconstructed).toEqual(scoreComplexity({}));
  });
});

// ---------------------------------------------------------------------------
// aggregateDesired — flattens resolveDesired() across active packs.
// ---------------------------------------------------------------------------
describe('aggregateDesired — flattens resolveDesired() across every active pack in order', () => {
  it('matches_a_direct_resolveDesired_call_for_a_single_active_pack', () => {
    const profileResult = scoreComplexity({
      design_heavy: 'yes',
      estimated_screens: 10,
      stakes: 'real',
      design_ambition: 'branded',
      ui_framework: 'vue',
      has_canvas_render: 'no',
      motion_required: 'no',
      needs_research: 'need-research',
      assets_required: ['none'],
    });
    const activePacks = [{ descriptor: DESIGN_POWER_DESCRIPTOR, module: {} }];

    const aggregated = aggregateDesired(activePacks, profileResult);
    const direct = resolveDesired(DESIGN_POWER_DESCRIPTOR, profileResult);

    expect(aggregated).toEqual(direct);
  });

  it('concatenates_multiple_active_packs_in_pack_order_without_reimplementing_resolveDesired', () => {
    const profileResult = scoreComplexity({ design_heavy: 'no' }); // LIGERO/no-design
    const packA = {
      id: 'pack-a', version: '1.0.0',
      resources: [{ id: 'always-on-a', kind: 'skill', origin: 'x', pin: 'v1', scope: 'project', required: 'soft' }],
    };
    const packB = {
      id: 'pack-b', version: '1.0.0',
      resources: [{ id: 'always-on-b', kind: 'skill', origin: 'x', pin: 'v1', scope: 'project', required: 'soft' }],
    };
    // Fake resourceActivations-independent descriptors don't exist for
    // arbitrary ids — activations gates on real resourceActivations() keys,
    // so use a profile + descriptor pairing whose ids ARE real resolveDesired
    // inputs by monkey-testing via the actual resolveDesired call per pack
    // (aggregateDesired must not diverge from calling resolveDesired per pack).
    const expected = [...resolveDesired(packA, profileResult), ...resolveDesired(packB, profileResult)];
    const aggregated = aggregateDesired(
      [{ descriptor: packA, module: {} }, { descriptor: packB, module: {} }],
      profileResult,
    );
    expect(aggregated).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// parseFlags — mirrors bin/loop-ctl.js's own parseFlags contract.
// ---------------------------------------------------------------------------
describe('parseFlags', () => {
  it('parses_known_repo_root_flag_to_camelCase', () => {
    const flags = parseFlags('resolve', ['--repo-root', '/tmp/proj']);
    expect(flags).toEqual({ repoRoot: '/tmp/proj' });
  });

  it('throws_on_an_unknown_flag', () => {
    expect(() => parseFlags('resolve', ['--bogus', 'x'])).toThrow(/unknown flag/);
  });

  it('throws_when_a_flag_value_is_missing', () => {
    expect(() => parseFlags('resolve', ['--repo-root'])).toThrow(/requires a value/);
  });
});

// ---------------------------------------------------------------------------
// run() argument-validation guard — must reject BEFORE any fs access (AC5).
// ---------------------------------------------------------------------------
describe('run() — argument validation happens before any disk I/O (AC5)', () => {
  it('rejects_resolve_missing_repo_root', async () => {
    await expect(run('resolve', {})).rejects.toThrow(/--repo-root/);
  });

  it('rejects_reconcile_plan_missing_repo_root', async () => {
    await expect(run('reconcile-plan', {})).rejects.toThrow(/--repo-root/);
  });

  it('rejects_reconcile_apply_missing_repo_root', async () => {
    await expect(run('reconcile-apply', {})).rejects.toThrow(/--repo-root/);
  });

  it('rejects_an_unknown_subcommand', async () => {
    await expect(run('bogus-subcommand', { repoRoot: '/tmp/whatever' })).rejects.toThrow(/unknown subcommand/);
  });
});
