// tests/pack-reconcile.spec.js
// TASK-118 — Skills env-probe + reconcile planner (pure). Pure logic only —
// no disk I/O (fast tier). probeSkills() real-fs coverage lives in
// tests/e2e/pack-reconcile.spec.js.
//
// Acceptance criteria covered here:
//   AC2 — plan() puts a desired-but-absent skill in install; a lock resource
//     that is orphaned (owners empty) AND soft goes in remove; a still-owned
//     orphan is NOT in remove.
//   AC3 — a desired resource whose pin differs from the lock/actual goes to
//     replace; matching pins are a no-op.
//   AC4 — a hard-required resource that would fail (out-of-scope kind, Wave 1
//     is skills-only) is surfaced in report with a blocking flag; plan()
//     performs no filesystem or network I/O.
//
// TASK-121 — closes the staged-but-not-live divergence (TASK-120 review
// MEDIUM): a skill present in the lock (staged by assimilate) but absent from
// `actual` (probeSkills — not yet materialized under .claude/skills) is now
// proposed for install regardless of lock presence, since a not-live skill
// cannot be "replaced" — it must first be installed/materialized. This is a
// legitimate semantic shift for two of the AC3 tests below (a lock entry with
// no corresponding `actual` entry used to fall through to a pin comparison
// and land in replace/no-op; it now short-circuits to install before that
// comparison ever runs) — both were updated to pass a matching `actual` entry
// so they keep testing the genuinely-live steady state they were written for,
// and the staged-but-not-live cases they used to (incidentally) cover are now
// their own tests under the "AC1/TASK-121" describe block below.

import { describe, it, expect, vi } from 'vitest';

// vi.mock is hoisted above imports by vitest, so this replaces node:fs for
// the whole file before pack-reconcile.js (imported below) gets its own
// binding — the purity test asserts none of these spies are ever called.
vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    existsSync: vi.fn(real.existsSync),
    readdirSync: vi.fn(real.readdirSync),
    readFileSync: vi.fn(real.readFileSync),
  };
});

import { plan } from '../src/pack-reconcile.js';

function makeLockEntry(overrides) {
  return {
    kind: 'skill',
    origin: 'github.com/example/skills',
    pin: 'abc123',
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

function makeLock(resources) {
  return { schema_version: 1, resources };
}

describe('AC2 — desired-but-absent skill goes to install', () => {
  it('a_skill_with_no_lock_or_actual_entry_is_installed', () => {
    const desired = [{ id: 'shadcn-vue', kind: 'skill', origin: 'x', pin: 'v1', scope: 'project', required: 'soft' }];
    const result = plan(desired, makeLock({}), {});

    expect(result.install).toHaveLength(1);
    expect(result.install[0].id).toBe('skill:shadcn-vue');
    expect(result.remove).toEqual([]);
    expect(result.replace).toEqual([]);
    expect(result.report).toEqual([]);
  });
});

describe('AC2 — orphaned + soft lock resources go to remove; still-owned orphans do not', () => {
  it('an_orphaned_soft_resource_is_removed', () => {
    const lock = makeLock({
      'skill:old-thing': makeLockEntry({ owners: [], required: 'soft' }),
    });

    const result = plan([], lock, {});

    expect(result.remove).toHaveLength(1);
    expect(result.remove[0].id).toBe('skill:old-thing');
  });

  it('a_still_owned_resource_is_not_removed_even_if_not_desired', () => {
    const lock = makeLock({
      'skill:still-used': makeLockEntry({ owners: ['design-power@0.1.0'], required: 'soft' }),
    });

    const result = plan([], lock, {});

    expect(result.remove).toEqual([]);
  });

  it('an_orphaned_but_hard_required_resource_is_not_auto_removed', () => {
    // Safe-removal requires owners-empty AND (soft OR trust-mode) per
    // addon-packs-plan.md §2 — trust-mode is out of scope here, so a hard
    // orphan is left in place rather than auto-removed.
    const lock = makeLock({
      'skill:critical-thing': makeLockEntry({ owners: [], required: 'hard' }),
    });

    const result = plan([], lock, {});

    expect(result.remove).toEqual([]);
  });

  it('a_soft_orphan_still_in_the_desired_set_is_not_removed (TASK-118 review HIGH)', () => {
    // Regression lock: §2 is "desired vs actual" — owners-empty alone is not
    // enough to remove. A lock entry with owners:[] (orphaned by whichever
    // pack dropped it) that is STILL in the CURRENT desired set is being
    // re-adopted, not discarded. Before the fix, this landed in `remove`
    // while the desired-side pass simultaneously treated it as a pins-match
    // no-op — self-contradictory, and the applier (TASK-119) would delete a
    // wanted skill.
    //
    // TASK-121: this skill is also LIVE (matching `actual` entry supplied)
    // so the desired-side pass stays a genuine no-op rather than tripping the
    // new staged-but-not-live install gate — that combination is covered
    // separately below.
    const desired = [{ id: 're-adopted', kind: 'skill', origin: 'x', pin: 'v1', scope: 'project', required: 'soft' }];
    const lock = makeLock({
      'skill:re-adopted': makeLockEntry({ pin: 'v1', owners: [], required: 'soft' }),
    });
    const actual = { 'skill:re-adopted': { path: '/wherever/SKILL.md' } };

    const result = plan(desired, lock, actual);

    expect(result.remove).toEqual([]);
    expect(result.install).toEqual([]);
    expect(result.replace).toEqual([]);
  });
});

describe('AC3 — pin drift goes to replace; matching pins are a no-op (skill is LIVE in both cases)', () => {
  it('a_desired_pin_that_differs_from_the_lock_pin_is_replaced', () => {
    // TASK-121: `actual` now carries a matching live entry so this exercises
    // the genuinely-live replace path (a not-live skill with a pin mismatch
    // is covered separately below, and is an install, not a replace).
    const desired = [{ id: 'shadcn-vue', kind: 'skill', origin: 'x', pin: 'v2', scope: 'project', required: 'soft' }];
    const lock = makeLock({
      'skill:shadcn-vue': makeLockEntry({ pin: 'v1', owners: ['design-power@0.1.0'] }),
    });
    const actual = { 'skill:shadcn-vue': { path: '/wherever/SKILL.md' } };

    const result = plan(desired, lock, actual);

    expect(result.replace).toHaveLength(1);
    expect(result.replace[0]).toMatchObject({ id: 'skill:shadcn-vue', from: 'v1', to: 'v2' });
    expect(result.install).toEqual([]);
  });

  it('a_matching_pin_is_a_no_op', () => {
    // TASK-121: `actual` now carries a matching live entry — see the
    // AC2/TASK-121 regression describe block below for this same shape
    // asserted against the full plan() output.
    const desired = [{ id: 'shadcn-vue', kind: 'skill', origin: 'x', pin: 'v1', scope: 'project', required: 'soft' }];
    const lock = makeLock({
      'skill:shadcn-vue': makeLockEntry({ pin: 'v1', owners: ['design-power@0.1.0'] }),
    });
    const actual = { 'skill:shadcn-vue': { path: '/wherever/SKILL.md' } };

    const result = plan(desired, lock, actual);

    expect(result.install).toEqual([]);
    expect(result.replace).toEqual([]);
    expect(result.remove).toEqual([]);
    expect(result.report).toEqual([]);
  });
});

describe('AC1/TASK-121 — a skill staged in the lock but NOT live is proposed for install, never left a no-op', () => {
  it('a_desired_skill_with_a_matching_pin_lock_entry_but_absent_from_actual_is_installed', () => {
    // The exact TASK-120 review divergence: assimilate stages a lock entry
    // at approve time but never touches .claude/skills/. Before this fix,
    // `!lockEntry && !actualEntry` was false (lockEntry present) so this fell
    // through to the pin comparison and landed as a no-op — plan() would
    // never again propose materializing it.
    const desired = [{ id: 'staged-thing', kind: 'skill', origin: 'x', pin: 'v1', scope: 'project', required: 'soft' }];
    const lock = makeLock({
      'skill:staged-thing': makeLockEntry({ pin: 'v1', owners: ['design-power@0.1.0'] }),
    });

    const result = plan(desired, lock, {});

    expect(result.install).toEqual([{ id: 'skill:staged-thing', resource: desired[0] }]);
    expect(result.replace).toEqual([]);
    expect(result.remove).toEqual([]);
  });

  it('a_desired_skill_staged_in_the_lock_with_a_pin_mismatch_but_absent_from_actual_is_installed_not_replaced', () => {
    // Legitimate semantic shift (per the ticket): staged-but-not-live with a
    // pin mismatch used to be a `replace`; it is now an `install` — you
    // cannot replace a skill that was never materialized on disk.
    const desired = [{ id: 'staged-thing', kind: 'skill', origin: 'x', pin: 'v2', scope: 'project', required: 'soft' }];
    const lock = makeLock({
      'skill:staged-thing': makeLockEntry({ pin: 'v1', owners: ['design-power@0.1.0'] }),
    });

    const result = plan(desired, lock, {});

    expect(result.install).toEqual([{ id: 'skill:staged-thing', resource: desired[0] }]);
    expect(result.replace).toEqual([]);
  });
});

describe('AC2/TASK-121 — a skill present in BOTH lock and actual with a matching pin remains a steady-state no-op', () => {
  it('a_lock_entry_and_a_live_actual_entry_with_the_same_pin_produce_no_ops_at_all', () => {
    // Regression lock: the not-live install gate must never fire once a
    // skill IS live — no false-positive re-install of an already-materialized,
    // steady-state skill.
    const desired = [{ id: 'shadcn-vue', kind: 'skill', origin: 'x', pin: 'v1', scope: 'project', required: 'soft' }];
    const lock = makeLock({
      'skill:shadcn-vue': makeLockEntry({ pin: 'v1', owners: ['design-power@0.1.0'] }),
    });
    const actual = { 'skill:shadcn-vue': { path: '/wherever/SKILL.md' } };

    const result = plan(desired, lock, actual);

    expect(result).toEqual({ install: [], remove: [], replace: [], report: [] });
  });
});

describe('AC4 — a hard-required resource that would fail is a blocking report entry', () => {
  it('a_hard_required_non_skill_resource_is_out_of_scope_and_blocking', () => {
    const desired = [{ id: 'firecrawl', kind: 'mcp', origin: 'vendor/firecrawl', pin: 'v1', scope: 'project', required: 'hard' }];

    const result = plan(desired, makeLock({}), {});

    expect(result.install).toEqual([]);
    expect(result.report).toHaveLength(1);
    expect(result.report[0]).toMatchObject({ id: 'mcp:firecrawl', blocking: true });
  });

  it('a_soft_required_non_skill_resource_is_out_of_scope_but_not_blocking', () => {
    const desired = [{ id: 'context7', kind: 'mcp', origin: 'vendor/context7', pin: 'v1', scope: 'project', required: 'soft' }];

    const result = plan(desired, makeLock({}), {});

    expect(result.install).toEqual([]);
    expect(result.report).toHaveLength(1);
    expect(result.report[0]).toMatchObject({ id: 'mcp:context7', blocking: false });
  });
});

describe('AC4 — plan() performs no filesystem or network I/O', () => {
  it('calling_plan_never_touches_the_mocked_fs_functions', async () => {
    const fs = await import('node:fs');

    const desired = [
      { id: 'shadcn-vue', kind: 'skill', origin: 'x', pin: 'v2', scope: 'project', required: 'soft' },
      { id: 'firecrawl', kind: 'mcp', origin: 'vendor/firecrawl', pin: 'v1', scope: 'project', required: 'hard' },
    ];
    const lock = makeLock({
      'skill:shadcn-vue': makeLockEntry({ pin: 'v1', owners: ['design-power@0.1.0'] }),
      'skill:old-thing': makeLockEntry({ owners: [], required: 'soft' }),
    });

    plan(desired, lock, { 'skill:shadcn-vue': { path: '/wherever/SKILL.md' } });

    expect(fs.existsSync).not.toHaveBeenCalled();
    expect(fs.readdirSync).not.toHaveBeenCalled();
    expect(fs.readFileSync).not.toHaveBeenCalled();
  });
});
