#!/usr/bin/env node
// bin/init.js
// TASK-012 — project-intake wizard entrypoint. Four-branch state machine:
//   1. already_initialized — PROJECT.md present, no --force: print summary, exit.
//   2. forced               — --force passed: fresh bundle, overwrite PROJECT.md.
//   3. resumed              — pointer + bundle + intake.json present: reuse the
//                             active session, runQuestionnaire resumes from the
//                             persisted answers via persistTo.
//   4. created              — fresh repo: startSession spins up a new bundle.
//
// Design notes:
//   * `runInit` is testable in isolation — argv, prompter, repoRoot, and `now`
//     are injected. Tests pass `hostname: 'test-host'` but the parameter is
//     intentionally ignored (extra keys are silently dropped). startSession()
//     owns host identification through its manifest; carrying a duplicate
//     hostname channel through runInit would invite drift.
//   * Branch order matters: --force is checked BEFORE the PROJECT.md guard so
//     "force re-init on an initialized repo" works. The PROJECT.md guard runs
//     BEFORE the resume guard so a completed init never re-prompts even if a
//     pointer happens to still be on disk. Resume runs BEFORE create so a
//     half-finished wizard does not get clobbered by a fresh bundle.
//   * The engine-shape prompter `({prompt, type, enum?, error?}) => string` is
//     forwarded directly (no adaptation) — runInit's contract IS the engine
//     contract, unlike bin/new-task.js which wraps a legacy (text)=>string.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import { startSession } from '../src/lifecycle.js';
import { readPointer } from '../src/pointer.js';
import { runQuestionnaire } from '../src/question-engine.js';
import { buildIntakeQuestions } from '../src/question-library.js';
import { writeProjectMd, readProjectMd } from '../src/project-md.js';
import { generateProjectContext, applyAgentModels } from '../src/agent-generator.js';
import { seedBacklog } from '../src/backlog-seeder.js';
import { generateUseCaseSuite } from '../src/use-case-specs.js';
import { archiveFrameworkHistory } from '../src/framework-history.js';
import { resolveRepoRoot } from '../src/repo-root.js';
import {
  writeOrchestratorRouting,
  hasRoutingBlock,
  readProjectClaudeMd,
} from '../src/claude-md.js';

const KNOWN_FLAGS = new Set([
  '--force',
  '--help',
  '--no-archive',
  '--answers-file',
  '--claude-md-consent',
  '--apply-models',
]);
// Flags that consume the FOLLOWING argv token as their value (so the value
// token is not treated as an unknown positional by the strict parser).
const VALUE_FLAGS = new Set(['--answers-file']);
const TASK_FILE_RE = /^TASK-\d{3,}\.json$/;

/**
 * Parse argv. Every token must be a recognized long flag; positional tokens
 * (anything not in KNOWN_FLAGS) throw with the offending token in the message,
 * matching bin/new-task.js's strictness so typos and stray args surface fast.
 *
 * Value-taking flags (VALUE_FLAGS, e.g. --answers-file <path>) consume the next
 * token as their value; that consumed token is therefore NOT subjected to the
 * unknown-argument check (TASK-024 item 3).
 */
function parseArgs(argv) {
  const out = {
    force: false,
    help: false,
    noArchive: false,
    answersFile: null,
    claudeMdConsent: false,
    applyModels: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (!KNOWN_FLAGS.has(tok)) {
      throw new Error(`unknown argument: ${tok}`);
    }
    if (tok === '--force') out.force = true;
    if (tok === '--help') out.help = true;
    if (tok === '--no-archive') out.noArchive = true;
    if (tok === '--claude-md-consent') out.claudeMdConsent = true;
    if (tok === '--apply-models') out.applyModels = true;
    if (tok === '--answers-file') {
      const value = argv[i + 1];
      if (value === undefined || VALUE_FLAGS.has(value) || KNOWN_FLAGS.has(value)) {
        throw new Error('--answers-file requires a file path argument');
      }
      out.answersFile = value;
      i += 1; // consume the path token
    }
  }
  return out;
}

/**
 * Lightweight peek at <repoRoot>/tasks/ for the archive prompt. Returns the
 * count of TASK-NNN.json files that look like framework history (i.e. none
 * carry the `seed` label). Returns 0 when:
 *   - tasks/ is absent, OR
 *   - no TASK-NNN.json files exist, OR
 *   - any existing TASK-NNN.json carries the `seed` label.
 * Mirrors archiveFrameworkHistory's detection so the user is never prompted
 * for an archive that would no-op.
 *
 * TASK-018 — JSON.parse failures propagate with the offending filename,
 * aligning this peek with src/backlog-seeder.js#readAllTasksSync's AC3
 * behavior. Surfacing corruption here (before the archive prompt fires) keeps
 * the user out of the half-archived-repo trap the old silent swallow created.
 */
function countFrameworkHistory(repoRoot) {
  const tasksDir = join(repoRoot, 'tasks');
  if (!existsSync(tasksDir)) return 0;
  const taskFiles = readdirSync(tasksDir).filter((n) => TASK_FILE_RE.test(n));
  if (taskFiles.length === 0) return 0;
  for (const name of taskFiles) {
    let t;
    try {
      t = JSON.parse(readFileSync(join(tasksDir, name), 'utf8'));
    } catch (err) {
      throw new Error(
        `bin/init.js: failed to parse task file ${name}: ${err.message}`,
      );
    }
    if (Array.isArray(t.labels) && t.labels.includes('seed')) {
      return 0;
    }
  }
  return taskFiles.length;
}

/**
 * Ask the user whether to archive pre-existing framework-history tickets, then
 * invoke archiveFrameworkHistory on consent. Skipped entirely when:
 *   - the caller passed --no-archive, OR
 *   - the peek finds nothing to archive.
 *
 * Decision rule: empty input OR a Y/y prefix → archive; anything else → skip.
 */
async function maybeArchiveFrameworkHistory({ repoRoot, prompter, noArchive, now }) {
  if (noArchive) return;
  const count = countFrameworkHistory(repoRoot);
  if (count === 0) return;
  const answer = await prompter({
    prompt:
      `Detected ${count} pre-existing tickets that look like framework history. ` +
      'Archive them so this project starts fresh? [Y/n]',
    type: 'string',
  });
  const trimmed = typeof answer === 'string' ? answer.trim() : '';
  const consent = trimmed === '' || /^y/i.test(trimmed);
  if (!consent) return;
  await archiveFrameworkHistory({ repoRoot, now });
}

/**
 * Path to the in-bundle intake persistence file.
 */
function intakePath(repoRoot, sessionId) {
  return join(repoRoot, 'state', 'sessions', sessionId, 'intake.json');
}

/**
 * Try to read `{answers, lastAnsweredId}` from an intake.json file. Returns
 * the parsed payload on success, or null if the file is missing or unparseable.
 */
function tryReadIntake(path) {
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    if (raw && typeof raw === 'object' && raw.answers && typeof raw.answers === 'object') {
      return raw;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Required intake keys for the non-interactive answers path. The wizard always
 * collects these (they map to PROJECT.md's frontmatter); a hand-supplied answers
 * object MUST carry them or we refuse to materialize anything (TASK-024 item 2).
 * writeProjectMd also throws on these, but validating up front guarantees we
 * never half-materialize (PROJECT.md before backlog, etc.) on bad input.
 */
const REQUIRED_ANSWER_KEYS = ['project_name', 'project_type'];

function validateSuppliedAnswers(answers) {
  if (!answers || typeof answers !== 'object') {
    throw new Error('init: supplied answers must be a non-empty object');
  }
  const missing = REQUIRED_ANSWER_KEYS.filter((k) => {
    const v = answers[k];
    return v === undefined || v === null || v === '';
  });
  if (missing.length > 0) {
    throw new Error(
      `init: supplied answers are missing required key(s): ${missing.join(', ')}`,
    );
  }
}

/**
 * Materialize PROJECT.md (+ project-context + seeded backlog) from a set of
 * intake answers. Answers come from one of two sources:
 *   - interactive: runQuestionnaire drives `prompter`, persisting into the
 *     bundle's intake.json as it goes (the direct `node bin/init.js` path).
 *   - non-interactive: a pre-supplied `answers` object (the --answers-file /
 *     programmatic runInit({answers}) path) — the prompter is NEVER called and
 *     runQuestionnaire is bypassed entirely, because a slash command runs
 *     through the Bash tool with no interactive TTY (TASK-024 item 1).
 *
 * The artifact sequence (writeProjectMd -> generateProjectContext ->
 * seedBacklog, with the seedBacklog try/catch) is identical for both sources.
 */
async function runWizardAndWriteProjectMd({
  repoRoot, sessionId, prompter, now, suppliedAnswers,
}) {
  let answers;
  if (suppliedAnswers) {
    // Non-interactive: use the supplied answers verbatim. Validated by the
    // caller (runInit) before we get here, so this is a straight pass-through.
    answers = suppliedAnswers;
  } else {
    const persistTo = intakePath(repoRoot, sessionId);
    ({ answers } = await runQuestionnaire({
      questions: buildIntakeQuestions(),
      prompter,
      persistTo,
      now,
    }));
  }
  await writeProjectMd({ repoRoot, answers, now });
  // TASK-013 — emit the per-project agent briefing alongside PROJECT.md.
  // The in-memory `answers` are passed through so the generator doesn't have
  // to read back from disk; this keeps init's "write once, read never"
  // semantics intact during the wizard run.
  await generateProjectContext({ repoRoot, answers, now });
  // TASK-014 — mint the day-one starter backlog from the intake's
  // primary_use_cases. seedBacklog is idempotent via the `seed` label: a
  // --force re-run will not duplicate tickets the user has already touched.
  //
  // TASK-017 AC5 — wrap in try/catch that surfaces a user-visible warning
  // BEFORE re-throwing. PROJECT.md and project-context.md are already on disk
  // by this point; the user must learn about a half-minted backlog
  // immediately, because a partial seed corrupts the idempotency guard for
  // any future --force re-run. Silent-continue is NOT acceptable.
  try {
    await seedBacklog({ repoRoot, answers, now });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `backlog seeder failed mid-mint: ${err && err.message ? err.message : err}`,
    );
    throw err;
  }
  // TASK-029 — generate the use-case regression suite from primary_use_cases.
  // Runs after seedBacklog (both always-write artifacts land together).
  // generateUseCaseSuite is idempotent: a --force re-run never clobbers existing
  // manifest or spec files.
  //
  // Review ruling (TASK-029 fix loop) — align with seedBacklog: surface a
  // user-visible warning BEFORE re-throwing. A partially-written suite must
  // surface immediately, not after the wizard reports success.
  // Silent-continue is NOT acceptable.
  try {
    await generateUseCaseSuite({ repoRoot, answers, now });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `use-case suite generator failed: ${err && err.message ? err.message : err}`,
    );
    throw err;
  }
  return { projectMdPath: join(repoRoot, 'PROJECT.md') };
}

/**
 * Decide whether to write the orchestrator routing block into the project's
 * CLAUDE.md, then write it on consent. This is a channel SEPARATE from the
 * wizard intake answers — supplying `answers` does NOT imply consent.
 *
 * Consent rules (no-TTY-aware, PROMPT-ONCE):
 *   1. EXPLICIT SIGNAL (the `--claude-md-consent` flag OR `claude_md_consent:true`
 *      in the answers object) → write WITHOUT prompting. This is the answers-mode
 *      / slash-command path, which has no interactive TTY.
 *   2. EXISTING BLOCK → a CLAUDE.md that already carries our marker block is
 *      refreshed (replaced) WITHOUT re-prompting — PROMPT-ONCE means the prompt
 *      only ever fires for the FIRST write.
 *   3. OTHERWISE → prompt ONCE through the prompter. A 'y'-prefixed answer writes
 *      the block; anything else (including a prompter that throws because there
 *      is no TTY, e.g. the answers-mode throw-if-called prompter) leaves the file
 *      untouched. Swallowing the throw is what makes answers-mode-without-signal
 *      a clean no-op rather than a crash.
 *
 * @param {object} opts
 * @param {string} opts.repoRoot
 * @param {(ctx: object) => Promise<string>|null} opts.prompter
 * @param {boolean} opts.explicitConsent - flag or answers-key consent signal.
 */
async function maybeWriteOrchestratorRouting({ repoRoot, prompter, explicitConsent }) {
  // 1. Explicit signal → write, never prompt.
  if (explicitConsent) {
    writeOrchestratorRouting({ repoRoot });
    return;
  }

  const existing = readProjectClaudeMd(repoRoot);

  // 2. Existing marker block → refresh idempotently, never re-prompt.
  if (existing !== null && hasRoutingBlock(existing)) {
    writeOrchestratorRouting({ repoRoot });
    return;
  }

  // 3. First write, no signal → prompt once. A throwing/absent prompter (no TTY)
  //    is treated as a decline.
  if (typeof prompter !== 'function') return;
  let answer;
  try {
    answer = await prompter({
      prompt:
        'Add the agentic-framework orchestrator routing block to this project\'s ' +
        'CLAUDE.md? It activates the RESUME-FIRST session contract. [y/N]',
      type: 'string',
    });
  } catch {
    // No TTY / prompter refused → decline, leave CLAUDE.md untouched.
    return;
  }
  const trimmed = typeof answer === 'string' ? answer.trim() : '';
  if (/^y/i.test(trimmed)) {
    writeOrchestratorRouting({ repoRoot });
  }
}

/**
 * Main entrypoint. See file header for branch semantics.
 *
 * @param {object} opts
 * @param {string[]} opts.argv
 * @param {(ctx: {prompt: string, type: string, enum?: string[], error?: string}) => Promise<string>} opts.prompter
 * @param {string} opts.repoRoot
 * @param {() => string} [opts.now]
 * @param {object} [opts.answers] - when truthy, the NON-INTERACTIVE path: the
 *   interactive runQuestionnaire is skipped entirely and the project is
 *   materialized straight from this object. `prompter` is never called. This is
 *   the Bash-tool-compatible mode the /init-project slash command relies on
 *   (TASK-024). The already_initialized guard still short-circuits even with
 *   answers supplied, so a re-run is idempotent (it never clobbers PROJECT.md).
 * @returns {Promise<{state: 'already_initialized'|'forced'|'resumed'|'created', projectMdPath: string, sessionId: string|null}>}
 */
export async function runInit({
  argv,
  prompter,
  repoRoot,
  now = () => new Date().toISOString(),
  answers = null,
}) {
  const parsed = parseArgs(argv);

  // In non-interactive answers mode, validate the supplied object BEFORE any
  // disk mutation so malformed input errors cleanly instead of writing a
  // PROJECT.md and then failing partway through the backlog seed (TASK-024
  // item 2). The already_initialized branch below never materializes, so it is
  // safe to validate here regardless of which branch we end up taking.
  if (answers) {
    validateSuppliedAnswers(answers);
  }

  const projectMdPath = join(repoRoot, 'PROJECT.md');
  const projectMdExists = existsSync(projectMdPath);

  // ---- Branch 0: --apply-models (short-circuits before all wizard logic) ----
  // Reads agent_models from PROJECT.md and applies to agent frontmatter files.
  // Never calls the prompter. Exits with state 'applied_models' (map present)
  // or 'no_op' (map absent). Unknown extra flags have already been rejected by
  // parseArgs above, so by the time we get here all tokens are valid.
  if (parsed.applyModels) {
    if (!projectMdExists) {
      // eslint-disable-next-line no-console
      console.log('--apply-models: PROJECT.md not found; nothing to apply.');
      return { state: 'no_op', projectMdPath, sessionId: null };
    }
    const { answers: projectAnswers } = await readProjectMd({ repoRoot });
    if (!projectAnswers.agent_models ||
        typeof projectAnswers.agent_models !== 'object' ||
        Object.keys(projectAnswers.agent_models).length === 0) {
      // eslint-disable-next-line no-console
      console.log('--apply-models: no agent_models map in PROJECT.md; nothing to apply.');
      return { state: 'no_op', projectMdPath, sessionId: null };
    }
    const changed = await applyAgentModels({
      repoRoot,
      agentModels: projectAnswers.agent_models,
    });
    // eslint-disable-next-line no-console
    console.log(`--apply-models: updated ${changed.length} file(s): ${changed.join(', ')}`);
    return { state: 'applied_models', projectMdPath, sessionId: null };
  }

  // The CLAUDE.md routing consent is a SEPARATE channel from the intake answers:
  // an explicit signal is either the --claude-md-consent flag or a truthy
  // claude_md_consent key in the supplied answers object.
  const explicitConsent =
    parsed.claudeMdConsent ||
    Boolean(answers && answers.claude_md_consent === true);

  // ---- Branch 2: forced (takes precedence over already_initialized) ----
  if (parsed.force) {
    const { sessionId } = await startSession({ repoRoot });
    await runWizardAndWriteProjectMd({
      repoRoot, sessionId, prompter, now, suppliedAnswers: answers,
    });
    await maybeWriteOrchestratorRouting({ repoRoot, prompter, explicitConsent });
    return { state: 'forced', projectMdPath, sessionId };
  }

  // ---- Branch 1: already_initialized ----
  // This guard short-circuits BEFORE any wizard/answers materialization, so a
  // second answers-mode run on an already-initialized project returns
  // already_initialized without re-prompting and without overwriting PROJECT.md
  // (TASK-024 AC3 idempotency). This branch never touches the prompter.
  if (projectMdExists) {
    const { frontmatter } = await readProjectMd({ repoRoot });
    // One-line summary to stdout. Non-emoji marker — see header.
    // eslint-disable-next-line no-console
    console.log(
      `Project already initialized: ${frontmatter.name} ` +
      `(${frontmatter.type}, created ${frontmatter.created_at})`,
    );
    const pointer = readPointer(repoRoot);
    const sessionId = pointer && pointer.active_session_id ? pointer.active_session_id : null;
    return { state: 'already_initialized', projectMdPath, sessionId };
  }

  // ---- Branch 3: resumed ----
  const pointer = readPointer(repoRoot);
  if (pointer && pointer.active_session_id) {
    const candidatePath = intakePath(repoRoot, pointer.active_session_id);
    const partial = tryReadIntake(candidatePath);
    if (partial) {
      const sessionId = pointer.active_session_id;
      await runWizardAndWriteProjectMd({
        repoRoot, sessionId, prompter, now, suppliedAnswers: answers,
      });
      await maybeWriteOrchestratorRouting({ repoRoot, prompter, explicitConsent });
      return { state: 'resumed', projectMdPath, sessionId };
    }
  }

  // ---- Branch 4: created ----
  // The archive prompt is strictly a created-branch concern. forced and
  // already_initialized both imply the project has past-the-archive state on
  // disk; resumed already has a half-answered wizard and replaying the
  // archive prompt mid-resume would be jarring.
  //
  // SKIP the archive prompt entirely in non-interactive answers mode: a slash
  // command / --answers-file caller has no TTY to answer a [Y/n], so prompting
  // would hang (or, with a throwing prompter, crash) the bootstrap. In a fresh
  // target dir countFrameworkHistory is 0 and the prompt no-ops anyway, but
  // guarding here is correct for the general no-TTY case (TASK-024 item 1).
  if (!answers) {
    await maybeArchiveFrameworkHistory({
      repoRoot,
      prompter,
      noArchive: parsed.noArchive,
      now,
    });
  }
  const { sessionId } = await startSession({ repoRoot });
  await runWizardAndWriteProjectMd({
    repoRoot, sessionId, prompter, now, suppliedAnswers: answers,
  });
  await maybeWriteOrchestratorRouting({ repoRoot, prompter, explicitConsent });
  return { state: 'created', projectMdPath, sessionId };
}

/* -------------------------------------------------------------------------- */
/*                                CLI shell                                   */
/* -------------------------------------------------------------------------- */

/**
 * Engine-shape readline prompter for terminal use. Renders the prompt with an
 * `(error)` prefix when the engine signals a validation retry, and appends the
 * enum/multi hint so the user sees the valid choices inline.
 */
function realReadlinePrompter() {
  const rl = createInterface({ input, output });
  return async (ctx) => {
    let text = ctx.prompt;
    if (ctx.type === 'enum' && Array.isArray(ctx.enum)) {
      text += ` (${ctx.enum.join(' | ')})`;
    } else if (ctx.type === 'multi' && Array.isArray(ctx.enum)) {
      text += ` (comma-separated from: ${ctx.enum.join(', ')})`;
    }
    if (ctx.error) {
      text = `(${ctx.error}) ${text}`;
    }
    return rl.question(`${text} `);
  };
}

function printFriendlyOutcome({ state, projectMdPath, sessionId }) {
  if (state === 'already_initialized') {
    // Summary already printed inside runInit's detection branch.
    return;
  }
  // eslint-disable-next-line no-console
  console.log(`* PROJECT.md written to ${projectMdPath}`);
  // eslint-disable-next-line no-console
  console.log(`* Session bundle: state/sessions/${sessionId}/`);
  // eslint-disable-next-line no-console
  console.log('Next step: start a chat with the orchestrator and ask it to plan the first phase.');
}

function printFriendlyError(err) {
  // eslint-disable-next-line no-console
  console.error(`Error: ${err.message}`);
  process.exit(1);
}

/**
 * Read + JSON.parse the --answers-file path into the flat {questionId: value}
 * answers object. A missing/unreadable file or invalid JSON throws an Error
 * with a friendly, path-naming message so the entry runner's
 * .catch(printFriendlyError) prints a clean one-liner (exit 1) instead of an
 * unhandled stacktrace (TASK-024 item 3).
 */
function loadAnswersFile(path) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    throw new Error(`could not read --answers-file ${path}: ${err.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`--answers-file ${path} is not valid JSON: ${err.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`--answers-file ${path} must contain a JSON object of answers`);
  }
  return parsed;
}

// Only fire the top-level runner when invoked as the entry script (not on
// import from tests). Two forms must be supported:
//   - dev/test ESM (`node bin/init.js`): import.meta.url is the file URL, so
//     compare it to argv[1] normalized via pathToFileURL.
//   - the shipped esbuild CJS bundle (`node dist/init.cjs`): esbuild empties
//     import.meta.url under the cjs format, so fall back to the canonical
//     `require.main === module` main-module check (TASK-023).
// When imported (vitest), import.meta.url is truthy but != argv[1] ⇒ false; when
// the bundle is require()'d rather than run, require.main != module ⇒ false.
const __isEntryScript = import.meta.url
  ? Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href
  : (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module);
if (__isEntryScript) {
  // Wrap in Promise.resolve().then(...) so a synchronous throw from argv
  // parsing or answers-file loading routes through printFriendlyError (a clean
  // exit-1 message) rather than crashing with an unhandled stacktrace.
  Promise.resolve()
    .then(() => {
      const argv = process.argv.slice(2);
      const parsed = parseArgs(argv);
      const answers = parsed.answersFile ? loadAnswersFile(parsed.answersFile) : null;
      // In --answers-file mode no prompter is ever called, so we do NOT open a
      // readline interface (it would otherwise hold the process open with no
      // TTY). The interactive path keeps the real readline prompter.
      const prompter = parsed.answersFile ? null : realReadlinePrompter();
      return runInit({
        argv,
        prompter,
        repoRoot: resolveRepoRoot(process.env, process.cwd()),
        answers,
      });
    })
    .then(printFriendlyOutcome)
    .catch(printFriendlyError);
}
