// tests/new-task-cli.spec.js
// TASK-002 — CLI wrapper at bin/new-task.js. Exports a runCli({argv, prompter,
// repoRoot, now}) so tests can drive the loop without a TTY. Most of this
// suite drives runCli() directly, in-process.
//
// AC1 coverage: "Running the script with no arguments prompts for required
// fields and produces a valid task JSON conformant to tasks/schema.json."
// The schema-conformance assertion lives in tests/new-task.spec.js (the core
// is what produces the on-disk JSON); this suite asserts the CLI plumbing.
//
// TASK-189 follow-up round (MEDIUM) — the top-level entry-script wiring
// (`.then(({ key, path }) => ...)` -> process.exit(0)) is the one piece of
// this file runCli() cannot exercise from in-process: it discarded
// `result.warnings` silently, which is exactly the silent-acceptance defect
// TASK-189 exists to close, reproduced on the human-facing intake surface.
// The block below spawns the real bin/new-task.js as a child process (ESM,
// package.json "type": "module" makes `node bin/new-task.js` runnable
// directly) so the entry-script wiring itself is under test, not just runCli().

import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { PROD, makeRepoSkeleton } from '../helpers/fixtures.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';
import { REPO_ROOT } from '../helpers/repoRoot.js';

afterAll(cleanupAll);

const CLI = join(REPO_ROOT, 'bin', 'new-task.js');

function runCliProcess(args, { cwd }) {
  const cleanEnv = { ...process.env };
  delete cleanEnv.CLAUDE_PROJECT_DIR; // force cwd-based repoRoot resolution
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    env: cleanEnv,
    encoding: 'utf8',
  });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

const FIXED_NOW = '2026-09-10T12:00:00Z';

function readTaskFile(repoDir, key) {
  return JSON.parse(readFileSync(join(repoDir, 'tasks', `${key}.json`), 'utf8'));
}

// Build a prompter that returns scripted answers in order. The prompter
// contract: `await prompter(promptText)` returns a string. We record every
// prompt the CLI emits so tests can assert prompt order + payload.
function makeScriptedPrompter(answers) {
  const prompts = [];
  let i = 0;
  const prompter = async (text) => {
    prompts.push(text);
    if (i >= answers.length) {
      throw new Error(
        `scripted prompter exhausted after ${i} answers; ` +
        `CLI asked for more: ${JSON.stringify(text)}`,
      );
    }
    return answers[i++];
  };
  prompter.prompts = prompts;
  prompter.consumed = () => i;
  return prompter;
}

function throwIfCalled() {
  return async (text) => {
    throw new Error(`prompter was called unexpectedly with: ${JSON.stringify(text)}`);
  };
}

// ===========================================================================
// AC1 (non-interactive path) — flags fully specify the task; prompter unused.
// ===========================================================================
describe('AC1 — non-interactive (flags only)', () => {
  it('non_interactive_flags_call_createTask_with_parsed_args', async () => {
    const { runCli } = await import(PROD.newTaskCli);

    const repoDir = makeTmpDir('af-ntcli-flags');
    makeRepoSkeleton(repoDir, {});

    const result = await runCli({
      argv: [
        '--title', 'T',
        '--description', 'D',
        '--ac', 'one',
        '--ac', 'two',
        '--priority', 'medium',
      ],
      prompter: throwIfCalled(), // MUST NOT be invoked.
      repoRoot: repoDir,
      now: () => FIXED_NOW,
    });

    // CLI surface returns the same {key, path} the core does.
    expect(result.key).toBe('TASK-001');
    const written = readTaskFile(repoDir, 'TASK-001');
    expect(written.title).toBe('T');
    expect(written.description).toBe('D');
    expect(written.acceptance_criteria).toEqual(['one', 'two']);
    expect(written.priority).toBe('medium');
    // Defaults still apply.
    expect(written.status).toBe('todo');
    expect(written.labels).toEqual([]);
    expect(written.depends_on).toEqual([]);
  });
});

// ===========================================================================
// AC1 (interactive path) — no args, prompter answers all required fields.
// ===========================================================================
describe('AC1 — interactive (no args)', () => {
  it('interactive_prompts_when_no_args', async () => {
    const { runCli } = await import(PROD.newTaskCli);

    const repoDir = makeTmpDir('af-ntcli-interactive');
    makeRepoSkeleton(repoDir, {});

    // Documented prompt order: title, description, ac-count, ac1..acN, priority.
    // The prompter receives free-form prompt text — we only assert that the
    // number of prompts and the values consumed produce the right task.
    const prompter = makeScriptedPrompter([
      'Interactive title',
      'Interactive description',
      '2',                  // number of acceptance criteria
      'Interactive AC 1',
      'Interactive AC 2',
      'high',               // priority
    ]);

    const result = await runCli({
      argv: [],
      prompter,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
    });

    expect(result.key).toBe('TASK-001');
    const written = readTaskFile(repoDir, 'TASK-001');
    expect(written.title).toBe('Interactive title');
    expect(written.description).toBe('Interactive description');
    expect(written.acceptance_criteria).toEqual([
      'Interactive AC 1',
      'Interactive AC 2',
    ]);
    expect(written.priority).toBe('high');

    // Every scripted answer was consumed — the CLI didn't skip any prompt.
    expect(prompter.consumed()).toBe(6);

    // Prompt order: title MUST come before description, description MUST
    // come before the ac-count prompt, ac-count MUST come before the
    // ac-body prompts, and priority MUST come last.
    const findIdx = (needle) =>
      prompter.prompts.findIndex((p) => p.toLowerCase().includes(needle));
    const iTitle = findIdx('title');
    const iDesc = findIdx('description');
    const iPrio = findIdx('priority');
    expect(iTitle).toBeGreaterThanOrEqual(0);
    expect(iDesc).toBeGreaterThan(iTitle);
    expect(iPrio).toBeGreaterThan(iDesc);
  });

  it('interactive_reprompts_on_empty_title', async () => {
    // Schema requires title.minLength >= 1. The CLI MUST re-ask rather than
    // accept an empty string and let the core throw.
    const { runCli } = await import(PROD.newTaskCli);

    const repoDir = makeTmpDir('af-ntcli-reprompt');
    makeRepoSkeleton(repoDir, {});

    const prompter = makeScriptedPrompter([
      '',                       // first title attempt — empty, must re-prompt
      'Eventually valid title', // second title attempt
      'A description',
      '1',
      'Just one AC',
      'low',
    ]);

    const result = await runCli({
      argv: [],
      prompter,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
    });

    expect(result.key).toBe('TASK-001');
    const written = readTaskFile(repoDir, 'TASK-001');
    expect(written.title).toBe('Eventually valid title');
    expect(written.acceptance_criteria).toEqual(['Just one AC']);
    expect(written.priority).toBe('low');

    // Six scripted answers, all consumed (the first title was the re-prompted
    // empty one).
    expect(prompter.consumed()).toBe(6);
    // At least two title prompts surfaced.
    const titlePrompts = prompter.prompts.filter(
      (p) => p.toLowerCase().includes('title'),
    );
    expect(titlePrompts.length).toBeGreaterThanOrEqual(2);
  });
});

// ===========================================================================
// TASK-015 AC5 — source-hygiene sweep on bin/new-task.js.
//   (a) The typo `engineerPrompter` must be gone (corrected to `enginePrompter`).
//   (b) The dead-code `validate` on the title question must be removed (the
//       `required: true` already covers empty-string rejection — keep ac_count's
//       `validate` which guards the >=1 numeric range, not emptiness).
// We assert by reading the source of bin/new-task.js — a behavioral test
// cannot distinguish "validate removed" from "validate present but unused
// because required: true short-circuits first".
// ===========================================================================
describe('TASK-015 AC5 — bin/new-task.js source hygiene', () => {
  it('typo_engineerPrompter_is_gone_renamed_to_enginePrompter', () => {
    const src = readFileSync(fileURLToPath(PROD.newTaskCli), 'utf8');
    expect(
      src.includes('engineerPrompter'),
      'bin/new-task.js must not contain the typo `engineerPrompter` (rename to `enginePrompter`)',
    ).toBe(false);
    expect(
      src.includes('enginePrompter'),
      'bin/new-task.js must use the corrected name `enginePrompter` (the adapter binding)',
    ).toBe(true);
  });

  it('dead_validate_on_title_question_is_removed', () => {
    const src = readFileSync(fileURLToPath(PROD.newTaskCli), 'utf8');
    // The title question lives inside the `headQuestions` block. Locate the
    // title question literal and confirm no `validate:` key sits inside it.
    // A `Title:` prompt string is the unique landmark for the title question.
    const titleIdx = src.indexOf("'Title:'");
    expect(
      titleIdx,
      "bin/new-task.js must still define the title question via 'Title:' prompt",
    ).toBeGreaterThan(-1);
    // Look forward from the title prompt to the next `})` closing the
    // push() call (the title question is wrapped in `headQuestions.push({…})`).
    // The title-question's `validate:` line (if present) must NOT appear in
    // that window. 400 chars is enough to cover a multi-line question object
    // without bleeding into the next question.
    const titleBlock = src.slice(titleIdx, titleIdx + 400);
    const closingIdx = titleBlock.search(/}\s*\)\s*;/);
    expect(
      closingIdx,
      'expected the title question to close with `});` within 400 chars of `Title:`',
    ).toBeGreaterThan(-1);
    const titleQuestion = titleBlock.slice(0, closingIdx);
    expect(
      /\bvalidate\s*:/.test(titleQuestion),
      'title question must not carry a dead-code `validate:` — `required: true` already covers empty rejection',
    ).toBe(false);
    // Sanity check — `required: true` should still be present on the title.
    expect(
      titleQuestion.includes('required'),
      "title question must retain `required: true` (the validate's replacement)",
    ).toBe(true);
  });
});

// ===========================================================================
// AC1 (mixed mode) — flag provides one field, prompter fills the rest.
// ===========================================================================
describe('AC1 — flag + prompt mix', () => {
  it('flag_and_prompt_mix', async () => {
    const { runCli } = await import(PROD.newTaskCli);

    const repoDir = makeTmpDir('af-ntcli-mix');
    makeRepoSkeleton(repoDir, {});

    // --title supplied as flag; description, AC, priority prompted.
    const prompter = makeScriptedPrompter([
      'Prompted description',
      '1',
      'Prompted AC',
      'critical',
    ]);

    const result = await runCli({
      argv: ['--title', 'Flag title'],
      prompter,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
    });

    expect(result.key).toBe('TASK-001');
    const written = readTaskFile(repoDir, 'TASK-001');
    expect(written.title).toBe('Flag title');
    expect(written.description).toBe('Prompted description');
    expect(written.acceptance_criteria).toEqual(['Prompted AC']);
    expect(written.priority).toBe('critical');

    // The prompter was NOT asked for a title (the flag satisfied it).
    expect(prompter.consumed()).toBe(4);
    const titlePrompts = prompter.prompts.filter(
      (p) => p.toLowerCase().includes('title'),
    );
    expect(titlePrompts).toEqual([]);
  });
});

// ===========================================================================
// TASK-189 follow-up — MEDIUM: the entry-script wiring must print any
// createTask() warnings to stderr (advisory, non-blocking) rather than
// silently discarding them, and MUST still exit 0 — warnings never become
// a failure.
// ===========================================================================
describe('TASK-189 follow-up — entry-script prints warnings, still exits 0', () => {
  it('a schema-change ticket declared uat-only prints the warning to stderr and exits 0', () => {
    const repoDir = makeTmpDir('af-ntcli-warn');
    makeRepoSkeleton(repoDir, {});

    const { status, stdout, stderr } = runCliProcess([
      '--title', 'Schema change at uat-only tier',
      '--description', 'Change tasks/schema.json to add a new required field.',
      '--ac', 'Schema updated and all task files migrated.',
      '--priority', 'medium',
      '--tier', 'uat-only',
    ], { cwd: repoDir });

    expect(status).toBe(0);
    expect(stdout).toMatch(/TASK-\d{3,} written to/);
    expect(stderr).toMatch(/schema/i);
  });

  it('a ticket with no warnings prints nothing extra to stderr and exits 0', () => {
    const repoDir = makeTmpDir('af-ntcli-nowarn');
    makeRepoSkeleton(repoDir, {});

    const { status, stdout, stderr } = runCliProcess([
      '--title', 'Ordinary ticket',
      '--description', 'A normal change with no schema mention.',
      '--ac', 'Something observable happens.',
      '--priority', 'medium',
    ], { cwd: repoDir });

    expect(status).toBe(0);
    expect(stdout).toMatch(/TASK-\d{3,} written to/);
    expect(stderr).toBe('');
  });
});
