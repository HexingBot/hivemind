// tests/helpers/design-power-prompter.js
// Shared scripted-answers + prompter-wrapping helpers for the design-power
// pack's DESIGN_PROFILE_QUESTIONS (src/design-profile.js). Used by both
// tests/e2e/init-pack-hook.spec.js (TASK-128, fixture-pack wiring) and
// tests/e2e/init-builtin-design-power.spec.js (TASK-129, built-in
// always-loaded default pack) — centralized here so the prompt-signature map
// can't drift between the two call sites.

import { makeScriptedPrompter } from './scripted-prompter.js';

// Distinctive substrings from src/design-profile.js's DESIGN_PROFILE_QUESTIONS
// prompts (kept in sync manually, mirroring tests/helpers/scripted-prompter.js's
// own PROMPT_SIGNATURES convention).
export const PACK_PROMPT_SIGNATURES = {
  design_heavy: 'visual, human-facing interface',
  estimated_screens: 'distinct user-facing screens',
  stakes: 'deployment reality',
  design_ambition: 'visual bar does this need to hit',
  ui_framework: 'Which framework renders the UI',
  has_canvas_render: 'canvas/game-engine surface',
  ui_outside_canvas: 'DOM UI (HUD, menus',
  motion_required: 'real animation/motion work',
  motion_layer: 'Where does that motion primarily live',
  needs_research: 'competitive/visual reference research',
  assets_required: 'custom visual assets',
};

// A design_heavy='yes' answer set that exercises the motion_layer branch but
// NOT ui_outside_canvas (has_canvas_render='no' skips it) — proves the
// injected questions' forward-only `when` gating survives injection after
// core questions.
export const PACK_ANSWERS = {
  design_heavy: 'yes',
  estimated_screens: '10',
  stakes: 'real',
  design_ambition: 'branded',
  ui_framework: 'react',
  has_canvas_render: 'no',
  motion_required: 'yes',
  motion_layer: 'dom',
  needs_research: 'need-research',
  assets_required: 'icons-custom, illustrations',
};

// runQuestionnaire coerces raw prompter strings per the question's declared
// `type` (src/question-engine.js#validateAndCoerce) before answers ever reach
// a pack's deriveProjectMd — 'number' becomes a real Number, 'multi' becomes a
// trimmed string[]. Mirror that coercion here so an "expected" value computed
// directly from PACK_ANSWERS matches what the live wizard actually hands
// deriveProfileFields.
export const PACK_ANSWERS_COERCED = {
  ...PACK_ANSWERS,
  estimated_screens: Number(PACK_ANSWERS.estimated_screens),
  assets_required: PACK_ANSWERS.assets_required.split(',').map((s) => s.trim()),
};

function resolvePackId(promptText) {
  for (const [id, fragment] of Object.entries(PACK_PROMPT_SIGNATURES)) {
    if (promptText.includes(fragment)) return id;
  }
  return null;
}

/**
 * Wrap a core scripted-answers map with design-power pack awareness: prompts
 * matching PACK_PROMPT_SIGNATURES are answered from `packAnswers` (default
 * PACK_ANSWERS); everything else delegates to the core scripted prompter
 * (tests/helpers/scripted-prompter.js#makeScriptedPrompter).
 *
 * @param {Record<string,string>} coreAnswers
 * @param {Record<string,string>} [packAnswers]
 * @returns {((ctx: object) => Promise<string>) & {askedPackIds: () => string[]}}
 */
export function makePackAwarePrompter(coreAnswers, packAnswers = PACK_ANSWERS) {
  const core = makeScriptedPrompter(coreAnswers);
  const askedPackIds = [];
  const prompter = async (ctx) => {
    const packId = resolvePackId(ctx.prompt);
    if (packId !== null) {
      askedPackIds.push(packId);
      if (!Object.prototype.hasOwnProperty.call(packAnswers, packId)) {
        throw new Error(`design-power-prompter: no scripted pack answer for "${packId}"`);
      }
      return packAnswers[packId];
    }
    return core(ctx);
  };
  prompter.askedPackIds = () => askedPackIds;
  return prompter;
}
