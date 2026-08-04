// tests/pack-ctl.spec.js
// TASK-134/TASK-135 — pure-logic specs for bin/pack-ctl.js, the zero-external-dep
// CLI wrapper exposing the addon-pack ops (resolveDesired / pack-reconcile /
// pack-orchestrator / assimilate) to a plugin-installed project with no
// cleanly-reachable src/ (mirrors bin/loop-ctl.js -> dist/loop-ctl.cjs exactly,
// see that file's header for the established CLI-shape precedent this ticket
// copies).
//
// Fast tier: no disk I/O, no process spawn. The reconstruction helper
// (profileResultFromFrontmatter) and the flag parsers (parseFlags,
// parseAssimilateArgs) are pure; run()'s own argument-validation guards
// (missing --repo-root / unknown subcommand / TASK-135's assimilate
// action+flag guards) throw BEFORE any fs access, so they are exercised here
// too.
//
// Real disk I/O + spawned-CLI coverage (resolve/reconcile-plan/reconcile-apply
// and TASK-135's assimilate scan/classify/stage, end to end against the BUILT
// dist/pack-ctl.cjs) lives in tests/e2e/pack-ctl.spec.js.
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
//
// TASK-135 AC map (validation-guard slice — the real assimilate scan/classify/
// stage behavior against fixtures lives in tests/e2e/pack-ctl.spec.js):
//   AC1/AC2 — `assimilate scan`/`assimilate classify` require --path, rejected
//     before any fs access.
//   AC3/AC4 — `assimilate stage` requires --source/--resource-id/--pack/
//     --repo-root, and rejects an invalid --decision or --security-verdict
//     value, all BEFORE calling assimilateSkill (i.e. before any write can
//     even be attempted) — the CLI-boundary half of the no-auto-adopt
//     invariant's typo protection.
//   AC3 — parseAssimilateArgs itself: unknown action, unknown flag, missing
//     flag value all throw eagerly (mirrors parseFlags' own contract).

import { describe, it, expect } from 'vitest';

import {
  parseFlags, run, profileResultFromFrontmatter, aggregateDesired, parseAssimilateArgs,
  computeApplyOutcome,
} from '../bin/pack-ctl.js';
import { scoreComplexity, resourceActivations } from '../src/design-profile.js';
import { deriveProfileFields } from '../src/design-profile.js';
import { resolveDesired } from '../src/pack-resources.js';
import { DESIGN_POWER_DESCRIPTOR } from '../src/builtin-packs.js';

// ---------------------------------------------------------------------------
// computeApplyOutcome — TASK-199. bin/pack-ctl.js:461-471 (pre-TASK-199) drove
// reconcile-apply's run-level ok/failureKind predicate from `plan.install`
// ONLY, so a planned replace (TASK-182 made the bucket actually executable)
// that soft-failed was invisible to it: `ok: true`, exit 0, with the truth
// sitting only in a nested `packs[].report` entry. Pure — no I/O — so these
// exercise the predicate directly, independent of the real built-in pack
// descriptors (whose git-sha pins make the replace bucket production-inert
// today — see the ticket hand-off's reachability note).
//
// AC map: AC1 (red demonstrated below by the concrete-gap test), AC2 (a
// soft-failing replace is distinguishable from "nothing planned"), AC3 (a
// successful replace is visible via replacedCount even with zero installs),
// AC4 (the extend-vs-report-only decision + reasoning is recorded on
// computeApplyOutcome's own doc comment in bin/pack-ctl.js).
// ---------------------------------------------------------------------------
describe('computeApplyOutcome — TASK-199: the run-level ok/failureKind predicate sees the replace bucket', () => {
  it('AC1/AC2 — a soft-failing replace the precedence gate WOULD attempt (shipped-newer, decidable) is no longer an unqualified success', () => {
    // Mirrors the ticket's concrete scenario: a consumer's lockfile owns
    // skill:watch at 1.0.0, the plugin ships 2.0.0 (decidable, shipped-newer
    // -- the gate WILL attempt this), and the materialize soft-fails (no
    // pack landed it) -- reproduced here via the outcome's inputs rather
    // than a real fixture, since no real built-in pack descriptor ships a
    // semver pin today (see the module header on computeApplyOutcome).
    const computedPlan = {
      install: [],
      replace: [{ id: 'skill:watch', resource: { id: 'watch' }, from: '1.0.0', to: '2.0.0' }],
    };
    const packs = [{ id: 'watch', aborted: false, installed: [], replaced: [] }];

    const outcome = computeApplyOutcome({ computedPlan, packs });

    expect(outcome.plannedReplaceCount).toBe(1);
    expect(outcome.replacedCount).toBe(0);
    expect(outcome.ok).toBe(false);
    expect(outcome.failureKind).toBe('total');
  });

  it('AC2 — distinguishes "no replaces were planned" from "replaces were planned and did not land"', () => {
    const nothingPlanned = computeApplyOutcome({
      computedPlan: { install: [], replace: [] },
      packs: [{ id: 'watch', aborted: false, installed: [], replaced: [] }],
    });
    expect(nothingPlanned.plannedReplaceCount).toBe(0);
    expect(nothingPlanned.replacedCount).toBe(0);
    expect(nothingPlanned.ok).toBe(true);

    const plannedButNotLanded = computeApplyOutcome({
      computedPlan: { install: [], replace: [{ id: 'skill:watch', resource: {}, from: '1.0.0', to: '2.0.0' }] },
      packs: [{ id: 'watch', aborted: false, installed: [], replaced: [] }],
    });
    expect(plannedButNotLanded.plannedReplaceCount).toBe(1);
    expect(plannedButNotLanded.replacedCount).toBe(0);
    expect(plannedButNotLanded.ok).toBe(false);

    // A caller can tell the two apart from the counts alone, without ever
    // reading packs[].report.
    expect(nothingPlanned.plannedReplaceCount).not.toBe(plannedButNotLanded.plannedReplaceCount);
  });

  it('a deliberately deferred/kept-as-is replace (installed-newer or undecidable precedence) is NOT counted as "planned" and stays ok:true — never a false alarm on a working-as-designed keep-as-is', () => {
    // Two real git-sha-shaped pins: comparePinPrecedence returns 'undecidable'
    // for both sides failing the semver regex, so shippedPinWins is false —
    // the apply-time gate DEFERS this op (TASK-182's documented residual),
    // it never attempts to execute it at all.
    const computedPlan = {
      install: [],
      replace: [{
        id: 'skill:watch',
        resource: { id: 'watch' },
        from: '83da59fa78c3eee9e20f515fe75c438bb5166efd',
        to: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
      }],
    };
    // Deferred ops never appear in `replaced` (they were never attempted).
    const packs = [{ id: 'watch', aborted: false, installed: [], replaced: [] }];

    const outcome = computeApplyOutcome({ computedPlan, packs });

    expect(outcome.plannedReplaceCount).toBe(0);
    expect(outcome.replacedCount).toBe(0);
    expect(outcome.ok).toBe(true);
    expect(outcome.failureKind).toBeNull();
  });

  it('AC3 — a successful attempted replace is counted and visible even when installed_count is zero', () => {
    const computedPlan = {
      install: [],
      replace: [{ id: 'skill:watch', resource: { id: 'watch' }, from: '1.0.0', to: '2.0.0' }],
    };
    const packs = [{ id: 'watch', aborted: false, installed: [], replaced: ['skill:watch'] }];

    const outcome = computeApplyOutcome({ computedPlan, packs });

    expect(outcome.plannedReplaceCount).toBe(1);
    expect(outcome.replacedCount).toBe(1);
    expect(outcome.installedCount).toBe(0);
    expect(outcome.ok).toBe(true);
  });

  it('a partial failure can come from EITHER bucket — install fully lands, replace does not', () => {
    const computedPlan = {
      install: [{ id: 'skill:ui-ux-pro-max', resource: { id: 'ui-ux-pro-max' } }],
      replace: [{ id: 'skill:watch', resource: { id: 'watch' }, from: '1.0.0', to: '2.0.0' }],
    };
    const packs = [{
      id: 'design-power', aborted: false, installed: ['skill:ui-ux-pro-max'], replaced: [],
    }];

    const outcome = computeApplyOutcome({ computedPlan, packs });

    expect(outcome.ok).toBe(false);
    expect(outcome.failureKind).toBe('partial');
  });

  it('an aborted pack still takes precedence over the replace counts, exactly like the pre-existing install-only rule', () => {
    const computedPlan = {
      install: [],
      replace: [{ id: 'skill:watch', resource: { id: 'watch' }, from: '1.0.0', to: '2.0.0' }],
    };
    const packs = [{ id: 'watch', aborted: true, installed: [], replaced: ['skill:watch'] }];

    const outcome = computeApplyOutcome({ computedPlan, packs });

    expect(outcome.ok).toBe(false);
    expect(outcome.failureKind).toBe('aborted');
  });
});

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

// ---------------------------------------------------------------------------
// parseAssimilateArgs — parses `assimilate <action> [--flags]` argv (TASK-135).
// ---------------------------------------------------------------------------
describe('parseAssimilateArgs', () => {
  it('parses_a_scan_action_with_its_path_flag', () => {
    expect(parseAssimilateArgs(['scan', '--path', '/tmp/skill'])).toEqual({
      action: 'scan',
      flags: { path: '/tmp/skill' },
    });
  });

  it('parses_a_classify_action_with_its_path_flag', () => {
    expect(parseAssimilateArgs(['classify', '--path', '/tmp/skill'])).toEqual({
      action: 'classify',
      flags: { path: '/tmp/skill' },
    });
  });

  it('parses_a_stage_action_with_all_of_its_known_flags_to_camelCase', () => {
    const { action, flags } = parseAssimilateArgs([
      'stage',
      '--source', '/tmp/skill',
      '--resource-id', 'demo-skill',
      '--pack', 'design-power@0.1.0',
      '--origin', 'github.com/example/demo-skill',
      '--pin', 'abc123',
      '--repo-root', '/tmp/project',
      '--decision', 'approve',
      '--security-verdict', 'safe',
      '--security-reasoning', 'no risky patterns',
      '--security-override', 'true',
    ]);
    expect(action).toBe('stage');
    expect(flags).toEqual({
      source: '/tmp/skill',
      resourceId: 'demo-skill',
      pack: 'design-power@0.1.0',
      origin: 'github.com/example/demo-skill',
      pin: 'abc123',
      repoRoot: '/tmp/project',
      decision: 'approve',
      securityVerdict: 'safe',
      securityReasoning: 'no risky patterns',
      securityOverride: 'true',
    });
  });

  it('throws_on_a_missing_action', () => {
    expect(() => parseAssimilateArgs([])).toThrow(/unknown assimilate action/);
  });

  it('throws_on_an_unrecognized_action', () => {
    expect(() => parseAssimilateArgs(['bogus'])).toThrow(/unknown assimilate action/);
  });

  it('throws_on_an_unknown_flag_for_the_given_action', () => {
    expect(() => parseAssimilateArgs(['scan', '--bogus', 'x'])).toThrow(/unknown flag/);
  });

  it('throws_when_a_flag_value_is_missing', () => {
    expect(() => parseAssimilateArgs(['scan', '--path'])).toThrow(/requires a value/);
  });

  it('a_stage_only_flag_is_unknown_for_scan', () => {
    expect(() => parseAssimilateArgs(['scan', '--decision', 'approve'])).toThrow(/unknown flag/);
  });
});

// ---------------------------------------------------------------------------
// run('assimilate', ...) — argument-validation guards, before any I/O
// (TASK-135 AC1/AC2/AC3 CLI-boundary typo protection).
// ---------------------------------------------------------------------------
describe('run("assimilate", ...) — argument validation happens before any disk I/O or write', () => {
  it('rejects_scan_missing_path', async () => {
    await expect(run('assimilate', { action: 'scan' })).rejects.toThrow(/--path/);
  });

  it('rejects_classify_missing_path', async () => {
    await expect(run('assimilate', { action: 'classify' })).rejects.toThrow(/--path/);
  });

  it('rejects_stage_missing_source', async () => {
    await expect(run('assimilate', {
      action: 'stage', resourceId: 'x', pack: 'p@1.0.0', repoRoot: '/tmp/project',
    })).rejects.toThrow(/--source/);
  });

  it('rejects_stage_missing_resource_id', async () => {
    await expect(run('assimilate', {
      action: 'stage', source: '/tmp/skill', pack: 'p@1.0.0', repoRoot: '/tmp/project',
    })).rejects.toThrow(/--resource-id/);
  });

  it('rejects_stage_missing_pack', async () => {
    await expect(run('assimilate', {
      action: 'stage', source: '/tmp/skill', resourceId: 'x', repoRoot: '/tmp/project',
    })).rejects.toThrow(/--pack/);
  });

  it('rejects_stage_missing_repo_root', async () => {
    await expect(run('assimilate', {
      action: 'stage', source: '/tmp/skill', resourceId: 'x', pack: 'p@1.0.0',
    })).rejects.toThrow(/--repo-root/);
  });

  it('rejects_stage_with_an_invalid_decision_value', async () => {
    await expect(run('assimilate', {
      action: 'stage', source: '/tmp/skill', resourceId: 'x', pack: 'p@1.0.0', repoRoot: '/tmp/project', decision: 'maybe',
    })).rejects.toThrow(/--decision must be/);
  });

  it('rejects_stage_with_an_invalid_security_verdict_value', async () => {
    await expect(run('assimilate', {
      action: 'stage', source: '/tmp/skill', resourceId: 'x', pack: 'p@1.0.0', repoRoot: '/tmp/project', securityVerdict: 'meh',
    })).rejects.toThrow(/--security-verdict must be/);
  });

  it('rejects_an_unknown_assimilate_action', async () => {
    await expect(run('assimilate', { action: 'bogus' })).rejects.toThrow(/unknown assimilate action/);
  });
});
