// tests/e2e/assimilate.spec.js
// TASK-120 — hivemind-assimilate-skill workflow + end-to-end proof
// (docs/design/addon-packs-plan.md §7 assimilation, §12 license-detection).
// Real disk I/O throughout (fixture skill dirs, owned-copy writes, the
// lockfile) so this suite lives entirely in the slow tier. No network: the
// two fixture skills under tests/fixtures/skills/ carry their own LICENSE
// files, so detectLicense's chain resolves at step 3 (license-file) without
// ever reaching the GitHub API step.
//
// AC1 — a known-permissive fixture skill assimilates with NO human prompt:
//   owned copy under assimilated-skills/<id>/ with a provenance block, and a
//   lock entry recording the pack as owner.
// AC2 — a copyleft fixture skill returns awaiting_human/declined and writes
//   NOTHING; only an explicit `decision: 'approve'` unblocks the proceed path.
// AC3/AC4 — E2E: assimilate -> materialize into .claude/skills/<id>/ via the
//   reconcile applier -> probeSkills' id lines up with assimilate's
//   resourceId (no spurious install/remove) -> remove -> orphan cleanup.
// AC5 — every result carries the provenance fields; integrity is a real
//   sha256:<64hex> over the source content.
//
// Gap B (TASK-120 UAT-bounce) — assimilateSkill forwards opts.repoRoot to
// detectLicense as a fallback dir distinct from `source`/skillDir, so a
// --subdir source (source is a subdirectory of a larger clone) still finds a
// LICENSE file that lives at the clone root rather than inside the skill's
// own subdir.

import { describe, it, expect, afterAll } from 'vitest';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { PROD } from '../helpers/fixtures.js';
import { REPO_ROOT } from '../helpers/repoRoot.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';

afterAll(cleanupAll);

const PERMISSIVE_FIXTURE = join(REPO_ROOT, 'tests', 'fixtures', 'skills', 'permissive-skill');
const COPYLEFT_FIXTURE = join(REPO_ROOT, 'tests', 'fixtures', 'skills', 'copyleft-skill');
const FIXED_NOW = () => '2026-07-08T12:00:00Z';
const PACK = 'design-power@0.1.0';

describe('AC1 — a known-permissive skill assimilates with no human prompt', () => {
  it('writes the owned copy with a provenance block and records a lock owner edge', async () => {
    const { assimilateSkill } = await import(PROD.assimilate);
    const root = makeTmpDir('asm-permissive');

    const result = await assimilateSkill({
      source: PERMISSIVE_FIXTURE,
      resourceId: 'permissive-skill',
      pack: PACK,
      origin: 'github.com/example/permissive-skill',
      pin: 'abc123',
      root,
      now: FIXED_NOW,
    });

    expect(result.status).toBe('assimilated');
    expect(result.spdx_id).toBe('MIT');
    expect(result.classification).toBe('permissive');
    // AC5 — real sha256:<64hex> integrity over the source content.
    expect(result.integrity).toMatch(/^sha256:[0-9a-f]{64}$/);

    const ownedSkillPath = join(root, 'assimilated-skills', 'permissive-skill', 'SKILL.md');
    expect(existsSync(ownedSkillPath)).toBe(true);
    const text = readFileSync(ownedSkillPath, 'utf8');
    expect(text).toContain('description: A demo skill used to test assimilation of a permissively-licensed third party skill. (assimilated for Hivemind)');
    expect(text).toContain('## Sources & provenance (hivemind)');
    expect(text).toContain('- origin: github.com/example/permissive-skill');
    expect(text).toContain('- pin: abc123');
    expect(text).toContain('- spdx_id: MIT');
    expect(text).toMatch(/- integrity: sha256:[0-9a-f]{64}/);
    expect(text).toContain('- assimilated_at: 2026-07-08T12:00:00Z');

    const lock = JSON.parse(readFileSync(join(root, 'integrations.lock.json'), 'utf8'));
    const entry = lock.resources['skill:permissive-skill'];
    expect(entry).toBeDefined();
    expect(entry.kind).toBe('skill');
    expect(entry.scope).toBe('project');
    expect(entry.verified).toBe('unsigned');
    expect(entry.integrity).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(entry.owners).toEqual([PACK]);
  });
});

describe('AC2 — a copyleft skill requires an explicit human decision', () => {
  it('returns awaiting_human and writes nothing when no decision is given', async () => {
    const { assimilateSkill } = await import(PROD.assimilate);
    const root = makeTmpDir('asm-copyleft-pending');

    const result = await assimilateSkill({
      source: COPYLEFT_FIXTURE,
      resourceId: 'copyleft-skill',
      pack: PACK,
      origin: 'github.com/example/copyleft-skill',
      pin: 'def456',
      root,
      now: FIXED_NOW,
    });

    expect(result.status).toBe('awaiting_human');
    expect(result.spdx_id).toBe('GPL-3.0-only');
    expect(result.classification).toBe('copyleft');
    expect(result.detected_via).toBe('license-file');
    expect(typeof result.source_path).toBe('string');

    expect(existsSync(join(root, 'assimilated-skills'))).toBe(false);
    expect(existsSync(join(root, 'integrations.lock.json'))).toBe(false);
  });

  it('returns declined and writes nothing when the decision is decline', async () => {
    const { assimilateSkill } = await import(PROD.assimilate);
    const root = makeTmpDir('asm-copyleft-declined');

    const result = await assimilateSkill({
      source: COPYLEFT_FIXTURE,
      resourceId: 'copyleft-skill',
      pack: PACK,
      decision: 'decline',
      origin: 'github.com/example/copyleft-skill',
      pin: 'def456',
      root,
      now: FIXED_NOW,
    });

    expect(result.status).toBe('declined');
    expect(existsSync(join(root, 'assimilated-skills'))).toBe(false);
    expect(existsSync(join(root, 'integrations.lock.json'))).toBe(false);
  });

  it('proceeds and assimilates once the caller re-invokes with an explicit approval', async () => {
    const { assimilateSkill } = await import(PROD.assimilate);
    const root = makeTmpDir('asm-copyleft-approved');

    const result = await assimilateSkill({
      source: COPYLEFT_FIXTURE,
      resourceId: 'copyleft-skill',
      pack: PACK,
      decision: 'approve',
      origin: 'github.com/example/copyleft-skill',
      pin: 'def456',
      root,
      now: FIXED_NOW,
    });

    expect(result.status).toBe('assimilated');
    expect(existsSync(join(root, 'assimilated-skills', 'copyleft-skill', 'SKILL.md'))).toBe(true);
    const lock = JSON.parse(readFileSync(join(root, 'integrations.lock.json'), 'utf8'));
    expect(lock.resources['skill:copyleft-skill'].owners).toEqual([PACK]);
  });
});

describe('Gap B — repoRoot forwarding: a LICENSE at the clone root is still found for a --subdir source', () => {
  it('detects the license via detectLicense\'s repoRoot fallback and assimilates', async () => {
    const { assimilateSkill } = await import(PROD.assimilate);

    // Simulates `bin/assimilate-skill.js --subdir skills/gsap-core`: the
    // skill itself carries no license signal of its own, but the clone root
    // (a sibling of the skill subdir, not an ancestor the skill controls)
    // carries a LICENSE file.
    const cloneRoot = makeTmpDir('asm-repo-root-license-clone');
    const skillSubdir = join(cloneRoot, 'skills', 'gsap-core');
    mkdirSync(skillSubdir, { recursive: true });
    writeFileSync(
      join(skillSubdir, 'SKILL.md'),
      '---\nname: gsap-core\ndescription: A demo skill with no local license signal.\n---\n\n# GSAP Core\n',
    );
    writeFileSync(join(cloneRoot, 'LICENSE'), 'MIT License\n\nCopyright (c) 2026 Example\n');

    const root = makeTmpDir('asm-repo-root-license-project');

    const result = await assimilateSkill({
      source: skillSubdir,
      repoRoot: cloneRoot,
      resourceId: 'gsap-core',
      pack: PACK,
      origin: 'github.com/example/gsap-skills',
      pin: 'abc123',
      root,
      now: FIXED_NOW,
    });

    expect(result.status).toBe('assimilated');
    expect(result.spdx_id).toBe('MIT');
    expect(result.detected_via).toBe('license-file');
    expect(result.source_path).toBe(join(cloneRoot, 'LICENSE'));
    expect(existsSync(join(root, 'assimilated-skills', 'gsap-core', 'SKILL.md'))).toBe(true);
  });

  it('without repoRoot, the same skill (no license signal of its own) gates on a human decision', async () => {
    // Regression lock for the bug this gap fixes: omitting repoRoot means
    // detectLicense never sees the clone-root LICENSE at all.
    const { assimilateSkill } = await import(PROD.assimilate);

    const cloneRoot = makeTmpDir('asm-repo-root-license-clone-omitted');
    const skillSubdir = join(cloneRoot, 'skills', 'gsap-core');
    mkdirSync(skillSubdir, { recursive: true });
    writeFileSync(
      join(skillSubdir, 'SKILL.md'),
      '---\nname: gsap-core\ndescription: A demo skill with no local license signal.\n---\n\n# GSAP Core\n',
    );
    writeFileSync(join(cloneRoot, 'LICENSE'), 'MIT License\n\nCopyright (c) 2026 Example\n');

    const root = makeTmpDir('asm-repo-root-license-project-omitted');

    const result = await assimilateSkill({
      source: skillSubdir,
      // repoRoot intentionally omitted.
      resourceId: 'gsap-core',
      pack: PACK,
      origin: 'github.com/example/gsap-skills',
      pin: 'abc123',
      root,
      now: FIXED_NOW,
    });

    expect(result.status).toBe('awaiting_human');
    expect(result.spdx_id).toBeNull();
  });
});

describe('AC3/AC4 — end-to-end: assimilate -> materialize -> id-space integration -> orphan cleanup', () => {
  it('reconciles cleanly through materialize, a no-spurious-op steady state, and orphan removal', async () => {
    const { assimilateSkill } = await import(PROD.assimilate);
    const { probeSkills, plan } = await import(PROD.packReconcile);
    const { applyPlan } = await import(PROD.packApply);

    const root = makeTmpDir('asm-e2e');
    const lockPath = join(root, 'integrations.lock.json');
    const resourceDescriptor = {
      id: 'permissive-skill',
      kind: 'skill',
      origin: 'github.com/example/permissive-skill',
      pin: 'abc123',
      scope: 'project',
      required: 'soft',
    };

    const assimilated = await assimilateSkill({
      source: PERMISSIVE_FIXTURE,
      resourceId: 'permissive-skill',
      pack: PACK,
      origin: resourceDescriptor.origin,
      pin: resourceDescriptor.pin,
      root,
      now: FIXED_NOW,
    });
    expect(assimilated.status).toBe('assimilated');
    // Not yet live -- assimilate only ever writes the OWNED staging copy.
    expect(probeSkills(root)).toEqual({});

    // Materialize: staging copy -> live .claude/skills/ tree. NOTE: the
    // install op is constructed directly here (the same convention
    // tests/e2e/pack-apply.spec.js already uses), not derived by calling
    // plan() against the lock assimilate just wrote -- assimilate's own lock
    // entry (recorded at stage time, per its ticket contract) already makes
    // plan() see a matching-pin lockEntry and treat the resource as a no-op,
    // since plan()'s current model doesn't distinguish "recorded, not yet
    // live" from "recorded and live". That's a pre-existing planner nuance
    // outside this ticket's scope -- flagged to the reconciler owner rather
    // than patched here.
    await applyPlan({
      plan: { install: [{ id: 'skill:permissive-skill', resource: resourceDescriptor }], remove: [], replace: [], report: [] },
      lockPath,
      root,
      owner: PACK,
    });

    const liveSkillPath = join(root, '.claude', 'skills', 'permissive-skill', 'SKILL.md');
    expect(existsSync(liveSkillPath)).toBe(true);

    // AC4 -- id-space integration: probeSkills' `skill:<reldir>` id (reldir
    // is flat = resourceId) lines up with assimilate's `skill:<resourceId>`,
    // so re-planning with it in `desired` against the now-live actual state
    // yields NO spurious install/remove.
    const lockAfterInstall = JSON.parse(readFileSync(lockPath, 'utf8'));
    const actual = probeSkills(root);
    expect(Object.keys(actual)).toEqual(['skill:permissive-skill']);
    const steadyState = plan([resourceDescriptor], lockAfterInstall, actual);
    expect(steadyState).toEqual({ install: [], remove: [], replace: [], report: [] });

    // Orphan cleanup: the pack drops the resource. applyPlan's remove path
    // re-derives orphan status from the CURRENT on-disk lock
    // (dropOwner/isOrphaned), so the single owner dropping its edge deletes
    // both the live dir and the lock entry.
    await applyPlan({
      plan: {
        install: [],
        remove: [{ id: 'skill:permissive-skill', entry: lockAfterInstall.resources['skill:permissive-skill'] }],
        replace: [],
        report: [],
      },
      lockPath,
      root,
      owner: PACK,
    });

    expect(existsSync(join(root, '.claude', 'skills', 'permissive-skill'))).toBe(false);
    const finalLock = JSON.parse(readFileSync(lockPath, 'utf8'));
    expect(finalLock.resources['skill:permissive-skill']).toBeUndefined();
  });
});
