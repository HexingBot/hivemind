// tests/e2e/pack-orchestrator.spec.js
// TASK-132 — FP-4: reconcilePack(...), the thin composer that wires FP-3
// (src/pack-resources.js#resolveDesired) into the Wave-1 reconciler core
// (src/pack-reconcile.js#probeSkills/plan) and the applier
// (src/pack-apply.js#applyPlan), for a single addon pack. Real disk I/O
// throughout (probe, lock read/write, skill materialize) so this suite lives
// entirely in the slow tier — see src/pack-orchestrator.js's own header for
// why this composes rather than reimplements each collaborator's logic.
//
// AC1 — reconcilePack materializes a FIXTURE assimilated skill (owned copy
//   staged under assimilated-skills/<id>/) into .claude/skills/<id>/ via the
//   existing applyPlan path, and records the ownership edge
//   (owner=design-power@<version>) in the integrations lock.
// AC2 — non-skill resources (mcp/plugin) appear in the returned report as
//   Wave-2 not-installed entries — blocking iff required:hard, leave-and-
//   report iff soft — and are never installed by this composer.
// AC3 — a hard-failure aborts the reconcile (result.aborted, no throw
//   escaping to the caller) while prior successful ops are still committed
//   to the lock (leave-and-report, atomic write); a soft-failure degrades via
//   leave-and-report (captured in result.report, run continues).
// AC4 — no real third-party skill is adopted; every fixture here is staged
//   locally under a mkdtemp root, never assimilateSkill with a real origin.

import { describe, it, expect, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PROD } from '../helpers/fixtures.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';

afterAll(cleanupAll);

const OWNER = 'design-power@0.1.0';

function stageOwnedSkill(root, id, contents = '# Skill\nFixture owned copy.\n') {
  const dir = join(root, 'assimilated-skills', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), contents);
  return dir;
}

// Minimal descriptor: one skill resource (Wave-1, materializable) plus one
// hard non-skill (plugin) and one soft non-skill (mcp) resource — both
// out-of-scope Wave-2 kinds that must only ever surface in the report.
function makeDescriptor(overrides = {}) {
  return {
    id: 'design-power',
    version: '0.1.0',
    resources: [
      { id: 'ui-ux-pro-max', kind: 'skill', origin: 'github.com/example/skills', pin: 'v1', scope: 'project', required: 'soft' },
      { id: 'frontend-design', kind: 'plugin', origin: 'marketplace', pin: 'latest', scope: 'project', required: 'hard' },
      { id: 'firecrawl', kind: 'mcp', origin: 'firecrawl-mcp', pin: '3.22.3', scope: 'project', required: 'soft' },
    ],
    ...overrides,
  };
}

// A real scoreComplexity() output (not a hand-faked activations map) so
// resourceActivations' real §5.2 predicates decide what's desired — this
// activates frontend-design (design_heavy), ui-ux-pro-max (tier!=LIGERO),
// and firecrawl (needs_research), matching the three resources above.
const COMPLETO_ANSWERS = {
  design_heavy: 'yes',
  estimated_screens: 10,
  stakes: 'real',
  design_ambition: 'branded',
  ui_framework: 'vue',
  has_canvas_render: 'no',
  motion_required: 'no',
  needs_research: 'need-research',
  assets_required: ['none'],
};

async function makeProfileResult() {
  const { scoreComplexity } = await import(PROD.designProfile);
  return scoreComplexity(COMPLETO_ANSWERS);
}

describe('AC1 — materializes a fixture skill and records the ownership edge', () => {
  it('copies_the_owned_skill_into_live_dir_and_adds_the_pack_as_lock_owner', async () => {
    const { reconcilePack } = await import(PROD.packOrchestrator);

    const root = makeTmpDir('po-install');
    stageOwnedSkill(root, 'ui-ux-pro-max', '# UI/UX Pro Max\nFixture owned copy.\n');

    const descriptor = makeDescriptor();
    const profileResult = await makeProfileResult();

    const result = await reconcilePack({ repoRoot: root, descriptor, profileResult });

    expect(result.aborted).toBe(false);

    const liveFile = join(root, '.claude', 'skills', 'ui-ux-pro-max', 'SKILL.md');
    expect(existsSync(liveFile)).toBe(true);
    expect(readFileSync(liveFile, 'utf8')).toBe('# UI/UX Pro Max\nFixture owned copy.\n');

    const onDisk = JSON.parse(readFileSync(join(root, 'integrations.lock.json'), 'utf8'));
    const entry = onDisk.resources['skill:ui-ux-pro-max'];
    expect(entry).toBeDefined();
    expect(entry.owners).toEqual([OWNER]);

    expect(result.installed.map((op) => op.id)).toContain('skill:ui-ux-pro-max');
  });
});

describe('AC2 — non-skill resources surface as Wave-2 report entries, never installed', () => {
  it('a_hard_required_plugin_is_blocking_and_a_soft_required_mcp_leaves_and_reports', async () => {
    const { reconcilePack } = await import(PROD.packOrchestrator);

    const root = makeTmpDir('po-wave2-report');
    stageOwnedSkill(root, 'ui-ux-pro-max');

    const descriptor = makeDescriptor();
    const profileResult = await makeProfileResult();

    const result = await reconcilePack({ repoRoot: root, descriptor, profileResult });

    const pluginEntry = result.report.find((r) => r.id === 'plugin:frontend-design');
    const mcpEntry = result.report.find((r) => r.id === 'mcp:firecrawl');
    expect(pluginEntry).toMatchObject({ blocking: true });
    expect(mcpEntry).toMatchObject({ blocking: false });

    // Never installed: no live dir under .claude/skills for either non-skill
    // resource, and no lock entry keyed by their (non "skill:") ids.
    expect(existsSync(join(root, '.claude', 'skills', 'frontend-design'))).toBe(false);
    expect(existsSync(join(root, '.claude', 'skills', 'firecrawl'))).toBe(false);
    const onDisk = JSON.parse(readFileSync(join(root, 'integrations.lock.json'), 'utf8'));
    expect(onDisk.resources['plugin:frontend-design']).toBeUndefined();
    expect(onDisk.resources['mcp:firecrawl']).toBeUndefined();
  });
});

describe('AC3 — hard failure aborts (leave-and-report); soft failure degrades and continues', () => {
  it('a_hard_required_skill_missing_its_owned_source_aborts_but_prior_ops_are_committed', async () => {
    const { reconcilePack } = await import(PROD.packOrchestrator);

    const root = makeTmpDir('po-hard-abort');
    // 'ui-ux-pro-max' materializes fine; the second resource has NO owned
    // source staged and is hard-required -> abort after the good op lands.
    // It reuses the "frontend-design" id (a real resourceActivations key,
    // design_heavy-gated true) but repurposes its kind to "skill" so it
    // plans as a Wave-1 skill install rather than a Wave-2 report entry.
    stageOwnedSkill(root, 'ui-ux-pro-max');

    const profileResult = await makeProfileResult();
    const descriptor = makeDescriptor({
      resources: [
        { id: 'ui-ux-pro-max', kind: 'skill', origin: 'x', pin: 'v1', scope: 'project', required: 'soft' },
        { id: 'frontend-design', kind: 'skill', origin: 'x', pin: 'v1', scope: 'project', required: 'hard' },
      ],
    });

    const result = await reconcilePack({ repoRoot: root, descriptor, profileResult });

    expect(result.aborted).toBe(true);
    expect(result.error).toBeDefined();
    expect(result.error.id).toBe('skill:frontend-design');

    // Leave-and-report: the good op's file AND lock mutation both survived.
    expect(existsSync(join(root, '.claude', 'skills', 'ui-ux-pro-max', 'SKILL.md'))).toBe(true);
    const onDisk = JSON.parse(readFileSync(join(root, 'integrations.lock.json'), 'utf8'));
    expect(onDisk.resources['skill:ui-ux-pro-max']).toBeDefined();
    expect(onDisk.resources['skill:frontend-design']).toBeUndefined();
  });

  it('a_soft_required_skill_missing_its_owned_source_degrades_via_leave_and_report_and_continues', async () => {
    const { reconcilePack } = await import(PROD.packOrchestrator);

    const root = makeTmpDir('po-soft-degrade');
    stageOwnedSkill(root, 'ui-ux-pro-max');
    // 'firecrawl' repurposed as a soft skill with no owned source staged.

    const descriptor = makeDescriptor({
      resources: [
        { id: 'ui-ux-pro-max', kind: 'skill', origin: 'x', pin: 'v1', scope: 'project', required: 'soft' },
        { id: 'firecrawl', kind: 'skill', origin: 'x', pin: 'v1', scope: 'project', required: 'soft' },
      ],
    });
    const profileResult = await makeProfileResult();

    const result = await reconcilePack({ repoRoot: root, descriptor, profileResult });

    expect(result.aborted).toBe(false);
    const failureEntry = result.report.find((r) => r.id === 'skill:firecrawl');
    expect(failureEntry).toBeDefined();
    expect(failureEntry.blocking).toBe(false);

    expect(existsSync(join(root, '.claude', 'skills', 'ui-ux-pro-max', 'SKILL.md'))).toBe(true);
    const onDisk = JSON.parse(readFileSync(join(root, 'integrations.lock.json'), 'utf8'));
    expect(onDisk.resources['skill:ui-ux-pro-max']).toBeDefined();
    expect(onDisk.resources['skill:firecrawl']).toBeUndefined();
  });
});

describe('lock precondition — reconcilePack tolerates a not-yet-existing lockfile', () => {
  it('creates_an_empty_lock_before_delegating_so_applyPlan_never_sees_ENOENT', async () => {
    const { reconcilePack } = await import(PROD.packOrchestrator);

    const root = makeTmpDir('po-no-lock-yet');
    stageOwnedSkill(root, 'ui-ux-pro-max');
    expect(existsSync(join(root, 'integrations.lock.json'))).toBe(false);

    const descriptor = makeDescriptor();
    const profileResult = await makeProfileResult();

    const result = await reconcilePack({ repoRoot: root, descriptor, profileResult });

    expect(result.aborted).toBe(false);
    expect(existsSync(join(root, 'integrations.lock.json'))).toBe(true);
  });
});
