// tests/plugin-scaffold.spec.js
// TASK-021 — Plugin chain P1: scaffold the Claude Code plugin.
//
// Authoritative design: tasks/TASK-020.research.md §A (manifest + layout) and
// §D.5 (observed proof-of-load). This spec encodes the DETERMINISTIC, on-disk
// file/manifest/JSON-shape acceptance criteria. It does NOT shell out to the
// `claude` CLI — `claude plugin validate/install/details/uninstall` mutate the
// user's plugin config and are slow/flaky inside vitest. That CLI proof is a
// MANUAL sensor: see the `it.skip` manifesto at the bottom of this file for the
// exact command sequence the impl phase / reviewer runs by hand (AC1/AC2/AC3/AC6).
//
// Tests-first phase: none of the plugin scaffold files exist yet, so every
// assertion that requires them FAILS for the RIGHT reason (file does not exist
// / dir not yet created). Pre-existing specs (the engine + make-template suite)
// must remain green — this file touches no production code.
//
// AC map (TASK-021):
//   AC1 — .claude-plugin/plugin.json: name `hivemind` (stable identity;
//         beta was `hivemind-beta` for side-by-side install; now promoted).
//         (mcpServers and version: see the in-body notes — both flipped by TASK-027 P7.)
//   AC2 — .claude-plugin/marketplace.json: source `./`, valid owner.name,
//         lists the `hivemind` stable plugin (plugins[0]).
//   AC3 — plugin-root agents/ (exactly the 4) + plugin-root skills/ with the
//         repo-local tech-training-template skill.
//   AC4 — shipped-bin allowlist: make-template.js EXCLUDED; init.js +
//         new-task.js INCLUDED.
//   AC5 — covered by tests/agents-parity.spec.js (drift guard).
//   AC6 — manual CLI sensor (it.skip manifesto).

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from './helpers/repoRoot.js';

const PLUGIN_MANIFEST = join(REPO_ROOT, '.claude-plugin', 'plugin.json');
const MARKETPLACE_MANIFEST = join(REPO_ROOT, '.claude-plugin', 'marketplace.json');
const SHIPPED_BIN_MANIFEST = join(REPO_ROOT, '.claude-plugin', 'shipped-bin.json');
const PLUGIN_AGENTS_DIR = join(REPO_ROOT, 'agents');
const PLUGIN_SKILLS_DIR = join(REPO_ROOT, 'skills');
const BIN_DIR = join(REPO_ROOT, 'bin');

// TASK-032 — orchestrator.md removed: the Orchestrator is the main session
// thread, not a spawnable subagent. The plugin now ships three specialist agents.
const AGENT_FILES = ['developer.md', 'researcher.md', 'reviewer.md'];
const REPO_LOCAL_SKILL = 'tech-training-template';
// TASK-025 — the always-on orchestrator-routing backstop skill is a SECOND
// legitimately shipped repo-local skill. The plugin's skill inventory genuinely
// grew, so the "no global sweep" assertion below now pins BOTH repo-local skills
// (still excluding any global gsd-*/vue/etc.).
const BACKSTOP_SKILL = 'orchestrator-routing';
// TASK-026 — the mcp-server training skill is a THIRD legitimately shipped
// repo-local skill (authored by the researcher for the MCP task-store server).
// It exists on disk in BOTH skills/ and .claude/skills/, so the "no global
// sweep" assertion below now pins all THREE repo-local skills (still excluding
// any global gsd-*/vue/etc.).
const MCP_SKILL = 'mcp-server';
// TASK-059 — the graphify skill is a FOURTH legitimately shipped repo-local
// skill (documents the knowledge-graph.js public API + /graph command). Exists
// in BOTH skills/ and .claude/skills/ byte-identical.
const GRAPHIFY_SKILL = 'graphify';
// TASK-008 — the claude-code-context-monitor skill is a FIFTH legitimately
// shipped repo-local skill (documents the context-autoflush feature shipped
// under context-monitor/). Lives in skills/ only (no .claude/skills/ parity
// copy required — it is the plugin's own skill, not a dogfood copy).
const CONTEXT_MONITOR_SKILL = 'claude-code-context-monitor';
// Phase 3 (P3.2) — the six vendored language-agnostic manifest skills (Spine spec layer).
// Each ships in BOTH skills/ and .claude/skills/ byte-identical (see manifest-skills.spec.js).
const MANIFEST_SKILLS = [
  'impl-screen-specs', 'impl-api-contracts', 'impl-state-schemas',
  'impl-component-catalog', 'impl-project-structure', 'impl-block-tasks',
];
// P3.3 — the independent manifest-verifier role (objective spec gate) ships as a skill too.
const VERIFIER_SKILL = 'manifest-verifier';
const REPO_LOCAL_SKILLS = [
  BACKSTOP_SKILL, REPO_LOCAL_SKILL, MCP_SKILL, GRAPHIFY_SKILL, CONTEXT_MONITOR_SKILL,
  ...MANIFEST_SKILLS, VERIFIER_SKILL,
].sort();

/** Read + JSON.parse a manifest, surfacing a clear failure when it's absent. */
function readJson(path) {
  expect(existsSync(path), `${path} must exist`).toBe(true);
  const raw = readFileSync(path, 'utf8');
  return JSON.parse(raw); // a malformed manifest throws here — a "right" failure.
}

// ===========================================================================
// AC1 — plugin.json manifest.
// ===========================================================================
describe('AC1 — .claude-plugin/plugin.json declares the plugin', () => {
  it('plugin_manifest_exists_and_is_valid_json', () => {
    const manifest = readJson(PLUGIN_MANIFEST);
    expect(typeof manifest).toBe('object');
    expect(manifest).not.toBeNull();
  });

  it('plugin_name_is_hivemind', () => {
    // Stable identity: name is hivemind (the public install handle).
    const manifest = readJson(PLUGIN_MANIFEST);
    expect(manifest.name).toBe('hivemind');
  });

  it('plugin_mcpServers_points_at_the_dot_mcp_json_now_that_P6_ships_it', () => {
    // FLIPPED BY TASK-026 P6 (the MCP task-store server). The TASK-021 → P7
    // interim state REMOVED `mcpServers` because .mcp.json did not exist yet (a
    // dangling reference would fail `claude plugin validate`/`install`). P6 ships
    // src/mcp-server.js + <REPO_ROOT>/.mcp.json TOGETHER and re-adds the key, so
    // the assertion flips from "must be undefined" to "must point at ./.mcp.json".
    // The publish-config no-dangling-reference guard then proves the file resolves.
    // FAILS until the impl phase adds the key — correct tests-first state.
    const manifest = readJson(PLUGIN_MANIFEST);
    expect(manifest.mcpServers).toBe('./.mcp.json');
  });

  it('plugin_version_is_pinned_for_publish', () => {
    // SUPERSEDED BY TASK-027 P7 AC3 (Q6 resolved by the human 2026-05-29): dev
    // used commit-SHA versioning, so this assertion originally required the
    // version to be UNSET — the comment explicitly said "flip then" at publish
    // time. First release pins an explicit semver in plugin.json (the single
    // version source of truth). The fine-grained semver/value contract lives in
    // tests/publish-config.spec.js; here we only pin that a version now EXISTS.
    const manifest = readJson(PLUGIN_MANIFEST);
    expect(typeof manifest.version).toBe('string');
    expect(manifest.version.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// AC2 — marketplace.json catalog.
// ===========================================================================
describe('AC2 — .claude-plugin/marketplace.json catalogs the plugin', () => {
  it('marketplace_manifest_exists_and_is_valid_json', () => {
    const m = readJson(MARKETPLACE_MANIFEST);
    expect(typeof m).toBe('object');
    expect(m).not.toBeNull();
  });

  it('marketplace_has_a_valid_owner_name', () => {
    const m = readJson(MARKETPLACE_MANIFEST);
    expect(m.owner).toBeTruthy();
    expect(typeof m.owner.name).toBe('string');
    expect(m.owner.name.length).toBeGreaterThan(0);
  });

  it('marketplace_lists_the_hivemind_plugin_with_same_repo_source', () => {
    // Stable identity: primary marketplace entry is hivemind at source './'.
    const m = readJson(MARKETPLACE_MANIFEST);
    expect(Array.isArray(m.plugins), 'marketplace.plugins must be an array').toBe(true);
    const entry = m.plugins.find((p) => p && p.name === 'hivemind');
    expect(entry, 'marketplace must list the hivemind plugin').toBeTruthy();
    // Same-repo layout: source is the relative repo root.
    expect(entry.source).toBe('./');
  });
});

// ===========================================================================
// AC3 — components relocated to the plugin root.
// ===========================================================================
describe('AC3 — agents/ and skills/ live at the plugin root', () => {
  it('plugin_agents_dir_contains_exactly_the_three_specialist_agents', () => {
    expect(existsSync(PLUGIN_AGENTS_DIR), 'plugin-root agents/ must exist').toBe(true);
    const entries = readdirSync(PLUGIN_AGENTS_DIR)
      .filter((n) => n.endsWith('.md'))
      .sort();
    expect(entries).toEqual([...AGENT_FILES].sort());
  });

  it('plugin_skills_dir_contains_the_repo_local_tech_training_template_skill', () => {
    expect(existsSync(PLUGIN_SKILLS_DIR), 'plugin-root skills/ must exist').toBe(true);
    const skillDir = join(PLUGIN_SKILLS_DIR, REPO_LOCAL_SKILL);
    expect(
      existsSync(skillDir) && statSync(skillDir).isDirectory(),
      `skills/${REPO_LOCAL_SKILL}/ must exist`,
    ).toBe(true);
    // A skill is identified by its SKILL.md.
    expect(
      existsSync(join(skillDir, 'SKILL.md')),
      `skills/${REPO_LOCAL_SKILL}/SKILL.md must exist`,
    ).toBe(true);
  });

  it('plugin_skills_dir_does_NOT_sweep_in_global_skills', () => {
    // Repo-local scope is exactly the two repo-local skills (tech-training-template
    // + the TASK-025 orchestrator-routing backstop). Global gsd-*/vue/etc. must
    // NOT be dragged into the plugin (locked decision: verify repo-local vs
    // user-global).
    expect(existsSync(PLUGIN_SKILLS_DIR), 'plugin-root skills/ must exist').toBe(true);
    const skillEntries = readdirSync(PLUGIN_SKILLS_DIR)
      .filter((n) => statSync(join(PLUGIN_SKILLS_DIR, n)).isDirectory())
      .sort();
    expect(skillEntries).toEqual(REPO_LOCAL_SKILLS);
  });
});

// ===========================================================================
// AC4 — shipped-bin allowlist points at the committed dist bundles.
// ===========================================================================
// UPDATED for the TASK-023 esbuild bundling pivot (orchestrator-authorized,
// like the TASK-002 Ajv precedent). The original TASK-021 AC4 pinned the
// allowlist to raw bin/ sources (`{ "bin": ["init.js", "new-task.js"] }`). After
// P3, the SHIPPED entrypoints are the self-contained esbuild bundles under
// dist/ — a git-URL plugin install ships no node_modules, so bin/*.js + src/*
// (which import ajv/gray-matter) are dev/test sources only, and the runnable
// shipped CLIs are dist/init.cjs / dist/new-task.cjs. AC4's INTENT is preserved:
// ship init + new-task, exclude make-template, and every listed entry is a real
// file. Only the representation changed (paths now include dist/, *.cjs).
describe('AC4 — shipped-bin allowlist points at the committed dist bundles', () => {
  it('shipped_bin_manifest_exists_and_lists_a_bin_array', () => {
    const m = readJson(SHIPPED_BIN_MANIFEST);
    expect(Array.isArray(m.bin), 'shipped-bin.json must have a `bin` string array').toBe(true);
    for (const name of m.bin) {
      expect(typeof name).toBe('string');
    }
  });

  it('shipped_bin_includes_init_and_new_task_bundles', () => {
    const m = readJson(SHIPPED_BIN_MANIFEST);
    expect(m.bin).toContain('dist/init.cjs');
    expect(m.bin).toContain('dist/new-task.cjs');
  });

  it('shipped_bin_excludes_make_template', () => {
    const m = readJson(SHIPPED_BIN_MANIFEST);
    // No shipped entry references the make-template scrub tool, in any form.
    for (const name of m.bin) {
      expect(/make-template/.test(name)).toBe(false);
    }
  });

  it('every_shipped_bin_entry_actually_exists_at_repo_root_relative_path', () => {
    // The allowlist must not reference phantom files — each entry resolves to a
    // real file relative to the repo root (the path now includes dist/).
    const m = readJson(SHIPPED_BIN_MANIFEST);
    for (const name of m.bin) {
      expect(
        existsSync(join(REPO_ROOT, name)),
        `shipped bin entry ${name} must exist at ${join(REPO_ROOT, name)}`,
      ).toBe(true);
    }
  });

  it('make_template_still_present_in_repo_bin_for_publish_time_use', () => {
    // Excluded from SHIPPING, but it must still live in the repo bin/ so it can
    // be run at publish time to scrub a distribution clone. (Sanity: this passes
    // today; it guards against an impl that physically deletes the file.)
    expect(existsSync(join(BIN_DIR, 'make-template.js'))).toBe(true);
  });
});

// ===========================================================================
// MANUAL CLI SENSOR — AC1/AC2/AC3/AC6 end-to-end load proof.
// ===========================================================================
// This is intentionally skipped. `claude plugin validate/install/details/
// uninstall` mutate the user's real plugin config and are slow/flaky under
// vitest — they are a MANUAL sensor, not an automated spec. The impl phase and
// the Reviewer run the sequence below by hand (Windows / PowerShell) and paste
// the observed inventory into the ticket close, mirroring the §D.5 proof.
//
//   # AC1/AC2 — manifests validate (warnings OK, zero errors):
//   claude plugin validate C:\Users\srpar\OneDrive\Documents\hivemind
//
//   # AC2/AC3 — install from the same-repo local marketplace, list components:
//   claude plugin marketplace add C:\Users\srpar\OneDrive\Documents\hivemind
//   claude plugin install hivemind@hivemind-marketplace
//   claude plugin details hivemind
//     # EXPECT (per §D.5 inventory buckets): Agents (3) =
//     #   developer / researcher / reviewer (orchestrator removed in TASK-032),
//     #   and the tech-training-template skill. NOTE §D.5: commands/ files may
//     #   surface under the "Skills" bucket in this Claude Code version — count
//     #   agents (must be 3) and confirm the skill appears; zero manifest errors.
//
//   # AC6 — leave NO residue in the user's plugin config:
//   claude plugin uninstall hivemind
//   claude plugin marketplace remove hivemind-marketplace
//   claude plugin list           # must show no hivemind
//   claude plugin marketplace list  # must show no hivemind-marketplace
describe('AC1/AC2/AC3/AC6 — claude CLI load proof (MANUAL sensor)', () => {
  it.skip('validate_install_details_uninstall_is_run_by_hand_see_comment_above', () => {
    // Deliberately not automated. See the command manifesto in the comment
    // block immediately above this describe(). The reviewer executes it.
  });
});
