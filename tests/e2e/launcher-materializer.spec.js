// tests/e2e/launcher-materializer.spec.js
// TASK-057 — Failing specs (TDD) for the console launcher materializer.
//
// AC map:
//   AC1 — fresh init (created branch) materializes console.cmd and console.sh
//          into the target project ROOT, content byte-identical to plugin source.
//   AC2 — never-overwrite + idempotent: existing launcher files are left untouched;
//          a second init run (already_initialized) adds nothing and does not mutate.
//   AC3 — branch behaviour: launchers ARE materialized on created and --force;
//          the already_initialized branch performs NO launcher mutation.
//   AC4 — byte-consistency / shipped-from-plugin: materialized bytes equal the
//          plugin-source launcher bytes (proves copy, not hand-duplication).
//   AC5 — discoverability: init stdout tells the user they can double-click
//          console.cmd / run `sh console.sh` or use /agentic-framework:console.
//
// These tests FAIL before TASK-057 is implemented — the materializer does not
// exist yet. Each spec fails for the right reason (assertion fails / file absent),
// NOT a syntax or import error.

import { describe, it, expect, afterAll } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from '../helpers/repoRoot.js';
import { PROD } from '../helpers/fixtures.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';
import { makeScriptedPrompter, webSaasAnswers } from '../helpers/scripted-prompter.js';

afterAll(cleanupAll);

const FIXED_NOW = '2026-06-16T12:00:00Z';

// Source launcher files — these live at the plugin root (one level above bin/).
const PLUGIN_LAUNCHER_CMD = join(REPO_ROOT, 'console.cmd');
const PLUGIN_LAUNCHER_SH  = join(REPO_ROOT, 'console.sh');

// ---------------------------------------------------------------------------
// AC4 — byte-consistency: plugin-root launchers must exist and be non-empty.
// (These pass immediately; they anchor the byte-comparison assertions in AC1.)
// ---------------------------------------------------------------------------

describe('AC4 — plugin-root launcher sources exist and are non-empty', () => {
  it('console.cmd exists at plugin root', () => {
    expect(
      existsSync(PLUGIN_LAUNCHER_CMD),
      'console.cmd must exist at the plugin root (REPO_ROOT)',
    ).toBe(true);
  });

  it('console.sh exists at plugin root', () => {
    expect(
      existsSync(PLUGIN_LAUNCHER_SH),
      'console.sh must exist at the plugin root (REPO_ROOT)',
    ).toBe(true);
  });

  it('console.cmd references dist/task-board.cjs --open --port 4517', () => {
    const content = readFileSync(PLUGIN_LAUNCHER_CMD, 'utf8');
    expect(content, 'console.cmd must reference task-board.cjs').toMatch(/task-board\.cjs/);
    expect(content, 'console.cmd must include --open flag').toMatch(/--open/);
    expect(content, 'console.cmd must use port 4517').toMatch(/4517/);
  });

  it('console.sh references dist/task-board.cjs --open --port 4517', () => {
    const content = readFileSync(PLUGIN_LAUNCHER_SH, 'utf8');
    expect(content, 'console.sh must reference task-board.cjs').toMatch(/task-board\.cjs/);
    expect(content, 'console.sh must include --open flag').toMatch(/--open/);
    expect(content, 'console.sh must use port 4517').toMatch(/4517/);
  });
});

// ---------------------------------------------------------------------------
// AC1 — fresh init materializes both launchers into the target project ROOT.
// The destination is <projectRoot>/console.cmd and <projectRoot>/console.sh,
// NOT .claude/ — the user can double-click straight from the project folder.
// Content must be byte-identical to the plugin-root source files.
// ---------------------------------------------------------------------------

describe('AC1 — created branch materializes launchers into target project root', () => {
  it('created_branch_writes_console_cmd_and_console_sh_to_project_root', async () => {
    const { runInit } = await import(PROD.init);
    const repoDir = makeTmpDir('af-lm-created');

    const prompter = makeScriptedPrompter(webSaasAnswers({ project_name: 'lm-created' }));
    const result = await runInit({
      argv: [],
      prompter,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
    });

    expect(['created', 'forced']).toContain(result.state);

    const destCmd = join(repoDir, 'console.cmd');
    const destSh  = join(repoDir, 'console.sh');

    expect(
      existsSync(destCmd),
      'console.cmd must be materialized into the target project root by fresh init',
    ).toBe(true);

    expect(
      existsSync(destSh),
      'console.sh must be materialized into the target project root by fresh init',
    ).toBe(true);
  });

  it('created_branch_launcher_content_is_byte_identical_to_plugin_source', async () => {
    const { runInit } = await import(PROD.init);
    const repoDir = makeTmpDir('af-lm-created-bytes');

    const prompter = makeScriptedPrompter(webSaasAnswers({ project_name: 'lm-bytes' }));
    await runInit({
      argv: [],
      prompter,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
    });

    const destCmd = join(repoDir, 'console.cmd');
    const destSh  = join(repoDir, 'console.sh');

    // AC4 — byte-identical to plugin-root sources (proves copy, not hand-duplication).
    const srcCmdBytes = readFileSync(PLUGIN_LAUNCHER_CMD);
    const destCmdBytes = readFileSync(destCmd);
    expect(
      destCmdBytes.equals(srcCmdBytes),
      'materialized console.cmd must be byte-identical to the plugin-root source',
    ).toBe(true);

    const srcShBytes = readFileSync(PLUGIN_LAUNCHER_SH);
    const destShBytes = readFileSync(destSh);
    expect(
      destShBytes.equals(srcShBytes),
      'materialized console.sh must be byte-identical to the plugin-root source',
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC2 — never-overwrite: existing launcher files in the project root are never
// clobbered by init, even on a fresh-create run.
// ---------------------------------------------------------------------------

describe('AC2 — materializer never overwrites existing launcher files', () => {
  it('existing_console_cmd_in_project_root_is_left_untouched', async () => {
    const { runInit } = await import(PROD.init);
    const repoDir = makeTmpDir('af-lm-nooverwrite-cmd');

    // Pre-write a sentinel to console.cmd BEFORE init runs.
    const destCmd = join(repoDir, 'console.cmd');
    const sentinelCmd = ':: TASK-057 sentinel for console.cmd — must not be overwritten\n';
    writeFileSync(destCmd, sentinelCmd, 'utf8');

    const prompter = makeScriptedPrompter(webSaasAnswers({ project_name: 'lm-nooverwrite-cmd' }));
    await runInit({
      argv: [],
      prompter,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
    });

    const after = readFileSync(destCmd, 'utf8');
    expect(
      after,
      'materializer must not overwrite an existing console.cmd (never-overwrite contract)',
    ).toBe(sentinelCmd);
  });

  it('existing_console_sh_in_project_root_is_left_untouched', async () => {
    const { runInit } = await import(PROD.init);
    const repoDir = makeTmpDir('af-lm-nooverwrite-sh');

    // Pre-write a sentinel to console.sh BEFORE init runs.
    const destSh = join(repoDir, 'console.sh');
    const sentinelSh = '# TASK-057 sentinel for console.sh — must not be overwritten\n';
    writeFileSync(destSh, sentinelSh, 'utf8');

    const prompter = makeScriptedPrompter(webSaasAnswers({ project_name: 'lm-nooverwrite-sh' }));
    await runInit({
      argv: [],
      prompter,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
    });

    const after = readFileSync(destSh, 'utf8');
    expect(
      after,
      'materializer must not overwrite an existing console.sh (never-overwrite contract)',
    ).toBe(sentinelSh);
  });
});

// ---------------------------------------------------------------------------
// AC2 — idempotency: second run (already_initialized) is a non-vacuous no-op.
//
// Steps:
//   1. First init materializes the launchers.
//   2. Perturb both launcher files with distinct sentinels.
//   3. Second init (already_initialized) must NOT overwrite the sentinels.
// ---------------------------------------------------------------------------

describe('AC2 — idempotency: already_initialized branch does not mutate launchers', () => {
  it('already_initialized_does_not_alter_existing_launcher_files', async () => {
    const { runInit } = await import(PROD.init);
    const repoDir = makeTmpDir('af-lm-idemp');

    // First run: full created branch — materializes the launchers.
    const prompter = makeScriptedPrompter(webSaasAnswers({ project_name: 'lm-idemp' }));
    const first = await runInit({
      argv: [],
      prompter,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
    });
    expect(['created', 'forced']).toContain(first.state);

    const destCmd = join(repoDir, 'console.cmd');
    const destSh  = join(repoDir, 'console.sh');

    expect(existsSync(destCmd), 'console.cmd must be materialized on first run').toBe(true);
    expect(existsSync(destSh),  'console.sh must be materialized on first run').toBe(true);

    // PERTURB: overwrite with distinct sentinels so any re-copy from source is caught.
    const sentinelCmd = ':: TASK-057 idempotency sentinel for console.cmd\n';
    const sentinelSh  = '# TASK-057 idempotency sentinel for console.sh\n';
    writeFileSync(destCmd, sentinelCmd, 'utf8');
    writeFileSync(destSh,  sentinelSh,  'utf8');

    // Verify sentinels differ from the source (test non-vacuity).
    const srcCmdContent = readFileSync(PLUGIN_LAUNCHER_CMD, 'utf8');
    const srcShContent  = readFileSync(PLUGIN_LAUNCHER_SH, 'utf8');
    expect(sentinelCmd).not.toBe(srcCmdContent);
    expect(sentinelSh).not.toBe(srcShContent);

    // Second run: already_initialized branch — must not touch launchers.
    const second = await runInit({
      argv: [],
      prompter: async () => { throw new Error('prompter must not be called in already_initialized'); },
      repoRoot: repoDir,
      now: () => '2099-01-01T00:00:00Z',
    });
    expect(second.state).toBe('already_initialized');

    // Sentinels must survive the second run.
    const cmdAfter = readFileSync(destCmd, 'utf8');
    const shAfter  = readFileSync(destSh,  'utf8');

    expect(
      cmdAfter,
      'already_initialized branch must not overwrite console.cmd — sentinel must survive',
    ).toBe(sentinelCmd);

    expect(
      shAfter,
      'already_initialized branch must not overwrite console.sh — sentinel must survive',
    ).toBe(sentinelSh);
  });
});

// ---------------------------------------------------------------------------
// AC3 — branch behaviour: launchers materialized on --force; already_initialized
// branch performs no launcher mutation.
// ---------------------------------------------------------------------------

describe('AC3 — forced branch materializes launchers', () => {
  it('force_flag_materializes_launchers_into_project_root', async () => {
    const { runInit } = await import(PROD.init);
    const repoDir = makeTmpDir('af-lm-forced');

    // Set up a fully-initialized project first.
    const prompter1 = makeScriptedPrompter(webSaasAnswers({ project_name: 'lm-forced-setup' }));
    const first = await runInit({
      argv: [],
      prompter: prompter1,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
    });
    expect(['created', 'forced']).toContain(first.state);

    // Remove the launchers so we can assert --force re-materializes them.
    const destCmd = join(repoDir, 'console.cmd');
    const destSh  = join(repoDir, 'console.sh');
    const { rmSync } = await import('node:fs');
    if (existsSync(destCmd)) rmSync(destCmd);
    if (existsSync(destSh))  rmSync(destSh);

    // --force re-run.
    const prompter2 = makeScriptedPrompter(webSaasAnswers({ project_name: 'lm-forced-rerun' }));
    const forced = await runInit({
      argv: ['--force'],
      prompter: prompter2,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
    });
    expect(forced.state).toBe('forced');

    expect(
      existsSync(destCmd),
      'console.cmd must be materialized by --force branch',
    ).toBe(true);

    expect(
      existsSync(destSh),
      'console.sh must be materialized by --force branch',
    ).toBe(true);
  });
});

describe('AC3 — already_initialized branch does not add launchers to a project that had none', () => {
  it('already_initialized_does_not_write_launchers_when_none_exist', async () => {
    const { runInit } = await import(PROD.init);
    const repoDir = makeTmpDir('af-lm-alreadyinit-nolaunchers');

    // Bootstrap the project WITHOUT triggering the launcher materializer:
    // write PROJECT.md manually so we land directly in already_initialized on
    // the first real runInit call without ever going through created/forced.
    // We do this by pre-populating PROJECT.md with valid frontmatter, so
    // already_initialized fires immediately.
    const projectMdContent = [
      '---',
      'name: lm-alreadyinit-test',
      'type: web-saas',
      'created_at: 2026-01-01T00:00:00Z',
      '---',
      '',
      '# lm-alreadyinit-test',
      '',
    ].join('\n');
    writeFileSync(join(repoDir, 'PROJECT.md'), projectMdContent, 'utf8');

    // Also write a minimal state/session.json pointer so readPointer does not crash.
    mkdirSync(join(repoDir, 'state'), { recursive: true });
    writeFileSync(
      join(repoDir, 'state', 'session.json'),
      JSON.stringify({ schema_version: 2, active_session_id: null, updated_at: FIXED_NOW }),
      'utf8',
    );

    const destCmd = join(repoDir, 'console.cmd');
    const destSh  = join(repoDir, 'console.sh');

    // Neither launcher file exists before the already_initialized run.
    expect(existsSync(destCmd), 'console.cmd must not exist before already_initialized run').toBe(false);
    expect(existsSync(destSh),  'console.sh must not exist before already_initialized run').toBe(false);

    const result = await runInit({
      argv: [],
      prompter: async () => { throw new Error('prompter must not be called in already_initialized'); },
      repoRoot: repoDir,
      now: () => FIXED_NOW,
    });

    expect(result.state).toBe('already_initialized');

    // already_initialized branch must NOT have written the launchers.
    expect(
      existsSync(destCmd),
      'already_initialized branch must not write console.cmd (no launcher mutation)',
    ).toBe(false);

    expect(
      existsSync(destSh),
      'already_initialized branch must not write console.sh (no launcher mutation)',
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC5 — discoverability: init stdout tells the user how to open the console.
// Asserts that a fresh init run emits a message mentioning:
//   - console.cmd (Windows double-click)
//   - console.sh (macOS/Linux)
//   - /agentic-framework:console (Claude Code slash command)
//
// This test captures stdout via a console.log spy over the runInit call.
// It will FAIL until the materializer implementation emits the discovery line.
// ---------------------------------------------------------------------------

describe('AC5 — init stdout tells the user how to launch the console', () => {
  it('fresh_init_stdout_mentions_console_cmd_console_sh_and_slash_command', async () => {
    const { runInit } = await import(PROD.init);
    const repoDir = makeTmpDir('af-lm-ac5-stdout');

    // Capture all console.log output during the init run.
    const logLines = [];
    const origLog = console.log;
    console.log = (...args) => logLines.push(args.map(String).join(' '));

    try {
      const prompter = makeScriptedPrompter(webSaasAnswers({ project_name: 'lm-ac5' }));
      await runInit({
        argv: [],
        prompter,
        repoRoot: repoDir,
        now: () => FIXED_NOW,
      });
    } finally {
      console.log = origLog;
    }

    const combinedOutput = logLines.join('\n');

    expect(
      combinedOutput.includes('console.cmd'),
      'init stdout must mention console.cmd so the user knows about the Windows double-click launcher\n' +
      `Captured stdout:\n${combinedOutput}`,
    ).toBe(true);

    expect(
      combinedOutput.includes('console.sh'),
      'init stdout must mention console.sh so the user knows about the macOS/Linux launcher\n' +
      `Captured stdout:\n${combinedOutput}`,
    ).toBe(true);

    expect(
      combinedOutput.includes('/agentic-framework:console') || combinedOutput.includes(':console'),
      'init stdout must mention the /agentic-framework:console slash command\n' +
      `Captured stdout:\n${combinedOutput}`,
    ).toBe(true);
  });
});
