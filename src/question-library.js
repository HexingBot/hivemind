// src/question-library.js
// TASK-011 — the curated intake catalog feeding runQuestionnaire() during the
// project-init wizard.
//
// Shape:
//   COMMON_QUESTIONS         — array, asked of every project (>=6 entries).
//   TYPE_SPECIFIC_QUESTIONS  — object keyed by the frozen project_type
//                              taxonomy; each value is an array of questions
//                              gated by a `when` predicate.
//   buildIntakeQuestions()   — concatenation: common first, then type-specific
//                              in the canonical taxonomy order.
//
// Design notes:
//   * The project_type enum is locked literal and order-significant. Tests
//     verify exact equality; widening the taxonomy requires editing this
//     literal AND the schema (state/PROJECT.schema.json) in lockstep.
//   * `runQuestionnaire` enforces globally-unique ids across the array. Two
//     branches naturally want a "language" question, and two naturally want a
//     "deployment_target". We namespace per-branch (cli_language /
//     library_language, web_deployment_target / ml_deployment_target) so each
//     prompt's wording stays specific to the project type without colliding.

export const PROJECT_TYPES = Object.freeze([
  'web-saas',
  'cli-tool',
  'data-pipeline',
  'ml-model',
  'library',
  'other',
]);

export const COMMON_QUESTIONS = Object.freeze([
  // TASK-046 — Discovery-first intake: the four definition questions lead the
  // wizard so the operator defines WHAT they are building before the project is
  // named and classified. All four are type:'string', no `when` predicate (asked
  // of every project type). Comma-separated answers for goals/scope_in/scope_out
  // are normalized into arrays by bin/init.js normalizeDefinitionAnswers() before
  // writeProjectMd is called. An empty answer is accepted here (the field is
  // optional prose); the normalizer converts '' → [] which writeProjectMd renders
  // as no heading (TASK-045 empty-omission guard).
  {
    id: 'problem_statement',
    type: 'string',
    prompt: 'What problem are you solving? (one or two sentences)',
  },
  {
    id: 'goals',
    type: 'string',
    required: false,
    prompt: 'Key goals (comma-separated, or press Enter to skip)',
  },
  {
    id: 'scope_in',
    type: 'string',
    required: false,
    prompt: 'In scope (comma-separated, or press Enter to skip)',
  },
  {
    id: 'scope_out',
    type: 'string',
    required: false,
    prompt: 'Out of scope / non-goals (comma-separated, or press Enter to skip)',
  },
  {
    id: 'project_name',
    type: 'string',
    prompt: 'Project name (short, kebab-case preferred)',
  },
  {
    id: 'project_description',
    type: 'string',
    prompt: 'One sentence describing what this project does',
  },
  {
    id: 'project_type',
    type: 'enum',
    enum: [...PROJECT_TYPES],
    prompt: 'What kind of project is this?',
  },
  {
    id: 'target_users',
    type: 'string',
    prompt: 'Who is this for? (primary audience)',
  },
  {
    id: 'primary_use_cases',
    type: 'multi',
    enum: [
      'data-entry',
      'reporting',
      'integration',
      'automation',
      'collaboration',
      'other',
    ],
    prompt:
      'Primary use cases (comma-separated; pick from the listed values)',
  },
  {
    id: 'success_criteria',
    type: 'string',
    prompt: 'How will you know this project succeeded? (one sentence)',
  },
  // TASK-036 — optional per-agent model overrides. `required: false` allows
  // the user to skip by pressing Enter; skipping writes NO agent_models key to
  // PROJECT.md. Defaults: reviewer=fable, developer=sonnet, researcher=sonnet.
  // A non-empty answer must be comma/space-separated agent=model pairs; the
  // validate hook rejects malformed pairs, unknown agents, and invalid model
  // values with an error naming the offender (the engine re-prompts).
  {
    id: 'agent_models',
    type: 'string',
    required: false,
    prompt:
      'Per-agent model overrides (optional, e.g. reviewer=opus developer=haiku).\n' +
      'Defaults: reviewer=fable, developer=sonnet, researcher=sonnet.\n' +
      'Press Enter to keep defaults (writes no agent_models key)',
    validate(value) {
      // The engine only calls this for non-empty input (required:false empty
      // short-circuits to a skip before the hook). Defensive empty check anyway.
      if (typeof value !== 'string' || value.trim().length === 0) return null;
      try {
        parseAgentModelsAnswer(value);
        return null; // valid
      } catch (err) {
        return err.message;
      }
    },
  },
]);

// ---------------------------------------------------------------------------
// TASK-036 — agent_models pair-syntax parsing + validation. Shared between the
// wizard question's validate hook above and bin/init.js's answer
// normalization (string answer → object map before writeProjectMd).
// ---------------------------------------------------------------------------

const AGENT_MODEL_ALIASES = new Set(['sonnet', 'opus', 'haiku', 'fable', 'inherit']);
const AGENT_MODEL_FULL_ID_RE = /^claude-[a-z0-9-]+$/;
const AGENT_MODEL_AGENTS = new Set(['reviewer', 'developer', 'researcher']);

/**
 * Parse a comma/space-separated list of agent=model pairs (the wizard answer
 * format, e.g. "reviewer=opus, developer=haiku") into an object map.
 * Throws with an error naming the offender on: a token without '=', an
 * unknown agent name, an invalid model value, or a duplicate agent.
 *
 * @param {string} raw - the wizard answer string (non-empty after trim)
 * @returns {Record<string, string>} agent → model map
 */
export function parseAgentModelsAnswer(raw) {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (trimmed.length === 0) {
    throw new Error('agent_models answer is empty — nothing to parse');
  }
  const out = {};
  const tokens = trimmed.split(/[\s,]+/).filter((t) => t.length > 0);
  for (const token of tokens) {
    const eq = token.indexOf('=');
    if (eq === -1) {
      throw new Error(
        `malformed agent=model pair "${token}" — expected e.g. reviewer=opus`,
      );
    }
    const agent = token.slice(0, eq).trim();
    const model = token.slice(eq + 1).trim();
    if (!AGENT_MODEL_AGENTS.has(agent)) {
      throw new Error(
        `unknown agent name "${agent}" — valid agents: ${[...AGENT_MODEL_AGENTS].join(', ')}`,
      );
    }
    if (!AGENT_MODEL_ALIASES.has(model) && !AGENT_MODEL_FULL_ID_RE.test(model)) {
      throw new Error(
        `invalid model value "${model}" for agent "${agent}" — must be one of ` +
        `${[...AGENT_MODEL_ALIASES].join(', ')} or a full model ID matching /^claude-[a-z0-9-]+$/`,
      );
    }
    if (Object.prototype.hasOwnProperty.call(out, agent)) {
      throw new Error(`duplicate agent "${agent}" in agent_models answer`);
    }
    out[agent] = model;
  }
  return out;
}

// Helper that builds a `when` predicate matching exactly one project_type.
// Each predicate is a fresh function instance — required by tests asserting
// `typeof q.when === 'function'` AND that it returns false for every other
// type in the frozen taxonomy.
function whenType(type) {
  return (a) => a.project_type === type;
}

const WEB_SAAS = [
  {
    id: 'frontend_framework',
    type: 'enum',
    enum: ['react', 'vue', 'svelte', 'angular', 'other'],
    prompt: 'Which frontend framework?',
    when: whenType('web-saas'),
  },
  {
    id: 'backend_framework',
    type: 'enum',
    enum: ['node-express', 'node-fastify', 'fastapi', 'django', 'rails', 'go', 'other'],
    prompt: 'Which backend framework?',
    when: whenType('web-saas'),
  },
  {
    id: 'database',
    type: 'enum',
    enum: ['postgres', 'mysql', 'sqlite', 'mongodb', 'dynamodb', 'other'],
    prompt: 'Which primary datastore?',
    when: whenType('web-saas'),
  },
  {
    id: 'web_deployment_target',
    type: 'enum',
    enum: ['fly-io', 'vercel', 'aws', 'gcp', 'azure', 'self-host', 'other'],
    prompt: 'Where will the web app run?',
    when: whenType('web-saas'),
  },
];

const CLI_TOOL = [
  {
    id: 'cli_language',
    type: 'enum',
    enum: ['node', 'python', 'go', 'rust', 'other'],
    prompt: 'Which language for the CLI?',
    when: whenType('cli-tool'),
  },
  {
    id: 'distribution_channel',
    type: 'enum',
    enum: ['npm', 'pypi', 'homebrew', 'github-release', 'other'],
    prompt: 'How will users install the CLI?',
    when: whenType('cli-tool'),
  },
  {
    id: 'command_structure',
    type: 'enum',
    enum: ['single-command', 'subcommands', 'interactive-repl'],
    prompt: 'Command surface shape?',
    when: whenType('cli-tool'),
  },
];

const DATA_PIPELINE = [
  {
    id: 'data_sources',
    type: 'string',
    prompt: 'Where does the data come from? (e.g. S3, Postgres, Kafka)',
    when: whenType('data-pipeline'),
  },
  {
    id: 'processing_framework',
    type: 'enum',
    enum: ['airflow', 'prefect', 'dagster', 'spark', 'pandas', 'dbt', 'other'],
    prompt: 'Which processing framework?',
    when: whenType('data-pipeline'),
  },
  {
    id: 'output_destinations',
    type: 'string',
    prompt: 'Where does processed data land? (e.g. warehouse, S3, API)',
    when: whenType('data-pipeline'),
  },
];

const ML_MODEL = [
  {
    id: 'model_family',
    type: 'enum',
    enum: ['classical', 'deep-learning', 'transformer-llm', 'other'],
    prompt: 'Which model family?',
    when: whenType('ml-model'),
  },
  {
    id: 'ml_data_source',
    type: 'string',
    prompt: 'Where does the training data come from?',
    when: whenType('ml-model'),
  },
  {
    id: 'training_approach',
    type: 'enum',
    enum: ['from-scratch', 'fine-tune', 'prompt-only', 'other'],
    prompt: 'Training approach?',
    when: whenType('ml-model'),
  },
  {
    id: 'ml_deployment_target',
    type: 'enum',
    enum: ['batch', 'online-api', 'edge', 'notebook-only', 'other'],
    prompt: 'How will the model be served?',
    when: whenType('ml-model'),
  },
];

const LIBRARY = [
  {
    id: 'library_language',
    type: 'enum',
    enum: ['javascript', 'typescript', 'python', 'go', 'rust', 'other'],
    prompt: 'Which language for the library?',
    when: whenType('library'),
  },
  {
    id: 'audience',
    type: 'string',
    prompt: 'Who consumes the library? (e.g. internal teams, public)',
    when: whenType('library'),
  },
  {
    id: 'package_manager',
    type: 'enum',
    enum: ['npm', 'pypi', 'cargo', 'go-modules', 'other'],
    prompt: 'Which package registry?',
    when: whenType('library'),
  },
];

const OTHER = [
  {
    id: 'architecture_description',
    type: 'string',
    prompt: 'Describe the architecture in a sentence or two',
    when: whenType('other'),
  },
];

export const TYPE_SPECIFIC_QUESTIONS = Object.freeze({
  'web-saas': WEB_SAAS,
  'cli-tool': CLI_TOOL,
  'data-pipeline': DATA_PIPELINE,
  'ml-model': ML_MODEL,
  'library': LIBRARY,
  'other': OTHER,
});

/**
 * Build the full intake array: common questions first, then type-specific in
 * the canonical taxonomy order. Concatenation order is deterministic — the
 * test asserts intake[0..N-1] mirrors COMMON_QUESTIONS exactly.
 *
 * @returns {Array<object>} array of question definitions for runQuestionnaire
 */
export function buildIntakeQuestions() {
  const out = [...COMMON_QUESTIONS];
  for (const type of PROJECT_TYPES) {
    out.push(...TYPE_SPECIFIC_QUESTIONS[type]);
  }
  return out;
}
