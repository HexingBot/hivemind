// tests/subagent-log.spec.js
// TASK-219 — regression locks for src/subagent-log.js, the pure core behind
// the SubagentStop persistence hook (hooks/persist-subagent.mjs).
//
// Tier: tests-after (implement first, then plant these as minimal regression
// locks). Each spec below encodes a named AC or a real regression risk called
// out in the ticket brief — no decorative coverage.

import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildSubagentRecord, resolveActiveTicket, resolveLogPath } from '../src/subagent-log.js';

// ---------------------------------------------------------------------------
// buildSubagentRecord — must never lose the result, even on malformed input.
// ---------------------------------------------------------------------------

describe('buildSubagentRecord (AC2/AC7 — the record must never be lost)', () => {
  it('carries last_assistant_message through VERBATIM (the whole point of the ticket)', () => {
    const payload = {
      session_id: 'sess-1',
      agent_id: 'adev-1-abc',
      agent_type: 'developer',
      last_assistant_message: 'multi\nline\nresult with "quotes" and unicode: café',
      agent_transcript_path: 'C:\\some\\path\\agent-adev-1-abc.jsonl',
      cwd: 'D:\\hivemind',
      hook_event_name: 'SubagentStop',
    };
    const record = buildSubagentRecord(payload, { activeTicket: 'TASK-219' });
    expect(record.last_assistant_message).toBe(payload.last_assistant_message);
    expect(record.session_id).toBe('sess-1');
    expect(record.agent_id).toBe('adev-1-abc');
    expect(record.agent_type).toBe('developer');
    expect(record.ticket).toBe('TASK-219');
    expect(record.agent_transcript_path).toBe(payload.agent_transcript_path);
    expect(record.cwd).toBe(payload.cwd);
    expect(record.hook_event_name).toBe('SubagentStop');
    expect(typeof record.captured_at).toBe('string');
    expect(() => new Date(record.captured_at).toISOString()).not.toThrow();
  });

  it('tolerates a completely empty payload ({}) without throwing, filling absent fields with null', () => {
    expect(() => buildSubagentRecord({}, {})).not.toThrow();
    const record = buildSubagentRecord({}, {});
    expect(record.session_id).toBeNull();
    expect(record.agent_id).toBeNull();
    expect(record.agent_type).toBeNull();
    expect(record.last_assistant_message).toBeNull();
    expect(record.ticket).toBeNull();
  });

  it('tolerates null/undefined payload (simulating empty/invalid stdin) without throwing', () => {
    expect(() => buildSubagentRecord(null, {})).not.toThrow();
    expect(() => buildSubagentRecord(undefined, {})).not.toThrow();
    expect(buildSubagentRecord(null, {}).last_assistant_message).toBeNull();
  });

  it('tolerates wrong-typed fields (e.g. a payload that is an array, or fields that are numbers) without throwing', () => {
    expect(() => buildSubagentRecord([], {})).not.toThrow();
    expect(() => buildSubagentRecord('not an object', {})).not.toThrow();
    const record = buildSubagentRecord({ agent_id: 12345, last_assistant_message: { nope: true } }, {});
    // Non-string fields degrade to null rather than being coerced or thrown on.
    expect(record.agent_id).toBeNull();
    expect(record.last_assistant_message).toBeNull();
  });

  it('defaults ticket to null when no activeTicket is supplied (AC3 — unattributable is still recorded)', () => {
    const record = buildSubagentRecord({ agent_id: 'a1' }, {});
    expect(record.ticket).toBeNull();
  });

  it('normalizes an empty-string agent_type to null (real fixture: a SubagentStop with no matching SubagentStart)', () => {
    // Real payload captured live during TASK-219's own investigation:
    // agent_id present and non-empty, agent_type "" — a subagent that
    // emitted SubagentStop with zero prior SubagentStart events. Reading ""
    // back as a distinct, real agent_type would be wrong; it must read null.
    const payload = {
      session_id: 'e80d409a-62cb-481c-9d6b-d1b4a3fe41d5',
      agent_id: 'a946acc6df5a7dc3a',
      agent_type: '',
      hook_event_name: 'SubagentStop',
    };
    const record = buildSubagentRecord(payload, {});
    expect(record.agent_id).toBe('a946acc6df5a7dc3a');
    expect(record.agent_type).toBeNull();
  });

  it('normalizes a whitespace-only string field to null, for any string field, not just agent_type', () => {
    const record = buildSubagentRecord({ agent_type: '   ', last_assistant_message: '\t\n' }, {});
    expect(record.agent_type).toBeNull();
    expect(record.last_assistant_message).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resolveActiveTicket — must never throw; must degrade to null.
// ---------------------------------------------------------------------------

describe('resolveActiveTicket (AC3 — attribution never blocks persistence)', () => {
  let dir;

  function makeRepo() {
    dir = mkdtempSync(join(tmpdir(), 'subagent-log-'));
    return dir;
  }

  it('returns null when state/session.json does not exist', () => {
    const repoRoot = makeRepo();
    expect(resolveActiveTicket(repoRoot)).toBeNull();
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('returns null when state/session.json is corrupt JSON (never throws)', () => {
    const repoRoot = makeRepo();
    mkdirSync(join(repoRoot, 'state'), { recursive: true });
    writeFileSync(join(repoRoot, 'state', 'session.json'), '{ not valid json', 'utf8');
    expect(() => resolveActiveTicket(repoRoot)).not.toThrow();
    expect(resolveActiveTicket(repoRoot)).toBeNull();
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('returns null when the pointer has no active_session_id (idle orchestrator)', () => {
    const repoRoot = makeRepo();
    mkdirSync(join(repoRoot, 'state'), { recursive: true });
    writeFileSync(
      join(repoRoot, 'state', 'session.json'),
      JSON.stringify({ schema_version: 2, active_session_id: null, updated_at: '2026-01-01T00:00:00.000Z' }),
      'utf8',
    );
    expect(resolveActiveTicket(repoRoot)).toBeNull();
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('returns null when the bundle directory referenced by the pointer does not exist', () => {
    const repoRoot = makeRepo();
    mkdirSync(join(repoRoot, 'state'), { recursive: true });
    writeFileSync(
      join(repoRoot, 'state', 'session.json'),
      JSON.stringify({ schema_version: 2, active_session_id: 'missing-bundle', updated_at: '2026-01-01T00:00:00.000Z' }),
      'utf8',
    );
    expect(resolveActiveTicket(repoRoot)).toBeNull();
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('returns active_task when the pointer + bundle resolve correctly (harness mode, the default)', () => {
    const repoRoot = makeRepo();
    const bundleDir = join(repoRoot, 'state', 'sessions', 'sess-abc');
    mkdirSync(bundleDir, { recursive: true });
    writeFileSync(
      join(repoRoot, 'state', 'session.json'),
      JSON.stringify({ schema_version: 2, active_session_id: 'sess-abc', updated_at: '2026-01-01T00:00:00.000Z' }),
      'utf8',
    );
    writeFileSync(
      join(bundleDir, 'session.json'),
      JSON.stringify({ active_task: 'TASK-219' }),
      'utf8',
    );
    expect(resolveActiveTicket(repoRoot)).toBe('TASK-219');
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('returns null when the bundle exists but has neither active_task nor a live loop_state.current_ticket', () => {
    const repoRoot = makeRepo();
    const bundleDir = join(repoRoot, 'state', 'sessions', 'sess-abc');
    mkdirSync(bundleDir, { recursive: true });
    writeFileSync(
      join(repoRoot, 'state', 'session.json'),
      JSON.stringify({ schema_version: 2, active_session_id: 'sess-abc', updated_at: '2026-01-01T00:00:00.000Z' }),
      'utf8',
    );
    writeFileSync(join(bundleDir, 'session.json'), JSON.stringify({ active_task: null }), 'utf8');
    expect(resolveActiveTicket(repoRoot)).toBeNull();
    rmSync(repoRoot, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Precedence fix round: active_task vs. loop_state.current_ticket.
  //
  // Bug this reproduces (found in live review, TASK-219 fix round): the
  // original implementation read loop_state.current_ticket unconditionally.
  // loop_state is only ever refreshed by the autonomous drive loop
  // (src/loop-checkpoint.js) — in harness mode (the default, and what was
  // actually running) nothing updates it, so on a real repo it sat frozen
  // on a ticket (TASK-197) that had since been closed, silently attributing
  // fresh subagent results to a stale, already-done ticket. That is worse
  // than ticket: null, which honestly says "unknown".
  // -------------------------------------------------------------------------

  it('active_task wins over loop_state.current_ticket when both are present and differ (reproduces the live defect)', () => {
    const repoRoot = makeRepo();
    const bundleDir = join(repoRoot, 'state', 'sessions', 'sess-abc');
    mkdirSync(bundleDir, { recursive: true });
    writeFileSync(
      join(repoRoot, 'state', 'session.json'),
      JSON.stringify({ schema_version: 2, active_session_id: 'sess-abc', updated_at: '2026-01-01T00:00:00.000Z' }),
      'utf8',
    );
    // Exact real-world fixture: active_task is the live ticket, loop_state
    // still carries a NINE-DAY-STALE, already-closed ticket from a past loop run.
    writeFileSync(
      join(bundleDir, 'session.json'),
      JSON.stringify({
        mode: 'harness',
        active_task: 'TASK-219',
        loop_state: { current_ticket: 'TASK-197', run_started_at: '2026-08-06T00:00:00.000Z' },
      }),
      'utf8',
    );
    expect(resolveActiveTicket(repoRoot)).toBe('TASK-219');
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('in harness mode, with active_task null, returns null even when loop_state.current_ticket is present (does NOT fall back to the stale value)', () => {
    const repoRoot = makeRepo();
    const bundleDir = join(repoRoot, 'state', 'sessions', 'sess-abc');
    mkdirSync(bundleDir, { recursive: true });
    writeFileSync(
      join(repoRoot, 'state', 'session.json'),
      JSON.stringify({ schema_version: 2, active_session_id: 'sess-abc', updated_at: '2026-01-01T00:00:00.000Z' }),
      'utf8',
    );
    writeFileSync(
      join(bundleDir, 'session.json'),
      JSON.stringify({ mode: 'harness', active_task: null, loop_state: { current_ticket: 'TASK-197' } }),
      'utf8',
    );
    expect(resolveActiveTicket(repoRoot)).toBeNull();
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('in loop mode, with active_task null, falls back to loop_state.current_ticket (the field is live in this mode)', () => {
    const repoRoot = makeRepo();
    const bundleDir = join(repoRoot, 'state', 'sessions', 'sess-abc');
    mkdirSync(bundleDir, { recursive: true });
    writeFileSync(
      join(repoRoot, 'state', 'session.json'),
      JSON.stringify({ schema_version: 2, active_session_id: 'sess-abc', updated_at: '2026-01-01T00:00:00.000Z' }),
      'utf8',
    );
    writeFileSync(
      join(bundleDir, 'session.json'),
      JSON.stringify({ mode: 'loop', active_task: null, loop_state: { current_ticket: 'TASK-219' } }),
      'utf8',
    );
    expect(resolveActiveTicket(repoRoot)).toBe('TASK-219');
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('treats a whitespace-only active_task as absent, not as a real ticket key (LOW-2, review fix round)', () => {
    // resolveActiveTicket tolerates schema-invalid bundle state on purpose
    // (that IS its job); its non-empty-string criterion must match
    // buildSubagentRecord's str() exactly, or a whitespace-only active_task
    // (schema-invalid, but still something this function must not choke on)
    // would be recorded verbatim as if it were a real ticket key.
    const repoRoot = makeRepo();
    const bundleDir = join(repoRoot, 'state', 'sessions', 'sess-abc');
    mkdirSync(bundleDir, { recursive: true });
    writeFileSync(
      join(repoRoot, 'state', 'session.json'),
      JSON.stringify({ schema_version: 2, active_session_id: 'sess-abc', updated_at: '2026-01-01T00:00:00.000Z' }),
      'utf8',
    );
    writeFileSync(
      join(bundleDir, 'session.json'),
      JSON.stringify({ mode: 'harness', active_task: '   ' }),
      'utf8',
    );
    expect(resolveActiveTicket(repoRoot)).toBeNull();
    rmSync(repoRoot, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// resolveLogPath — prefers the active bundle dir, falls back to state/ root.
// ---------------------------------------------------------------------------

describe('resolveLogPath', () => {
  it('resolves alongside the active session bundle when the pointer resolves', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'subagent-log-'));
    mkdirSync(join(repoRoot, 'state'), { recursive: true });
    writeFileSync(
      join(repoRoot, 'state', 'session.json'),
      JSON.stringify({ schema_version: 2, active_session_id: 'sess-abc', updated_at: '2026-01-01T00:00:00.000Z' }),
      'utf8',
    );
    const logPath = resolveLogPath(repoRoot);
    expect(logPath).toBe(join(repoRoot, 'state', 'sessions', 'sess-abc', 'subagent-log.jsonl'));
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('falls back to state/subagent-log.jsonl when there is no pointer file', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'subagent-log-'));
    const logPath = resolveLogPath(repoRoot);
    expect(logPath).toBe(join(repoRoot, 'state', 'subagent-log.jsonl'));
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('falls back to state/subagent-log.jsonl when the pointer is corrupt (never throws)', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'subagent-log-'));
    mkdirSync(join(repoRoot, 'state'), { recursive: true });
    writeFileSync(join(repoRoot, 'state', 'session.json'), 'not json', 'utf8');
    expect(() => resolveLogPath(repoRoot)).not.toThrow();
    expect(resolveLogPath(repoRoot)).toBe(join(repoRoot, 'state', 'subagent-log.jsonl'));
    rmSync(repoRoot, { recursive: true, force: true });
  });
});
