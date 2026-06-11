// tests/task-board-scaffold.spec.js
// TASK-034 — Fast-tier scaffold pins for the kanban task board plugin wiring.
//
// These are DETERMINISTIC, on-disk assertions that encode the plugin contract:
//   AC8 — commands/task-status.md exists and uses the ${CLAUDE_PLUGIN_ROOT}/dist/
//          idiom matching init-project.md.
//   AC9 — .claude-plugin/shipped-bin.json includes dist/task-board.cjs.
//          The every_shipped_bin_entry_actually_exists guard in plugin-scaffold.spec.js
//          will enforce realness at impl time; this spec pins the entry is PRESENT.
//  AC10 — bin/task-board.js exists on disk and src/task-board.js exports a
//          `createBoardServer` function (checked via dynamic import so a module-not-
//          found is the right tests-first failure — never a TypeError or undefined).
//
// TESTS-FIRST FAILURE SURFACE:
//   AC8 → commands/task-status.md does not exist → existsSync returns false.
//   AC9 → dist/task-board.cjs not in shipped-bin.json → toContain fails.
//  AC10 → bin/task-board.js does not exist → existsSync returns false.
//          src/task-board.js does not exist → dynamic import fails (module-not-found).

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from './helpers/repoRoot.js';

const COMMANDS_DIR = join(REPO_ROOT, 'commands');
const TASK_STATUS_COMMAND = join(COMMANDS_DIR, 'task-status.md');
const SHIPPED_BIN_JSON = join(REPO_ROOT, '.claude-plugin', 'shipped-bin.json');
const TASK_BOARD_BIN = join(REPO_ROOT, 'bin', 'task-board.js');
const TASK_BOARD_SRC = join(REPO_ROOT, 'src', 'task-board.js');

function readJson(path) {
  expect(existsSync(path), `${path} must exist`).toBe(true);
  return JSON.parse(readFileSync(path, 'utf8'));
}

// ===========================================================================
// AC8 — commands/task-status.md: file exists and references the dist bundle.
// ===========================================================================
describe('AC8 — commands/task-status.md plugin command', () => {
  it('task_status_command_file_exists', () => {
    expect(
      existsSync(TASK_STATUS_COMMAND),
      'commands/task-status.md must exist',
    ).toBe(true);
  });

  it('task_status_command_references_dist_task_board_cjs_via_CLAUDE_PLUGIN_ROOT', () => {
    // The command must invoke the SHIPPED bundle, not the raw source.
    // Pattern matches init-project.md: node ${CLAUDE_PLUGIN_ROOT}/dist/task-board.cjs
    expect(existsSync(TASK_STATUS_COMMAND), 'commands/task-status.md must exist').toBe(true);
    const content = readFileSync(TASK_STATUS_COMMAND, 'utf8');
    expect(
      content.includes('${CLAUDE_PLUGIN_ROOT}'),
      'commands/task-status.md must reference ${CLAUDE_PLUGIN_ROOT} (the plugin install path variable)',
    ).toBe(true);
    expect(
      content.includes('dist/task-board.cjs'),
      'commands/task-status.md must reference dist/task-board.cjs (the shipped bundle)',
    ).toBe(true);
  });
});

// ===========================================================================
// AC9 — shipped-bin.json includes dist/task-board.cjs.
// ===========================================================================
describe('AC9 — shipped-bin.json includes the task-board bundle', () => {
  it('shipped_bin_includes_dist_task_board_cjs', () => {
    const m = readJson(SHIPPED_BIN_JSON);
    expect(
      Array.isArray(m.bin),
      'shipped-bin.json must have a `bin` array',
    ).toBe(true);
    expect(
      m.bin,
      'shipped-bin.json must include dist/task-board.cjs',
    ).toContain('dist/task-board.cjs');
  });
});

// ===========================================================================
// AC10 — bin/task-board.js exists and src/task-board.js exports createBoardServer.
// ===========================================================================
describe('AC10 — bin/task-board.js exists and src/task-board.js exports createBoardServer', () => {
  it('bin_task_board_js_exists', () => {
    expect(
      existsSync(TASK_BOARD_BIN),
      'bin/task-board.js must exist (the thin shell entry point)',
    ).toBe(true);
  });

  it('src_task_board_js_exports_createBoardServer_function', async () => {
    // A module-not-found here is the correct tests-first failure. Once impl
    // creates src/task-board.js this import resolves and the export is verified.
    expect(
      existsSync(TASK_BOARD_SRC),
      'src/task-board.js must exist',
    ).toBe(true);
    const mod = await import(TASK_BOARD_SRC);
    expect(
      typeof mod.createBoardServer,
      'src/task-board.js must export a createBoardServer function',
    ).toBe('function');
  });
});
