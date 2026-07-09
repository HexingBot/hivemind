// tests/helpers/scripted-prompter.js
// Engine-shape scripted prompter for the project-intake wizard tests.
// The engine calls prompter({prompt, type, enum?, error?}) -> Promise<string>.
// We resolve the answer by matching ctx.prompt against the question-library's
// exact prompt strings (substring match keyed by question id). Unknown prompts
// throw so missing scripted answers surface loudly rather than hang the test.

// Substring fragments unique to each question library prompt. Keep this map
// in sync with src/question-library.js wording — substring (not prefix) is
// fine because each question's prompt has at least one distinctive token.
//
// TASK-046 — discovery questions added at the front (matching the new
// COMMON_QUESTIONS order). The confirmation gate prompt is mapped to the
// synthetic id '__confirm__' so tests that don't need to script a confirm
// answer fall through to KNOWN_OPTIONAL_IDS and return '' (default-yes).
const PROMPT_SIGNATURES = {
  // TASK-046 — discovery questions (lead the intake in the new ordering)
  problem_statement: 'What problem are you solving',
  goals: 'Key goals',
  scope_in: 'In scope',
  scope_out: 'Out of scope',
  // TASK-046 — confirmation gate. Maps to '__confirm__' (a synthetic id never
  // present in the answers map), which KNOWN_OPTIONAL_IDS below treats as
  // optional so it returns '' (default-yes) without throwing. Tests that need
  // to script an explicit 'n' must use a custom prompter wrapper.
  __confirm__: 'Confirm and create project',
  project_name: 'Project name',
  project_description: 'One sentence describing',
  project_type: 'What kind of project',
  target_users: 'Who is this for',
  primary_use_cases: 'Primary use cases',
  success_criteria: 'How will you know this project succeeded',
  // web-saas branch
  frontend_framework: 'Which frontend framework',
  backend_framework: 'Which backend framework',
  database: 'Which primary datastore',
  web_deployment_target: 'Where will the web app run',
  // cli-tool branch
  cli_language: 'Which language for the CLI',
  distribution_channel: 'How will users install the CLI',
  command_structure: 'Command surface shape',
  // library branch
  library_language: 'Which language for the library',
  audience: 'Who consumes the library',
  package_manager: 'Which package registry',
  // TASK-036 — optional per-agent model overrides
  agent_models: 'Per-agent model overrides',
  // TASK-129 — design-power is now an ALWAYS-LOADED first-party pack
  // candidate (src/builtin-packs.js): its design_heavy gate question is
  // injected into every interactive init by default. Tests that don't care
  // about the design-profile pack get a safe default answer ('no') via
  // DEFAULT_ANSWERS_WHEN_MISSING below instead of throwing — see that map's
  // comment for why this can't just be KNOWN_OPTIONAL_IDS treatment.
  design_heavy: 'visual, human-facing interface',
};

// Question ids declared `required: false` in src/question-library.js, plus
// the synthetic '__confirm__' id for the TASK-046 confirmation gate. For
// these (and ONLY these), a missing scripted answer falls back to '' — the
// engine treats empty input to an optional question as a skip, so
// subset-answer tests keep passing when an optional question is added to the
// catalog. The confirmation gate is also treated as optional so existing tests
// that drive runInit interactively but don't need to assert on confirmation
// automatically confirm with the default-yes (empty answer).
//
// Every other id keeps the loud throw: the engine's required-field loop is
// while(true), so silently returning '' for a forgotten REQUIRED answer would
// re-prompt forever (vitest timeout) instead of surfacing a named error — the
// header promise ("surface loudly rather than hang") holds.
//
// TASK-048 — problem_statement is now REQUIRED (required:false removed from the
// question library). It has been removed from KNOWN_OPTIONAL_IDS and added to
// webSaasAnswers() so all existing wizard-interactive tests provide a non-empty
// answer and do not infinite-loop.
const KNOWN_OPTIONAL_IDS = new Set([
  'agent_models',
  // TASK-046 — goals/scope_in/scope_out remain required:false in COMMON_QUESTIONS;
  // tests that don't supply them get '' (skip) from the engine.
  'goals',
  'scope_in',
  'scope_out',
  // TASK-046 — confirmation gate (synthetic id, never in answers map).
  '__confirm__',
]);

// TASK-129 — ids with a real (non-empty) DEFAULT answer to fall back to when
// no scripted answer is supplied, distinct from KNOWN_OPTIONAL_IDS above
// (which return '' — a true skip). design_heavy is a REQUIRED question (enum,
// no `required: false`), so an empty '' answer would fail validation and hang
// the engine's re-prompt `while(true)` loop; 'no' is both a valid enum value
// and the value that reproduces pre-TASK-129 behavior (the design-power pack
// derives NO tier/perfil_proyecto fields for design_heavy !== 'yes' — see
// src/builtin-packs.js's deriveProjectMdGated), so every existing
// scripted-prompter-driven test keeps passing unchanged.
const DEFAULT_ANSWERS_WHEN_MISSING = {
  design_heavy: 'no',
};

/**
 * Build a scripted prompter from a {questionId: answerString} map.
 *
 * @param {Record<string, string>} answers
 * @returns {((ctx: object) => Promise<string>) & {calls: object[], askedIds: () => string[]}}
 */
export function makeScriptedPrompter(answers) {
  const calls = [];
  const prompter = async (ctx) => {
    calls.push(ctx);
    if (!ctx || typeof ctx !== 'object' || typeof ctx.prompt !== 'string') {
      throw new Error(
        `scripted-prompter: expected engine-shape ctx with .prompt string, got ${JSON.stringify(ctx)}`,
      );
    }
    const id = resolveQuestionId(ctx.prompt);
    if (id === null) {
      throw new Error(
        `scripted-prompter: no question id matches prompt ${JSON.stringify(ctx.prompt)}`,
      );
    }
    if (!Object.prototype.hasOwnProperty.call(answers, id)) {
      if (KNOWN_OPTIONAL_IDS.has(id)) {
        // Optional question with no scripted answer → empty input = skip.
        return '';
      }
      if (Object.prototype.hasOwnProperty.call(DEFAULT_ANSWERS_WHEN_MISSING, id)) {
        return DEFAULT_ANSWERS_WHEN_MISSING[id];
      }
      throw new Error(
        `scripted-prompter: no scripted answer for question id "${id}" (prompt: ${JSON.stringify(ctx.prompt)})`,
      );
    }
    return answers[id];
  };
  prompter.calls = calls;
  prompter.askedIds = () =>
    calls.map((c) => resolveQuestionId(c.prompt)).filter((id) => id !== null);
  return prompter;
}

function resolveQuestionId(promptText) {
  for (const [id, fragment] of Object.entries(PROMPT_SIGNATURES)) {
    if (promptText.includes(fragment)) return id;
  }
  return null;
}

/**
 * Web-saas full-branch answers — used by the forced and created tests.
 * TASK-046: discovery questions are optional (required:false), so tests that
 * don't need them simply omit them — makeScriptedPrompter returns '' for
 * missing optional ids.
 */
export function webSaasAnswers(overrides = {}) {
  return {
    // TASK-048 — problem_statement is now required; supply a non-empty sentinel
    // so wizard-interactive tests do not infinite-loop on the required-field prompt.
    problem_statement: 'Teams lose context between sessions.',
    project_name: 'new-project',
    project_description: 'a brand new test project',
    project_type: 'web-saas',
    target_users: 'internal teams',
    primary_use_cases: 'automation, reporting',
    success_criteria: 'ships and runs without paging anyone',
    frontend_framework: 'react',
    backend_framework: 'node-express',
    database: 'postgres',
    web_deployment_target: 'fly-io',
    // TASK-036 — agent_models is optional; empty string → skipped (required:false).
    agent_models: '',
    ...overrides,
  };
}
