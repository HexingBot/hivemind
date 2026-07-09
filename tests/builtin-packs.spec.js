// tests/builtin-packs.spec.js
// TASK-129 — src/builtin-packs.js registers the design-power pack as an
// ALWAYS-LOADED first-party candidate (discovery Option C), closing the
// unfed-registration-hook gap TASK-128 left open (bin/init.js accepted
// packDescriptors/packModules but nothing supplied them by default).
//
// AC3 — the design-power module binding satisfies the pack-hooks isolation
//        allowlist (derived keys are a subset of descriptor.project_md_contribution
//        = [perfil_proyecto, tier]); the built-in registration binds the REAL
//        DESIGN_PROFILE_QUESTIONS + deriveProfileFields, never a
//        reimplementation.
// Also covers the self-gating contract (TASK-129's critical design note): a
// design_heavy answer other than 'yes' must derive NOTHING, matching
// pre-TASK-129 (no design-power pack) behavior exactly, even though
// scoreComplexity()/deriveProfileFields() themselves return a real (non-empty)
// activations map for that case.
//
// Pure logic, no disk I/O beyond the module's own static JSON import — fast tier.

import { describe, it, expect } from 'vitest';

import {
  DESIGN_POWER_DESCRIPTOR,
  DESIGN_POWER_MODULE,
  BUILTIN_PACK_DESCRIPTORS,
  BUILTIN_PACK_MODULES,
} from '../src/builtin-packs.js';
import { validatePackDescriptor } from '../src/pack-descriptor.js';
import { resolveActivePacks, HOOK_API_VERSION } from '../src/pack-registry.js';
import { collectPackQuestions, applyProjectMdContributions } from '../src/pack-hooks.js';
import { buildIntakeQuestions } from '../src/question-library.js';
import { DESIGN_PROFILE_QUESTIONS, deriveProfileFields } from '../src/design-profile.js';

// Mirrors tests/e2e/init-pack-hook.spec.js's PACK_ANSWERS — a design_heavy='yes'
// answer set exercising a representative branch of the Fase-1 interview.
const YES_ANSWERS = {
  design_heavy: 'yes',
  estimated_screens: 10,
  stakes: 'real',
  design_ambition: 'branded',
  ui_framework: 'react',
  has_canvas_render: 'no',
  motion_required: 'yes',
  motion_layer: 'dom',
  needs_research: 'need-research',
  assets_required: ['icons-custom', 'illustrations'],
};

describe('AC3 — design-power descriptor is a minimal valid FP-1 seed', () => {
  it('descriptor_passes_validatePackDescriptor', () => {
    const { valid, errors } = validatePackDescriptor(DESIGN_POWER_DESCRIPTOR);
    expect(valid, `expected a valid descriptor, got errors: ${JSON.stringify(errors)}`).toBe(true);
  });

  it('descriptor_id_is_design_power', () => {
    expect(DESIGN_POWER_DESCRIPTOR.id).toBe('design-power');
  });

  it('descriptor_declares_exactly_the_perfil_proyecto_and_tier_isolation_envelope', () => {
    expect([...DESIGN_POWER_DESCRIPTOR.project_md_contribution].sort()).toEqual(
      ['perfil_proyecto', 'tier'],
    );
  });

  it('descriptor_core_compat_is_satisfied_by_the_current_HOOK_API_VERSION', () => {
    const { active, skipped } = resolveActivePacks([DESIGN_POWER_DESCRIPTOR], HOOK_API_VERSION);
    expect(skipped).toEqual([]);
    expect(active).toEqual([DESIGN_POWER_DESCRIPTOR]);
  });
});

describe('AC3 — the built-in module binds the REAL design-profile exports, not a reimplementation', () => {
  it('module_questions_is_reference_equal_to_DESIGN_PROFILE_QUESTIONS', () => {
    expect(DESIGN_POWER_MODULE.questions).toBe(DESIGN_PROFILE_QUESTIONS);
  });

  it('deriveProjectMd_yes_path_matches_deriveProfileFields_exactly', () => {
    const expected = deriveProfileFields(YES_ANSWERS);
    const actual = DESIGN_POWER_MODULE.deriveProjectMd(YES_ANSWERS);
    expect(actual).toEqual(expected);
    // Non-vacuity: the real derivation actually produced a non-empty result
    // for this answer set (a stub/no-op module would trivially "match" {}).
    expect(actual.tier).toBeDefined();
    expect(Object.keys(actual.perfil_proyecto).length).toBeGreaterThan(0);
  });

  it('deriveProjectMd_derived_keys_stay_within_the_descriptor_isolation_envelope', () => {
    const activePacks = [{ descriptor: DESIGN_POWER_DESCRIPTOR, module: DESIGN_POWER_MODULE }];
    // applyProjectMdContributions throws on any out-of-envelope key — a real
    // reimplementation drifting from the descriptor's allowlist would fail here.
    expect(() => applyProjectMdContributions(activePacks, YES_ANSWERS)).not.toThrow();
    const merged = applyProjectMdContributions(activePacks, YES_ANSWERS);
    const expected = deriveProfileFields(YES_ANSWERS);
    expect(merged.tier).toBe(expected.tier);
    expect(merged.perfil_proyecto).toEqual(expected.perfil_proyecto);
  });

  it('collectPackQuestions_injects_design_power_questions_after_the_real_core_questions_with_no_collision', () => {
    const core = buildIntakeQuestions();
    const activePacks = [{ descriptor: DESIGN_POWER_DESCRIPTOR, module: DESIGN_POWER_MODULE }];
    const combined = collectPackQuestions(core, activePacks);
    expect(combined.length).toBe(core.length + DESIGN_PROFILE_QUESTIONS.length);
    const injectedIds = combined.slice(core.length).map((q) => q.id);
    expect(injectedIds).toEqual(DESIGN_PROFILE_QUESTIONS.map((q) => q.id));
  });
});

describe('AC2 (unit-level) — the self-gate: design_heavy !== "yes" derives nothing', () => {
  it('design_heavy_no_derives_an_empty_object', () => {
    expect(DESIGN_POWER_MODULE.deriveProjectMd({ design_heavy: 'no' })).toEqual({});
  });

  it('design_heavy_absent_derives_an_empty_object', () => {
    // Non-design / non-interactive projects: design_heavy is never answered at
    // all (see bin/init.js's suppliedAnswers branch, which skips the wizard
    // entirely). The gate must treat "absent" exactly like "no".
    expect(DESIGN_POWER_MODULE.deriveProjectMd({ project_name: 'x' })).toEqual({});
  });

  it('design_heavy_no_produces_no_isolation_violation_and_merges_nothing', () => {
    const activePacks = [{ descriptor: DESIGN_POWER_DESCRIPTOR, module: DESIGN_POWER_MODULE }];
    const answers = { project_name: 'no-design', design_heavy: 'no' };
    const merged = applyProjectMdContributions(activePacks, answers);
    expect(merged).toEqual(answers);
    expect(merged.tier).toBeUndefined();
    expect(merged.perfil_proyecto).toBeUndefined();
  });

  it('contrasts_with_the_unwrapped_deriveProfileFields_which_is_NOT_gated', () => {
    // Documents WHY the gate in src/builtin-packs.js exists: the raw
    // deriveProfileFields (Phase E) returns a real, non-empty perfil_proyecto
    // even for design_heavy!=='yes' — it is scoreComplexity()'s job to encode
    // "not a design project" as an all-false activations map, not to omit the
    // field entirely. Always-loading the RAW function (skipping the gate)
    // would leak these keys into every non-design project's PROJECT.md.
    const raw = deriveProfileFields({ design_heavy: 'no' });
    expect(Object.keys(raw.perfil_proyecto).length).toBeGreaterThan(0);
  });
});

describe('BUILTIN_PACK_DESCRIPTORS / BUILTIN_PACK_MODULES — the bin/init.js default shape', () => {
  it('descriptors_and_modules_are_keyed_consistently_by_descriptor_id', () => {
    expect(BUILTIN_PACK_DESCRIPTORS).toEqual([DESIGN_POWER_DESCRIPTOR]);
    expect(BUILTIN_PACK_MODULES[DESIGN_POWER_DESCRIPTOR.id]).toBe(DESIGN_POWER_MODULE);
  });

  it('loadActivePacks_shape_binds_the_default_descriptor_to_the_default_module', async () => {
    const { loadActivePacks } = await import('../src/pack-loader.js');
    const { activePacks } = loadActivePacks({
      descriptors: BUILTIN_PACK_DESCRIPTORS,
      moduleRegistry: BUILTIN_PACK_MODULES,
    });
    expect(activePacks).toEqual([
      { descriptor: DESIGN_POWER_DESCRIPTOR, module: DESIGN_POWER_MODULE },
    ]);
  });
});
