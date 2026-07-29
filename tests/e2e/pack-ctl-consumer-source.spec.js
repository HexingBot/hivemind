// tests/e2e/pack-ctl-consumer-source.spec.js
// TASK-181 — the consumer-shaped reconcile-apply path.
//
// Why this file exists separately from tests/e2e/pack-ctl.spec.js: that spec's
// makeProject helper STAGES the owned copies into the tmp fixture's own
// `assimilated-skills/` (see its stageOwned helper) before running the CLI. That
// manufactures a precondition which never holds for a real consumer project, so
// the whole suite stayed green while every downstream install was silently
// broken. It even locks the soft-failure as acceptable
// ("a_soft_skill_missing_its_owned_source_degrades_via_leave_and_report").
//
// These specs deliberately do the opposite: a consumer fixture with NOTHING but
// a PROJECT.md — no assimilated-skills/ of its own, exactly like a real project
// that installed the plugin — and assert the skills actually materialize from
// the PLUGIN's owned copies.
//
// Real disk I/O + process spawn -> slow tier.

import { describe, it, expect, afterAll } from 'vitest';
import { existsSync, readFileSync, mkdirSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';
import { REPO_ROOT } from '../helpers/repoRoot.js';
import { writeProjectMd } from '../../src/project-md.js';
import { scoreComplexity, deriveProfileFields } from '../../src/design-profile.js';

afterAll(cleanupAll);

const SRC_CLI = join(REPO_ROOT, 'bin', 'pack-ctl.js');
const DIST_CLI = join(REPO_ROOT, 'dist', 'pack-ctl.cjs');

// A design profile that activates ui-ux-pro-max, so the fixture proves the fix
// for the design-power pack too — `watch` alone would not, since watch is
// activate_when:"always" and could pass via a narrower code path.
const DESIGN_ANSWERS = {
  design_heavy: 'yes',
  estimated_screens: 10,
  stakes: 'real',
  design_ambition: 'tidy',
  ui_framework: 'other',
  has_canvas_render: 'no',
  motion_required: 'no',
  needs_research: 'have-direction',
  assets_required: ['none'],
};

/** A consumer project: PROJECT.md and nothing else. No assimilated-skills/. */
async function makeConsumerProject() {
  const root = await makeTmpDir('consumer-project');
  const profile = deriveProfileFields(DESIGN_ANSWERS, scoreComplexity(DESIGN_ANSWERS));
  await writeProjectMd({
    repoRoot: root,
    answers: {
      project_name: 'fixture-consumer',
      project_type: 'web-saas',
      primary_use_cases: ['browse'],
      target_users: 'people',
      stack: ['node'],
      ...profile,
    },
  });
  // The load-bearing precondition: a consumer has no owned copies of its own.
  expect(existsSync(join(root, 'assimilated-skills'))).toBe(false);
  return root;
}

function runCli(cli, args, { cwd, env } = {}) {
  const cleanEnv = { ...process.env, ...env };
  delete cleanEnv.CLAUDE_PROJECT_DIR;
  delete cleanEnv.CLAUDE_PLUGIN_ROOT;
  if (env) Object.assign(cleanEnv, env);
  const r = spawnSync(process.execPath, [cli, ...args], {
    cwd: cwd || REPO_ROOT,
    env: cleanEnv,
    encoding: 'utf8',
  });
  const line = (r.stdout || '').trim().split('\n').filter(Boolean).pop() || '';
  let json = null;
  try { json = JSON.parse(line); } catch { /* leave null */ }
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', json };
}

describe('TASK-181 — reconcile-apply materializes built-in pack skills into a consumer project', () => {
  it('installs BOTH watch and ui-ux-pro-max from the plugin owned copies, not the consumer root', async () => {
    const root = await makeConsumerProject();
    const result = runCli(SRC_CLI, ['reconcile-apply', '--repo-root', root]);

    expect(result.status).toBe(0);

    const installedIds = result.json.packs.flatMap((p) => p.installed).sort();
    expect(installedIds).toContain('skill:watch');
    expect(installedIds).toContain('skill:ui-ux-pro-max');

    // No pack may report a missing owned source any more.
    const notFound = result.json.packs
      .flatMap((p) => p.report)
      .filter((r) => /owned source not found/.test(r.reason || ''));
    expect(notFound).toEqual([]);

    // Live on disk, with the scripts (not just SKILL.md).
    expect(existsSync(join(root, '.claude', 'skills', 'watch', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(root, '.claude', 'skills', 'watch', 'scripts', 'watch.py'))).toBe(true);
    expect(existsSync(join(root, '.claude', 'skills', 'ui-ux-pro-max', 'SKILL.md'))).toBe(true);
  });

  it('materializes watch byte-identical to the plugin owned copy (provenance pin intact)', async () => {
    const root = await makeConsumerProject();
    runCli(SRC_CLI, ['reconcile-apply', '--repo-root', root]);

    const owned = readFileSync(join(REPO_ROOT, 'assimilated-skills', 'watch', 'scripts', 'watch.py'));
    const live = readFileSync(join(root, '.claude', 'skills', 'watch', 'scripts', 'watch.py'));
    expect(live.equals(owned)).toBe(true);

    const skillMd = readFileSync(join(root, '.claude', 'skills', 'watch', 'SKILL.md'), 'utf8');
    expect(skillMd).toContain('pin: 83da59fa78c3eee9e20f515fe75c438bb5166efd');
  });

  it('is idempotent — a second run installs nothing new and does not thrash the copy', async () => {
    const root = await makeConsumerProject();
    runCli(SRC_CLI, ['reconcile-apply', '--repo-root', root]);
    const second = runCli(SRC_CLI, ['reconcile-apply', '--repo-root', root]);

    expect(second.status).toBe(0);
    expect(second.json.plan.install).toEqual([]);
    for (const pack of second.json.packs) expect(pack.installed).toEqual([]);
  });

  it('works from the BUNDLED dist/ CLI in a plugin-cache-shaped dir with no node_modules', async () => {
    // The launch mode that actually matters downstream: dist/pack-ctl.cjs sitting
    // under a copied plugin root, run with cwd far away from it. esbuild replaces
    // import.meta with {}, so this is the case where __dirname must carry the day.
    const pluginRoot = await makeTmpDir('plugin-cache');
    mkdirSync(join(pluginRoot, 'dist'), { recursive: true });
    cpSync(DIST_CLI, join(pluginRoot, 'dist', 'pack-ctl.cjs'));
    cpSync(join(REPO_ROOT, 'assimilated-skills'), join(pluginRoot, 'assimilated-skills'), { recursive: true });

    const root = await makeConsumerProject();
    const result = runCli(join(pluginRoot, 'dist', 'pack-ctl.cjs'), ['reconcile-apply', '--repo-root', root], {
      cwd: root, // cwd is the CONSUMER, not the plugin — resolution must not use cwd
    });

    expect(result.status).toBe(0);
    const installedIds = result.json.packs.flatMap((p) => p.installed);
    expect(installedIds).toContain('skill:watch');
    expect(existsSync(join(root, '.claude', 'skills', 'watch', 'scripts', 'watch.py'))).toBe(true);
  });

  it('does NOT regress the framework repo: its own owned copies still resolve and steady-state no-ops', async () => {
    const result = runCli(SRC_CLI, ['reconcile-apply', '--repo-root', REPO_ROOT]);
    expect(result.status).toBe(0);
    // The framework repo already has both skills live under .claude/skills/, so a
    // reconcile must be a pure no-op — never a reinstall loop.
    expect(result.json.plan.install).toEqual([]);
    const notFound = result.json.packs
      .flatMap((p) => p.report)
      .filter((r) => /owned source not found/.test(r.reason || ''));
    expect(notFound).toEqual([]);
  });
});

describe('TASK-181 — a total materialize failure is distinguishable from "nothing to do"', () => {
  it('reports installed_count and a non-empty plan so a silent zero-install cannot read as success', async () => {
    // The compounding defect: the failure is required:"soft", so it degrades into
    // `report` while the CLI still prints ok:true. A consumer had no way to tell
    // "nothing needed installing" from "everything failed to install".
    const root = await makeConsumerProject();
    const result = runCli(SRC_CLI, ['reconcile-apply', '--repo-root', root], {
      // Point the resolver at a root with no owned copies to force the failure.
      env: { HIVEMIND_OWNED_SOURCE_ROOT: join(root, 'definitely-not-here') },
    });

    expect(result.json.planned_install_count).toBeGreaterThan(0);
    expect(result.json.installed_count).toBe(0);
    expect(result.json.ok).toBe(false);
  });
});
