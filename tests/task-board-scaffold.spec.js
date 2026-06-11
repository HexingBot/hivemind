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

// ===========================================================================
// M2 (review follow-up) — XSS discipline pin. The board HTML embedded in
// src/task-board.js must build all card markup via createElement/textContent,
// never by interpolating task fields into HTML strings. Pinned by regex over
// the embedded HTML segment (everything between <!DOCTYPE html> and </html>):
//   1. every .innerHTML assignment is the empty-string clear (`= ''`);
//   2. the HTML segment contains NO template-literal interpolation at all
//      (`${` would be evaluated server-side — the page must be a static string);
//   3. positive pin: the client script demonstrably uses textContent +
//      document.createElement (so 1–2 can't pass vacuously on a rewrite).
// ===========================================================================
describe('M2 — board HTML pins the textContent/createElement XSS discipline', () => {
  function boardHtmlSegment() {
    expect(existsSync(TASK_BOARD_SRC), 'src/task-board.js must exist').toBe(true);
    const src = readFileSync(TASK_BOARD_SRC, 'utf8');
    const start = src.indexOf('<!DOCTYPE html>');
    const end = src.indexOf('</html>');
    expect(start, 'src/task-board.js must embed an HTML document').toBeGreaterThan(-1);
    expect(end, 'the embedded HTML document must be terminated').toBeGreaterThan(start);
    return src.slice(start, end);
  }

  it('innerHTML_is_only_ever_assigned_the_empty_string_clear', () => {
    const html = boardHtmlSegment();
    const assignments = html.match(/\.innerHTML\s*=\s*[^;\n]+/g) || [];
    expect(
      assignments.length,
      'the render loop must clear columns via innerHTML = \'\' (sanity: regex not vacuous)',
    ).toBeGreaterThan(0);
    for (const a of assignments) {
      expect(
        /\.innerHTML\s*=\s*(''|"")\s*$/.test(a),
        `innerHTML may only be assigned the empty-string clear, found: ${a}`,
      ).toBe(true);
    }
  });

  it('embedded_HTML_contains_no_template_literal_interpolation', () => {
    const html = boardHtmlSegment();
    expect(
      html.includes('${'),
      'the served HTML must be a static string — no ${...} interpolation of any ' +
        'value (task fields or otherwise) into the markup/script',
    ).toBe(false);
  });

  it('client_script_uses_textContent_and_createElement', () => {
    const html = boardHtmlSegment();
    expect(
      /\.textContent\s*=/.test(html),
      'card fields must be set via textContent (auto-escaping)',
    ).toBe(true);
    expect(
      /document\.createElement\(/.test(html),
      'card DOM must be built via document.createElement',
    ).toBe(true);
  });
});
