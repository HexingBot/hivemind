// src/agent-generator.js
// TASK-013 — emit `.claude/agents/project-context.md` from PROJECT.md (or from
// an injected `answers` map) so every subagent reads the same stack-aware
// briefing before starting work.
//
// The single-file design is locked by the ticket: three base agents
// (developer/reviewer/researcher) capture specialist roles, and this one
// generated file captures stack + project type. (TASK-032: the orchestrator
// agent file was removed; the Orchestrator is the main session thread.) A
// future contributor adds a new project_type by appending one entry to
// `TYPE_SPECIFIC_GUIDANCE` below — the per-type body lives in this module
// rather than fanning out across N templated files so the surface stays one
// literal long.
//
// File layout (mirrors what tests/agent-generator.spec.js asserts):
//   ---
//   project_name: ...
//   project_type: ...
//   generated_at: ...
//   schema_version: 1
//   ---
//
//   ## Stack
//   - key: value
//   - ...
//
//   ## Testing conventions
//   <prose>
//
//   ## Linting and formatting
//   <prose>
//
//   ## Type-specific guidance
//   - <bullet>
//   - ...

import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { atomicWriteFile } from './atomic-write.js';
import { readProjectMd } from './project-md.js';
import { rejectControlChars, escapeMarkdownStructure, renderBulletLines } from './intake-sanitizer.js';

const PROJECT_CONTEXT_REL = ['.claude', 'agents', 'project-context.md'];
const SCHEMA_VERSION = 1;

// Frontmatter answer ids are surfaced in YAML, not in the Stack body. Anything
// not listed here (and not a synthesized timestamp/schema field) lands in the
// Stack section.
const FRONTMATTER_IDS = new Set(['project_name', 'project_type']);

// Round-trip noise that readProjectMd may include in answers but that does
// NOT belong in the regenerated project-context.md. Keep this list narrow:
// genuinely user-supplied stack keys must pass through to `## Stack`.
const ROUNDTRIP_NOISE_IDS = new Set([
  'project_description',
  'target_users',
  'primary_use_cases',
  'success_criteria',
  'created_at',
  'schema_version',
  // TASK-036 — agent_models is project config, not a stack entry.
  'agent_models',
  // TASK-045 — definition fields are rendered in their own ## Problem section
  // below; they must not appear as Stack bullets.
  'problem_statement',
  'goals',
  'scope_in',
  'scope_out',
]);

// Per-project_type guidance bullets. Adding a new project_type means appending
// one entry here. Each value MUST contain at least 3 bullets and at least one
// type-relevant keyword (see tests/agent-generator.spec.js TYPE_KEYWORDS). The
// production map carries 4 bullets per type so a tightening of the spec
// minimum from 3 to 4 doesn't break us.
const TYPE_SPECIFIC_GUIDANCE = Object.freeze({
  'web-saas': [
    'Treat the browser and the backend as separate trust boundaries — never assume client-supplied data is well-formed at HTTP entry points.',
    'Reach for end-to-end tests sparingly; cover routing and frontend state-transition logic with focused integration tests at the boundary.',
    'Sessions and auth tokens are sensitive — never log them, and isolate any HTTP middleware that touches them behind a small, reviewable surface.',
    'Performance budgets matter: measure both server latency and browser time-to-interactive when changing data-fetch patterns.',
  ],
  'cli-tool': [
    'Treat stdin, stdout, and stderr as the public API — output schema changes are breaking changes for downstream piped consumers.',
    'Exit codes carry contract weight: 0 means success, non-zero means failure, and the specific code should be stable across releases.',
    'Detect whether the process attaches to a TTY before emitting color or progress UI — non-interactive shells need plain, parseable output.',
    'Validate argv shape early and fail with a one-line usage hint rather than a stack trace; users see only what is printed.',
  ],
  'data-pipeline': [
    'Distinguish batch and stream execution paths explicitly — they have different failure semantics and different idempotency guarantees.',
    'Schema validation belongs at the ingest boundary; a malformed row should be quarantined, not silently coerced downstream.',
    'Idempotent writes are non-negotiable for any step that can be retried — design every sink around upsert-by-key, not blind append.',
    'Watch throughput and per-stage latency; a 10x slowdown in one stage often hides a schema drift or a runaway upstream source.',
  ],
  'ml-model': [
    'Pin the dataset version alongside the model version — reproducibility is the metric that makes every other metric trustworthy.',
    'Notebook experiments are exploratory by nature; promote any reusable transform out of the notebook before it becomes load-bearing.',
    'Evaluation metrics should be computed on a held-out split that the training loop has never observed, including during hyperparameter search.',
    'Document the eval harness: which split, which metric, which baseline. A model without a recorded baseline is a model without a verdict.',
  ],
  'library': [
    'Treat every exported symbol as part of the public API — adding one is cheap, removing or renaming one is a semver-major change.',
    'Backwards compatibility is a feature, not an afterthought. Deprecate first, remove later, and document the migration path in the changelog.',
    'Consumer-facing types and error shapes are part of the contract; widening a return type is fine, narrowing it is breaking.',
    'Avoid runtime dependencies wherever a small built-in alternative exists — every transitive dep is something a consumer inherits.',
  ],
  'other': [
    'No project-type-specific assumptions apply — default to conservative, generic engineering practice until the stack reveals itself.',
    'Stack details were left unspecified at intake; ask the human (or update PROJECT.md) before making non-trivial architectural decisions.',
    'Prefer the simplest tool that solves the problem; do not import a framework when a 20-line helper would do.',
    'When in doubt, write the test first — the unspecified domain is exactly the case where tests pin down intent fastest.',
  ],
});

/**
 * Generate `.claude/agents/project-context.md` for the project at `repoRoot`.
 *
 * When `answers` is supplied, the PROJECT.md read is skipped entirely — this
 * is the path bin/init.js takes in the created/forced branches so the generator
 * runs off the in-memory intake answers without round-tripping through disk.
 * When `answers` is omitted, the function calls readProjectMd and uses the
 * parsed answers map; a missing PROJECT.md raises a clear named-file error.
 *
 * @param {object} opts
 * @param {string} opts.repoRoot
 * @param {object} [opts.answers]
 * @param {() => string} [opts.now]
 * @returns {Promise<{path: string}>}
 */
export async function generateProjectContext({
  repoRoot,
  answers,
  now = () => new Date().toISOString(),
}) {
  let resolvedAnswers = answers;
  if (resolvedAnswers === undefined || resolvedAnswers === null) {
    const projectMdPath = join(repoRoot, 'PROJECT.md');
    try {
      const parsed = await readProjectMd({ repoRoot });
      resolvedAnswers = parsed.answers;
    } catch (err) {
      // Normalize whatever readProjectMd throws into a single-shape error that
      // names the missing file. This keeps the caller surface predictable
      // regardless of whether the failure was a missing file vs. a malformed
      // frontmatter; the spec only requires the message contains "PROJECT.md".
      throw new Error(
        `generateProjectContext: cannot read PROJECT.md at ${projectMdPath} ` +
        `(supply an explicit answers argument or run the init wizard first) — ${err.message}`,
      );
    }
  }

  const target = join(repoRoot, ...PROJECT_CONTEXT_REL);
  mkdirSync(dirname(target), { recursive: true });

  const body = renderProjectContext(resolvedAnswers, now());
  await atomicWriteFile(target, body);
  return { path: target };
}

function renderProjectContext(answers, generatedAt) {
  const projectName = answers.project_name ?? '';
  const projectType = answers.project_type ?? 'other';

  const out = [];
  // --- Frontmatter ---
  out.push('---');
  out.push(`project_name: ${projectName}`);
  out.push(`project_type: ${projectType}`);
  out.push(`generated_at: ${generatedAt}`);
  out.push(`schema_version: ${SCHEMA_VERSION}`);
  out.push('---');
  out.push('');

  // --- ## Problem (definition block: problem_statement, goals, scope_in, scope_out) ---
  // TASK-045 — surface the project definition so subagents understand the
  // problem context before starting work. Each sub-field is rendered only when
  // it is present and non-empty; the entire section is omitted when all four
  // are absent, so existing projects that lack the new fields see no change.
  const hasProblem = answers.problem_statement && String(answers.problem_statement).length > 0;
  const hasGoals = Array.isArray(answers.goals) && answers.goals.length > 0;
  const hasScopeIn = Array.isArray(answers.scope_in) && answers.scope_in.length > 0;
  const hasScopeOut = Array.isArray(answers.scope_out) && answers.scope_out.length > 0;
  if (hasProblem || hasGoals || hasScopeIn || hasScopeOut) {
    out.push('## Problem');
    // TASK-158 — SECURITY: this whole block renders untrusted intake prose.
    // escapeMarkdownStructure neutralizes any line-start `#`/``` marker so it
    // cannot forge a new framework-authored heading/fence; renderBulletLines
    // does the same per bullet item AND re-indents any embedded continuation
    // line so it stays attached to its own bullet rather than breaking out
    // into a free-standing, unattributed directive-shaped paragraph
    // (probe P8).
    if (hasProblem) {
      out.push(escapeMarkdownStructure(String(answers.problem_statement)));
      out.push('');
    }
    if (hasGoals) {
      out.push('### Goals');
      for (const g of answers.goals) out.push(...renderBulletLines(g));
      out.push('');
    }
    if (hasScopeIn) {
      out.push('### Scope (in)');
      for (const s of answers.scope_in) out.push(...renderBulletLines(s));
      out.push('');
    }
    if (hasScopeOut) {
      out.push('### Scope (out)');
      for (const s of answers.scope_out) out.push(...renderBulletLines(s));
      out.push('');
    }
  }

  // --- ## Stack ---
  out.push('## Stack');
  const stackEntries = [];
  for (const [key, value] of Object.entries(answers)) {
    if (FRONTMATTER_IDS.has(key)) continue;
    if (ROUNDTRIP_NOISE_IDS.has(key)) continue;
    stackEntries.push([key, value]);
  }
  if (stackEntries.length === 0) {
    out.push('- (none specified)');
  } else {
    for (const [key, value] of stackEntries) {
      // TASK-158 — SECURITY: same single-line-context guard as
      // project-md.js's Stack loop — generateProjectContext can be called
      // with a fresh `answers` map directly (bypassing writeProjectMd), so
      // it must independently reject a newline-bearing Stack key/value
      // before it can forge new markdown lines/headings/fences (probe P3).
      rejectControlChars(key, `Stack key "${key}"`);
      const valuesToCheck = Array.isArray(value) ? value : [value];
      for (const v of valuesToCheck) {
        rejectControlChars(typeof v === 'string' ? v : String(v), `Stack value for "${key}"`);
      }
      out.push(`- ${key}: ${formatStackValue(value)}`);
    }
  }
  out.push('');

  // --- ## Testing conventions ---
  out.push('## Testing conventions');
  out.push(
    'Use the testing tool that fits this stack — the project standard is to keep a fast unit suite ' +
    'runnable via the project\'s default test command, and to write a failing test before any new ' +
    'behavior lands. Tests live next to the code they exercise (or under a top-level tests/ tree, ' +
    'whichever already exists in this repo); follow the local convention rather than introducing ' +
    'a new one.',
  );
  out.push('');

  // --- ## Linting and formatting ---
  out.push('## Linting and formatting');
  out.push(
    'Run the project\'s linter and formatter before every commit. If the repo ships a config ' +
    '(e.g., .eslintrc, ruff.toml, .prettierrc, gofmt defaults), defer to it without arguing; if ' +
    'no config exists yet, use the ecosystem-standard tool and add a minimal config rather than ' +
    'reformatting the whole tree in a drive-by change.',
  );
  out.push('');

  // --- ## Type-specific guidance ---
  out.push('## Type-specific guidance');
  const bullets = TYPE_SPECIFIC_GUIDANCE[projectType] ?? TYPE_SPECIFIC_GUIDANCE['other'];
  for (const bullet of bullets) {
    out.push(`- ${bullet}`);
  }
  out.push('');

  return out.join('\n');
}

function formatStackValue(value) {
  if (Array.isArray(value)) {
    return value.map((v) => String(v)).join(', ');
  }
  return String(value);
}

// ---------------------------------------------------------------------------
// TASK-036 — applyAgentModels: surgical frontmatter model-line patcher
// ---------------------------------------------------------------------------

// Valid model aliases (must stay in sync with state/PROJECT.schema.json).
const VALID_MODEL_ALIASES = new Set(['sonnet', 'opus', 'haiku', 'fable', 'inherit']);
const VALID_FULL_MODEL_ID_RE = /^claude-[a-z0-9-]+$/;
// Recognized agent names in the map (no orchestrator — it is the main thread).
const VALID_AGENT_NAMES_FOR_APPLY = new Set(['reviewer', 'developer', 'researcher']);

/**
 * Apply an agent_models map by patching the `model:` line in each agent's
 * YAML frontmatter (or inserting it after `description:` when absent).
 *
 * Validation happens BEFORE any file is written — an invalid agent name or
 * model value throws without touching disk.
 *
 * Parity: when `<repoRoot>/agents/` exists (the dev-repo parity dir) the
 * patch is applied to both `.claude/agents/` and `agents/`.
 *
 * @param {object} opts
 * @param {string} opts.repoRoot - absolute path to the repository root
 * @param {object} opts.agentModels - map of agent name → model alias/ID
 * @returns {Promise<string[]>} absolute paths of changed files
 */
export async function applyAgentModels({ repoRoot, agentModels }) {
  // ---- Pre-write validation ----
  for (const [agentName, modelValue] of Object.entries(agentModels)) {
    if (!VALID_AGENT_NAMES_FOR_APPLY.has(agentName)) {
      throw new Error(
        `applyAgentModels: invalid/unknown agent name "${agentName}". ` +
        `Valid agent names are: ${[...VALID_AGENT_NAMES_FOR_APPLY].join(', ')}`,
      );
    }
    if (!VALID_MODEL_ALIASES.has(modelValue) && !VALID_FULL_MODEL_ID_RE.test(modelValue)) {
      throw new Error(
        `applyAgentModels: invalid model value "${modelValue}" for agent "${agentName}". ` +
        `Must be one of ${[...VALID_MODEL_ALIASES].join(', ')} or match /^claude-[a-z0-9-]+$/`,
      );
    }
  }

  const claudeAgentsDir = join(repoRoot, '.claude', 'agents');
  const parityAgentsDir = join(repoRoot, 'agents');
  const hasParityDir = existsSync(parityAgentsDir);

  const changedFiles = [];

  for (const [agentName, modelValue] of Object.entries(agentModels)) {
    const targets = [join(claudeAgentsDir, `${agentName}.md`)];
    if (hasParityDir) {
      targets.push(join(parityAgentsDir, `${agentName}.md`));
    }

    for (const targetPath of targets) {
      if (!existsSync(targetPath)) {
        // Agent file not present — skip silently (user project may not have
        // all agents; the parity copy may not exist for every agent).
        continue;
      }
      const raw = readFileSync(targetPath, 'utf8');
      const patched = patchAgentModelContent(raw, modelValue);
      if (patched === null) {
        // Missing or unterminated YAML frontmatter — skip with a warning, do
        // NOT rewrite, do NOT report as changed (TASK-036 review ruling 3iii/4:
        // never prepend frontmatter onto a file that has none).
        // eslint-disable-next-line no-console
        console.warn(
          `applyAgentModels: skipping ${targetPath} — missing or unterminated YAML frontmatter`,
        );
        continue;
      }
      if (patched === raw) {
        // model: already at the target value — nothing changed, nothing to report.
        continue;
      }
      await atomicWriteFile(targetPath, patched);
      changedFiles.push(targetPath);
    }
  }

  return changedFiles;
}

/**
 * Return `text` with ONLY the `model:` line inside the YAML frontmatter block
 * updated (or inserted immediately after the `description:` line when absent;
 * appended as the last frontmatter line when there is no description line).
 * Every byte outside that single line — including mixed line endings anywhere
 * in the file — is preserved verbatim: the patch is a targeted string splice
 * on the frontmatter substring, never a split/rejoin of the whole file
 * (TASK-036 review ruling 3i).
 *
 * Returns null when the file has no leading `---` fence or no closing fence
 * (malformed frontmatter) — callers must skip such files without rewriting.
 *
 * @param {string} text - the raw file content
 * @param {string} modelValue - the model alias or full ID to write
 * @returns {string|null} the patched content, or null to signal "skip"
 */
function patchAgentModelContent(text, modelValue) {
  // Opening fence must be the very first line.
  const open = text.match(/^---(\r?\n)/);
  if (!open) return null;
  const fmStart = open[0].length;

  // Closing fence: the first subsequent line that is exactly `---`.
  const rest = text.slice(fmStart);
  const close = rest.match(/(^|\r?\n)---(\r?\n|$)/);
  if (!close) return null;

  // inner = the frontmatter lines, each carrying its own original EOL bytes.
  const innerEnd = fmStart + close.index + close[1].length;
  const inner = text.slice(fmStart, innerEnd);

  let newInner;
  const modelRe = /^model:[^\r\n]*/m;
  if (modelRe.test(inner)) {
    // Replace just the line's content; its EOL bytes are untouched.
    newInner = inner.replace(modelRe, `model: ${modelValue}`);
  } else {
    const descMatch = inner.match(/^description:[^\r\n]*(\r?\n)/m);
    if (descMatch) {
      // Insert immediately after the description: line, reusing ITS EOL style.
      const insertAt = descMatch.index + descMatch[0].length;
      const eol = descMatch[1];
      newInner = inner.slice(0, insertAt) + `model: ${modelValue}${eol}` + inner.slice(insertAt);
    } else {
      // No description line — append as the last frontmatter line, using the
      // opening fence's EOL style.
      newInner = inner + `model: ${modelValue}${open[1]}`;
    }
  }

  return text.slice(0, fmStart) + newInner + text.slice(innerEnd);
}

// ---------------------------------------------------------------------------
// TASK-091 — developer Bash allowlist: generateDeveloperToolsLine +
// applyDeveloperPermissions. Same home as applyAgentModels above (this module
// already owns generated agent frontmatter/guidance; folding the allowlist
// patcher in here avoids splitting near-identical frontmatter-splice logic
// across two files for one extra exported pair of functions).
// ---------------------------------------------------------------------------

// Non-Bash tools carried on agents/developer.md's frontmatter today — every
// generated tools: line preserves these five exactly; only the bare `Bash`
// entry is replaced by a scoped Bash(...) allowlist.
const DEVELOPER_NON_BASH_TOOLS = Object.freeze(['Read', 'Write', 'Edit', 'Grep', 'Glob', 'mcp__github__*']);

// Always-included Bash prefixes regardless of declared stack.
const CORE_DEVELOPER_BASH = Object.freeze(['Bash(git:*)', 'Bash(npm:*)', 'Bash(node:*)', 'Bash(npx:*)']);

// Data-driven per-stack additions, keyed by a `dev_stack` token. `dev_stack`
// is a plain PROJECT.md ## Stack-section entry (e.g. `- dev_stack: [python]`)
// — no schema change is needed, since the Stack section already round-trips
// arbitrary keys and inline arrays losslessly (see project-md.js). Adding a
// new stack means appending one entry here.
const STACK_BASH_ADDITIONS = Object.freeze({
  node: ['Bash(vitest:*)'],
  vue: ['Bash(vitest:*)'],
  react: ['Bash(vitest:*)'],
  python: ['Bash(python:*)', 'Bash(pip:*)', 'Bash(pytest:*)'],
  go: ['Bash(go:*)'],
  rust: ['Bash(cargo:*)'],
  ruby: ['Bash(ruby:*)', 'Bash(bundle:*)', 'Bash(rspec:*)'],
  java: ['Bash(mvn:*)', 'Bash(gradle:*)'],
});

/**
 * Normalize a `dev_stack` value (array, or a comma-separated string as free
 * Stack-section text may supply) into a string[] of tokens, validating each
 * against STACK_BASH_ADDITIONS. Throws BEFORE any file is touched when a
 * token is not recognized, naming the offending value — mirrors
 * applyAgentModels's pre-write validation above.
 */
function normalizeDevStack(devStack) {
  if (devStack === undefined || devStack === null) return [];
  const arr = Array.isArray(devStack)
    ? devStack
    : String(devStack).split(',').map((s) => s.trim()).filter(Boolean);
  for (const token of arr) {
    if (!Object.prototype.hasOwnProperty.call(STACK_BASH_ADDITIONS, token)) {
      throw new Error(
        `generateDeveloperToolsLine: invalid/unknown dev_stack value "${token}". ` +
        `Known stack values: ${Object.keys(STACK_BASH_ADDITIONS).join(', ')}`,
      );
    }
  }
  return arr;
}

/**
 * Derive the developer.md `tools:` frontmatter value from a `dev_stack` list.
 * Core Bash prefixes (git/npm/node/npx) are always present; stack-specific
 * additions are appended in dev_stack's declared order, de-duplicated across
 * tokens that map to the same pattern (e.g. vue + react both want vitest).
 * Throws on an unrecognized stack token before returning anything (the
 * pre-write gate applyDeveloperPermissions below relies on).
 *
 * @param {object} opts
 * @param {string[]|string} [opts.devStack] - stack tokens (array, or a
 *   comma-separated string)
 * @returns {string} the full `tools:` value
 */
export function generateDeveloperToolsLine({ devStack } = {}) {
  const normalized = normalizeDevStack(devStack);
  const bashPatterns = [...CORE_DEVELOPER_BASH];
  for (const token of normalized) {
    for (const pattern of STACK_BASH_ADDITIONS[token]) {
      if (!bashPatterns.includes(pattern)) bashPatterns.push(pattern);
    }
  }
  return [...DEVELOPER_NON_BASH_TOOLS, ...bashPatterns].join(', ');
}

/**
 * Apply the generated tools: line to agents/developer.md (and the
 * plugin-root parity copy when present), surgically patching ONLY the
 * tools: frontmatter line. Validation (inside generateDeveloperToolsLine)
 * runs BEFORE any file is touched.
 *
 * @param {object} opts
 * @param {string} opts.repoRoot
 * @param {string[]|string} [opts.devStack]
 * @returns {Promise<string[]>} absolute paths of changed files
 */
export async function applyDeveloperPermissions({ repoRoot, devStack } = {}) {
  const toolsLine = generateDeveloperToolsLine({ devStack });

  const claudeAgentsDir = join(repoRoot, '.claude', 'agents');
  const parityAgentsDir = join(repoRoot, 'agents');
  const hasParityDir = existsSync(parityAgentsDir);

  const targets = [join(claudeAgentsDir, 'developer.md')];
  if (hasParityDir) targets.push(join(parityAgentsDir, 'developer.md'));

  const changedFiles = [];
  for (const targetPath of targets) {
    if (!existsSync(targetPath)) continue;
    const raw = readFileSync(targetPath, 'utf8');
    const patched = patchAgentToolsContent(raw, toolsLine);
    if (patched === null) {
      // eslint-disable-next-line no-console
      console.warn(
        `applyDeveloperPermissions: skipping ${targetPath} — missing or unterminated YAML frontmatter`,
      );
      continue;
    }
    if (patched === raw) continue;
    await atomicWriteFile(targetPath, patched);
    changedFiles.push(targetPath);
  }
  return changedFiles;
}

/**
 * Return `text` with ONLY the `tools:` line inside the YAML frontmatter block
 * updated (or inserted — immediately after `model:` when present, else
 * immediately after `description:`, else appended as the last frontmatter
 * line). Mirrors patchAgentModelContent's surgical-splice guarantee: every
 * other byte, including mixed line endings anywhere in the file, is
 * preserved. Returns null for malformed/absent frontmatter — callers must
 * skip such files without rewriting.
 */
function patchAgentToolsContent(text, toolsLine) {
  const open = text.match(/^---(\r?\n)/);
  if (!open) return null;
  const fmStart = open[0].length;

  const rest = text.slice(fmStart);
  const close = rest.match(/(^|\r?\n)---(\r?\n|$)/);
  if (!close) return null;

  const innerEnd = fmStart + close.index + close[1].length;
  const inner = text.slice(fmStart, innerEnd);

  let newInner;
  const toolsRe = /^tools:[^\r\n]*/m;
  if (toolsRe.test(inner)) {
    newInner = inner.replace(toolsRe, `tools: ${toolsLine}`);
  } else {
    const modelMatch = inner.match(/^model:[^\r\n]*(\r?\n)/m);
    const descMatch = inner.match(/^description:[^\r\n]*(\r?\n)/m);
    if (modelMatch) {
      const insertAt = modelMatch.index + modelMatch[0].length;
      const eol = modelMatch[1];
      newInner = inner.slice(0, insertAt) + `tools: ${toolsLine}${eol}` + inner.slice(insertAt);
    } else if (descMatch) {
      const insertAt = descMatch.index + descMatch[0].length;
      const eol = descMatch[1];
      newInner = inner.slice(0, insertAt) + `tools: ${toolsLine}${eol}` + inner.slice(insertAt);
    } else {
      newInner = inner + `tools: ${toolsLine}${open[1]}`;
    }
  }

  return text.slice(0, fmStart) + newInner + text.slice(innerEnd);
}
