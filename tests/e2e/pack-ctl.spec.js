// tests/e2e/pack-ctl.spec.js
// TASK-134/TASK-135 — e2e regression locks for bin/pack-ctl.js (built as
// dist/pack-ctl.cjs), the CLI wrapper exposing the deterministic addon-pack
// ops (resolveDesired / pack-reconcile / pack-orchestrator / assimilate) to a
// plugin-installed project that has no cleanly-reachable src/. Mirrors
// tests/e2e/loop-ctl.spec.js's own shape exactly (spawn the BUILT bundle, not
// the src) — see that file's header for the established precedent.
//
// AC map (TASK-134):
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
// AC map (TASK-135 — `assimilate` subcommands, wrapping src/assimilate.js +
// src/skill-scan.js; the human sign-off / security-reviewer verdict are
// injected as --decision/--security-verdict/--security-override, exactly as
// src/assimilate.js already models them, keeping this CLI LLM/network-free):
//   AC1 — `assimilate scan --path <skill>` prints the risky-pattern scan
//         report JSON from src/skill-scan.js (via src/assimilate.js's own
//         computeSkillScan, now exported — not reimplemented here).
//   AC2 — `assimilate classify --path <skill>` prints the license verdict
//         (SPDX id + permissive|copyleft|unknown) via src/license-detect.js.
//   AC3 — `assimilate stage ...` writes assimilated-skills/<id>/ with
//         re-scoped frontmatter + provenance ONLY on --decision approve AND
//         (verdict != suspicious OR --security-override is the strict
//         boolean "true"); every other combination writes nothing and
//         reports a blocked_* status with a reason.
//   AC4 — invariant sweep: {permissive,copyleft,unknown} x {no-decision,
//         decline} asserts zero writes; a suspicious verdict blocks even
//         approve unless --security-override is the literal string "true".
//   AC5 — dist/pack-ctl.cjs rebuilt; dist-parity green (covered by the
//         existing "dist/pack-ctl.cjs is committed" + release-gate dist-parity
//         spec, not duplicated here).
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
import { DESIGN_POWER_DESCRIPTOR, WATCH_DESCRIPTOR } from '../../src/builtin-packs.js';

afterAll(cleanupAll);

const CLI = join(REPO_ROOT, 'dist', 'pack-ctl.cjs');

// TASK-135 — assimilate scan/classify/stage fixtures, reused from
// tests/e2e/assimilate.spec.js (TASK-120/TASK-122)'s own fixture set, plus a
// new unknown-skill fixture (no LICENSE/package.json/README license section
// at all) added by this ticket for the {permissive,copyleft,unknown} sweep.
const PERMISSIVE_FIXTURE = join(REPO_ROOT, 'tests', 'fixtures', 'skills', 'permissive-skill');
const COPYLEFT_FIXTURE = join(REPO_ROOT, 'tests', 'fixtures', 'skills', 'copyleft-skill');
const UNKNOWN_FIXTURE = join(REPO_ROOT, 'tests', 'fixtures', 'skills', 'unknown-skill');
const MALICIOUS_FIXTURE = join(REPO_ROOT, 'tests', 'fixtures', 'skills', 'malicious-skill');
const ASSIMILATE_PACK = 'design-power@0.1.0';

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

    // TASK-176 — the built-in pack set now aggregates BOTH design-power (this
    // project's MEDIO/other profile) AND watch (unconditionally "always" on,
    // src/pack-resources.js's TASK-176 seam), in the same pack order
    // src/pack-registry.js#resolveActivePacks sorts by ("design-power" <
    // "watch" alphabetically) — never a reimplementation of resolveDesired's
    // own per-pack filtering.
    const profileResult = scoreComplexity(MEDIO_OTHER_ANSWERS);
    const expected = [
      ...resolveDesired(DESIGN_POWER_DESCRIPTOR, profileResult),
      ...resolveDesired(WATCH_DESCRIPTOR, profileResult),
    ];
    expect(result.json.desired).toEqual(expected);
    expect(result.json.desired.map((r) => r.id).sort()).toEqual(['frontend-design', 'ui-ux-pro-max', 'watch']);
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
    // TASK-176 — watch is now a second always-on built-in pack resource
    // (BUILTIN_PACK_DESCRIPTORS); stage its owned source too so the "second
    // run is a no-op" idempotency assertion below covers BOTH built-in
    // packs materializing successfully, not just design-power.
    stageOwnedSkill(root, 'watch', '# Watch\nFixture owned copy.\n');

    const first = runCli(['reconcile-apply', '--repo-root', root]);
    expect(first.status).toBe(0);
    expect(first.json.ok).toBe(true);
    expect(first.json.plan.install.map((op) => op.id)).toContain('skill:ui-ux-pro-max');
    expect(first.json.plan.install.map((op) => op.id)).toContain('skill:watch');

    const liveFile = join(root, '.claude', 'skills', 'ui-ux-pro-max', 'SKILL.md');
    expect(existsSync(liveFile)).toBe(true);
    expect(readFileSync(liveFile, 'utf8')).toBe('# UI/UX Pro Max\nFixture owned copy.\n');

    const watchLiveFile = join(root, '.claude', 'skills', 'watch', 'SKILL.md');
    expect(existsSync(watchLiveFile)).toBe(true);
    expect(readFileSync(watchLiveFile, 'utf8')).toBe('# Watch\nFixture owned copy.\n');

    const lockPath = join(root, 'integrations.lock.json');
    expect(existsSync(lockPath)).toBe(true);
    const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
    expect(lock.resources['skill:ui-ux-pro-max'].owners).toEqual(['design-power@0.1.0']);
    expect(lock.resources['skill:watch'].owners).toEqual(['watch@0.2.0']);

    const designPowerPack = first.json.packs.find((p) => p.id === 'design-power');
    expect(designPowerPack.aborted).toBe(false);
    expect(designPowerPack.installed).toContain('skill:ui-ux-pro-max');

    const watchPack = first.json.packs.find((p) => p.id === 'watch');
    expect(watchPack.aborted).toBe(false);
    expect(watchPack.installed).toContain('skill:watch');

    // --- second run: idempotent, empty plan (steady-state no-op) ---
    const second = runCli(['reconcile-apply', '--repo-root', root]);
    expect(second.status).toBe(0);
    expect(second.json.plan.install).toEqual([]);
    expect(second.json.plan.remove).toEqual([]);
    expect(second.json.plan.replace).toEqual([]);
    const designPowerPack2 = second.json.packs.find((p) => p.id === 'design-power');
    expect(designPowerPack2.installed).toEqual([]);
    const watchPack2 = second.json.packs.find((p) => p.id === 'watch');
    expect(watchPack2.installed).toEqual([]);
    expect(readFileSync(liveFile, 'utf8')).toBe('# UI/UX Pro Max\nFixture owned copy.\n');
    expect(readFileSync(watchLiveFile, 'utf8')).toBe('# Watch\nFixture owned copy.\n');
  });

  it('a_soft_skill_missing_its_owned_source_degrades_via_leave_and_report_without_aborting', async () => {
    // TASK-181 — "no assimilated-skills staged in the fixture" no longer means
    // the owned source is missing: applyPlan now falls back to the PLUGIN's own
    // owned copies, which is the entire point of that fix (before it, every
    // built-in pack skill soft-failed in every consumer project). This test's
    // invariant — a genuinely unreachable soft source degrades via
    // leave-and-report instead of aborting — is still worth locking, so force a
    // genuinely unreachable source rather than relying on the fixture's silence.
    const root = await makeProject();
    const result = runCli(['reconcile-apply', '--repo-root', root], {
      env: { HIVEMIND_OWNED_SOURCE_ROOT: join(root, 'no-such-owned-root') },
    });

    expect(result.status).toBe(0);
    const designPowerPack = result.json.packs.find((p) => p.id === 'design-power');
    expect(designPowerPack.aborted).toBe(false);
    expect(existsSync(join(root, '.claude', 'skills', 'ui-ux-pro-max'))).toBe(false);
    // And the run must no longer read as an unqualified success (TASK-181).
    expect(result.json.ok).toBe(false);
    expect(result.json.installed_count).toBe(0);
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

// ===========================================================================
// TASK-135 — assimilate scan / classify / stage
// ===========================================================================

// ---------------------------------------------------------------------------
// AC1 — assimilate scan
// ---------------------------------------------------------------------------
describe('AC1 — assimilate scan prints the risky-pattern scan report JSON', () => {
  it('a_malicious_fixture_surfaces_categorized_findings_at_high_severity', () => {
    const result = runCli(['assimilate', 'scan', '--path', MALICIOUS_FIXTURE]);

    expect(result.status).toBe(0);
    expect(result.json.ok).toBe(true);
    expect(Array.isArray(result.json.scan.findings)).toBe(true);
    const categories = result.json.scan.findings.map((f) => f.category);
    expect(categories).toContain('shell-exec');
    expect(categories).toContain('network-fetch');
    expect(categories).toContain('env-credential-access');
    expect(categories).toContain('obfuscated-blob');
    expect(result.json.scan.summary.highestSeverity).toBe('high');
  });

  it('a_clean_fixture_scans_with_zero_findings', () => {
    const result = runCli(['assimilate', 'scan', '--path', PERMISSIVE_FIXTURE]);

    expect(result.status).toBe(0);
    expect(result.json.scan.findings).toEqual([]);
    expect(result.json.scan.summary.total).toBe(0);
  });

  it('a_missing_SKILL_md_at_the_given_path_exits_nonzero_with_a_clear_message', () => {
    const emptyDir = makeTmpDir('af-packctl-scan-no-skillmd');
    const result = runCli(['assimilate', 'scan', '--path', emptyDir]);

    expect(result.status).not.toBe(0);
    expect(result.json.ok).toBe(false);
    expect(result.json.message).toMatch(/SKILL\.md/);
  });
});

// ---------------------------------------------------------------------------
// AC2 — assimilate classify
// ---------------------------------------------------------------------------
describe('AC2 — assimilate classify prints the license verdict (SPDX id + classification)', () => {
  it('a_permissive_MIT_fixture_classifies_permissive', () => {
    const result = runCli(['assimilate', 'classify', '--path', PERMISSIVE_FIXTURE]);

    expect(result.status).toBe(0);
    expect(result.json.license.spdx_id).toBe('MIT');
    expect(result.json.license.classification).toBe('permissive');
    expect(result.json.license.detected_via).toBe('license-file');
  });

  it('a_copyleft_GPL_fixture_classifies_copyleft', () => {
    const result = runCli(['assimilate', 'classify', '--path', COPYLEFT_FIXTURE]);

    expect(result.status).toBe(0);
    expect(result.json.license.spdx_id).toBe('GPL-3.0-only');
    expect(result.json.license.classification).toBe('copyleft');
  });

  it('a_fixture_with_no_license_signal_at_all_classifies_unknown', () => {
    const result = runCli(['assimilate', 'classify', '--path', UNKNOWN_FIXTURE]);

    expect(result.status).toBe(0);
    expect(result.json.license.spdx_id).toBeNull();
    expect(result.json.license.classification).toBe('unknown');
    expect(result.json.license.detected_via).toBe('none');
  });
});

// ---------------------------------------------------------------------------
// AC3/AC4 — assimilate stage: writes ONLY on approve + non-suspicious(or
// strict-boolean override); every other combination is a no-write blocked_*.
// ---------------------------------------------------------------------------
function stageCli({
  source, resourceId, root, decision, securityVerdict, securityOverride,
}) {
  const args = [
    'assimilate', 'stage',
    '--source', source,
    '--resource-id', resourceId,
    '--pack', ASSIMILATE_PACK,
    '--origin', 'github.com/example/fixture',
    '--pin', 'abc123',
    '--repo-root', root,
  ];
  if (decision) args.push('--decision', decision);
  if (securityVerdict) args.push('--security-verdict', securityVerdict);
  if (securityOverride !== undefined) args.push('--security-override', securityOverride);
  return runCli(args);
}

describe('AC3 — assimilate stage writes the owned copy + provenance only on approve, non-suspicious', () => {
  it('decision_approve_with_a_safe_security_verdict_writes_the_owned_copy_and_lock_entry', () => {
    const root = makeTmpDir('af-packctl-stage-approve');
    const result = stageCli({
      source: PERMISSIVE_FIXTURE, resourceId: 'permissive-skill', root, decision: 'approve', securityVerdict: 'safe',
    });

    expect(result.status).toBe(0);
    expect(result.json.ok).toBe(true);
    expect(result.json.assimilate.status).toBe('assimilated');

    const ownedSkillPath = join(root, 'assimilated-skills', 'permissive-skill', 'SKILL.md');
    expect(existsSync(ownedSkillPath)).toBe(true);
    expect(readFileSync(ownedSkillPath, 'utf8')).toContain('## Sources & provenance (hivemind)');

    const lock = JSON.parse(readFileSync(join(root, 'integrations.lock.json'), 'utf8'));
    expect(lock.resources['skill:permissive-skill'].owners).toEqual([ASSIMILATE_PACK]);
  });

  // TASK-140 -- RED-LOCK at the CLI/bundle level: --security-verdict validation
  // only ever accepts safe|suspicious (see runAssimilateStage), so the CLI's
  // "no verdict at all" path is the ONLY way to reach an absent reviewerVerdict
  // through this wrapper. Under the pre-TASK-140 fail-open gate this WROTE the
  // owned copy; the default-deny fix now blocks it (status: blocked_security).
  it('decision_approve_with_no_security_verdict_at_all_is_blocked_by_default_deny', () => {
    const root = makeTmpDir('af-packctl-stage-approve-no-verdict-blocked');
    const result = stageCli({ source: PERMISSIVE_FIXTURE, resourceId: 'permissive-skill', root, decision: 'approve' });

    expect(result.status).toBe(0);
    expect(result.json.assimilate.status).toBe('blocked_security');
    expect(existsSync(join(root, 'assimilated-skills'))).toBe(false);
    expect(existsSync(join(root, 'integrations.lock.json'))).toBe(false);
  });

  it('a_suspicious_verdict_blocks_approve_without_an_override_and_writes_nothing', () => {
    const root = makeTmpDir('af-packctl-stage-blocked-security');
    const result = stageCli({
      source: MALICIOUS_FIXTURE, resourceId: 'malicious-skill', root, decision: 'approve', securityVerdict: 'suspicious',
    });

    expect(result.status).toBe(0);
    expect(result.json.assimilate.status).toBe('blocked_security');
    expect(result.json.assimilate.reason).toMatch(/suspicious/);
    expect(existsSync(join(root, 'assimilated-skills'))).toBe(false);
    expect(existsSync(join(root, 'integrations.lock.json'))).toBe(false);
  });

  it('a_suspicious_verdict_with_the_strict_boolean_override_true_proceeds_and_writes', () => {
    const root = makeTmpDir('af-packctl-stage-override');
    const result = stageCli({
      source: MALICIOUS_FIXTURE, resourceId: 'malicious-skill', root, decision: 'approve', securityVerdict: 'suspicious', securityOverride: 'true',
    });

    expect(result.status).toBe(0);
    expect(result.json.assimilate.status).toBe('assimilated');
    expect(existsSync(join(root, 'assimilated-skills', 'malicious-skill', 'SKILL.md'))).toBe(true);
  });

  it('a_truthy_but_non_strict_boolean_override_value_does_NOT_bypass_the_suspicious_block', () => {
    const root = makeTmpDir('af-packctl-stage-override-non-strict');
    const result = stageCli({
      source: MALICIOUS_FIXTURE, resourceId: 'malicious-skill', root, decision: 'approve', securityVerdict: 'suspicious', securityOverride: 'yes',
    });

    expect(result.status).toBe(0);
    expect(result.json.assimilate.status).toBe('blocked_security');
    expect(existsSync(join(root, 'assimilated-skills'))).toBe(false);
    expect(existsSync(join(root, 'integrations.lock.json'))).toBe(false);
  });
});

describe('AC4 — invariant sweep: {permissive,copyleft,unknown} x {no-decision,decline} makes zero writes', () => {
  it('sweeps every license classification across no-decision and decline, asserting zero writes each time', () => {
    const fixtures = [
      ['permissive', PERMISSIVE_FIXTURE],
      ['copyleft', COPYLEFT_FIXTURE],
      ['unknown', UNKNOWN_FIXTURE],
    ];
    for (const [label, source] of fixtures) {
      for (const decision of [undefined, 'decline']) {
        const root = makeTmpDir(`af-packctl-sweep-${label}-${decision ?? 'absent'}`);
        const result = stageCli({ source, resourceId: `${label}-skill`, root, decision });

        expect(result.status, `${label}/${decision}`).toBe(0);
        expect(result.json.assimilate.status, `${label}/${decision}`).toMatch(/^blocked_/);
        expect(existsSync(join(root, 'assimilated-skills')), `${label}/${decision} staging dir`).toBe(false);
        expect(existsSync(join(root, 'integrations.lock.json')), `${label}/${decision} lock`).toBe(false);
      }
    }
  });

  it('a_suspicious_verdict_blocks_approve_without_override_for_every_license_classification_too', () => {
    // The security gate is orthogonal to license classification -- a
    // permissive skill with a suspicious content verdict is blocked exactly
    // like the malicious fixture above.
    const root = makeTmpDir('af-packctl-sweep-suspicious-permissive');
    const result = stageCli({
      source: PERMISSIVE_FIXTURE, resourceId: 'permissive-skill', root, decision: 'approve', securityVerdict: 'suspicious',
    });

    expect(result.status).toBe(0);
    expect(result.json.assimilate.status).toBe('blocked_security');
    expect(existsSync(join(root, 'assimilated-skills'))).toBe(false);
    expect(existsSync(join(root, 'integrations.lock.json'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC3 — assimilate stage argument-error paths: nonzero exit, no partial writes.
// ---------------------------------------------------------------------------
describe('assimilate stage — argument-error paths exit non-zero with no partial writes', () => {
  it('unknown_assimilate_action_exits_nonzero_with_a_usage_message', () => {
    const result = runCli(['assimilate', 'not-a-real-action']);
    expect(result.status).not.toBe(0);
    expect(result.json.ok).toBe(false);
    expect(result.json.message).toMatch(/usage: pack-ctl assimilate|unknown assimilate action/);
  });

  it('missing_source_exits_nonzero_with_a_clear_stderr_message', () => {
    const root = makeTmpDir('af-packctl-stage-missing-source');
    const result = runCli(['assimilate', 'stage', '--resource-id', 'x', '--pack', ASSIMILATE_PACK, '--repo-root', root]);
    expect(result.status).not.toBe(0);
    expect(result.json.ok).toBe(false);
    expect(result.json.message).toMatch(/--source/);
  });
});
