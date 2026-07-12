// tests/e2e/assimilate.spec.js
// TASK-120 — hivemind-assimilate-skill workflow + end-to-end proof
// (docs/design/addon-packs-plan.md §7 assimilation, §12 license-detection).
// Real disk I/O throughout (fixture skill dirs, owned-copy writes, the
// lockfile) so this suite lives entirely in the slow tier. No network: the
// two fixture skills under tests/fixtures/skills/ carry their own LICENSE
// files, so detectLicense's chain resolves at step 3 (license-file) without
// ever reaching the GitHub API step.
//
// HUMAN-GATE POLICY (locked, 2026-07-08): NO skill ever adopts without an
// explicit `decision: 'approve'` — not even a permissive one. A call without
// it is a dry-run vet: nothing written, a `pending_approval` payload
// returned with everything an approve would commit (integrity, provenance
// preview). `decision: 'decline'` is a terminal no. Classification is
// decision support, never a write authority.
//
// AC1 — a known-permissive fixture skill: WITHOUT decision:'approve' ->
//   pending_approval, writes NOTHING; WITH decision:'approve' -> owned copy
//   under assimilated-skills/<id>/ with a provenance block, and a lock entry
//   recording the pack as owner.
// AC2 — a copyleft fixture skill: same shape (pending_approval by default,
//   declined on decision:'decline', assimilated only on decision:'approve') —
//   proving the gate is universal, not classification-dependent.
// AC3/AC4 — E2E: assimilate (approved) -> materialize into .claude/skills/<id>/
//   via the reconcile applier -> probeSkills' id lines up with assimilate's
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
const MALICIOUS_FIXTURE = join(REPO_ROOT, 'tests', 'fixtures', 'skills', 'malicious-skill');
const FIXED_NOW = () => '2026-07-08T12:00:00Z';
const PACK = 'design-power@0.1.0';

describe('AC1 — a known-permissive skill still requires an explicit approve to write anything', () => {
  it('without decision, returns pending_approval and writes nothing', async () => {
    const { assimilateSkill } = await import(PROD.assimilate);
    const root = makeTmpDir('asm-permissive-pending');

    const result = await assimilateSkill({
      source: PERMISSIVE_FIXTURE,
      resourceId: 'permissive-skill',
      pack: PACK,
      origin: 'github.com/example/permissive-skill',
      pin: 'abc123',
      root,
      now: FIXED_NOW,
    });

    expect(result.status).toBe('pending_approval');
    expect(result.spdx_id).toBe('MIT');
    expect(result.classification).toBe('permissive');
    // Everything an approve would commit is already computed for review...
    expect(result.integrity).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(result.assimilated_at).toBe('2026-07-08T12:00:00Z');
    expect(result.provenance_preview).toContain('## Sources & provenance (hivemind)');
    expect(result.provenance_preview).toContain('- spdx_id: MIT');
    // ...but NOTHING is written.
    expect(existsSync(join(root, 'assimilated-skills'))).toBe(false);
    expect(existsSync(join(root, 'integrations.lock.json'))).toBe(false);
  });

  it('with decision: approve, writes the owned copy with a provenance block and records a lock owner edge', async () => {
    const { assimilateSkill } = await import(PROD.assimilate);
    const root = makeTmpDir('asm-permissive-approved');

    const result = await assimilateSkill({
      source: PERMISSIVE_FIXTURE,
      resourceId: 'permissive-skill',
      pack: PACK,
      decision: 'approve',
      // TASK-140 — the content-security gate is now default-deny (blocks
      // unless verdict === 'safe'); an explicit safe verdict is required to
      // reach the write path this test exercises. See the "TASK-140" describe
      // block below for the default-deny matrix itself.
      reviewerVerdict: { verdict: 'safe', reasoning: 'no risky patterns' },
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

describe('AC2 — a copyleft skill requires the same explicit approve — the gate is universal, not classification-dependent', () => {
  it('returns pending_approval and writes nothing when no decision is given', async () => {
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

    expect(result.status).toBe('pending_approval');
    expect(result.spdx_id).toBe('GPL-3.0-only');
    expect(result.classification).toBe('copyleft');
    expect(result.detected_via).toBe('license-file');
    expect(typeof result.source_path).toBe('string');
    // Copyleft/unknown carries the same computed-preview shape as permissive —
    // the ONLY difference is the classification/gate reason, not the payload shape.
    expect(result.integrity).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(result.provenance_preview).toContain('- spdx_id: GPL-3.0-only');

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
      // TASK-140 — default-deny gate: an explicit safe verdict is required.
      reviewerVerdict: { verdict: 'safe', reasoning: 'no risky patterns' },
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
  it('detects the license via detectLicense\'s repoRoot fallback and assimilates once approved', async () => {
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
      decision: 'approve',
      // TASK-140 — default-deny gate: an explicit safe verdict is required.
      reviewerVerdict: { verdict: 'safe', reasoning: 'no risky patterns' },
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

  it('without repoRoot, the same skill (no license signal of its own) can only reach pending_approval as unknown', async () => {
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

    expect(result.status).toBe('pending_approval');
    expect(result.spdx_id).toBeNull();
    expect(result.classification).toBe('unknown');
  });
});

describe('AC3/AC4 — end-to-end: assimilate (approved) -> materialize -> id-space integration -> orphan cleanup', () => {
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
      decision: 'approve',
      // TASK-140 — default-deny gate: an explicit safe verdict is required.
      reviewerVerdict: { verdict: 'safe', reasoning: 'no risky patterns' },
      origin: resourceDescriptor.origin,
      pin: resourceDescriptor.pin,
      root,
      now: FIXED_NOW,
    });
    expect(assimilated.status).toBe('assimilated');
    // Not yet live -- assimilate only ever writes the OWNED staging copy.
    expect(probeSkills(root)).toEqual({});

    // TASK-121 -- the divergence this ticket closes: assimilate already wrote
    // a matching-pin lock entry (owners: [PACK]) at stage time, but the skill
    // is still absent from `actual` (probeSkills). plan() itself -- not a
    // hand-constructed install op -- must still propose the materialize: a
    // staged-but-not-live skill is never a no-op.
    const lockAfterAssimilate = JSON.parse(readFileSync(lockPath, 'utf8'));
    const actualBeforeInstall = probeSkills(root);
    const firstPlan = plan([resourceDescriptor], lockAfterAssimilate, actualBeforeInstall);
    expect(firstPlan.install).toEqual([{ id: 'skill:permissive-skill', resource: resourceDescriptor }]);
    expect(firstPlan.replace).toEqual([]);
    expect(firstPlan.remove).toEqual([]);

    // Materialize using plan()'s own output.
    await applyPlan({ plan: firstPlan, lockPath, root, owner: PACK });

    const liveSkillPath = join(root, '.claude', 'skills', 'permissive-skill', 'SKILL.md');
    expect(existsSync(liveSkillPath)).toBe(true);

    // AC4 -- a second reconcile pass confirms the divergence is fully
    // resolved: id-space integration (probeSkills' `skill:<reldir>` lines up
    // with assimilate's `skill:<resourceId>`) plus the now-live actual state
    // together yield a clean, no-spurious-op steady state.
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

describe('no-write-without-approve invariant (human-gate policy)', () => {
  it('holds across every classification: only decision: "approve" ever writes to disk or the lock', async () => {
    const { assimilateSkill } = await import(PROD.assimilate);

    for (const [label, source, expectedClassification] of [
      ['permissive', PERMISSIVE_FIXTURE, 'permissive'],
      ['copyleft', COPYLEFT_FIXTURE, 'copyleft'],
    ]) {
      for (const decision of [undefined, 'decline']) {
        const root = makeTmpDir(`asm-invariant-${label}-${decision ?? 'absent'}`);

        const result = await assimilateSkill({
          source,
          resourceId: `${label}-skill`,
          pack: PACK,
          decision,
          origin: 'github.com/example/skill',
          pin: 'abc123',
          root,
          now: FIXED_NOW,
        });

        expect(result.status, `${label}/${decision}`).not.toBe('assimilated');
        expect(existsSync(join(root, 'assimilated-skills')), `${label}/${decision} staging dir`).toBe(false);
        expect(existsSync(join(root, 'integrations.lock.json')), `${label}/${decision} lock`).toBe(false);
      }
    }
  });
});

// TASK-122 -- content security gate: an automated pattern scan (src/skill-scan.js)
// plus an injected security-reviewer verdict now populate the approval package
// assimilateSkill assembles, and a suspicious verdict blocks the approve write
// unless the human passes an explicit securityOverride. Trust model unchanged:
// license/scan/reviewer are all decision-support; the human approve/decline
// call is still the only write authority (TASK-120's invariant, untouched).

describe('AC1/AC3 -- pending_approval carries scan findings + the (possibly absent) reviewer verdict', () => {
  it('surfaces categorized scan findings for a skill with risky content, and echoes reviewer as null when not yet supplied', async () => {
    const { assimilateSkill } = await import(PROD.assimilate);
    const root = makeTmpDir('asm-scan-pending');

    const result = await assimilateSkill({
      source: MALICIOUS_FIXTURE,
      resourceId: 'malicious-skill',
      pack: PACK,
      origin: 'github.com/example/malicious-skill',
      pin: 'bad000',
      root,
      now: FIXED_NOW,
    });

    expect(result.status).toBe('pending_approval');
    expect(result.reviewer).toBeNull();
    expect(Array.isArray(result.scan.findings)).toBe(true);
    const categories = result.scan.findings.map((f) => f.category);
    expect(categories).toContain('shell-exec');
    expect(categories).toContain('network-fetch');
    expect(categories).toContain('env-credential-access');
    expect(categories).toContain('obfuscated-blob');
    expect(result.scan.summary.highestSeverity).toBe('high');
    // Still writes nothing -- scan findings alone are decision support, never a write authority.
    expect(existsSync(join(root, 'assimilated-skills'))).toBe(false);
    expect(existsSync(join(root, 'integrations.lock.json'))).toBe(false);
  });

  it('echoes an already-computed reviewer verdict back in the pending_approval payload', async () => {
    const { assimilateSkill } = await import(PROD.assimilate);
    const root = makeTmpDir('asm-scan-pending-reviewer');

    const result = await assimilateSkill({
      source: MALICIOUS_FIXTURE,
      resourceId: 'malicious-skill',
      pack: PACK,
      origin: 'github.com/example/malicious-skill',
      pin: 'bad000',
      reviewerVerdict: { verdict: 'suspicious', reasoning: 'instructions attempt to exfiltrate env secrets to a remote host' },
      root,
      now: FIXED_NOW,
    });

    expect(result.status).toBe('pending_approval');
    expect(result.reviewer).toEqual({ verdict: 'suspicious', reasoning: 'instructions attempt to exfiltrate env secrets to a remote host' });
  });
});

describe('AC4 -- a suspicious security-reviewer verdict blocks adoption on approve, pending an explicit override', () => {
  it('refuses the write with status blocked_security when approve is combined with an un-overridden suspicious verdict', async () => {
    const { assimilateSkill } = await import(PROD.assimilate);
    const root = makeTmpDir('asm-blocked-security');

    const result = await assimilateSkill({
      source: MALICIOUS_FIXTURE,
      resourceId: 'malicious-skill',
      pack: PACK,
      decision: 'approve',
      reviewerVerdict: { verdict: 'suspicious', reasoning: 'prompt-injection risk: instructs exfil of credentials' },
      origin: 'github.com/example/malicious-skill',
      pin: 'bad000',
      root,
      now: FIXED_NOW,
    });

    expect(result.status).toBe('blocked_security');
    expect(result.reviewer.verdict).toBe('suspicious');
    // An approve alone cannot override a suspicious content verdict -- NOTHING is written.
    expect(existsSync(join(root, 'assimilated-skills'))).toBe(false);
    expect(existsSync(join(root, 'integrations.lock.json'))).toBe(false);
  });

  it('leaves a pre-existing staging dir and lockfile byte-untouched when a later resource is blocked_security', async () => {
    const { assimilateSkill } = await import(PROD.assimilate);
    const root = makeTmpDir('asm-blocked-security-byte-untouched');

    // Seed real prior state: one already-approved, unrelated skill.
    const baseline = await assimilateSkill({
      source: PERMISSIVE_FIXTURE,
      resourceId: 'permissive-skill',
      pack: PACK,
      decision: 'approve',
      // TASK-140 — default-deny gate: an explicit safe verdict is required.
      reviewerVerdict: { verdict: 'safe', reasoning: 'no risky patterns' },
      origin: 'github.com/example/permissive-skill',
      pin: 'abc123',
      root,
      now: FIXED_NOW,
    });
    expect(baseline.status).toBe('assimilated');

    const lockPath = join(root, 'integrations.lock.json');
    const ownedSkillPath = join(root, 'assimilated-skills', 'permissive-skill', 'SKILL.md');
    const lockBefore = readFileSync(lockPath, 'utf8');
    const ownedSkillBefore = readFileSync(ownedSkillPath, 'utf8');

    const blocked = await assimilateSkill({
      source: MALICIOUS_FIXTURE,
      resourceId: 'malicious-skill',
      pack: PACK,
      decision: 'approve',
      reviewerVerdict: { verdict: 'suspicious', reasoning: 'prompt-injection risk' },
      origin: 'github.com/example/malicious-skill',
      pin: 'bad000',
      root,
      now: FIXED_NOW,
    });
    expect(blocked.status).toBe('blocked_security');

    // Nothing about the pre-existing, unrelated resource changed -- byte-identical.
    expect(readFileSync(lockPath, 'utf8')).toBe(lockBefore);
    expect(readFileSync(ownedSkillPath, 'utf8')).toBe(ownedSkillBefore);
    // And the blocked resource itself was never staged.
    expect(existsSync(join(root, 'assimilated-skills', 'malicious-skill'))).toBe(false);
  });

  it('proceeds and writes once the human passes an explicit securityOverride alongside the same suspicious verdict', async () => {
    const { assimilateSkill } = await import(PROD.assimilate);
    const root = makeTmpDir('asm-security-override');

    const result = await assimilateSkill({
      source: MALICIOUS_FIXTURE,
      resourceId: 'malicious-skill',
      pack: PACK,
      decision: 'approve',
      reviewerVerdict: { verdict: 'suspicious', reasoning: 'prompt-injection risk: instructs exfil of credentials' },
      securityOverride: true,
      origin: 'github.com/example/malicious-skill',
      pin: 'bad000',
      root,
      now: FIXED_NOW,
    });

    expect(result.status).toBe('assimilated');
    expect(result.reviewer.verdict).toBe('suspicious');
    expect(existsSync(join(root, 'assimilated-skills', 'malicious-skill', 'SKILL.md'))).toBe(true);
    const lock = JSON.parse(readFileSync(join(root, 'integrations.lock.json'), 'utf8'));
    expect(lock.resources['skill:malicious-skill']).toBeDefined();
  });

  it('a truthy NON-boolean securityOverride does NOT bypass the suspicious block (strict === true required)', async () => {
    const { assimilateSkill } = await import(PROD.assimilate);
    const root = makeTmpDir('asm-blocked-security-truthy-non-bool');

    const result = await assimilateSkill({
      source: MALICIOUS_FIXTURE,
      resourceId: 'malicious-skill',
      pack: PACK,
      decision: 'approve',
      reviewerVerdict: { verdict: 'suspicious', reasoning: 'prompt-injection risk: instructs exfil of credentials' },
      securityOverride: 'no', // truthy string, NOT the boolean true -- must still block
      origin: 'github.com/example/malicious-skill',
      pin: 'bad000',
      root,
      now: FIXED_NOW,
    });

    expect(result.status).toBe('blocked_security');
    expect(result.reviewer.verdict).toBe('suspicious');
    // A truthy-but-non-boolean securityOverride must not bypass the gate -- NOTHING is written.
    expect(existsSync(join(root, 'assimilated-skills'))).toBe(false);
    expect(existsSync(join(root, 'integrations.lock.json'))).toBe(false);
  });

  it('a safe reviewer verdict proceeds normally on approve, no override needed', async () => {
    const { assimilateSkill } = await import(PROD.assimilate);
    const root = makeTmpDir('asm-safe-reviewer');

    const result = await assimilateSkill({
      source: PERMISSIVE_FIXTURE,
      resourceId: 'permissive-skill',
      pack: PACK,
      decision: 'approve',
      reviewerVerdict: { verdict: 'safe', reasoning: 'no risky patterns, no suspicious instructions' },
      origin: 'github.com/example/permissive-skill',
      pin: 'abc123',
      root,
      now: FIXED_NOW,
    });

    expect(result.status).toBe('assimilated');
    expect(result.reviewer).toEqual({ verdict: 'safe', reasoning: 'no risky patterns, no suspicious instructions' });
  });
});

describe('AC5 -- end-to-end: license -> scan -> reviewer -> presented package -> human sign-off', () => {
  it('a declined package (after full package assembly) leaves the tree and lock untouched; a subsequent approve with a safe verdict adopts', async () => {
    const { assimilateSkill } = await import(PROD.assimilate);
    const root = makeTmpDir('asm-e2e-signoff');

    // Step 1: dry-run vet assembles the full approval package -- writes nothing.
    const dryRun = await assimilateSkill({
      source: MALICIOUS_FIXTURE,
      resourceId: 'malicious-skill',
      pack: PACK,
      origin: 'github.com/example/malicious-skill',
      pin: 'bad000',
      reviewerVerdict: { verdict: 'suspicious', reasoning: 'prompt-injection risk' },
      root,
      now: FIXED_NOW,
    });
    expect(dryRun.status).toBe('pending_approval');
    expect(dryRun.classification).toBeDefined();
    expect(dryRun.scan.findings.length).toBeGreaterThan(0);
    expect(dryRun.reviewer.verdict).toBe('suspicious');

    // Step 2: the human declines the package. Terminal no -- nothing written.
    const declined = await assimilateSkill({
      source: MALICIOUS_FIXTURE,
      resourceId: 'malicious-skill',
      pack: PACK,
      decision: 'decline',
      origin: 'github.com/example/malicious-skill',
      pin: 'bad000',
      reviewerVerdict: { verdict: 'suspicious', reasoning: 'prompt-injection risk' },
      root,
      now: FIXED_NOW,
    });
    expect(declined.status).toBe('declined');
    expect(existsSync(join(root, 'assimilated-skills'))).toBe(false);
    expect(existsSync(join(root, 'integrations.lock.json'))).toBe(false);

    // Step 3: a DIFFERENT, benign skill goes through the same full package
    // assembly and the human approves it -- this is the only path that writes.
    const approved = await assimilateSkill({
      source: PERMISSIVE_FIXTURE,
      resourceId: 'permissive-skill',
      pack: PACK,
      decision: 'approve',
      origin: 'github.com/example/permissive-skill',
      pin: 'abc123',
      reviewerVerdict: { verdict: 'safe', reasoning: 'no risky patterns, no suspicious instructions' },
      root,
      now: FIXED_NOW,
    });
    expect(approved.status).toBe('assimilated');
    expect(approved.scan.findings).toEqual([]);
    expect(existsSync(join(root, 'assimilated-skills', 'permissive-skill', 'SKILL.md'))).toBe(true);
    const lock = JSON.parse(readFileSync(join(root, 'integrations.lock.json'), 'utf8'));
    expect(lock.resources['skill:permissive-skill']).toBeDefined();
    // The declined resource from step 2 still never made it to disk.
    expect(existsSync(join(root, 'assimilated-skills', 'malicious-skill'))).toBe(false);
  });
});

// TASK-140 -- DEFAULT-DENY inversion: the TASK-122 gate blocked ONLY on the
// literal string 'suspicious', so ANY other reviewerVerdict value -- absent,
// an unrecognized string ('unsafe'), a typo, differently-cased ('Safe'), or
// an empty string -- was NOT treated as a block and let an approve write
// (fail-OPEN). This locks the fix: on decision:'approve', the write proceeds
// ONLY when reviewerVerdict?.verdict === 'safe' exactly; every other value
// blocks with status:'blocked_security' unless securityOverride === true
// (strict boolean, TASK-122's override semantics unchanged).

describe('TASK-140 -- content security gate is DEFAULT-DENY (block unless verdict === "safe")', () => {
  it('RED-LOCK: approve + reviewerVerdict:{verdict:"unsafe"} + no override is blocked (previously the fail-open bug WROTE the skill)', async () => {
    const { assimilateSkill } = await import(PROD.assimilate);
    const root = makeTmpDir('asm-140-unsafe-blocks');

    const result = await assimilateSkill({
      source: PERMISSIVE_FIXTURE,
      resourceId: 'permissive-skill',
      pack: PACK,
      decision: 'approve',
      reviewerVerdict: { verdict: 'unsafe', reasoning: 'not a recognized safe/suspicious value' },
      origin: 'github.com/example/permissive-skill',
      pin: 'abc123',
      root,
      now: FIXED_NOW,
    });

    expect(result.status).toBe('blocked_security');
    expect(result.reviewer).toEqual({ verdict: 'unsafe', reasoning: 'not a recognized safe/suspicious value' });
    expect(existsSync(join(root, 'assimilated-skills'))).toBe(false);
    expect(existsSync(join(root, 'integrations.lock.json'))).toBe(false);
  });

  it('approve + reviewerVerdict:{verdict:"safe"} proceeds and writes (green path preserved)', async () => {
    const { assimilateSkill } = await import(PROD.assimilate);
    const root = makeTmpDir('asm-140-safe-proceeds');

    const result = await assimilateSkill({
      source: PERMISSIVE_FIXTURE,
      resourceId: 'permissive-skill',
      pack: PACK,
      decision: 'approve',
      reviewerVerdict: { verdict: 'safe', reasoning: 'no risky patterns' },
      origin: 'github.com/example/permissive-skill',
      pin: 'abc123',
      root,
      now: FIXED_NOW,
    });

    expect(result.status).toBe('assimilated');
    expect(existsSync(join(root, 'assimilated-skills', 'permissive-skill', 'SKILL.md'))).toBe(true);
  });

  const DEFAULT_DENY_MATRIX = [
    ['absent reviewerVerdict', undefined, 'absent'],
    ['verdict: suspicious', { verdict: 'suspicious', reasoning: 'flagged' }, 'suspicious'],
    ['verdict: unsafe (unrecognized string)', { verdict: 'unsafe', reasoning: 'flagged' }, 'unsafe'],
    ['verdict: Safe (wrong case)', { verdict: 'Safe', reasoning: 'flagged' }, 'wrong-case'],
    ['verdict: "" (empty string)', { verdict: '', reasoning: 'flagged' }, 'empty'],
  ];

  it.each(DEFAULT_DENY_MATRIX)('blocks approve for %s, writing nothing, unless securityOverride === true', async (label, reviewerVerdict, slug) => {
    const { assimilateSkill } = await import(PROD.assimilate);
    const root = makeTmpDir(`asm-140-matrix-${slug}`);

    const result = await assimilateSkill({
      source: PERMISSIVE_FIXTURE,
      resourceId: 'permissive-skill',
      pack: PACK,
      decision: 'approve',
      reviewerVerdict,
      origin: 'github.com/example/permissive-skill',
      pin: 'abc123',
      root,
      now: FIXED_NOW,
    });

    expect(result.status, label).toBe('blocked_security');
    expect(existsSync(join(root, 'assimilated-skills')), label).toBe(false);
    expect(existsSync(join(root, 'integrations.lock.json')), label).toBe(false);
  });

  it('securityOverride === true (strict boolean) still lets approve proceed despite a non-safe verdict', async () => {
    const { assimilateSkill } = await import(PROD.assimilate);
    const root = makeTmpDir('asm-140-override-bypasses-unsafe');

    const result = await assimilateSkill({
      source: PERMISSIVE_FIXTURE,
      resourceId: 'permissive-skill',
      pack: PACK,
      decision: 'approve',
      reviewerVerdict: { verdict: 'unsafe', reasoning: 'flagged' },
      securityOverride: true,
      origin: 'github.com/example/permissive-skill',
      pin: 'abc123',
      root,
      now: FIXED_NOW,
    });

    expect(result.status).toBe('assimilated');
    expect(existsSync(join(root, 'assimilated-skills', 'permissive-skill', 'SKILL.md'))).toBe(true);
  });

  const LOOSE_OVERRIDE_CASES = [
    ['the string "true"', 'true', 'str-true'],
    ['the string "1"', '1', 'str-1'],
  ];

  it.each(LOOSE_OVERRIDE_CASES)('a loose truthy-but-non-boolean securityOverride (%s) does NOT bypass the default-deny gate', async (_label, looseOverride, slug) => {
    const { assimilateSkill } = await import(PROD.assimilate);
    const root = makeTmpDir(`asm-140-loose-override-${slug}`);

    const result = await assimilateSkill({
      source: PERMISSIVE_FIXTURE,
      resourceId: 'permissive-skill',
      pack: PACK,
      decision: 'approve',
      reviewerVerdict: { verdict: 'unsafe', reasoning: 'flagged' },
      securityOverride: looseOverride,
      origin: 'github.com/example/permissive-skill',
      pin: 'abc123',
      root,
      now: FIXED_NOW,
    });

    expect(result.status).toBe('blocked_security');
    expect(existsSync(join(root, 'assimilated-skills'))).toBe(false);
    expect(existsSync(join(root, 'integrations.lock.json'))).toBe(false);
  });
});
