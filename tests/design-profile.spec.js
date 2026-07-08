// tests/design-profile.spec.js
// TASK-125 — Design-profile subsystem (Phase E): scoreComplexity + the Fase 0-1
// interview + deriveProfileFields, per docs/design/design-profile-spec.md.
//
// Tests are written ahead of implementation. src/design-profile.js does not yet
// exist on disk, so every dynamic import below resolves to a missing-module
// error — that is the "right" failure mode for the tests-first commit. Each
// describe block maps to one ticket AC so the failure surface stays legible.
//
// Fast tier only: every case here is pure (no fs/network/clock/random), so it
// lives at the top level per the tests/ vs tests/e2e/ split (see vitest.config.js).
// The one genuinely disk-touching case (AC6's writeProjectMd/readProjectMd
// round-trip) lives in tests/e2e/design-profile-round-trip.spec.js instead.

import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

import { PROD } from './helpers/fixtures.js';
import { cleanupAll } from './helpers/tmpRepo.js';

afterAll(cleanupAll);

const __thisDir = dirname(fileURLToPath(import.meta.url));
const QUESTION_LIBRARY_PATH = join(__thisDir, '..', 'src', 'question-library.js');
const DESIGN_PROFILE_PATH = join(__thisDir, '..', 'src', 'design-profile.js');

function makeScriptedPrompter(answers) {
  const calls = [];
  let i = 0;
  const prompter = async (ctx) => {
    calls.push(ctx);
    if (i >= answers.length) {
      throw new Error(
        `scripted prompter exhausted after ${i} answers; ` +
        `engine asked again with: ${JSON.stringify(ctx)}`,
      );
    }
    return answers[i++];
  };
  prompter.calls = calls;
  prompter.consumed = () => i;
  return prompter;
}

// ===========================================================================
// AC1 — the 6 worked examples from spec §4, verbatim.
// ===========================================================================
describe('AC1 — scoreComplexity worked examples (spec §4)', () => {
  it('example_1_horrible_and_functional', async () => {
    const { scoreComplexity } = await import(PROD.designProfile);
    const result = scoreComplexity({
      design_heavy: 'yes',
      estimated_screens: 25,
      stakes: 'real',
      design_ambition: 'utilitarian',
    });
    expect(result.tier).toBe('MEDIO');
    expect(result.score).toBe(3);
    expect(result.axes).toEqual({ functionality: 3, beauty: 0 });
  });

  it('example_2_beautiful_and_simple', async () => {
    const { scoreComplexity } = await import(PROD.designProfile);
    const result = scoreComplexity({
      design_heavy: 'yes',
      estimated_screens: 1,
      stakes: 'low',
      design_ambition: 'signature',
    });
    expect(result.tier).toBe('MEDIO');
    expect(result.score).toBe(3);
    expect(result.axes).toEqual({ functionality: 0, beauty: 3 });
  });

  it('example_3_beautiful_and_functional', async () => {
    const { scoreComplexity } = await import(PROD.designProfile);
    const result = scoreComplexity({
      design_heavy: 'yes',
      estimated_screens: 15,
      stakes: 'real',
      design_ambition: 'branded',
    });
    expect(result.tier).toBe('COMPLETO');
    expect(result.score).toBe(4);
    expect(result.axes).toEqual({ functionality: 2, beauty: 2 });
  });

  it('example_4_design_heavy_no_short_circuit', async () => {
    const { scoreComplexity } = await import(PROD.designProfile);
    const result = scoreComplexity({ design_heavy: 'no' });
    expect(result.tier).toBe('LIGERO');
    expect(result.score).toBe(0);
    expect(result.axes).toEqual({ functionality: 0, beauty: 0 });
    expect(result.activations).toEqual({
      design_heavy: false,
      framework: null,
      is_canvas: false,
      ui_outside_canvas: null,
      motion_required: false,
      motion_layer: null,
      needs_research: false,
      assets: false,
      assets_list: [],
    });
  });

  it('example_5_boundary_modest_on_both_axes', async () => {
    const { scoreComplexity } = await import(PROD.designProfile);
    const result = scoreComplexity({
      design_heavy: 'yes',
      estimated_screens: 5,
      stakes: 'low',
      design_ambition: 'tidy',
    });
    expect(result.tier).toBe('LIGERO');
    expect(result.score).toBe(2);
    expect(result.axes).toEqual({ functionality: 1, beauty: 1 });
  });

  it('example_6_tie_break_same_score_opposite_composition', async () => {
    const { scoreComplexity } = await import(PROD.designProfile);

    const a = scoreComplexity({
      design_heavy: 'yes',
      estimated_screens: 12,
      design_ambition: 'tidy',
    });
    const b = scoreComplexity({
      design_heavy: 'yes',
      estimated_screens: 1,
      stakes: 'real',
      design_ambition: 'branded',
    });

    expect(a.axes).toEqual({ functionality: 2, beauty: 1 });
    expect(b.axes).toEqual({ functionality: 1, beauty: 2 });
    expect(a.score).toBe(3);
    expect(b.score).toBe(3);
    expect(a.tier).toBe('MEDIO');
    expect(b.tier).toBe('MEDIO');
    // Same score, same tier, opposite axis composition — this is the whole
    // point of example 6: a single scalar threshold could not distinguish
    // these two cases, yet both land correctly via fHigh/bHigh.
  });
});

// ===========================================================================
// AC2 — tier gate is fHigh&&bHigh / fHigh||bHigh / else, NEVER the additive
// score.
// ===========================================================================
describe('AC2 — tier gate is axis-based, not score-based', () => {
  it('high_score_with_only_one_axis_high_still_lands_medio', async () => {
    const { scoreComplexity } = await import(PROD.designProfile);

    // F=3 (fHigh), B=1 (not bHigh) -> score=4, a naive "score>=4 => COMPLETO"
    // rule would misclassify this as COMPLETO. The real rule looks only at
    // fHigh/bHigh and correctly returns MEDIO.
    const functionHeavy = scoreComplexity({
      design_heavy: 'yes',
      estimated_screens: 25,
      design_ambition: 'tidy',
    });
    expect(functionHeavy.axes).toEqual({ functionality: 3, beauty: 1 });
    expect(functionHeavy.score).toBe(4);
    expect(functionHeavy.tier).toBe('MEDIO');

    // Mirror case: F=1 (not fHigh), B=3 (bHigh) -> same score=4, same tier
    // MEDIO, opposite composition.
    const beautyHeavy = scoreComplexity({
      design_heavy: 'yes',
      estimated_screens: 1,
      stakes: 'real',
      design_ambition: 'signature',
    });
    expect(beautyHeavy.axes).toEqual({ functionality: 1, beauty: 3 });
    expect(beautyHeavy.score).toBe(4);
    expect(beautyHeavy.tier).toBe('MEDIO');
  });

  it('source_does_not_gate_tier_on_score', () => {
    // Static-inspection guard: the tier assignment expression in the module
    // source must be the fHigh/bHigh ternary, and the literal token `score`
    // must not appear on that same line (i.e. no code path branches tier on
    // the additive score).
    const src = readFileSync(DESIGN_PROFILE_PATH, 'utf8');
    const tierLine = src.split('\n').find((l) => /\bconst tier\s*=/.test(l));
    expect(tierLine, 'expected a `const tier = ...` assignment line in src/design-profile.js').toBeDefined();
    expect(tierLine).toMatch(/fHigh\s*&&\s*bHigh/);
    expect(tierLine).toMatch(/fHigh\s*\|\|\s*bHigh/);
    expect(tierLine).not.toMatch(/score/);
  });
});

// ===========================================================================
// AC3 — pipeline-step activation (spec §5.1), table-driven.
// ===========================================================================
describe('AC3 — pipeline step activation (spec §5.1)', () => {
  it('pipeline_steps_table', async () => {
    const { scoreComplexity, pipelineSteps } = await import(PROD.designProfile);

    const cases = [
      {
        name: 'design_heavy=no -> everything off',
        answers: { design_heavy: 'no' },
        expected: {
          reference: false, research: false, 'art-direction': false,
          'design-system': false, implementation: false, motion: false,
          assets: false, polish: false, testing: false,
        },
      },
      {
        name: 'LIGERO with no flags -> only the always-on trio',
        answers: {
          design_heavy: 'yes', estimated_screens: 5, stakes: 'low',
          design_ambition: 'tidy', needs_research: 'have-direction',
          motion_required: 'no', assets_required: ['none'],
        },
        expected: {
          reference: true, research: false, 'art-direction': false,
          'design-system': false, implementation: true, motion: false,
          assets: false, polish: false, testing: true,
        },
      },
      {
        name: 'MEDIO function-heavy (worked example 1) -> design-system on, art-direction/polish off',
        answers: {
          design_heavy: 'yes', estimated_screens: 25, stakes: 'real',
          design_ambition: 'utilitarian',
        },
        expected: {
          reference: true, research: false, 'art-direction': false,
          'design-system': true, implementation: true, motion: false,
          assets: false, polish: false, testing: true,
        },
      },
      {
        name: 'MEDIO beauty-heavy (worked example 2) with research+motion+assets flags on',
        answers: {
          design_heavy: 'yes', estimated_screens: 1, stakes: 'low',
          design_ambition: 'signature', needs_research: 'need-research',
          motion_required: 'yes', motion_layer: 'dom',
          assets_required: ['icons-custom'],
        },
        expected: {
          reference: true, research: true, 'art-direction': true,
          'design-system': false, implementation: true, motion: true,
          assets: true, polish: true, testing: true,
        },
      },
      {
        name: 'COMPLETO (worked example 3) -> all 9 steps on (flags all held)',
        answers: {
          design_heavy: 'yes', estimated_screens: 15, stakes: 'real',
          design_ambition: 'branded', needs_research: 'need-research',
          motion_required: 'yes', motion_layer: 'both',
          assets_required: ['illustrations'],
        },
        expected: {
          reference: true, research: true, 'art-direction': true,
          'design-system': true, implementation: true, motion: true,
          assets: true, polish: true, testing: true,
        },
      },
    ];

    for (const c of cases) {
      const result = scoreComplexity(c.answers);
      expect(pipelineSteps(result), c.name).toEqual(c.expected);
    }
  });
});

// ===========================================================================
// AC4 — §8 resource activation (spec §5.2), incl. the §8.1 canvas exclusion.
// ===========================================================================
describe('AC4 — §8 resource activation (spec §5.2 + §8.1 canvas exclusion)', () => {
  it('resource_activation_table', async () => {
    const { scoreComplexity, resourceActivations } = await import(PROD.designProfile);

    const cases = [
      {
        name: 'design_heavy=no -> no resources',
        answers: { design_heavy: 'no' },
        expected: {
          'frontend-design': false, 'ui-ux-pro-max': false,
          'shadcn-vue': false, 'shadcn/ui': false, gsap: false,
          firecrawl: false, openart: false, playwright: false,
        },
      },
      {
        name: 'LIGERO, vue, DOM UI -> frontend-design only (tier gates ui-ux-pro-max off)',
        answers: {
          design_heavy: 'yes', estimated_screens: 5, stakes: 'low',
          design_ambition: 'tidy', ui_framework: 'vue',
          has_canvas_render: 'no',
        },
        expected: {
          'frontend-design': true, 'ui-ux-pro-max': false,
          'shadcn-vue': true, 'shadcn/ui': false, gsap: false,
          firecrawl: false, openart: false, playwright: false,
        },
      },
      {
        name: 'MEDIO, react, DOM UI, DOM motion, needs research -> shadcn/ui + gsap + firecrawl, no openart/playwright (not COMPLETO)',
        answers: {
          design_heavy: 'yes', estimated_screens: 1, stakes: 'low',
          design_ambition: 'signature', ui_framework: 'react',
          has_canvas_render: 'no', motion_required: 'yes', motion_layer: 'dom',
          needs_research: 'need-research',
        },
        expected: {
          'frontend-design': true, 'ui-ux-pro-max': true,
          'shadcn-vue': false, 'shadcn/ui': true, gsap: true,
          firecrawl: true, openart: false, playwright: false,
        },
      },
      {
        name: 'COMPLETO, react, DOM UI, assets, needs research -> everything applicable is ON',
        answers: {
          design_heavy: 'yes', estimated_screens: 15, stakes: 'real',
          design_ambition: 'branded', ui_framework: 'react',
          has_canvas_render: 'no', motion_required: 'yes', motion_layer: 'dom',
          needs_research: 'need-research', assets_required: ['icons-custom'],
        },
        expected: {
          'frontend-design': true, 'ui-ux-pro-max': true,
          'shadcn-vue': false, 'shadcn/ui': true, gsap: true,
          firecrawl: true, openart: true, playwright: true,
        },
      },
      {
        name: '§8.1 canvas exclusion: COMPLETO, react, CANVAS render with NO dom UI outside it -> shadcn/ui, shadcn-vue, playwright ALL disabled',
        answers: {
          design_heavy: 'yes', estimated_screens: 15, stakes: 'real',
          design_ambition: 'branded', ui_framework: 'react',
          has_canvas_render: 'yes', ui_outside_canvas: 'no',
          assets_required: ['icons-custom'],
        },
        expected: {
          'frontend-design': true, 'ui-ux-pro-max': true,
          'shadcn-vue': false, 'shadcn/ui': false, gsap: false,
          firecrawl: false, openart: true, playwright: false,
        },
      },
      {
        name: 'canvas render but WITH dom UI outside it -> shadcn/ui + playwright re-enable (§8.1 counter-case)',
        answers: {
          design_heavy: 'yes', estimated_screens: 15, stakes: 'real',
          design_ambition: 'branded', ui_framework: 'react',
          has_canvas_render: 'yes', ui_outside_canvas: 'yes',
        },
        expected: {
          'frontend-design': true, 'ui-ux-pro-max': true,
          'shadcn-vue': false, 'shadcn/ui': true, gsap: false,
          firecrawl: false, openart: false, playwright: true,
        },
      },
      {
        name: 'canvas motion (motion_layer=canvas) -> motion step ON but gsap resource stays OFF (no DOM motion resource for canvas)',
        answers: {
          design_heavy: 'yes', estimated_screens: 15, stakes: 'real',
          design_ambition: 'branded', ui_framework: 'other',
          has_canvas_render: 'yes', ui_outside_canvas: 'no',
          motion_required: 'yes', motion_layer: 'canvas',
        },
        expected: {
          'frontend-design': true, 'ui-ux-pro-max': true,
          'shadcn-vue': false, 'shadcn/ui': false, gsap: false,
          firecrawl: false, openart: false, playwright: false,
        },
      },
    ];

    for (const c of cases) {
      const result = scoreComplexity(c.answers);
      expect(resourceActivations(result), c.name).toEqual(c.expected);
    }
  });

  it('canvas_motion_still_activates_the_motion_pipeline_step', async () => {
    // Companion assertion to the last table row above: motion_layer=canvas
    // still turns the `motion` PIPELINE step on (spec §6 open question 4) even
    // though no §8 resource activates for it.
    const { scoreComplexity, pipelineSteps } = await import(PROD.designProfile);
    const result = scoreComplexity({
      design_heavy: 'yes', estimated_screens: 15, stakes: 'real',
      design_ambition: 'branded', has_canvas_render: 'yes',
      ui_outside_canvas: 'no', motion_required: 'yes', motion_layer: 'canvas',
    });
    expect(pipelineSteps(result).motion).toBe(true);
  });
});

// ===========================================================================
// AC5 — DESIGN_PROFILE_QUESTIONS is engine-valid and forward-only, driven
// through runQuestionnaire itself (not re-derived in the test).
// ===========================================================================
describe('AC5 — DESIGN_PROFILE_QUESTIONS engine compatibility', () => {
  it('design_heavy_no_skips_all_ten_interview_questions', async () => {
    const { runQuestionnaire } = await import(PROD.questionEngine);
    const { DESIGN_PROFILE_QUESTIONS } = await import(PROD.designProfile);

    const prompter = makeScriptedPrompter(['no']);
    const { answers } = await runQuestionnaire({
      questions: DESIGN_PROFILE_QUESTIONS,
      prompter,
      persistTo: null,
      now: () => '2026-07-08T12:00:00Z',
    });

    expect(answers).toEqual({ design_heavy: 'no' });
    expect(prompter.consumed()).toBe(1);
  });

  it('doubly_gated_questions_fire_only_when_both_gates_hold', async () => {
    const { runQuestionnaire } = await import(PROD.questionEngine);
    const { DESIGN_PROFILE_QUESTIONS } = await import(PROD.designProfile);

    // design_heavy=yes, has_canvas_render=no -> ui_outside_canvas must be
    // skipped even though design_heavy holds, because has_canvas_render is
    // the second gate.
    const prompterA = makeScriptedPrompter([
      'yes',   // design_heavy
      '10',    // estimated_screens
      'real',  // stakes
      'branded', // design_ambition
      'react', // ui_framework
      'no',    // has_canvas_render -> ui_outside_canvas must be SKIPPED
      'no',    // motion_required -> motion_layer must be SKIPPED
      'have-direction', // needs_research
      'none',  // assets_required
    ]);
    const { answers: answersA } = await runQuestionnaire({
      questions: DESIGN_PROFILE_QUESTIONS,
      prompter: prompterA,
      persistTo: null,
      now: () => '2026-07-08T12:00:00Z',
    });
    expect('ui_outside_canvas' in answersA).toBe(false);
    expect('motion_layer' in answersA).toBe(false);
    expect(prompterA.consumed()).toBe(9);

    // design_heavy=yes, has_canvas_render=yes -> ui_outside_canvas MUST fire;
    // motion_required=yes -> motion_layer MUST fire.
    const prompterB = makeScriptedPrompter([
      'yes', '10', 'real', 'branded', 'react',
      'yes', // has_canvas_render
      'yes', // ui_outside_canvas fires now
      'yes', // motion_required
      'dom', // motion_layer fires now
      'need-research',
      'icons-custom',
    ]);
    const { answers: answersB } = await runQuestionnaire({
      questions: DESIGN_PROFILE_QUESTIONS,
      prompter: prompterB,
      persistTo: null,
      now: () => '2026-07-08T12:00:00Z',
    });
    expect(answersB.ui_outside_canvas).toBe('yes');
    expect(answersB.motion_layer).toBe('dom');
    expect(prompterB.consumed()).toBe(11);
  });
});

// ===========================================================================
// AC6 (partial) — the comma/brace guard. The disk-touching round-trip half of
// AC6 lives in tests/e2e/design-profile-round-trip.spec.js.
// ===========================================================================
describe('AC6 — deriveProfileFields shape + comma/brace guard', () => {
  it('returns_tier_and_a_flat_scalar_perfil_proyecto_map', async () => {
    const { deriveProfileFields } = await import(PROD.designProfile);
    const { tier, perfil_proyecto } = deriveProfileFields({
      design_heavy: 'yes', estimated_screens: 15, stakes: 'real',
      design_ambition: 'branded', ui_framework: 'vue',
      has_canvas_render: 'no', needs_research: 'need-research',
      assets_required: ['icons-custom', 'photography'],
    });
    expect(['LIGERO', 'MEDIO', 'COMPLETO']).toContain(tier);
    expect(typeof perfil_proyecto).toBe('object');
    for (const [key, value] of Object.entries(perfil_proyecto)) {
      expect(typeof value, `perfil_proyecto.${key} must be a scalar`).not.toBe('object');
      expect(String(value), `perfil_proyecto.${key} must be comma-free`).not.toMatch(/,/);
      expect(String(value), `perfil_proyecto.${key} must be brace-free`).not.toMatch(/[{}]/);
    }
  });

  it('throws_loudly_if_an_emitted_value_would_contain_a_comma_or_brace', async () => {
    const { deriveProfileFields } = await import(PROD.designProfile);
    // Bypass the engine's enum validation on purpose: craft a raw answers
    // object whose ui_framework value smuggles a comma through, simulating
    // any future caller that doesn't route through runQuestionnaire's enum
    // check. deriveProfileFields must refuse to emit this rather than
    // silently corrupting the perfil_proyecto inline-object encoding.
    expect(() => deriveProfileFields({
      design_heavy: 'yes',
      estimated_screens: 5,
      design_ambition: 'tidy',
      ui_framework: 'react,vue',
    })).toThrow(/comma|brace/i);
  });
});

// ===========================================================================
// AC7 — src/question-library.js is untouched; live wizard injection is
// deferred to the Phase D registration hook.
// ===========================================================================
describe('AC7 — core intake is not patched', () => {
  it('question_library_has_no_design_heavy_leakage', () => {
    const src = readFileSync(QUESTION_LIBRARY_PATH, 'utf8');
    expect(src).not.toMatch(/design_heavy/);
  });

  it('module_documents_the_phase_d_deferral', async () => {
    const src = readFileSync(DESIGN_PROFILE_PATH, 'utf8');
    expect(src).toMatch(/Phase D/);
    expect(src).toMatch(/registration hook/i);
  });
});
