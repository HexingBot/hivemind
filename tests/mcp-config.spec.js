// tests/mcp-config.spec.js
// TASK-026 — Plugin chain P6: MCP task-store server registration (AC1 + AC2).
//
// Authoritative design: the `mcp-server` skill's
// references/esbuild-and-mcp-json.md (the .mcp.json interpolation rules) and
// SKILL.md workflow step 6, plus tasks/TASK-020.research.md §E.
//
// .mcp.json LOCATION CHOICE (stated explicitly): REPO ROOT, i.e.
// <REPO_ROOT>/.mcp.json — NOT .claude-plugin/.mcp.json. Rationale:
//   • This is a same-repo single-plugin marketplace: marketplace.json sources the
//     plugin from "./" (the repo root), so the PLUGIN ROOT == the repo root.
//   • The skill's example and references both show plugin.json re-declaring
//     `"mcpServers": "./.mcp.json"` — a path relative to the plugin (repo) root.
//   • tests/publish-config.spec.js's no-dangling-reference guard resolves that
//     string with join(REPO_ROOT, manifest.mcpServers) — so the referenced file
//     MUST sit at the repo root for the guard to find it once P6 ships the key.
// If impl decides on .claude-plugin/.mcp.json instead, plugin.json's mcpServers
// string AND the publish-config guard's resolution base would BOTH have to move
// in lockstep — that is the design tension flagged in the return summary.
//
// TESTS-FIRST: neither <REPO_ROOT>/.mcp.json nor plugin.json's `mcpServers` key
// exists yet, so the existence + shape + plugin.json-redeclaration assertions
// FAIL for the RIGHT reason (file/key absent). The .mcp.json `args` deliberately
// point at the BUNDLED dist/mcp-server.cjs (NOT src/), because a git-URL plugin
// install runs no npm install and ESM imports ignore NODE_PATH — esbuild inlines
// the SDK into the .cjs (P3 bundling decision).

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from './helpers/repoRoot.js';

const MCP_JSON = join(REPO_ROOT, '.mcp.json');
const PLUGIN_JSON = join(REPO_ROOT, '.claude-plugin', 'plugin.json');

const SERVER_NAME = 'hivemind-tasks';

function readJson(path) {
  expect(existsSync(path), `${path} must exist`).toBe(true);
  return JSON.parse(readFileSync(path, 'utf8'));
}

// ===========================================================================
// AC2 — .mcp.json exists at the plugin (repo) root and registers the server.
// ===========================================================================
describe('AC2 — .mcp.json registers the task-store MCP server', () => {
  it('mcp_json_exists_at_the_repo_root', () => {
    expect(
      existsSync(MCP_JSON),
      '<REPO_ROOT>/.mcp.json must exist (the plugin-root MCP registration)',
    ).toBe(true);
  });

  it('mcp_json_declares_exactly_one_stdio_server', () => {
    const cfg = readJson(MCP_JSON);
    expect(cfg.mcpServers && typeof cfg.mcpServers === 'object').toBe(true);
    const names = Object.keys(cfg.mcpServers);
    expect(names.length, 'exactly one MCP server must be declared').toBe(1);
    expect(names[0]).toBe(SERVER_NAME);
  });

  it('the_server_is_a_node_stdio_invocation_of_the_bundled_cjs', () => {
    const cfg = readJson(MCP_JSON);
    const srv = cfg.mcpServers[SERVER_NAME];
    expect(srv, 'the named server entry must exist').toBeTruthy();
    // stdio server: command `node`, args invoking the bundle.
    expect(srv.command).toBe('node');
    expect(Array.isArray(srv.args), 'args must be an array').toBe(true);
    const argsBlob = srv.args.join(' ');
    // ${CLAUDE_PLUGIN_ROOT} locates the immutable plugin install dir.
    expect(
      argsBlob.includes('${CLAUDE_PLUGIN_ROOT}'),
      'args must locate the bundle via ${CLAUDE_PLUGIN_ROOT}',
    ).toBe(true);
    // The args point at the BUNDLE (dist/mcp-server.cjs), not the dev source.
    expect(
      argsBlob.includes('dist/mcp-server.cjs'),
      'args must point at the bundled dist/mcp-server.cjs (NOT src/mcp-server.js)',
    ).toBe(true);
    expect(
      /src[/\\]mcp-server\.js/.test(argsBlob),
      'args must NOT point at the unbundled src/mcp-server.js',
    ).toBe(false);
  });

  it('the_server_env_passes_CLAUDE_PROJECT_DIR_through_for_repoRoot_binding', () => {
    const cfg = readJson(MCP_JSON);
    const srv = cfg.mcpServers[SERVER_NAME];
    expect(srv.env && typeof srv.env === 'object', 'server must declare an env block').toBe(true);
    // ${CLAUDE_PROJECT_DIR} is interpolated into the spawned process so the
    // server binds repoRoot to the user's repo (NOT the plugin cache dir).
    expect(srv.env.CLAUDE_PROJECT_DIR).toBe('${CLAUDE_PROJECT_DIR}');
  });

  it('the_server_does_NOT_reintroduce_NODE_PATH', () => {
    // esbuild inlines the SDK into the .cjs, so no external module resolution is
    // needed. The §E.1 spike's NODE_PATH:${CLAUDE_PLUGIN_DATA}/... line was
    // superseded by the P3 bundling decision and must NOT reappear.
    const cfg = readJson(MCP_JSON);
    const srv = cfg.mcpServers[SERVER_NAME];
    const env = srv.env || {};
    expect(Object.prototype.hasOwnProperty.call(env, 'NODE_PATH')).toBe(false);
  });
});

// ===========================================================================
// AC2 — plugin.json re-declares mcpServers pointing at the .mcp.json path.
// FAILS NOW: the key was removed in TASK-021 (no .mcp.json existed); P6 re-adds
// the key and the file together.
// ===========================================================================
describe('AC2 — plugin.json re-declares mcpServers pointing at ./.mcp.json', () => {
  it('plugin_json_mcpServers_points_at_the_dot_mcp_json', () => {
    const manifest = readJson(PLUGIN_JSON);
    expect(
      manifest.mcpServers,
      'plugin.json must re-add "mcpServers": "./.mcp.json" together with the file (P6)',
    ).toBe('./.mcp.json');
  });

  it('plugin_json_mcpServers_reference_resolves_to_a_real_file', () => {
    const manifest = readJson(PLUGIN_JSON);
    expect(typeof manifest.mcpServers).toBe('string');
    const referenced = join(REPO_ROOT, manifest.mcpServers);
    expect(
      existsSync(referenced),
      `plugin.json mcpServers points at ${manifest.mcpServers} but ${referenced} does not exist`,
    ).toBe(true);
  });
});

// ===========================================================================
// AC2 (live registration) — MANUAL CLI SENSOR.
// Mirrors the it.skip manifesto pattern in tests/plugin-scaffold.spec.js and
// tests/init-command.spec.js. `claude plugin install/details` mutate the user's
// real plugin config and spawn the MCP subprocess — slow/flaky under vitest, so
// this is a hand-run sensor the impl phase + Reviewer execute and paste into the
// ticket close.
//
//   # Build the bundle first so dist/mcp-server.cjs exists:
//   node scripts/build-plugin.mjs
//
//   # Bundle smoke test — should print the stderr banner and wait on stdin
//   # (Ctrl-C to stop). A crash on start is a bundling miss (externals / dynamic
//   # require), NOT a logic bug:
//   node dist/mcp-server.cjs
//
//   # Install from the same-repo local marketplace and confirm registration:
//   claude plugin marketplace add C:\Users\srpar\OneDrive\Documents\hivemind
//   claude plugin install hivemind@hivemind-marketplace
//   claude plugin details hivemind
//     # EXPECT: "MCP servers (1)" listing hivemind-tasks, with NO
//     #         startup error in the details output.
//
//   # Leave no residue:
//   claude plugin uninstall hivemind
//   claude plugin marketplace remove hivemind-marketplace
// ===========================================================================
describe('AC2 — claude plugin details shows MCP servers (1) (MANUAL sensor)', () => {
  it.skip('install_then_details_shows_one_mcp_server_no_startup_error_run_by_hand', () => {
    // Deliberately not automated. See the command manifesto in the comment block
    // immediately above this describe(). The reviewer executes it on Windows /
    // PowerShell and pastes the observed "MCP servers (1)" inventory line.
  });
});
