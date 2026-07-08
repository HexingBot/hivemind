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
