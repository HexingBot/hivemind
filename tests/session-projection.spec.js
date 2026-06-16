// tests/session-projection.spec.js
// TASK-055 — regression lock for projectSessionState (fast tier, tmp-repo fixture).
//
// Strategy: build a fat tmp repo with a pointer + a bundle that has huge fields.
// Assert the BOUNDED contract — the output is never a dump of the raw bundle.
//
// Locked ACs:
//   1. Pointer absent OR active_session_id null → idle projection.
//   2. Active bundle → idle:false, workflow_step/active_task surfaced.
//   3. next_action truncated to CAP_NEXT_ACTION (+1 for ellipsis) — fat input → bounded output.
//   4. recent_decisions.length ≤ CAP_DECISIONS.
//   5. open_questions.length ≤ CAP_LIST.
//   6. Corrupt/missing referenced bundle → does NOT throw; returns idle (optionally error field).

import { describe, it, expect, afterAll } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { makeTmpDir, cleanupAll } from './helpers/tmpRepo.js';
import {
  projectSessionState,
  CAP_NEXT_ACTION,
  CAP_DECISIONS,
  CAP_LIST,
} from '../src/session-projection.js';

afterAll(cleanupAll);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function writeJson(p, obj) {
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8');
}

function makeRepo({ pointer, bundleId, bundle } = {}) {
  const root = makeTmpDir('af-sp');
  mkdirSync(join(root, 'state'), { recursive: true });
  if (pointer !== undefined) {
    writeJson(join(root, 'state', 'session.json'), pointer);
  }
  if (bundleId && bundle) {
    const dir = join(root, 'state', 'sessions', bundleId);
    mkdirSync(dir, { recursive: true });
    writeJson(join(dir, 'session.json'), bundle);
  }
  return root;
}

// Build a fat bundle — next_action is 1000 chars, 10 decisions, 12 open_questions.
const FAT_NEXT_ACTION = 'X'.repeat(1000);
const FAT_DECISIONS = Array.from({ length: 10 }, (_, i) => ({
  at: '2026-06-15T12:00:00Z',
  decision: 'Decision ' + i + ': ' + 'D'.repeat(300),
}));
const FAT_OPEN_QUESTIONS = Array.from({ length: 12 }, (_, i) => 'Question ' + i + '? ' + 'Q'.repeat(210));
const FAT_BLOCKERS = Array.from({ length: 8 }, (_, i) => 'Blocker ' + i + ': ' + 'B'.repeat(220));

const SESSION_ID = '20260615T120000Z-deadbeef';

function makeFatBundle(overrides = {}) {
  return {
    schema_version: 2,
    session_id: SESSION_ID,
    lifecycle_state: 'active',
    updated_at: '2026-06-15T12:00:00Z',
    active_task: 'TASK-055',
    workflow_step: 'implement',
    next_action: FAT_NEXT_ACTION,
    handoff_summary: 'working on status bar',
    open_questions: FAT_OPEN_QUESTIONS,
    blockers: FAT_BLOCKERS,
    decisions: FAT_DECISIONS,
    subagent_results: [],
    pending_human_confirmation: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Lock 1 — No pointer file → idle:true, workflow_step:'idle'.
// ---------------------------------------------------------------------------
describe('TASK-055 — idle when pointer file absent', () => {
  it('returns_idle_when_no_pointer_file', () => {
    const root = makeTmpDir('af-sp-no-ptr');
    const result = projectSessionState({ repoRoot: root });
    expect(result.idle).toBe(true);
    expect(result.workflow_step).toBe('idle');
    expect(result.active_task).toBeNull();
    expect(result.open_questions).toEqual([]);
    expect(result.blockers).toEqual([]);
    expect(result.next_action).toBeNull();
    expect(result.recent_decisions).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Lock 2 — Pointer with active_session_id null → idle.
// ---------------------------------------------------------------------------
describe('TASK-055 — idle when active_session_id is null', () => {
  it('returns_idle_when_active_session_id_null', () => {
    const root = makeRepo({
      pointer: { schema_version: 2, active_session_id: null, updated_at: '2026-06-15T12:00:00Z' },
    });
    const result = projectSessionState({ repoRoot: root });
    expect(result.idle).toBe(true);
    expect(result.workflow_step).toBe('idle');
  });
});

// ---------------------------------------------------------------------------
// Lock 3 — Active bundle: idle:false, workflow_step and active_task surfaced.
// ---------------------------------------------------------------------------
describe('TASK-055 — active bundle surfaces workflow_step and active_task', () => {
  it('surfaces_workflow_step_and_active_task', () => {
    const root = makeRepo({
      pointer: { schema_version: 2, active_session_id: SESSION_ID, updated_at: '2026-06-15T12:00:00Z' },
      bundleId: SESSION_ID,
      bundle: makeFatBundle(),
    });
    const result = projectSessionState({ repoRoot: root });
    expect(result.idle).toBe(false);
    expect(result.workflow_step).toBe('implement');
    expect(result.active_task).toBe('TASK-055');
  });
});

// ---------------------------------------------------------------------------
// Lock 4 — next_action is TRUNCATED to CAP_NEXT_ACTION (+1 for ellipsis), not dumped.
// The fat bundle has next_action.length = 1000; output must be ≤ CAP_NEXT_ACTION + 1.
// ---------------------------------------------------------------------------
describe('TASK-055 — next_action bounded to CAP_NEXT_ACTION (never raw dump)', () => {
  it('next_action_truncated_to_cap', () => {
    const root = makeRepo({
      pointer: { schema_version: 2, active_session_id: SESSION_ID, updated_at: '2026-06-15T12:00:00Z' },
      bundleId: SESSION_ID,
      bundle: makeFatBundle(),
    });
    const result = projectSessionState({ repoRoot: root });
    // The fat next_action is 1000 chars; it MUST be shorter than that (truncated).
    expect(result.next_action.length).toBeLessThan(FAT_NEXT_ACTION.length);
    // Output must be exactly CAP_NEXT_ACTION chars + 1 ellipsis char.
    expect(result.next_action.length).toBe(CAP_NEXT_ACTION + 1);
    expect(result.next_action.endsWith('…')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Lock 5 — recent_decisions: at most CAP_DECISIONS entries.
// ---------------------------------------------------------------------------
describe('TASK-055 — recent_decisions capped at CAP_DECISIONS', () => {
  it('recent_decisions_length_at_most_cap', () => {
    const root = makeRepo({
      pointer: { schema_version: 2, active_session_id: SESSION_ID, updated_at: '2026-06-15T12:00:00Z' },
      bundleId: SESSION_ID,
      bundle: makeFatBundle(),
    });
    const result = projectSessionState({ repoRoot: root });
    // Fat bundle has 10 decisions; output must be ≤ CAP_DECISIONS.
    expect(result.recent_decisions.length).toBeLessThanOrEqual(CAP_DECISIONS);
    // At least 1 decision must appear (not empty) to prove non-vacuous.
    expect(result.recent_decisions.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Lock 6 — open_questions capped at CAP_LIST.
// ---------------------------------------------------------------------------
describe('TASK-055 — open_questions capped at CAP_LIST', () => {
  it('open_questions_length_at_most_cap', () => {
    const root = makeRepo({
      pointer: { schema_version: 2, active_session_id: SESSION_ID, updated_at: '2026-06-15T12:00:00Z' },
      bundleId: SESSION_ID,
      bundle: makeFatBundle(),
    });
    const result = projectSessionState({ repoRoot: root });
    // Fat bundle has 12 open_questions; output must be ≤ CAP_LIST.
    expect(result.open_questions.length).toBeLessThanOrEqual(CAP_LIST);
    // Must have non-zero items (fat input is non-empty, so output is non-empty).
    expect(result.open_questions.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Lock 7 — corrupt/missing referenced bundle → does NOT throw; returns idle.
// ---------------------------------------------------------------------------
describe('TASK-055 — corrupt/missing bundle → idle, no throw', () => {
  it('missing_bundle_returns_idle', () => {
    // Pointer names a non-existent bundle directory.
    const root = makeRepo({
      pointer: {
        schema_version: 2,
        active_session_id: 'nonexistent-session-id',
        updated_at: '2026-06-15T12:00:00Z',
      },
    });
    let result;
    expect(() => { result = projectSessionState({ repoRoot: root }); }).not.toThrow();
    expect(result.idle).toBe(true);
    expect(result.workflow_step).toBe('idle');
  });

  it('corrupt_bundle_json_returns_idle', () => {
    const CORRUPT_ID = '20260615T120000Z-corrupt';
    const root = makeTmpDir('af-sp-corrupt');
    // Write a valid pointer.
    mkdirSync(join(root, 'state'), { recursive: true });
    writeFileSync(
      join(root, 'state', 'session.json'),
      JSON.stringify({ schema_version: 2, active_session_id: CORRUPT_ID, updated_at: '2026-06-15T12:00:00Z' }),
      'utf8',
    );
    // Write corrupt JSON for the bundle.
    const bundleDir = join(root, 'state', 'sessions', CORRUPT_ID);
    mkdirSync(bundleDir, { recursive: true });
    writeFileSync(join(bundleDir, 'session.json'), '{ this is not valid JSON', 'utf8');

    let result;
    expect(() => { result = projectSessionState({ repoRoot: root }); }).not.toThrow();
    expect(result.idle).toBe(true);
    expect(result.workflow_step).toBe('idle');
  });
});
