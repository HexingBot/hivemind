// tests/e2e/pack-ctl.spec.js
// TASK-134 — e2e regression locks for bin/pack-ctl.js (built as
// dist/pack-ctl.cjs), the CLI wrapper exposing the deterministic addon-pack
// ops (resolveDesired / pack-reconcile / pack-orchestrator) to a
// plugin-installed project that has no cleanly-reachable src/. Mirrors
// tests/e2e/loop-ctl.spec.js's own shape exactly (spawn the BUILT bundle, not
// the src) — see that file's header for the established precedent.
//
// AC map:
//   AC1 — `resolve --repo-root <r>` prints the desired resource set as JSON,
//         identical to a direct resolveDesired() call for the fixture.
//   AC2 — `reconcile-plan --repo-root <r>` prints {install,remove,replace,report}
//         for skills over the fixture's actual state + integrations.lock.json.
//   AC3 — `reconcile-apply --repo-root <r>` materializes desired skills +
//         atomically writes integrations.lock.json; a second run is idempotent
//         (empty install/remove/replace on the freshly recomputed plan).
//   AC4 — dist/pack-ctl.cjs is committed (registered in shipped-bin.json +
//         build-plugin.mjs ENTRYPOINT_NAMES; dist-parity + plugin-scaffold
//         specs cover the registration itself under `npm run test:all`).
//   AC5 — unknown subcommand / missing --repo-root exits non-zero with a
//         clear stderr message; no partial writes on error.
//
// Real disk I/O + process spawn -> slow tier: tests/e2e/.

import { describe, it, expect, afterAll } from 'vitest';
import {
  mkdirSync, writeFileSync, readFileSync, existsSync,
} from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';
import { REPO_ROOT } from '../helpers/repoRoot.js';

// These production modules all pre-date this ticket (TASK-125/128/130/131) —
// only bin/pack-ctl.js (spawned via CLI below, never imported) is new here,
// so these are plain static imports rather than the PROD dynamic-import
// convention (which exists specifically to let "module doesn't exist yet"
// register as a right-reason red for genuinely new production modules).
import { writeProjectMd } from '../../src/project-md.js';
import { scoreComplexity, deriveProfileFields } from '../../src/design-profile.js';
import { resolveDesired } from '../../src/pack-resources.js';
import { DESIGN_POWER_DESCRIPTOR } from '../../src/builtin-packs.js';

afterAll(cleanupAll);

const CLI = join(REPO_ROOT, 'dist', 'pack-ctl.cjs');

function runCli(args, { cwd, env } = {}) {
  const cleanEnv = { ...process.env, ...env };
  delete cleanEnv.CLAUDE_PROJECT_DIR;
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: cwd || REPO_ROOT,
    env: cleanEnv,
    encoding: 'utf8',
  });
  const stdoutLine = (r.stdout || '').trim().split('\n').filter(Boolean).pop() || '';
  let json = null;
  try { json = JSON.parse(stdoutLine); } catch { /* leave null */ }
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', json };
}

// A MEDIO-tier, "other" framework profile: activates exactly two resources
// from the real production design-power descriptor — frontend-design
// (kind:"plugin", Wave-2 report-only) and ui-ux-pro-max (kind:"skill", the
// only Wave-1-materializable resource for this profile). Keeps the fixture
// minimal (one skill to stage) while still exercising the Wave-2 report path.
const MEDIO_OTHER_ANSWERS = {
  design_heavy: 'yes',
  estimated_screens: 10, // F bucket 2 (fHigh)
  stakes: 'real',
  design_ambition: 'tidy', // B = 1 (not bHigh) -> tier MEDIO
  ui_framework: 'other',
  has_canvas_render: 'no',
  motion_required: 'no',
  needs_research: 'have-direction',
  assets_required: ['none'],
};

async function makeProject() {
  const root = makeTmpDir('af-packctl');
  const { tier, perfil_proyecto } = deriveProfileFields(MEDIO_OTHER_ANSWERS);
  await writeProjectMd({
    repoRoot: root,
    answers: {
      project_name: 'pack-ctl-fixture',
      project_type: 'web-saas',
      tier,
      perfil_proyecto,
    },
    now: () => '2026-07-09T00:00:00Z',
  });
  return root;
}

function stageOwnedSkill(root, id, contents = '# Skill\nFixture owned copy.\n') {
  const dir = join(root, 'assimilated-skills', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), contents);
  return dir;
}

describe('pack-ctl bundle exists and runs standalone', () => {
  it('dist/pack-ctl.cjs is committed', () => {
    expect(existsSync(CLI), 'run `npm run build:plugin` to produce dist/pack-ctl.cjs').toBe(true);
  });
});

// ===========================================================================
// AC1 — resolve
// ===========================================================================
describe('AC1 — resolve prints the desired resource set as JSON', () => {
  it('resolve_matches_resolveDesired_for_the_fixture', async () => {
    const root = await makeProject();
    const result = runCli(['resolve', '--repo-root', root]);

    expect(result.status).toBe(0);
    expect(result.json.ok).toBe(true);

    const expected = resolveDesired(DESIGN_POWER_DESCRIPTOR, scoreComplexity(MEDIO_OTHER_ANSWERS));
    expect(result.json.desired).toEqual(expected);
    expect(result.json.desired.map((r) => r.id).sort()).toEqual(['frontend-design', 'ui-ux-pro-max']);
  });
});

// ===========================================================================
// AC2 — reconcile-plan
// ===========================================================================
describe('AC2 — reconcile-plan prints {install,remove,replace,report} for skills', () => {
  it('reconcile_plan_before_any_materialization_plans_the_install_and_reports_wave2', async () => {
    const root = await makeProject();
    const result = runCli(['reconcile-plan', '--repo-root', root]);

    expect(result.status).toBe(0);
    expect(result.json.ok).toBe(true);
    const { plan } = result.json;

    expect(plan.install.map((op) => op.id)).toContain('skill:ui-ux-pro-max');
    expect(plan.remove).toEqual([]);
    expect(plan.replace).toEqual([]);
    const pluginReport = plan.report.find((r) => r.id === 'plugin:frontend-design');
    expect(pluginReport).toMatchObject({ blocking: true });

    // Read-only: no lock file, no live skill dir created as a side effect.
    expect(existsSync(join(root, 'integrations.lock.json'))).toBe(false);
    expect(existsSync(join(root, '.claude', 'skills', 'ui-ux-pro-max'))).toBe(false);
  });
});

// ===========================================================================
// AC3 — reconcile-apply (materialize + idempotency)
// ===========================================================================
describe('AC3 — reconcile-apply materializes skills and writes integrations.lock.json atomically; idempotent on re-run', () => {
  it('first_run_materializes_the_skill_and_records_the_lock_owner_then_second_run_is_a_no_op', async () => {
    const root = await makeProject();
    stageOwnedSkill(root, 'ui-ux-pro-max', '# UI/UX Pro Max\nFixture owned copy.\n');

    const first = runCli(['reconcile-apply', '--repo-root', root]);
    expect(first.status).toBe(0);
    expect(first.json.ok).toBe(true);
    expect(first.json.plan.install.map((op) => op.id)).toContain('skill:ui-ux-pro-max');

    const liveFile = join(root, '.claude', 'skills', 'ui-ux-pro-max', 'SKILL.md');
    expect(existsSync(liveFile)).toBe(true);
    expect(readFileSync(liveFile, 'utf8')).toBe('# UI/UX Pro Max\nFixture owned copy.\n');

    const lockPath = join(root, 'integrations.lock.json');
    expect(existsSync(lockPath)).toBe(true);
    const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
    expect(lock.resources['skill:ui-ux-pro-max'].owners).toEqual(['design-power@0.1.0']);

    const designPowerPack = first.json.packs.find((p) => p.id === 'design-power');
    expect(designPowerPack.aborted).toBe(false);
    expect(designPowerPack.installed).toContain('skill:ui-ux-pro-max');

    // --- second run: idempotent, empty plan (steady-state no-op) ---
    const second = runCli(['reconcile-apply', '--repo-root', root]);
    expect(second.status).toBe(0);
    expect(second.json.plan.install).toEqual([]);
    expect(second.json.plan.remove).toEqual([]);
    expect(second.json.plan.replace).toEqual([]);
    const designPowerPack2 = second.json.packs.find((p) => p.id === 'design-power');
    expect(designPowerPack2.installed).toEqual([]);
    expect(readFileSync(liveFile, 'utf8')).toBe('# UI/UX Pro Max\nFixture owned copy.\n');
  });

  it('a_soft_skill_missing_its_owned_source_degrades_via_leave_and_report_without_aborting', async () => {
    // No assimilated-skills staged at all -> ui-ux-pro-max (soft) fails to
    // materialize but the run does not abort (leave-and-report).
    const root = await makeProject();
    const result = runCli(['reconcile-apply', '--repo-root', root]);

    expect(result.status).toBe(0);
    const designPowerPack = result.json.packs.find((p) => p.id === 'design-power');
    expect(designPowerPack.aborted).toBe(false);
    expect(existsSync(join(root, '.claude', 'skills', 'ui-ux-pro-max'))).toBe(false);
  });
});

// ===========================================================================
// AC5 — unknown subcommand / missing --repo-root: non-zero exit, clear
// stderr, no partial writes.
// ===========================================================================
describe('AC5 — argument-error paths exit non-zero with clear stderr and make no partial writes', () => {
  it('bare_invocation_with_no_subcommand_exits_nonzero_with_a_usage_message', () => {
    const { status, json, stderr } = runCli([]);
    expect(status).not.toBe(0);
    expect(json.ok).toBe(false);
    expect(json.message).toMatch(/usage: pack-ctl/);
    expect(stderr).toMatch(/usage: pack-ctl/);
  });

  it('unknown_subcommand_exits_nonzero_with_a_usage_message', () => {
    const { status, json } = runCli(['not-a-real-subcommand', '--repo-root', REPO_ROOT]);
    expect(status).not.toBe(0);
    expect(json.ok).toBe(false);
    expect(json.message).toMatch(/usage: pack-ctl/);
  });

  it('missing_repo_root_exits_nonzero_with_a_clear_stderr_message', () => {
    const { status, json, stderr } = runCli(['resolve']);
    expect(status).not.toBe(0);
    expect(json.ok).toBe(false);
    expect(json.message).toMatch(/--repo-root/);
    expect(stderr).toMatch(/--repo-root/);
  });

  it('reconcile_apply_failure_path_missing_project_md_makes_no_partial_writes', () => {
    const root = makeTmpDir('af-packctl-noprojectmd');
    const result = runCli(['reconcile-apply', '--repo-root', root]);

    expect(result.status).not.toBe(0);
    expect(result.json.ok).toBe(false);
    expect(result.json.message).toMatch(/PROJECT\.md/);
    expect(existsSync(join(root, 'integrations.lock.json'))).toBe(false);
    expect(existsSync(join(root, '.claude', 'skills'))).toBe(false);
  });
});
