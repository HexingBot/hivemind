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

// TASK-183 — src/pack-apply.js:266-275 selected the owned source with
// `existsSync(dir)`, which only proves a DIRECTORY exists, never that it
// holds a real owned skill copy (unlike src/assimilate.js's own source
// validation, which checks for a readable SKILL.md). Before TASK-181 there
// was one sourceRoot and nothing to shadow; the multi-root search path
// TASK-181 added makes this load-bearing: an EMPTY assimilated-skills/<id>/
// earlier in the search path silently shadows a perfectly good candidate
// later in the path, materializes an empty skill dir, and blesses it with
// the empty-tree SHA-256 as a "verified" integrity at the upstream pin.
describe('TASK-183 — owned-source selection validates a REAL owned skill copy, not a bare existsSync directory test', () => {
  it('AC1/AC2/AC3 — an EMPTY candidate earlier in the search path is skipped in favour of a valid candidate later in the path; no false integrity is ever recorded', async () => {
    const { applyPlan, hashDir } = await import(PROD.packApply);

    const root = makeTmpDir('pa-183-empty-box-skip');
    const localSourceRoot = join(root, 'assimilated-skills');
    // The reproduced defect: a consumer fixture with an EMPTY
    // assimilated-skills/watch/ -- e.g. `mkdir -p` with nothing ever staged
    // into it -- shadowing a valid plugin copy later in the search path.
    mkdirSync(join(localSourceRoot, 'watch'), { recursive: true });

    const pluginSourceRoot = join(root, 'plugin-owned');
    writeSkillSource(pluginSourceRoot, 'watch', '# Watch\nReal owned copy.\n');

    const lockPath = join(root, 'integrations.lock.json');
    seedLock(lockPath, {});

    const plan = {
      install: [{
        id: 'skill:watch',
        resource: { id: 'watch', kind: 'skill', origin: 'x', pin: 'v1', scope: 'project', required: 'soft' },
      }],
      remove: [],
      replace: [],
      report: [],
    };

    const result = await applyPlan({
      plan, lockPath, root, owner: 'watch@0.2.0',
      sourceRoot: localSourceRoot,
      sourceRoots: [pluginSourceRoot],
    });

    // AC2 — no report entry: the empty candidate was skipped, the valid
    // fallback materialized successfully.
    expect(result.report).toEqual([]);

    // Installed from the PLUGIN copy, not the empty local shadow -- the live
    // dir actually has content, not an empty directory with no SKILL.md.
    const liveFile = join(root, '.claude', 'skills', 'watch', 'SKILL.md');
    expect(existsSync(liveFile)).toBe(true);
    expect(readFileSync(liveFile, 'utf8')).toBe('# Watch\nReal owned copy.\n');

    // AC3 — the recorded integrity is a REAL hash of the materialized
    // content, never the empty-tree SHA-256 (the ticket's reproduced value).
    const onDisk = JSON.parse(readFileSync(lockPath, 'utf8'));
    const entry = onDisk.resources['skill:watch'];
    expect(entry).toBeDefined();
    expect(entry.integrity).not.toBe('sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(entry.integrity).toBe(`sha256:${hashDir(join(root, '.claude', 'skills', 'watch'))}`);
  });

  it('AC2/AC4 — when NO candidate anywhere is a real owned copy, the install fails loudly naming what was tried, and a second run does not re-bless it (self-healing, not sticky)', async () => {
    const { applyPlan } = await import(PROD.packApply);

    const root = makeTmpDir('pa-183-no-valid-candidate');
    const localSourceRoot = join(root, 'assimilated-skills');
    const emptyCandidateDir = join(localSourceRoot, 'watch');
    mkdirSync(emptyCandidateDir, { recursive: true }); // still empty, no fallback provided at all

    const lockPath = join(root, 'integrations.lock.json');
    seedLock(lockPath, {});

    const plan = {
      install: [{
        id: 'skill:watch',
        resource: { id: 'watch', kind: 'skill', origin: 'x', pin: 'v1', scope: 'project', required: 'soft' },
      }],
      remove: [],
      replace: [],
      report: [],
    };

    const applyOnce = () => applyPlan({ plan, lockPath, root, owner: 'watch@0.2.0', sourceRoot: localSourceRoot });

    const first = await applyOnce();
    expect(first.report).toHaveLength(1);
    expect(first.report[0].id).toBe('skill:watch');
    expect(first.report[0].reason).toMatch(/owned source not found/);
    expect(first.report[0].reason).toContain(emptyCandidateDir);
    expect(existsSync(join(root, '.claude', 'skills', 'watch'))).toBe(false);
    const lockAfterFirst = JSON.parse(readFileSync(lockPath, 'utf8'));
    expect(lockAfterFirst.resources['skill:watch']).toBeUndefined();

    // AC4 — a second run against the SAME still-broken fixture behaves
    // identically: the failure is not sticky, and the empty dir never wins
    // on a re-run (the permanently-broken re-run path the ticket describes,
    // now closed).
    const second = await applyOnce();
    expect(second.report).toHaveLength(1);
    expect(second.report[0].id).toBe('skill:watch');
    expect(existsSync(join(root, '.claude', 'skills', 'watch'))).toBe(false);
    const lockAfterSecond = JSON.parse(readFileSync(lockPath, 'utf8'));
    expect(lockAfterSecond.resources['skill:watch']).toBeUndefined();
  });
});

// TASK-183 AC8(b) — applyPlan's multi-root search had no spec proving
// local-beats-plugin precedence when BOTH candidates are valid (as opposed to
// AC1/AC2's "one candidate is invalid" case above).
describe('TASK-183 — precedence: applyPlan multi-root search proves a local adoption beats a built-in of the same id', () => {
  it('when both the local staging dir and a fallback (plugin) root hold a VALID copy of the same id, the local one wins', async () => {
    const { applyPlan } = await import(PROD.packApply);

    const root = makeTmpDir('pa-183-precedence-local-wins');
    const localSourceRoot = join(root, 'assimilated-skills');
    writeSkillSource(localSourceRoot, 'watch', '# Watch\nLOCAL adoption -- must win.\n');
    const pluginSourceRoot = join(root, 'plugin-owned');
    writeSkillSource(pluginSourceRoot, 'watch', '# Watch\nBuilt-in plugin copy -- must lose.\n');

    const lockPath = join(root, 'integrations.lock.json');
    seedLock(lockPath, {});

    const plan = {
      install: [{
        id: 'skill:watch',
        resource: { id: 'watch', kind: 'skill', origin: 'x', pin: 'v1', scope: 'project', required: 'soft' },
      }],
      remove: [],
      replace: [],
      report: [],
    };

    await applyPlan({
      plan, lockPath, root, owner: 'watch@0.2.0',
      sourceRoot: localSourceRoot,
      sourceRoots: [pluginSourceRoot],
    });

    const liveFile = join(root, '.claude', 'skills', 'watch', 'SKILL.md');
    expect(readFileSync(liveFile, 'utf8')).toBe('# Watch\nLOCAL adoption -- must win.\n');
  });
});

describe('a replace op with an UNDECIDABLE pin comparison is surfaced in the report as deferred, never silently dropped', () => {
  it('does_not_touch_the_lock_entry_or_live_dir_and_reports_executed_false', async () => {
    // "v1"/"v2" are opaque, non-semver tokens -- comparePinPrecedence cannot
    // order them (see tests/pack-apply-pin-precedence.spec.js), so this stays
    // on the deferred/keep-as-is path exactly like before TASK-182. The
    // DECIDABLE cases (plugin ahead, project ahead) are covered by the
    // "TASK-182 — dual-copy precedence" describe block below.
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
    expect(result.report[0].reason).toMatch(/cannot.*ordered|undecidable/i);

    expect(readFileSync(join(liveDir, 'SKILL.md'), 'utf8')).toBe('# Foo v1\n');
    const onDisk = JSON.parse(readFileSync(lockPath, 'utf8'));
    expect(onDisk.resources['skill:foo'].pin).toBe('v1');
  });
});

// TASK-182 — dual-copy precedence (human decision, direction (a), recorded on
// the ticket 2026-08-04): "the reconciler retires the project-scope resource
// when the plugin ships the same resource id at an equal-or-newer pin; the
// project-scope copy survives only when it is ahead of the plugin." This also
// reconciles the TASK-181 accident named in that decision:
// src/pack-apply.js#applyPlan's search-path precedence (consumer staging dir
// always leads the plugin, by first-existing-match) let a STALE project copy
// silently shadow a NEWER plugin copy -- the exact inversion of the rule.
//
// AC5's already-installed-project precondition is modeled explicitly in every
// fixture below: a lockfile that ALREADY owns skill:watch (a prior
// reconcile-apply materialized it), never a fresh/never-installed resource --
// a bare REMOVE against that state is the defect this ticket exists to avoid
// (see the "no dangling edge, no lost skill" assertions).
describe('TASK-182 — dual-copy precedence: plugin wins on a DECIDABLE equal-or-newer pin, project wins only when ahead, an undecidable divergence is never silently resolved', () => {
  it('AC6 — plugin ships watch at a NEWER decidable pin than an already-installed project lockfile entry: the stale project-scope copy is retired, the plugin content materializes, and the retirement is announced -- no dangling edge, no lost skill', async () => {
    const { applyPlan } = await import(PROD.packApply);

    const root = makeTmpDir('pa-182-shipped-newer-retires');
    const projectSourceRoot = join(root, 'assimilated-skills');
    writeSkillSource(projectSourceRoot, 'watch', '# Watch v1\nSTALE project-pinned copy -- must be retired.\n');
    const pluginSourceRoot = join(root, 'plugin-owned');
    writeSkillSource(pluginSourceRoot, 'watch', '# Watch v2\nCurrent plugin copy -- must win.\n');

    // AC5 precondition: already installed & lock-owned, materialized at the
    // OLDER pin (a prior reconcile-apply run, not a fresh/never-installed id).
    const liveDir = join(root, '.claude', 'skills', 'watch');
    mkdirSync(liveDir, { recursive: true });
    writeFileSync(join(liveDir, 'SKILL.md'), '# Watch v1\nSTALE project-pinned copy -- must be retired.\n');
    const lockPath = join(root, 'integrations.lock.json');
    seedLock(lockPath, { 'skill:watch': makeEntry({ pin: '1.0.0', owners: ['watch@1.0.0'], required: 'soft' }) });

    const plan = {
      install: [],
      remove: [],
      replace: [{
        id: 'skill:watch',
        resource: { id: 'watch', kind: 'skill', origin: 'x', pin: '2.0.0', scope: 'project', required: 'soft' },
        from: '1.0.0',
        to: '2.0.0',
      }],
      report: [],
    };

    const result = await applyPlan({
      plan, lockPath, root, owner: 'watch@2.0.0',
      sourceRoot: projectSourceRoot,
      sourceRoots: [pluginSourceRoot],
    });

    // Materialized from the PLUGIN candidate, not the stale project one.
    expect(readFileSync(join(liveDir, 'SKILL.md'), 'utf8')).toBe('# Watch v2\nCurrent plugin copy -- must win.\n');

    // AC5 — no dangling edge, no lost skill: the id is still owned and still
    // live; this is an in-place content refresh, never a REMOVE.
    const onDisk = JSON.parse(readFileSync(lockPath, 'utf8'));
    const entry = onDisk.resources['skill:watch'];
    expect(entry).toBeDefined();
    expect(entry.pin).toBe('2.0.0');
    expect(entry.owners).toContain('watch@2.0.0');
    expect(existsSync(liveDir)).toBe(true);

    // Announced, never silent (the "must never be silent" constraint).
    expect(result.report).toHaveLength(1);
    expect(result.report[0]).toMatchObject({ id: 'skill:watch', executed: true, retired: true });
    expect(result.report[0].reason).toMatch(/retired/i);
    expect(result.report[0].reason).toMatch(/1\.0\.0/);
    expect(result.report[0].reason).toMatch(/2\.0\.0/);
  });

  it('the installed (project) pin is AHEAD of the shipped (plugin) pin: the project-scope copy survives untouched and is reported informationally, never retired', async () => {
    const { applyPlan } = await import(PROD.packApply);

    const root = makeTmpDir('pa-182-installed-newer-survives');
    const projectSourceRoot = join(root, 'assimilated-skills');
    writeSkillSource(projectSourceRoot, 'watch', '# Watch v3\nDeliberately-pinned-ahead project copy -- must survive.\n');
    const pluginSourceRoot = join(root, 'plugin-owned');
    writeSkillSource(pluginSourceRoot, 'watch', '# Watch v2\nOlder plugin copy -- must lose.\n');

    const liveDir = join(root, '.claude', 'skills', 'watch');
    mkdirSync(liveDir, { recursive: true });
    writeFileSync(join(liveDir, 'SKILL.md'), '# Watch v3\nDeliberately-pinned-ahead project copy -- must survive.\n');
    const lockPath = join(root, 'integrations.lock.json');
    seedLock(lockPath, { 'skill:watch': makeEntry({ pin: '3.0.0', owners: ['watch@3.0.0'], required: 'soft' }) });

    const plan = {
      install: [],
      remove: [],
      replace: [{
        id: 'skill:watch',
        resource: { id: 'watch', kind: 'skill', origin: 'x', pin: '2.0.0', scope: 'project', required: 'soft' },
        from: '3.0.0',
        to: '2.0.0',
      }],
      report: [],
    };

    const result = await applyPlan({
      plan, lockPath, root, owner: 'watch@2.0.0',
      sourceRoot: projectSourceRoot,
      sourceRoots: [pluginSourceRoot],
    });

    expect(readFileSync(join(liveDir, 'SKILL.md'), 'utf8')).toBe('# Watch v3\nDeliberately-pinned-ahead project copy -- must survive.\n');
    const onDisk = JSON.parse(readFileSync(lockPath, 'utf8'));
    expect(onDisk.resources['skill:watch'].pin).toBe('3.0.0');

    expect(result.report).toHaveLength(1);
    expect(result.report[0]).toMatchObject({ id: 'skill:watch', executed: false });
    expect(result.report[0].retired).toBeFalsy();
    expect(result.report[0].reason).toMatch(/ahead/i);
  });

  it('an UNDECIDABLE divergence (real git-sha-shaped pins) keeps the project-scope copy and surfaces the ambiguity loudly instead of silently retiring it', async () => {
    const { applyPlan } = await import(PROD.packApply);

    const root = makeTmpDir('pa-182-undecidable-git-shas');
    const projectSourceRoot = join(root, 'assimilated-skills');
    writeSkillSource(projectSourceRoot, 'watch', '# Watch (project sha)\nProject-pinned copy.\n');
    const pluginSourceRoot = join(root, 'plugin-owned');
    writeSkillSource(pluginSourceRoot, 'watch', '# Watch (plugin sha)\nPlugin copy.\n');

    const projectPin = '83da59fa78c3eee9e20f515fe75c438bb5166efd';
    const pluginPin = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';

    const liveDir = join(root, '.claude', 'skills', 'watch');
    mkdirSync(liveDir, { recursive: true });
    writeFileSync(join(liveDir, 'SKILL.md'), '# Watch (project sha)\nProject-pinned copy.\n');
    const lockPath = join(root, 'integrations.lock.json');
    seedLock(lockPath, { 'skill:watch': makeEntry({ pin: projectPin, owners: ['watch@1.0.0'], required: 'soft' }) });

    const plan = {
      install: [],
      remove: [],
      replace: [{
        id: 'skill:watch',
        resource: { id: 'watch', kind: 'skill', origin: 'x', pin: pluginPin, scope: 'project', required: 'soft' },
        from: projectPin,
        to: pluginPin,
      }],
      report: [],
    };

    const result = await applyPlan({
      plan, lockPath, root, owner: 'watch@2.0.0',
      sourceRoot: projectSourceRoot,
      sourceRoots: [pluginSourceRoot],
    });

    // Kept -- the residual "cannot determine" outcome must never silently
    // retire the project's copy.
    expect(readFileSync(join(liveDir, 'SKILL.md'), 'utf8')).toBe('# Watch (project sha)\nProject-pinned copy.\n');
    const onDisk = JSON.parse(readFileSync(lockPath, 'utf8'));
    expect(onDisk.resources['skill:watch'].pin).toBe(projectPin);

    expect(result.report).toHaveLength(1);
    expect(result.report[0]).toMatchObject({ id: 'skill:watch', executed: false });
    expect(result.report[0].retired).toBeFalsy();
    expect(result.report[0].reason).toMatch(/cannot.*order|undecidable/i);
  });

  it('a fresh install (no prior lock entry) with a divergent staged project pin also routes through the plugin candidate when the plugin is equal-or-newer, and announces it', async () => {
    // Distinct from the replace-op fixtures above: this exercises the INSTALL
    // path (plan.install, not plan.replace) -- e.g. a project ran its own
    // `assimilate stage` (which records a lock entry at STAGE time, before
    // any materialize -- src/assimilate.js) but the resource was never live
    // yet when this reconcile-apply runs, so plan() proposes an install, not
    // a replace (TASK-121's staged-vs-live rule). The SAME precedence
    // decision must still apply to the search-path candidate selection.
    const { applyPlan } = await import(PROD.packApply);

    const root = makeTmpDir('pa-182-install-path-shipped-newer');
    const projectSourceRoot = join(root, 'assimilated-skills');
    writeSkillSource(projectSourceRoot, 'watch', '# Watch v1\nSTALE staged-but-not-yet-live project copy.\n');
    const pluginSourceRoot = join(root, 'plugin-owned');
    writeSkillSource(pluginSourceRoot, 'watch', '# Watch v2\nCurrent plugin copy -- must win.\n');

    const lockPath = join(root, 'integrations.lock.json');
    seedLock(lockPath, { 'skill:watch': makeEntry({ pin: '1.0.0', owners: [], required: 'soft' }) });

    const plan = {
      install: [{
        id: 'skill:watch',
        resource: { id: 'watch', kind: 'skill', origin: 'x', pin: '2.0.0', scope: 'project', required: 'soft' },
      }],
      remove: [],
      replace: [],
      report: [],
    };

    const result = await applyPlan({
      plan, lockPath, root, owner: 'watch@2.0.0',
      sourceRoot: projectSourceRoot,
      sourceRoots: [pluginSourceRoot],
    });

    const liveFile = join(root, '.claude', 'skills', 'watch', 'SKILL.md');
    expect(readFileSync(liveFile, 'utf8')).toBe('# Watch v2\nCurrent plugin copy -- must win.\n');

    const onDisk = JSON.parse(readFileSync(lockPath, 'utf8'));
    expect(onDisk.resources['skill:watch'].pin).toBe('2.0.0');

    expect(result.report).toHaveLength(1);
    expect(result.report[0]).toMatchObject({ id: 'skill:watch', executed: true, retired: true });
  });
});

// TASK-200 — from TASK-182's gating review (MEDIUM-3): executeInstall wrote
// `lock.resources[id] = { ..., owners: [] }` and then called addOwner for
// ONLY the current run's pack, dropping any owner edge belonging to a
// DIFFERENT pack in the process. Latent before TASK-182 (only reachable on
// the unusual staged-but-not-live install path); TASK-182 put plan.replace
// through the very same executeInstall, so it now sits on the routine
// plugin-wins retire path. Fix: preserve prior owners across a re-materialize
// and union the current run's owner in, on BOTH the install and replace
// paths (never a hard reset) -- see executeInstall's own TASK-200 comment for
// the full reasoning, including why nothing downstream relies on the reset.
describe('TASK-200 — owner-edge clobber: a re-materialize through executeInstall must preserve a sibling pack\'s owner edge, never reset it', () => {
  it('RED-LOCK (AC1): a resource owned by two packs, replaced via the TASK-182 plugin-wins path, loses the sibling pack\'s owner edge without the fix', async () => {
    const { applyPlan } = await import(PROD.packApply);

    const root = makeTmpDir('pa-200-replace-multi-owner');
    const projectSourceRoot = join(root, 'assimilated-skills');
    writeSkillSource(projectSourceRoot, 'watch', '# Watch v1\nStale project-pinned copy.\n');
    const pluginSourceRoot = join(root, 'plugin-owned');
    writeSkillSource(pluginSourceRoot, 'watch', '# Watch v2\nCurrent plugin copy.\n');

    const liveDir = join(root, '.claude', 'skills', 'watch');
    mkdirSync(liveDir, { recursive: true });
    writeFileSync(join(liveDir, 'SKILL.md'), '# Watch v1\nStale project-pinned copy.\n');
    const lockPath = join(root, 'integrations.lock.json');
    // The multi-owner fixture the ticket calls for: TWO DIFFERENT packs
    // already own this resource id (a supported shape the descriptor schema
    // does not forbid). The `watch` pack's OWN owner identity ("watch@1.0.0")
    // stays constant across this run -- only the SKILL's pin bumps (1.0.0 ->
    // 2.0.0), which is orthogonal to the owning pack's own version (owner =
    // "<descriptor.id>@<descriptor.version>", src/pack-orchestrator.js) --
    // so the fixture isolates the cross-pack clobber this ticket is about
    // from same-pack version-edge bookkeeping, which is a separate concern.
    seedLock(lockPath, {
      'skill:watch': makeEntry({ pin: '1.0.0', owners: ['design-power@0.1.0', 'watch@1.0.0'], required: 'soft' }),
    });

    const plan = {
      install: [],
      remove: [],
      replace: [{
        id: 'skill:watch',
        resource: { id: 'watch', kind: 'skill', origin: 'x', pin: '2.0.0', scope: 'project', required: 'soft' },
        from: '1.0.0',
        to: '2.0.0',
      }],
      report: [],
    };

    await applyPlan({
      plan, lockPath, root, owner: 'watch@1.0.0',
      sourceRoot: projectSourceRoot,
      sourceRoots: [pluginSourceRoot],
    });

    const onDisk = JSON.parse(readFileSync(lockPath, 'utf8'));
    const entry = onDisk.resources['skill:watch'];
    expect(entry).toBeDefined();
    // design-power's edge is a SIBLING pack's ownership, unrelated to this
    // run's replace -- it must survive the re-materialize.
    expect(entry.owners).toEqual(['design-power@0.1.0', 'watch@1.0.0']);
  });

  it('AC2 (install path): owner edges belonging to other packs survive a re-materialize on the plain install path too', async () => {
    // Distinct from the replace-path fixture above: this is the
    // staged-but-not-live shape (a prior assimilate/reconcile already
    // recorded a lock entry -- and another pack's ownership on it -- but the
    // resource was never live on disk when this run's plan() proposed an
    // install, per TASK-121's staged-vs-live rule). This is the path that was
    // reachable BEFORE TASK-182 too.
    const { applyPlan } = await import(PROD.packApply);

    const root = makeTmpDir('pa-200-install-multi-owner');
    const sourceRoot = join(root, 'assimilated-skills');
    writeSkillSource(sourceRoot, 'shared', '# Shared\nOwned copy.\n');
    const lockPath = join(root, 'integrations.lock.json');
    seedLock(lockPath, {
      'skill:shared': makeEntry({ pin: 'v1', owners: ['design-power@0.1.0'], required: 'soft' }),
    });

    const plan = {
      install: [{
        id: 'skill:shared',
        resource: { id: 'shared', kind: 'skill', origin: 'x', pin: 'v1', scope: 'project', required: 'soft' },
      }],
      remove: [],
      replace: [],
      report: [],
    };

    await applyPlan({ plan, lockPath, root, owner: 'watch@1.0.0', sourceRoot });

    const onDisk = JSON.parse(readFileSync(lockPath, 'utf8'));
    const entry = onDisk.resources['skill:shared'];
    expect(entry).toBeDefined();
    expect(entry.owners).toContain('design-power@0.1.0');
    expect(entry.owners).toContain('watch@1.0.0');
  });

  it('AC3: after a replace by pack B, a resource still owned by pack A is NOT removable as an orphan by executeRemove', async () => {
    // Proves the DOWNSTREAM CONSEQUENCE the field exists to produce, not just
    // the array contents: executeRemove promises "a still-owned resource is
    // never deleted" (re-derived from the CURRENT on-disk lock via
    // dropOwner/isOrphaned). If the replace silently dropped pack A's edge,
    // this step would see an apparently-unowned resource and delete it --
    // the failure this ticket's description says surfaces far from its
    // cause, in a DIFFERENT pack's run, as a deleted working skill.
    const { applyPlan } = await import(PROD.packApply);

    const root = makeTmpDir('pa-200-replace-then-remove-still-owned');
    const projectSourceRoot = join(root, 'assimilated-skills');
    writeSkillSource(projectSourceRoot, 'watch', '# Watch v1\n');
    const pluginSourceRoot = join(root, 'plugin-owned');
    writeSkillSource(pluginSourceRoot, 'watch', '# Watch v2\n');

    const liveDir = join(root, '.claude', 'skills', 'watch');
    mkdirSync(liveDir, { recursive: true });
    writeFileSync(join(liveDir, 'SKILL.md'), '# Watch v1\n');
    const lockPath = join(root, 'integrations.lock.json');
    // As in the RED-LOCK fixture above, pack B's (watch) own owner identity
    // stays constant ("watch@1.0.0") across the replace -- only the skill's
    // pin bumps -- isolating the cross-pack guarantee AC3 exists to prove
    // from same-pack version-edge bookkeeping, which is a separate concern.
    seedLock(lockPath, {
      'skill:watch': makeEntry({ pin: '1.0.0', owners: ['design-power@0.1.0', 'watch@1.0.0'], required: 'soft' }),
    });

    // Step 1: pack B (watch) replaces the resource at an equal-or-newer pin
    // (TASK-182 plugin-wins path). Pack A's edge must survive this.
    const replacePlan = {
      install: [],
      remove: [],
      replace: [{
        id: 'skill:watch',
        resource: { id: 'watch', kind: 'skill', origin: 'x', pin: '2.0.0', scope: 'project', required: 'soft' },
        from: '1.0.0',
        to: '2.0.0',
      }],
      report: [],
    };
    await applyPlan({
      plan: replacePlan, lockPath, root, owner: 'watch@1.0.0',
      sourceRoot: projectSourceRoot,
      sourceRoots: [pluginSourceRoot],
    });

    const afterReplace = JSON.parse(readFileSync(lockPath, 'utf8'));
    const entryAfterReplace = afterReplace.resources['skill:watch'];
    expect(entryAfterReplace.owners).toContain('design-power@0.1.0');

    // Step 2: pack B (watch) itself later drops this resource -- a real
    // executeRemove op, re-deriving orphan status from the CURRENT on-disk
    // lock (never a stale plan snapshot). This is the exact guarantee AC3
    // exists to prove.
    const removePlan = {
      install: [],
      remove: [{ id: 'skill:watch', entry: entryAfterReplace }],
      replace: [],
      report: [],
    };
    await applyPlan({ plan: removePlan, lockPath, root, owner: 'watch@1.0.0' });

    // Still owned by design-power -> must NOT have been deleted.
    expect(existsSync(liveDir)).toBe(true);
    const afterRemove = JSON.parse(readFileSync(lockPath, 'utf8'));
    const entryAfterRemove = afterRemove.resources['skill:watch'];
    expect(entryAfterRemove).toBeDefined();
    expect(entryAfterRemove.owners).toEqual(['design-power@0.1.0']);
  });
});
