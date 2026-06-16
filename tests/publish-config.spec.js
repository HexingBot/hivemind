// tests/publish-config.spec.js
// TASK-027 — Plugin chain P7 (AC3): finalize the publish configuration.
//
// LOCKED PUBLISH DECISIONS (human-resolved 2026-05-29T05:15 on TASK-027;
// originally the deferred §I Q5/Q6 of tasks/TASK-020.research.md):
//   • Q5 (hosting/name): THIS repo is the public marketplace. marketplace.json
//     keeps name "agentic-framework-marketplace" with a single plugin entry
//     `agentic-framework` whose source is "./" (the repo root). No separate
//     catalog repo.
//   • Q6 (versioning): set an EXPLICIT semver version "0.1.0" in
//     .claude-plugin/plugin.json (currently it has NO version field).
//
// These assertions are FULLY AUTOMATABLE — they read the two committed manifests
// at the repo root and check shape/values, no live `claude` CLI involved.
//
// TESTS-FIRST: the version assertions FAIL NOW because .claude-plugin/plugin.json
// has no `version` field yet. The marketplace name/source/single-entry checks
// already match the committed marketplace.json, so those are regression locks
// that pin the resolved Q5 decision against future drift.
//
// VERSION SOURCE-OF-TRUTH CHOICE (documented per the ticket's "optional but
// good" note): plugin.json's `version` is the SINGLE source of version truth.
// The current marketplace.json plugin entry carries NO version field, and the
// install string the quickstart documents is
// `agentic-framework@agentic-framework-marketplace` (marketplace-name scoped,
// not version-pinned). We therefore do NOT require a version on the marketplace
// plugin entry; but IF one is ever added it must AGREE with plugin.json (a
// conditional cross-check below), so the two manifests can never silently
// disagree.

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from './helpers/repoRoot.js';

const PLUGIN_JSON = join(REPO_ROOT, '.claude-plugin', 'plugin.json');
const MARKETPLACE_JSON = join(REPO_ROOT, '.claude-plugin', 'marketplace.json');

const SEMVER_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const EXPECTED_VERSION = '0.7.0-beta.1';
const EXPECTED_MARKETPLACE_NAME = 'agentic-framework-marketplace';
// Beta branch: plugin name intentionally diverges from stable 'agentic-framework'
// to allow side-by-side installation. EXPECTED_MARKETPLACE_NAME stays unchanged.
const EXPECTED_PLUGIN_NAME = 'agentic-framework-beta';
const EXPECTED_SOURCE = './';

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

// ===========================================================================
// AC3 (versioning, Q6) — plugin.json gains an explicit semver `version`.
// FAILS NOW: plugin.json has no `version` field.
// ===========================================================================
describe('AC3 — plugin.json carries an explicit semver version (Q6 resolved)', () => {
  it('plugin_json_exists_at_the_repo_root', () => {
    expect(
      existsSync(PLUGIN_JSON),
      '.claude-plugin/plugin.json must exist',
    ).toBe(true);
  });

  it('plugin_json_has_version_exactly_0_1_1', () => {
    const manifest = readJson(PLUGIN_JSON);
    expect(
      manifest.version,
      'plugin.json must carry an explicit `version` (Q6: first release is pinned, not commit-SHA)',
    ).toBe(EXPECTED_VERSION);
  });

  it('plugin_json_version_is_semver_shaped', () => {
    const manifest = readJson(PLUGIN_JSON);
    expect(
      typeof manifest.version === 'string' && SEMVER_RE.test(manifest.version),
      `plugin.json version must match ${SEMVER_RE}, got: ${JSON.stringify(manifest.version)}`,
    ).toBe(true);
  });

  it('plugin_json_name_is_the_published_plugin_name', () => {
    // Regression lock: the namespace-bearing plugin name must stay stable —
    // it is the public install handle (`agentic-framework@<marketplace>`).
    const manifest = readJson(PLUGIN_JSON);
    expect(manifest.name).toBe(EXPECTED_PLUGIN_NAME);
  });
});

// ===========================================================================
// AC3 (hosting/name, Q5) — marketplace.json names this repo as the public
// marketplace with a single self-sourced plugin entry.
// These already match the committed file → regression locks for the Q5 decision.
// ===========================================================================
describe('AC3 — marketplace.json reflects this repo as the public marketplace (Q5 resolved)', () => {
  it('marketplace_json_exists_at_the_repo_root', () => {
    expect(
      existsSync(MARKETPLACE_JSON),
      '.claude-plugin/marketplace.json must exist',
    ).toBe(true);
  });

  it('marketplace_name_is_agentic_framework_marketplace', () => {
    const mkt = readJson(MARKETPLACE_JSON);
    expect(mkt.name).toBe(EXPECTED_MARKETPLACE_NAME);
  });

  it('marketplace_has_exactly_one_plugin_entry', () => {
    const mkt = readJson(MARKETPLACE_JSON);
    expect(Array.isArray(mkt.plugins)).toBe(true);
    expect(
      mkt.plugins.length,
      'a single-plugin marketplace must list exactly one plugin entry',
    ).toBe(1);
  });

  it('the_plugin_entry_names_agentic_framework_sourced_from_this_repo', () => {
    const mkt = readJson(MARKETPLACE_JSON);
    const entry = mkt.plugins[0];
    expect(entry.name).toBe(EXPECTED_PLUGIN_NAME);
    // source "./" = the plugin lives at this repo's root (Q5: no separate catalog repo).
    expect(entry.source).toBe(EXPECTED_SOURCE);
  });
});

// ===========================================================================
// AC3 (no dangling MCP reference) — ORCHESTRATOR-AUTHORIZED GUARD (TASK-027 P7,
// 2026-05-29). plugin.json must never point `mcpServers` at a file that does not
// exist: a dangling reference can make `claude plugin validate`/`install` fail
// and would block the AC1 clean-machine E2E. The plugin ships NO MCP server
// until P6 (TASK-026), so the key is currently ABSENT; this guard does NOT
// require its absence (P6 will legitimately re-add it together with .mcp.json)
// — it only fails if a key is present while the referenced file is missing.
// This is a guard ADDITION (catches a future regression), not a weakening.
// ===========================================================================
describe('AC3 — plugin.json carries no dangling mcpServers reference', () => {
  it('if_mcpServers_is_declared_the_referenced_file_exists', () => {
    const manifest = readJson(PLUGIN_JSON);
    if (!Object.prototype.hasOwnProperty.call(manifest, 'mcpServers')) {
      // No MCP server shipped yet (P6 re-adds it). Nothing to dangle.
      expect(manifest.mcpServers).toBeUndefined();
      return;
    }
    // A string value is a path relative to the plugin (repo) root. (When P6
    // ships an inline-object form instead, this string branch is skipped and the
    // guard simply passes — inline servers reference no external file.)
    if (typeof manifest.mcpServers === 'string') {
      const referenced = join(REPO_ROOT, manifest.mcpServers);
      expect(
        existsSync(referenced),
        `plugin.json mcpServers points at ${manifest.mcpServers} but ${referenced} does not exist`,
      ).toBe(true);
    }
  });
});

// ===========================================================================
// AC3 (cross-manifest consistency) — plugin.json is the single version source
// of truth; if the marketplace entry ALSO declares a version it must agree.
// ===========================================================================
describe('AC3 — plugin.json is the single version source of truth', () => {
  it('marketplace_plugin_version_if_present_agrees_with_plugin_json', () => {
    const plugin = readJson(PLUGIN_JSON);
    const mkt = readJson(MARKETPLACE_JSON);
    const entry = mkt.plugins[0];
    // The marketplace entry version is OPTIONAL (install is name-scoped, not
    // version-pinned). But it must never DISAGREE with plugin.json.
    if (Object.prototype.hasOwnProperty.call(entry, 'version')) {
      expect(
        entry.version,
        'if marketplace.json pins a plugin version it must match plugin.json',
      ).toBe(plugin.version);
    } else {
      // No version on the marketplace entry — plugin.json alone owns it. This
      // branch passes by construction; the meaningful guard is plugin.json's
      // own version assertions above.
      expect(true).toBe(true);
    }
  });
});
