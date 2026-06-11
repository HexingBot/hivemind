// tests/helpers/scripted-prompter.js
// Engine-shape scripted prompter for the project-intake wizard tests.
// The engine calls prompter({prompt, type, enum?, error?}) -> Promise<string>.
// We resolve the answer by matching ctx.prompt against the question-library's
// exact prompt strings (substring match keyed by question id). Unknown prompts
// throw so missing scripted answers surface loudly rather than hang the test.

// Substring fragments unique to each question library prompt. Keep this map
// in sync with src/question-library.js wording — substring (not prefix) is
// fine because each question's prompt has at least one distinctive token.
const PROMPT_SIGNATURES = {
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
      // TASK-036 — for known-signature questions not in the answers map, return
      // empty string so optional (required:false) questions are silently skipped
      // rather than causing test failures in tests that only provide a subset of
      // answers. Required questions with empty answers will re-prompt or fail
      // validation — that is the intended guard for required fields.
      return '';
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
 */
export function webSaasAnswers(overrides = {}) {
  return {
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
