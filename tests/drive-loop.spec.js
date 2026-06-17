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
