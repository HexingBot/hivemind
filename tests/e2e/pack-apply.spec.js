// tests/e2e/pack-apply.spec.js
// TASK-119 — Reconcile applier for skills + atomic lock commit. Real disk I/O
// (copying/deleting skill directories, reading/writing the lockfile) so this
// suite lives entirely in the slow tier.
//
// AC1 — applyPlan() materializes an install skill's files from the owned
//   source (assimilated-skills/<id>/) into .claude/skills/<id>/ and
//   records/updates its lock entry via the store (addOwner).
// AC2 — a remove op deletes the orphaned live skill directory and drops its
//   lock entry; a still-owned resource is never deleted (re-derived from the
//   CURRENT on-disk lock via dropOwner/isOrphaned, not trusted blindly from
//   the plan snapshot).
// AC3 — a soft-resource failure is captured in the returned report and does
//   not abort the run; a hard-resource failure aborts with a typed error and
//   leaves prior successful ops in place (leave-and-report, no rollback).
// AC4 — the lockfile is written via atomicWriteFile in a single commit at the
//   end of the run.
//
// Also: a `replace` op is surfaced in the report as deferred/not-executed
// rather than silently dropped (Wave-1 applier scope is install/remove only;
// see docs/design/addon-packs-plan.md §5 first-wave applier scope) — a
// regression lock against a real defect class (a plan bucket vanishing).

import { describe, it, expect, vi, afterEach, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PROD } from '../helpers/fixtures.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';

afterAll(cleanupAll);

function makeEntry(overrides) {
  return {
    kind: 'skill',
    origin: 'github.com/example/skills',
    pin: 'v1',
    integrity: 'sha256:' + 'a'.repeat(64),
    scope: 'project',
    owners: [],
    required: 'soft',
    installed_at: '2026-07-08T12:00:00Z',
    install_method: 'assimilated',
    verified: 'unsigned',
    ...overrides,
  };
}

function seedLock(lockPath, resources) {
  writeFileSync(lockPath, JSON.stringify({ schema_version: 1, resources }, null, 2), 'utf8');
}

function writeSkillSource(sourceRoot, id, contents = '# Skill\nOwned copy.\n') {
  const dir = join(sourceRoot, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), contents);
  return dir;
}

describe('AC1 — install materializes the owned source and records a lock entry', () => {
  it('copies_the_skill_dir_and_adds_the_pack_as_an_owner', async () => {
    const { applyPlan } = await import(PROD.packApply);

    const root = makeTmpDir('pa-install');
    const sourceRoot = join(root, 'assimilated-skills');
    writeSkillSource(sourceRoot, 'foo', '# Foo\nAssimilated foo skill.\n');
    const lockPath = join(root, 'integrations.lock.json');
    seedLock(lockPath, {});

    const plan = {
      install: [{
        id: 'skill:foo',
        resource: { id: 'foo', kind: 'skill', origin: 'github.com/example/skills', pin: 'v1', scope: 'project', required: 'soft' },
      }],
      remove: [],
      replace: [],
      report: [],
    };

    const result = await applyPlan({ plan, lockPath, root, owner: 'design-power@0.1.0', sourceRoot });

    const liveFile = join(root, '.claude', 'skills', 'foo', 'SKILL.md');
    expect(existsSync(liveFile)).toBe(true);
    expect(readFileSync(liveFile, 'utf8')).toBe('# Foo\nAssimilated foo skill.\n');

    const onDisk = JSON.parse(readFileSync(lockPath, 'utf8'));
    const entry = onDisk.resources['skill:foo'];
    expect(entry).toBeDefined();
    expect(entry.kind).toBe('skill');
    expect(entry.pin).toBe('v1');
    expect(entry.scope).toBe('project');
    expect(entry.required).toBe('soft');
    expect(entry.owners).toEqual(['design-power@0.1.0']);
    expect(entry.integrity).toMatch(/^sha256:[0-9a-f]{64}$/);

    expect(result.report).toEqual([]);
  });

  it('clean_replaces_a_stale_pre_existing_live_dir_instead_of_merging_into_it', async () => {
    // TASK-120 (carried LOW from the TASK-119 review): cpSync alone MERGES
    // into a pre-existing live dir, so a re-materialize would leave behind a
    // file the new owned source no longer carries. Assert the stale file is
    // gone after applyPlan, not just that the new file landed.
    const { applyPlan } = await import(PROD.packApply);

    const root = makeTmpDir('pa-install-clean-replace');
    const sourceRoot = join(root, 'assimilated-skills');
    writeSkillSource(sourceRoot, 'foo', '# Foo v2\nRe-assimilated foo skill.\n');
    const liveDir = join(root, '.claude', 'skills', 'foo');
    mkdirSync(liveDir, { recursive: true });
    writeFileSync(join(liveDir, 'SKILL.md'), '# Foo v1\nStale live copy.\n');
    writeFileSync(join(liveDir, 'stale-file.txt'), 'no longer part of the owned source\n');
    const lockPath = join(root, 'integrations.lock.json');
    seedLock(lockPath, {});

    const plan = {
      install: [{
        id: 'skill:foo',
        resource: { id: 'foo', kind: 'skill', origin: 'github.com/example/skills', pin: 'v2', scope: 'project', required: 'soft' },
      }],
      remove: [],
      replace: [],
      report: [],
    };

    await applyPlan({ plan, lockPath, root, owner: 'design-power@0.1.0', sourceRoot });

    expect(readFileSync(join(liveDir, 'SKILL.md'), 'utf8')).toBe('# Foo v2\nRe-assimilated foo skill.\n');
    expect(existsSync(join(liveDir, 'stale-file.txt'))).toBe(false);
  });
});

describe('AC2 — remove deletes an orphaned live dir and drops the lock entry', () => {
  it('deletes_the_live_dir_and_removes_the_lock_entry_once_orphaned', async () => {
    const { applyPlan } = await import(PROD.packApply);

    const root = makeTmpDir('pa-remove-orphan');
    const liveDir = join(root, '.claude', 'skills', 'old-thing');
    mkdirSync(liveDir, { recursive: true });
    writeFileSync(join(liveDir, 'SKILL.md'), '# Old\n');

    const lockPath = join(root, 'integrations.lock.json');
    const entry = makeEntry({ owners: ['design-power@0.1.0'], required: 'soft' });
    seedLock(lockPath, { 'skill:old-thing': entry });

    const plan = { install: [], remove: [{ id: 'skill:old-thing', entry }], replace: [], report: [] };

    const result = await applyPlan({ plan, lockPath, root, owner: 'design-power@0.1.0' });

    expect(existsSync(liveDir)).toBe(false);
    const onDisk = JSON.parse(readFileSync(lockPath, 'utf8'));
    expect(onDisk.resources['skill:old-thing']).toBeUndefined();
    expect(result.report).toEqual([]);
  });

  it('never_deletes_a_still_owned_resource', async () => {
    // Defense-in-depth: even though the planner only ever proposes a remove
    // op for an already-orphaned entry, the applier re-derives orphan status
    // from the CURRENT on-disk lock (dropOwner/isOrphaned) rather than
    // trusting the plan's stale snapshot of owners[].
    const { applyPlan } = await import(PROD.packApply);

    const root = makeTmpDir('pa-remove-still-owned');
    const liveDir = join(root, '.claude', 'skills', 'still-used');
    mkdirSync(liveDir, { recursive: true });
    writeFileSync(join(liveDir, 'SKILL.md'), '# Still used\n');

    const lockPath = join(root, 'integrations.lock.json');
    const entry = makeEntry({ owners: ['design-power@0.1.0', 'other-pack@2.0.0'], required: 'soft' });
    seedLock(lockPath, { 'skill:still-used': entry });

    const plan = { install: [], remove: [{ id: 'skill:still-used', entry }], replace: [], report: [] };

    await applyPlan({ plan, lockPath, root, owner: 'design-power@0.1.0' });

    expect(existsSync(liveDir)).toBe(true);
    const onDisk = JSON.parse(readFileSync(lockPath, 'utf8'));
    expect(onDisk.resources['skill:still-used']).toBeDefined();
    expect(onDisk.resources['skill:still-used'].owners).toEqual(['other-pack@2.0.0']);
  });
});

describe('AC3 — soft failure reports and continues; hard failure aborts and leaves prior ops', () => {
  it('a_soft_resource_failure_is_captured_in_the_report_and_does_not_abort', async () => {
    const { applyPlan } = await import(PROD.packApply);

    const root = makeTmpDir('pa-soft-fail');
    const sourceRoot = join(root, 'assimilated-skills');
    writeSkillSource(sourceRoot, 'good');
    // 'missing' has no owned source on disk -> materialize fails.
    const lockPath = join(root, 'integrations.lock.json');
    seedLock(lockPath, {});

    const plan = {
      install: [
        { id: 'skill:good', resource: { id: 'good', kind: 'skill', origin: 'x', pin: 'v1', scope: 'project', required: 'soft' } },
        { id: 'skill:missing', resource: { id: 'missing', kind: 'skill', origin: 'x', pin: 'v1', scope: 'project', required: 'soft' } },
      ],
      remove: [],
      replace: [],
      report: [],
    };

    const result = await applyPlan({ plan, lockPath, root, owner: 'design-power@0.1.0', sourceRoot });

    expect(result.report).toHaveLength(1);
    expect(result.report[0]).toMatchObject({ id: 'skill:missing' });
    expect(typeof result.report[0].reason).toBe('string');

    expect(existsSync(join(root, '.claude', 'skills', 'good', 'SKILL.md'))).toBe(true);
    const onDisk = JSON.parse(readFileSync(lockPath, 'utf8'));
    expect(onDisk.resources['skill:good']).toBeDefined();
    expect(onDisk.resources['skill:missing']).toBeUndefined();
  });

  it('a_hard_resource_failure_aborts_with_a_typed_error_and_leaves_prior_ops_in_place', async () => {
    const { applyPlan, HardResourceFailureError } = await import(PROD.packApply);

    const root = makeTmpDir('pa-hard-fail');
    const sourceRoot = join(root, 'assimilated-skills');
    writeSkillSource(sourceRoot, 'good');
    // 'critical' has no owned source -> materialize fails, and it is hard.
    const lockPath = join(root, 'integrations.lock.json');
    seedLock(lockPath, {});

    const plan = {
      install: [
        { id: 'skill:good', resource: { id: 'good', kind: 'skill', origin: 'x', pin: 'v1', scope: 'project', required: 'soft' } },
        { id: 'skill:critical', resource: { id: 'critical', kind: 'skill', origin: 'x', pin: 'v1', scope: 'project', required: 'hard' } },
      ],
      remove: [],
      replace: [],
      report: [],
    };

    await expect(
      applyPlan({ plan, lockPath, root, owner: 'design-power@0.1.0', sourceRoot }),
    ).rejects.toThrow(HardResourceFailureError);

    // Leave-and-report, no rollback: the earlier successful op's file AND
    // lock mutation both survive the abort.
    expect(existsSync(join(root, '.claude', 'skills', 'good', 'SKILL.md'))).toBe(true);
    const onDisk = JSON.parse(readFileSync(lockPath, 'utf8'));
    expect(onDisk.resources['skill:good']).toBeDefined();
    expect(onDisk.resources['skill:critical']).toBeUndefined();
  });
});

describe('AC4 — the lockfile is committed via atomicWriteFile exactly once', () => {
  // Spy on node:fs the same way tests/e2e/integrations-lock.spec.js does, so
  // we can assert the whole run produces a single tmp+rename commit onto the
  // lockfile, no matter how many install/remove ops it contains.
  vi.mock('node:fs', async (importOriginal) => {
    const real = await importOriginal();
    return {
      ...real,
      renameSync: vi.fn(real.renameSync),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renames_a_single_tmp_file_onto_the_lockfile_regardless_of_op_count', async () => {
    const fs = await import('node:fs');
    const { applyPlan } = await import(PROD.packApply);

    const root = makeTmpDir('pa-atomic-commit');
    const sourceRoot = join(root, 'assimilated-skills');
    writeSkillSource(sourceRoot, 'foo');
    const liveDirToRemove = join(root, '.claude', 'skills', 'old-thing');
    mkdirSync(liveDirToRemove, { recursive: true });
    writeFileSync(join(liveDirToRemove, 'SKILL.md'), '# Old\n');

    const lockPath = join(root, 'integrations.lock.json');
    const removeEntry = makeEntry({ owners: ['design-power@0.1.0'], required: 'soft' });
    seedLock(lockPath, { 'skill:old-thing': removeEntry });

    const plan = {
      install: [{ id: 'skill:foo', resource: { id: 'foo', kind: 'skill', origin: 'x', pin: 'v1', scope: 'project', required: 'soft' } }],
      remove: [{ id: 'skill:old-thing', entry: removeEntry }],
      replace: [],
      report: [],
    };

    await applyPlan({ plan, lockPath, root, owner: 'design-power@0.1.0', sourceRoot });

    const lockCommits = fs.renameSync.mock.calls.filter(
      ([src, dst]) => dst === lockPath && String(src).startsWith(lockPath + '.tmp.'),
    );
    expect(lockCommits).toHaveLength(1);
  });
});

// TASK-142 -- A3/TOCTOU fix: previously executeInstall computed
// `integrity: sha256:hashDir(liveDir)` AFTER copying -- it hashed whatever it
// just copied and never compared against anything, so content tampered in
// assimilated-skills/<id>/ AFTER stage-approve but BEFORE reconcile-apply was
// silently materialized and blessed with a fresh hash. Now: if the lockfile
// already carries a stage-time content_integrity for this id (assimilateSkill
// records one at approve time, src/assimilate.js), executeInstall re-hashes
// the CURRENT staged bytes with hashOwnedSkillDir and refuses to copy
// anything live on a mismatch -- fail closed, reported, no re-blessing.
describe('TASK-142 -- TOCTOU close: staged content is re-verified against the recorded content_integrity before materialize', () => {
  function seedStagedSkillWithApprovedBaseline(root, id, contents) {
    const sourceRoot = join(root, 'assimilated-skills');
    const skillDir = writeSkillSource(sourceRoot, id, contents);
    return skillDir;
  }

  async function seedApprovedLockEntry(lockPath, id, skillDir, overrides = {}) {
    const { hashOwnedSkillDir } = await import(PROD.packApply);
    const contentIntegrity = `sha256:${hashOwnedSkillDir(skillDir)}`;
    const entry = makeEntry({
      owners: [],
      required: 'soft',
      source_integrity: 'sha256:' + 'a'.repeat(64),
      content_integrity: contentIntegrity,
      ...overrides,
    });
    delete entry.integrity; // new-field-only shape, matching assimilateSkill's real writes
    seedLock(lockPath, { [`skill:${id}`]: entry });
    return contentIntegrity;
  }

  it('RED-LOCK: content tampered AFTER stage-approve, BEFORE reconcile-apply, is refused -- nothing materializes, no fresh-hash re-blessing', async () => {
    const { applyPlan } = await import(PROD.packApply);

    const root = makeTmpDir('pa-142-toctou-soft');
    const skillDir = seedStagedSkillWithApprovedBaseline(root, 'tampered', '# Tampered\nOriginal content a human actually approved.\n');
    const lockPath = join(root, 'integrations.lock.json');
    const approvedContentIntegrity = await seedApprovedLockEntry(lockPath, 'tampered', skillDir);

    // TAMPER: the staged owned copy changes AFTER approve, BEFORE reconcile-apply.
    writeFileSync(join(skillDir, 'SKILL.md'), '# Tampered\nMALICIOUS CONTENT INJECTED AFTER APPROVE.\n');

    const plan = {
      install: [{ id: 'skill:tampered', resource: { id: 'tampered', kind: 'skill', origin: 'x', pin: 'v1', scope: 'project', required: 'soft' } }],
      remove: [],
      replace: [],
      report: [],
    };

    const result = await applyPlan({ plan, lockPath, root, owner: 'design-power@0.1.0', sourceRoot: join(root, 'assimilated-skills') });

    // Fail closed: reported, not silently materialized.
    expect(result.report).toHaveLength(1);
    expect(result.report[0].id).toBe('skill:tampered');
    expect(result.report[0].reason).toMatch(/content integrity mismatch/i);

    // Nothing materialized to the live tree.
    expect(existsSync(join(root, '.claude', 'skills', 'tampered'))).toBe(false);

    // No re-blessing: the lock entry's content_integrity is untouched -- the
    // tampered bytes never got a fresh hash written over the real one.
    const onDisk = JSON.parse(readFileSync(lockPath, 'utf8'));
    expect(onDisk.resources['skill:tampered'].content_integrity).toBe(approvedContentIntegrity);
  });

  it('a hard-required tampered resource aborts the whole run via HardResourceFailureError, prior successful ops still committed', async () => {
    const { applyPlan, HardResourceFailureError, ContentIntegrityMismatchError } = await import(PROD.packApply);

    const root = makeTmpDir('pa-142-toctou-hard');
    const goodSourceRoot = join(root, 'assimilated-skills');
    writeSkillSource(goodSourceRoot, 'good');
    const tamperedDir = seedStagedSkillWithApprovedBaseline(root, 'tampered', '# Tampered\nOriginal content.\n');
    const lockPath = join(root, 'integrations.lock.json');
    seedLock(lockPath, {});
    const approvedContentIntegrity = await seedApprovedLockEntry(lockPath, 'tampered', tamperedDir, { required: 'hard' });

    writeFileSync(join(tamperedDir, 'SKILL.md'), '# Tampered\nMALICIOUS.\n');

    const plan = {
      install: [
        { id: 'skill:good', resource: { id: 'good', kind: 'skill', origin: 'x', pin: 'v1', scope: 'project', required: 'soft' } },
        { id: 'skill:tampered', resource: { id: 'tampered', kind: 'skill', origin: 'x', pin: 'v1', scope: 'project', required: 'hard' } },
      ],
      remove: [],
      replace: [],
      report: [],
    };

    let caught;
    try {
      await applyPlan({ plan, lockPath, root, owner: 'design-power@0.1.0', sourceRoot: goodSourceRoot });
    } catch (err) {
      caught = err;
    }

    // Aborted via the typed hard-failure error, whose cause is the typed
    // content-integrity mismatch -- not a generic Error either way.
    expect(caught).toBeInstanceOf(HardResourceFailureError);
    expect(caught.cause).toBeInstanceOf(ContentIntegrityMismatchError);
    expect(caught.id).toBe('skill:tampered');

    // Leave-and-report: the good op survived; the tampered one never materialized.
    expect(existsSync(join(root, '.claude', 'skills', 'good', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(root, '.claude', 'skills', 'tampered'))).toBe(false);
    const onDisk = JSON.parse(readFileSync(lockPath, 'utf8'));
    expect(onDisk.resources['skill:tampered'].content_integrity).toBe(approvedContentIntegrity);
  });

  it('matching content_integrity (no tampering) proceeds and materializes normally, carrying forward the verified hashes', async () => {
    const { applyPlan } = await import(PROD.packApply);

    const root = makeTmpDir('pa-142-toctou-match');
    const skillDir = seedStagedSkillWithApprovedBaseline(root, 'clean', '# Clean\nUntouched staged content.\n');
    const lockPath = join(root, 'integrations.lock.json');
    const approvedContentIntegrity = await seedApprovedLockEntry(lockPath, 'clean', skillDir);
    const seededBefore = JSON.parse(readFileSync(lockPath, 'utf8'));
    const approvedSourceIntegrity = seededBefore.resources['skill:clean'].source_integrity;

    const plan = {
      install: [{ id: 'skill:clean', resource: { id: 'clean', kind: 'skill', origin: 'x', pin: 'v1', scope: 'project', required: 'soft' } }],
      remove: [],
      replace: [],
      report: [],
    };

    const result = await applyPlan({ plan, lockPath, root, owner: 'design-power@0.1.0', sourceRoot: join(root, 'assimilated-skills') });

    expect(result.report).toEqual([]);
    expect(existsSync(join(root, '.claude', 'skills', 'clean', 'SKILL.md'))).toBe(true);

    const onDisk = JSON.parse(readFileSync(lockPath, 'utf8'));
    const entry = onDisk.resources['skill:clean'];
    expect(entry.content_integrity).toBe(approvedContentIntegrity);
    expect(entry.source_integrity).toBe(approvedSourceIntegrity);
    expect(entry.integrity).toBeUndefined();
  });

  it('BACKWARD-COMPAT: a pre-TASK-142 lock entry with only the legacy `integrity` field skips verification and installs via the old hashDir(liveDir) path', async () => {
    // Documented decision: an entry that predates TASK-142 has no
    // content_integrity baseline to check against -- inventing one
    // retroactively would be indistinguishable from the TOCTOU bug itself.
    // Verification is skipped for it; the pre-existing single-hash-of-what-
    // was-just-copied behavior is preserved unchanged.
    const { applyPlan } = await import(PROD.packApply);

    const root = makeTmpDir('pa-142-legacy-entry');
    const sourceRoot = join(root, 'assimilated-skills');
    writeSkillSource(sourceRoot, 'legacy', '# Legacy\nPre-TASK-142 shape.\n');
    const lockPath = join(root, 'integrations.lock.json');
    seedLock(lockPath, { 'skill:legacy': makeEntry({ owners: [], required: 'soft' }) }); // legacy `integrity` only

    const plan = {
      install: [{ id: 'skill:legacy', resource: { id: 'legacy', kind: 'skill', origin: 'x', pin: 'v1', scope: 'project', required: 'soft' } }],
      remove: [],
      replace: [],
      report: [],
    };

    const result = await applyPlan({ plan, lockPath, root, owner: 'design-power@0.1.0', sourceRoot });

    expect(result.report).toEqual([]);
    expect(existsSync(join(root, '.claude', 'skills', 'legacy', 'SKILL.md'))).toBe(true);
    const onDisk = JSON.parse(readFileSync(lockPath, 'utf8'));
    expect(onDisk.resources['skill:legacy'].integrity).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(onDisk.resources['skill:legacy'].content_integrity).toBeUndefined();
  });

  it('BACKWARD-COMPAT: an id with NO prior lock entry at all also skips verification (nothing to verify against)', async () => {
    const { applyPlan } = await import(PROD.packApply);

    const root = makeTmpDir('pa-142-no-prior-entry');
    const sourceRoot = join(root, 'assimilated-skills');
    writeSkillSource(sourceRoot, 'fresh', '# Fresh\nNever assimilated before.\n');
    const lockPath = join(root, 'integrations.lock.json');
    seedLock(lockPath, {}); // no prior entry for "fresh" at all

    const plan = {
      install: [{ id: 'skill:fresh', resource: { id: 'fresh', kind: 'skill', origin: 'x', pin: 'v1', scope: 'project', required: 'soft' } }],
      remove: [],
      replace: [],
      report: [],
    };

    const result = await applyPlan({ plan, lockPath, root, owner: 'design-power@0.1.0', sourceRoot });

    expect(result.report).toEqual([]);
    const onDisk = JSON.parse(readFileSync(lockPath, 'utf8'));
    expect(onDisk.resources['skill:fresh'].integrity).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(onDisk.resources['skill:fresh'].content_integrity).toBeUndefined();
  });
});

describe('a replace op is surfaced in the report as deferred, never silently dropped', () => {
  it('does_not_touch_the_lock_entry_or_live_dir_and_reports_executed_false', async () => {
    const { applyPlan } = await import(PROD.packApply);

    const root = makeTmpDir('pa-replace-deferred');
    const liveDir = join(root, '.claude', 'skills', 'foo');
    mkdirSync(liveDir, { recursive: true });
    writeFileSync(join(liveDir, 'SKILL.md'), '# Foo v1\n');

    const lockPath = join(root, 'integrations.lock.json');
    const entry = makeEntry({ pin: 'v1', owners: ['design-power@0.1.0'], required: 'soft' });
    seedLock(lockPath, { 'skill:foo': entry });

    const plan = {
      install: [],
      remove: [],
      replace: [{ id: 'skill:foo', resource: { id: 'foo', kind: 'skill', origin: 'x', pin: 'v2', scope: 'project', required: 'soft' }, from: 'v1', to: 'v2' }],
      report: [],
    };

    const result = await applyPlan({ plan, lockPath, root, owner: 'design-power@0.1.0' });

    expect(result.report).toHaveLength(1);
    expect(result.report[0]).toMatchObject({ id: 'skill:foo', executed: false });

    expect(readFileSync(join(liveDir, 'SKILL.md'), 'utf8')).toBe('# Foo v1\n');
    const onDisk = JSON.parse(readFileSync(lockPath, 'utf8'));
    expect(onDisk.resources['skill:foo'].pin).toBe('v1');
  });
});
