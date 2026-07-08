// src/design-profile.js
// TASK-125 — Design-profile subsystem, Phase E of the Diseño Poderoso design
// pack (see docs/design/design-profile-spec.md, human-approved). SELF-CONTAINED
// pack-owned pure module: no fs/network/clock/random anywhere in this file.
//
// This module does NOT patch core intake — src/question-library.js is left
// byte-unchanged (AC7). Live injection of DESIGN_PROFILE_QUESTIONS into the
// project-init wizard is Phase D's registration hook (the pack's own
// `profile.base_questions`, per docs/design/addon-packs.md §5); nothing in
// this repo wires it into the wizard yet. Nothing here is bundled into any
// dist/*.cjs entrypoint either (see scripts/build-plugin.mjs ENTRYPOINT_NAMES)
// — it is dead code from the shipped-plugin's point of view until Phase D
// imports it, so no `npm run build:plugin` rebuild is needed for this ticket.
//
// Exports:
//   - DESIGN_PROFILE_QUESTIONS — the design_heavy gate + the 10-question
//     Fase 0-1 interview (spec §2-§3), copied verbatim from the spec.
//   - scoreComplexity(answers) -> {tier, score, axes, activations} (spec §4).
//   - pipelineSteps(result) -> {<step>: boolean} (spec §5.1).
//   - resourceActivations(result) -> {<resource>: boolean} (spec §5.2, incl.
//     the §8.1 canvas-gating exclusion).
//   - deriveProfileFields(answers) -> {tier, perfil_proyecto} shaped for the
//     TASK-124 PROJECT.md frontmatter fields (src/project-md.js).

// ---------------------------------------------------------------------------
// §2 — the unconditional gate question.
// ---------------------------------------------------------------------------

const DESIGN_HEAVY_QUESTION = {
  id: 'design_heavy',
  type: 'enum',
  enum: ['yes', 'no'],
  prompt:
    'Does this project have a visual, human-facing interface that needs deliberate ' +
    'design work — as opposed to a pure API, CLI, backend service, or script? ' +
    '(This decides whether the design-power pack engages at all.)',
};

// ---------------------------------------------------------------------------
// §3 — the Fase 0-1 conditional interview. Order matters: every `when` looks
// backward only (the engine has no lookahead). Copied verbatim from spec §3.
// ---------------------------------------------------------------------------

const FASE_1_QUESTIONS = [
  {
    id: 'estimated_screens',
    type: 'number',
    prompt:
      'Roughly how many distinct user-facing screens/flows will this need at launch? ' +
      '(best estimate; a single-page tool = 1)',
    when: (a) => a.design_heavy === 'yes',
  },
  {
    id: 'stakes',
    type: 'enum',
    enum: ['low', 'real'],
    prompt:
      "What's the deployment reality? 'low' = personal project/prototype/experiment, " +
      "no one depends on it working. 'real' = an internal team relies on it daily, or " +
      'it has public/paying users and uptime matters.',
    when: (a) => a.design_heavy === 'yes',
  },
  {
    id: 'design_ambition',
    type: 'enum',
    enum: ['utilitarian', 'tidy', 'branded', 'signature'],
    prompt:
      'What visual bar does this need to hit? utilitarian = internal tool, just needs ' +
      'to be usable. tidy = clean and professional, generic is fine. branded = ' +
      'distinctive, competitive with polished products in its category. signature = ' +
      'best-in-class, art-directed, a differentiator in itself.',
    when: (a) => a.design_heavy === 'yes',
  },
  {
    id: 'ui_framework',
    type: 'enum',
    enum: ['react', 'vue', 'other'],
    prompt: 'Which framework renders the UI? (drives component-registry routing)',
    when: (a) => a.design_heavy === 'yes',
  },
  {
    id: 'has_canvas_render',
    type: 'enum',
    enum: ['yes', 'no'],
    prompt:
      'Does the project render through a canvas/game-engine surface (Phaser, WebGL, ' +
      'Three.js, etc.) rather than plain DOM?',
    when: (a) => a.design_heavy === 'yes',
  },
  {
    id: 'ui_outside_canvas',
    type: 'enum',
    enum: ['yes', 'no'],
    prompt:
      'Is there any DOM UI (HUD, menus, settings screens, overlays) outside that canvas?',
    when: (a) => a.design_heavy === 'yes' && a.has_canvas_render === 'yes',
  },
  {
    id: 'motion_required',
    type: 'enum',
    enum: ['yes', 'no'],
    prompt:
      'Does this need real animation/motion work — transitions, micro-interactions, ' +
      'choreographed sequences — beyond basic hover states?',
    when: (a) => a.design_heavy === 'yes',
  },
  {
    id: 'motion_layer',
    type: 'enum',
    enum: ['dom', 'canvas', 'both'],
    prompt: 'Where does that motion primarily live?',
    when: (a) => a.design_heavy === 'yes' && a.motion_required === 'yes',
  },
  {
    id: 'needs_research',
    type: 'enum',
    enum: ['need-research', 'have-direction'],
    prompt:
      'Do you need competitive/visual reference research (mood boards, competitor UI ' +
      'audits) before design starts, or do you already have clear direction (existing ' +
      'brand, mockups, style guide)?',
    when: (a) => a.design_heavy === 'yes',
  },
  {
    id: 'assets_required',
    type: 'multi',
    enum: ['illustrations', 'icons-custom', 'photography', '3d-renders', 'game-sprites-tiles', 'none'],
    prompt: 'Which custom visual assets does this need? (comma-separated; pick from the listed values)',
    when: (a) => a.design_heavy === 'yes',
  },
];

export const DESIGN_PROFILE_QUESTIONS = [DESIGN_HEAVY_QUESTION, ...FASE_1_QUESTIONS];

// ---------------------------------------------------------------------------
// §4 — the pure scoring function. Ported directly from the spec's own code.
// ---------------------------------------------------------------------------

function bucketScreens(n) {
  const v = Number.isFinite(n) ? n : 1;
  if (v <= 2) return 0;
  if (v <= 7) return 1;
  if (v <= 20) return 2;
  return 3;
}

const DESIGN_AMBITION_SCORE = { utilitarian: 0, tidy: 1, branded: 2, signature: 3 };

/**
 * Pure and deterministic: reads only `answers`, no I/O, no randomness, no
 * hidden state. See docs/design/design-profile-spec.md §4 for the full
 * derivation and the six worked examples this function must reproduce.
 *
 * @param {object} answers
 * @returns {{tier: 'LIGERO'|'MEDIO'|'COMPLETO', score: number,
 *   axes: {functionality: number, beauty: number}, activations: object}}
 */
export function scoreComplexity(answers) {
  if (answers.design_heavy !== 'yes') {
    return {
      tier: 'LIGERO',
      score: 0,
      axes: { functionality: 0, beauty: 0 },
      activations: {
        design_heavy: false, framework: null, is_canvas: false,
        ui_outside_canvas: null, motion_required: false, motion_layer: null,
        needs_research: false, assets: false, assets_list: [],
      },
    };
  }

  let F = bucketScreens(answers.estimated_screens);
  if (answers.stakes === 'real' && F === 0) F = 1; // production stakes floor the axis at 1
  F = Math.min(F, 3);

  const B = DESIGN_AMBITION_SCORE[answers.design_ambition] ?? 0;

  const fHigh = F >= 2;
  const bHigh = B >= 2;
  // CANONICAL tier gate — axis-based, never the additive score below. See
  // spec §1/§4 worked example 6 for why `score` cannot be the gate: two
  // answer sets can share a score while landing in the same tier via
  // opposite axis compositions.
  const tier = fHigh && bHigh ? 'COMPLETO' : (fHigh || bHigh) ? 'MEDIO' : 'LIGERO';
  const score = F + B; // 0-6, descriptive/ordering only — NOT the tier gate

  const isCanvas = answers.has_canvas_render === 'yes';
  const uiOutsideCanvas = isCanvas ? answers.ui_outside_canvas === 'yes' : true;
  const motionRequired = answers.motion_required === 'yes';
  const motionLayer = motionRequired ? (answers.motion_layer ?? 'dom') : null;
  const needsResearch = answers.needs_research === 'need-research';
  const assetsList = Array.isArray(answers.assets_required)
    ? answers.assets_required.filter((a) => a !== 'none')
    : [];

  return {
    tier,
    score,
    axes: { functionality: F, beauty: B },
    activations: {
      design_heavy: true,
      framework: answers.ui_framework ?? 'other',
      is_canvas: isCanvas,
      ui_outside_canvas: uiOutsideCanvas,
      motion_required: motionRequired,
      motion_layer: motionLayer,
      needs_research: needsResearch,
      assets: assetsList.length > 0,
      assets_list: assetsList,
    },
  };
}

// ---------------------------------------------------------------------------
// §5.1 — pipeline-step activation predicates, over {tier, axes, activations}.
// ---------------------------------------------------------------------------

/**
 * @param {{tier: string, axes: {functionality: number, beauty: number},
 *   activations: object}} result — scoreComplexity's return value.
 * @returns {Record<string, boolean>}
 */
export function pipelineSteps({ axes, activations }) {
  const bHigh = axes.beauty >= 2;
  const fHigh = axes.functionality >= 2;
  return {
    reference: activations.design_heavy === true,
    research: activations.needs_research === true,
    'art-direction': bHigh,
    'design-system': fHigh,
    implementation: activations.design_heavy === true,
    motion: activations.motion_required === true,
    assets: activations.assets === true,
    polish: bHigh,
    testing: activations.design_heavy === true,
  };
}

// ---------------------------------------------------------------------------
// §5.2 — §8 resource activation predicates, incl. the §8.1 canvas exclusion
// (honored directly by the shared `ui_outside_canvas` predicate on all three
// DOM-only resources: shadcn-vue, shadcn/ui, playwright).
// ---------------------------------------------------------------------------

/**
 * @param {{tier: string, axes: object, activations: object}} result
 * @returns {Record<string, boolean>}
 */
export function resourceActivations({ tier, activations }) {
  const domUi = activations.ui_outside_canvas === true;
  return {
    'frontend-design': activations.design_heavy === true,
    'ui-ux-pro-max': tier !== 'LIGERO',
    'shadcn-vue': activations.framework === 'vue' && domUi,
    'shadcn/ui': activations.framework === 'react' && domUi,
    gsap: activations.motion_required === true && activations.motion_layer !== 'canvas',
    firecrawl: activations.needs_research === true,
    openart: tier === 'COMPLETO' && activations.assets === true,
    playwright: tier === 'COMPLETO' && domUi,
  };
}

// ---------------------------------------------------------------------------
// deriveProfileFields — {tier, perfil_proyecto} for the TASK-124 PROJECT.md
// frontmatter fields (src/project-md.js SPECIAL_FRONTMATTER_IDS).
// ---------------------------------------------------------------------------

/**
 * perfil_proyecto must be a FLAT map of comma/brace-free scalars (the
 * inline-object frontmatter encoder in src/project-md.js splits naively on
 * ',' and strips the surrounding '{'/'}'). scoreComplexity's `activations`
 * carries `assets_list` as an array — arrays cannot be inline scalars, so it
 * is joined here with '+' (never ',', which is the field separator itself).
 * Keys whose value is null/undefined/empty-string are omitted rather than
 * written as a stringified "null"/empty entry: project-md's own frontmatter
 * parser drops any inline-object pair whose value is empty on read-back
 * (see coerceFrontmatterScalar), so emitting one here would silently break
 * the round-trip guarantee (AC6) rather than merely being redundant.
 *
 * The comma/brace guard below discharges the carried TASK-124 LOW: rather
 * than trust that every source enum value happens to be comma/brace-free,
 * this throws loudly the moment a value that would corrupt the encoding is
 * about to be emitted.
 *
 * @param {object} answers
 * @returns {{tier: 'LIGERO'|'MEDIO'|'COMPLETO', perfil_proyecto: Record<string, string>}}
 */
export function deriveProfileFields(answers) {
  const { tier, score, axes, activations } = scoreComplexity(answers);

  const raw = {
    score,
    functionality: axes.functionality,
    beauty: axes.beauty,
    design_heavy: activations.design_heavy,
    framework: activations.framework,
    is_canvas: activations.is_canvas,
    ui_outside_canvas: activations.ui_outside_canvas,
    motion_required: activations.motion_required,
    motion_layer: activations.motion_layer,
    needs_research: activations.needs_research,
    assets: activations.assets,
    assets_list: activations.assets_list.join('+'),
  };

  const perfil_proyecto = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === null || value === undefined) continue;
    const str = String(value);
    if (str.length === 0) continue;
    if (str.includes(',') || str.includes('{') || str.includes('}')) {
      throw new Error(
        `deriveProfileFields: value for perfil_proyecto.${key} ("${str}") contains a ` +
        'comma or brace, which would corrupt the inline-object PROJECT.md frontmatter ' +
        'encoding (project-md.js splits on unescaped "," and strips "{"/"}") — refusing ' +
        'to emit a value that would mis-parse on read-back',
      );
    }
    perfil_proyecto[key] = str;
  }

  return { tier, perfil_proyecto };
}
