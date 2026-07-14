// tests/drive-loop.spec.js
// TASK-062 — Regression locks for src/drive-loop.js pure helpers.
// Pure-logic tier (top-level tests/, NOT e2e) — no disk I/O, no process spawns.
//
// One assertion per real behavior per the new-test budget.
// Coverage: matchesGoal (label + keys), selectNextTicket (priority order,
// dependency readiness, null when none), goalProgress, goalSatisfied,
// goalStuck, shouldStop (each stop reason).

import { describe, it, expect } from 'vitest';
import {
  matchesGoal,
  selectNextTicket,
  goalProgress,
  goalSatisfied,
  goalStuck,
  shouldStop,
} from '../src/drive-loop.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function task(overrides) {
  return {
    key: 'TASK-001',
    status: 'todo',
    priority: 'medium',
    labels: [],
    depends_on: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// matchesGoal
// ---------------------------------------------------------------------------

describe('matchesGoal — label goal', () => {
  it('returns true when task carries the goal label', () => {
    const t = task({ labels: ['beta', 'loop'] });
    expect(matchesGoal(t, { label: 'loop' })).toBe(true);
  });

  it('returns false when task does not carry the goal label', () => {
    const t = task({ labels: ['beta'] });
    expect(matchesGoal(t, { label: 'loop' })).toBe(false);
  });
});

describe('matchesGoal — keys goal', () => {
  it('returns true when task key is in the keys array', () => {
    const t = task({ key: 'TASK-010' });
    expect(matchesGoal(t, { keys: ['TASK-010', 'TASK-011'] })).toBe(true);
  });

  it('returns false when task key is not in the keys array', () => {
    const t = task({ key: 'TASK-099' });
    expect(matchesGoal(t, { keys: ['TASK-010', 'TASK-011'] })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// selectNextTicket
// ---------------------------------------------------------------------------

describe('selectNextTicket — priority order', () => {
  const goal = { label: 'epic' };

  it('picks critical over high', () => {
    const tasks = [
      task({ key: 'TASK-001', priority: 'high', labels: ['epic'] }),
      task({ key: 'TASK-002', priority: 'critical', labels: ['epic'] }),
    ];
    expect(selectNextTicket(tasks, goal).key).toBe('TASK-002');
  });

  it('picks high over medium', () => {
    const tasks = [
      task({ key: 'TASK-001', priority: 'medium', labels: ['epic'] }),
      task({ key: 'TASK-002', priority: 'high', labels: ['epic'] }),
    ];
    expect(selectNextTicket(tasks, goal).key).toBe('TASK-002');
  });

  it('breaks ties by ascending key', () => {
    const tasks = [
      task({ key: 'TASK-003', priority: 'medium', labels: ['epic'] }),
      task({ key: 'TASK-001', priority: 'medium', labels: ['epic'] }),
      task({ key: 'TASK-002', priority: 'medium', labels: ['epic'] }),
    ];
    expect(selectNextTicket(tasks, goal).key).toBe('TASK-001');
  });
});

describe('selectNextTicket — dependency readiness', () => {
  const goal = { label: 'epic' };

  it('selects a task whose dep is done', () => {
    const tasks = [
      task({ key: 'TASK-001', labels: ['epic'], depends_on: ['TASK-000'] }),
      task({ key: 'TASK-000', status: 'done', labels: [] }),
    ];
    expect(selectNextTicket(tasks, goal).key).toBe('TASK-001');
  });

  it('skips a task whose dep is not done', () => {
    const tasks = [
      task({ key: 'TASK-001', labels: ['epic'], depends_on: ['TASK-000'] }),
      task({ key: 'TASK-000', status: 'in_progress', labels: [] }),
    ];
    expect(selectNextTicket(tasks, goal)).toBeNull();
  });

  it('returns null when empty list', () => {
    expect(selectNextTicket([], goal)).toBeNull();
  });

  it('returns null when no task matches goal', () => {
    const tasks = [task({ key: 'TASK-001', labels: ['other'] })];
    expect(selectNextTicket(tasks, goal)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// selectNextTicket composed with listReady's filter (TASK-096, R1 HIGH)
//
// src/task-store.js's listReady() filters its OWN output to status==='todo'
// only, using a full internal task list to resolve deps before filtering —
// so its returned array never contains the 'done' dependency itself. Piping
// that filtered array into selectNextTicket (which re-derives readiness from
// whatever array it is given) strands any ticket whose done dep got filtered
// out: depsAreDone can't find the dep key in the passed array and treats it
// as unsatisfied. This composes the two functions the way commands/loop.md
// used to instruct, to prove the full-list contract is the actual fix.
// ---------------------------------------------------------------------------

describe('selectNextTicket — composed with listReady (TASK-096, R1)', () => {
  const goal = { label: 'epic' };

  // Mirrors src/task-store.js listReady()'s filter: keep only status==='todo'
  // tasks whose deps resolve to done against the FULL input — but the
  // returned array itself carries only the surviving todo tasks, so any
  // 'done' task (including a dependency) is absent from the output.
  function simulateListReady(tasks) {
    const byKey = new Map(tasks.map((t) => [t.key, t]));
    return tasks.filter((t) => {
      if (t.status !== 'todo') return false;
      const deps = Array.isArray(t.depends_on) ? t.depends_on : [];
      return deps.every((depKey) => byKey.get(depKey)?.status === 'done');
    });
  }

  const tasks = [
    task({ key: 'TASK-001', labels: ['epic'], depends_on: ['TASK-000'] }),
    task({ key: 'TASK-000', status: 'done', labels: [] }),
  ];

  it('selects the ready ticket when passed the FULL task list', () => {
    expect(selectNextTicket(tasks, goal).key).toBe('TASK-001');
  });

  it('fails loudly (AC4) instead of silently stranding when passed listReady-filtered output', () => {
    const filtered = simulateListReady(tasks);
    // TASK-000 (done) never appears in listReady's own output, so
    // depsAreDone can't find it in the passed array. Per AC4, this must
    // throw a descriptive error rather than silently returning null (which
    // is what caused the R1 stranding: null ticket + goalStuck=false spun
    // the no-progress counter with no signal of what went wrong).
    expect(filtered.map((t) => t.key)).toEqual(['TASK-001']);
    expect(() => selectNextTicket(filtered, goal)).toThrow(/TASK-000/);
  });
});

// ---------------------------------------------------------------------------
// goalProgress
// ---------------------------------------------------------------------------

describe('goalProgress', () => {
  const goal = { label: 'epic' };

  it('counts done and total for matching tasks', () => {
    const tasks = [
      task({ key: 'TASK-001', labels: ['epic'], status: 'done' }),
      task({ key: 'TASK-002', labels: ['epic'], status: 'todo' }),
      task({ key: 'TASK-003', labels: ['other'], status: 'done' }),
    ];
    expect(goalProgress(tasks, goal)).toEqual({ done: 1, total: 2 });
  });

  it('returns zero totals when no tasks match', () => {
    const tasks = [task({ labels: ['other'] })];
    expect(goalProgress(tasks, goal)).toEqual({ done: 0, total: 0 });
  });
});

// ---------------------------------------------------------------------------
// goalSatisfied
// ---------------------------------------------------------------------------

describe('goalSatisfied', () => {
  const goal = { label: 'epic' };

  it('returns true when all matching tasks are done', () => {
    const tasks = [
      task({ key: 'TASK-001', labels: ['epic'], status: 'done' }),
      task({ key: 'TASK-002', labels: ['epic'], status: 'done' }),
    ];
    expect(goalSatisfied(tasks, goal)).toBe(true);
  });

  it('returns false when any matching task is not done', () => {
    const tasks = [
      task({ key: 'TASK-001', labels: ['epic'], status: 'done' }),
      task({ key: 'TASK-002', labels: ['epic'], status: 'todo' }),
    ];
    expect(goalSatisfied(tasks, goal)).toBe(false);
  });

  it('returns false when no tasks match (total === 0)', () => {
    expect(goalSatisfied([], goal)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// goalStuck
// ---------------------------------------------------------------------------

describe('goalStuck', () => {
  const goal = { label: 'epic' };

  it('returns false when goal is already satisfied', () => {
    const tasks = [task({ labels: ['epic'], status: 'done' })];
    expect(goalStuck(tasks, goal)).toBe(false);
  });

  it('returns true when not satisfied but no ticket is selectable (all blocked)', () => {
    const tasks = [task({ labels: ['epic'], status: 'blocked' })];
    expect(goalStuck(tasks, goal)).toBe(true);
  });

  it('returns false when a ready ticket is selectable', () => {
    const tasks = [task({ labels: ['epic'], status: 'todo' })];
    expect(goalStuck(tasks, goal)).toBe(false);
  });

  // TASK-107 (L2) — goalStuck calls selectNextTicket internally (via
  // goalSatisfied+selectNextTicket), so it propagates depsAreDone's throw
  // exactly like selectNextTicket does when called with a partial list. This
  // locks in the propagation behavior the new @throws JSDoc line documents.
  it('propagates depsAreDone throw when called standalone with a partial list', () => {
    const tasks = [
      task({ key: 'TASK-002', labels: ['epic'], status: 'todo', depends_on: ['TASK-001'] }),
      // TASK-001 (the dep) is deliberately absent from this partial list.
    ];
    expect(() => goalStuck(tasks, goal)).toThrow(/depends_on "TASK-001"/);
  });
});

// ---------------------------------------------------------------------------
// TASK-107 (L2) doc-lock — goalStuck's JSDoc must document the propagated
// throw (@throws), consistent with selectNextTicket's own @throws line. Grep
// the source directly rather than re-parsing comment text so this rots if the
// tag is ever deleted, mirroring the doc-lock convention in
// tests/agility-doc-locks.spec.js et al.
// ---------------------------------------------------------------------------
describe('goalStuck JSDoc — @throws doc-lock', () => {
  it('documents the propagated depsAreDone throw with an @throws tag', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { REPO_ROOT } = await import('./helpers/repoRoot.js');
    const src = readFileSync(join(REPO_ROOT, 'src', 'drive-loop.js'), 'utf8');

    // Isolate the JSDoc block immediately preceding `export function goalStuck`.
    const fnIdx = src.indexOf('export function goalStuck');
    expect(fnIdx, 'goalStuck export must exist').toBeGreaterThan(-1);
    const docStart = src.lastIndexOf('/**', fnIdx);
    const jsdoc = src.slice(docStart, fnIdx);

    expect(
      /@throws/.test(jsdoc),
      'goalStuck JSDoc must carry an @throws tag documenting the propagated '
      + 'depsAreDone throw, consistent with selectNextTicket\'s @throws line',
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// shouldStop
// ---------------------------------------------------------------------------

describe('shouldStop — iteration ceiling', () => {
  it('stops when iteration >= maxIterations', () => {
    const result = shouldStop({ iteration: 20, maxIterations: 20, consecutiveNoProgress: 0, maxNoProgress: 3 });
    expect(result.stop).toBe(true);
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it('does not stop when iteration < maxIterations', () => {
    const result = shouldStop({ iteration: 19, maxIterations: 20, consecutiveNoProgress: 0, maxNoProgress: 3 });
    expect(result.stop).toBe(false);
    expect(result.reason).toBe('');
  });
});

describe('shouldStop — no-progress ceiling', () => {
  it('stops when consecutiveNoProgress >= maxNoProgress', () => {
    const result = shouldStop({ iteration: 1, maxIterations: 20, consecutiveNoProgress: 3, maxNoProgress: 3 });
    expect(result.stop).toBe(true);
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it('does not stop when consecutiveNoProgress < maxNoProgress', () => {
    const result = shouldStop({ iteration: 1, maxIterations: 20, consecutiveNoProgress: 2, maxNoProgress: 3 });
    expect(result.stop).toBe(false);
  });
});
