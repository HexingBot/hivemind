#!/usr/bin/env node
// bin/new-task.js
// CLI wrapper around createTask() for human-driven task scaffolding.
// Flags fully satisfy the non-interactive path; missing required fields fall
// through to the injected prompter. Prompter is injectable so tests run
// without a TTY — see tests/new-task-cli.spec.js for the contract.
//
// Interactive prompting delegates to runQuestionnaire (src/question-engine.js)
// for shared validation + (future) resumability. The legacy prompter contract
// `(text) => Promise<string>` is preserved by adapting at this boundary: the
// engine's `{prompt, error}` context is rendered to a string before being
// forwarded to the CLI prompter. The new-task CLI itself does not persist
// partial state (persistTo: null) — the project-init wizard will.

import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import { createTask } from '../src/task-store.js';
import { runQuestionnaire } from '../src/question-engine.js';
import { resolveRepoRoot } from '../src/repo-root.js';

const REPEATABLE = new Set(['--ac', '--label', '--depends']);
const SINGLE = new Set(['--title', '--description', '--priority', '--tier']);

/**
 * Parse argv into { title, description, ac[], priority, labels[], dependsOn[] }.
 * Unknown flags throw with the flag name in the message so typos surface fast.
 */
function parseArgs(argv) {
  const out = {
    title: undefined,
    description: undefined,
    ac: [],
    priority: undefined,
    labels: [],
    dependsOn: [],
    tier: undefined,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (!SINGLE.has(flag) && !REPEATABLE.has(flag)) {
      throw new Error(`unknown flag: ${flag}`);
    }
    const value = argv[++i];
    if (value === undefined) {
      throw new Error(`flag ${flag} requires a value`);
    }
    switch (flag) {
      case '--title': out.title = value; break;
      case '--description': out.description = value; break;
      case '--priority': out.priority = value; break;
      case '--ac': out.ac.push(value); break;
      case '--label': out.labels.push(value); break;
      case '--depends': out.dependsOn.push(value); break;
      case '--tier': out.tier = value; break;
    }
  }
  return out;
}

/**
 * Adapt a legacy `(text) => Promise<string>` prompter to the engine's
 * `({prompt, type, enum, error}) => Promise<string>` shape. The error message,
 * when present, is rendered as a prefix on the prompt so the human sees why
 * the previous answer was rejected.
 */
function adaptPrompter(legacyPrompter) {
  return async (ctx) => {
    const text = ctx.error
      ? `(${ctx.error}) ${ctx.prompt} `
      : `${ctx.prompt} `;
    return legacyPrompter(text);
  };
}

/**
 * Drive the CLI: parse flags, prompt for whatever is missing via the
 * question engine, then call createTask(). Honors flag overrides — any
 * field already supplied via argv is removed from the questionnaire so
 * the prompter is never asked for it.
 */
export async function runCli({ argv, prompter, repoRoot, now }) {
  const parsed = parseArgs(argv);
  const enginePrompter = adaptPrompter(prompter);

  // Prompt order when nothing is supplied: title, description, ac-count,
  // ac1..acN, priority. AC count is dynamic, so we use three engine
  // invocations: (1) title/description/ac_count, (2) ac1..acN, (3) priority.
  // Each phase is skipped wholesale when flags satisfied its fields.

  // ---- Phase 1: title, description, ac_count ----
  const headQuestions = [];
  if (parsed.title === undefined) {
    headQuestions.push({
      id: 'title',
      type: 'string',
      prompt: 'Title:',
      required: true,
    });
  }
  if (parsed.description === undefined) {
    headQuestions.push({
      id: 'description',
      type: 'string',
      prompt: 'Description:',
      required: true,
    });
  }
  if (parsed.ac.length === 0) {
    headQuestions.push({
      id: 'ac_count',
      type: 'number',
      prompt: 'How many acceptance criteria?',
      validate: (v) => (v >= 1 ? null : 'must be at least 1'),
    });
  }

  let headAnswers = {};
  if (headQuestions.length > 0) {
    const result = await runQuestionnaire({
      questions: headQuestions,
      prompter: enginePrompter,
      persistTo: null,
      now,
    });
    headAnswers = result.answers;
  }

  // ---- Phase 2: dynamic AC sub-questionnaire (only when --ac not supplied) ----
  let acceptance_criteria = parsed.ac;
  if (acceptance_criteria.length === 0) {
    const count = Math.max(1, Math.floor(headAnswers.ac_count || 1));
    const acQuestions = [];
    for (let i = 0; i < count; i++) {
      acQuestions.push({
        id: `ac_${i + 1}`,
        type: 'string',
        prompt: `Acceptance criterion ${i + 1}:`,
        required: true,
      });
    }
    const acResult = await runQuestionnaire({
      questions: acQuestions,
      prompter: enginePrompter,
      persistTo: null,
      now,
    });
    acceptance_criteria = acQuestions.map((q) => acResult.answers[q.id]);
  }

  // ---- Phase 3: priority (asked last so it comes after ACs in the prompt order) ----
  let tailAnswers = {};
  if (parsed.priority === undefined) {
    const tailResult = await runQuestionnaire({
      questions: [{
        id: 'priority',
        type: 'enum',
        prompt: 'Priority (low|medium|high|critical):',
        enum: ['low', 'medium', 'high', 'critical'],
      }],
      prompter: enginePrompter,
      persistTo: null,
      now,
    });
    tailAnswers = tailResult.answers;
  }

  return createTask({
    repoRoot,
    title: parsed.title ?? headAnswers.title,
    description: parsed.description ?? headAnswers.description,
    acceptance_criteria,
    priority: parsed.priority ?? tailAnswers.priority,
    labels: parsed.labels,
    depends_on: parsed.dependsOn,
    ...(parsed.tier !== undefined ? { verification_tier: parsed.tier } : {}),
    now,
  });
}

/**
 * Real readline prompter — used only when the file is executed directly.
 * Returns a function (text) => Promise<string> that closes the interface on
 * each call so the process exits cleanly after the last prompt.
 */
function realReadlinePrompter() {
  const rl = createInterface({ input, output });
  return async (text) => {
    const answer = await rl.question(text);
    return answer;
  };
}

// Only fire the top-level runner when invoked as the entry script (not on
// import from tests). Two forms must be supported:
//   - dev/test ESM (`node bin/new-task.js`): compare import.meta.url to argv[1].
//   - the shipped esbuild CJS bundle (`node dist/new-task.cjs`): esbuild empties
//     import.meta.url under cjs, so fall back to `require.main === module`
//     (TASK-023). Imported (vitest) ⇒ false; bundle require()'d ⇒ false.
const __isEntryScript = import.meta.url
  ? Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href
  : (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module);
if (__isEntryScript) {
  const prompter = realReadlinePrompter();
  runCli({
    argv: process.argv.slice(2),
    prompter,
    repoRoot: resolveRepoRoot(process.env, process.cwd()),
    now: () => new Date().toISOString(),
  })
    .then(({ key, path, warnings }) => {
      // eslint-disable-next-line no-console
      console.log(`${key} written to ${path}`);
      // TASK-189 follow-up (MEDIUM) — warnings are advisory and MUST NOT
      // affect the exit code; print each to stderr so the human-facing CLI
      // surfaces them the same way the MCP path already does (ok() returns
      // the whole result object, warnings included).
      if (Array.isArray(warnings)) {
        for (const warning of warnings) {
          // eslint-disable-next-line no-console
          console.error(warning);
        }
      }
      process.exit(0);
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(err.message);
      process.exit(1);
    });
}
