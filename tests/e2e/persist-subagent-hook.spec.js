// tests/e2e/persist-subagent-hook.spec.js
// TASK-219 — spawns hooks/persist-subagent.mjs as a real child process to
// pin AC5's exit-0 guarantee, which until now was only checked by the
// Reviewer running it by hand (review fix round, LOW-3 follow-up). Complements
// tests/subagent-log.spec.js, which covers the pure logic in-process only.

import { describe, it, expect, afterAll } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';

import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';

afterAll(cleanupAll);

const __thisDir = dirname(fileURLToPath(import.meta.url));
const HOOK_SCRIPT = join(__thisDir, '..', '..', 'hooks', 'persist-subagent.mjs');

function runHook(repoRoot, input) {
  return spawnSync('node', [HOOK_SCRIPT], {
    input,
    encoding: 'utf8',
    timeout: 10_000,
    env: { ...process.env, CLAUDE_PROJECT_DIR: repoRoot },
  });
}

describe('hooks/persist-subagent.mjs (AC5 — always exits 0)', () => {
  it('exits 0 and appends a record for a well-formed payload, with no active session', () => {
    const repoRoot = makeTmpDir('persist-subagent-hook');
    const payload = JSON.stringify({
      session_id: 'sess-1',
      agent_id: 'a1',
      agent_type: 'developer',
      last_assistant_message: 'ok',
      hook_event_name: 'SubagentStop',
    });

    const result = runHook(repoRoot, payload);
    expect(result.status).toBe(0);

    const logPath = join(repoRoot, 'state', 'subagent-log.jsonl');
    const contents = readFileSync(logPath, 'utf8').trim();
    const record = JSON.parse(contents);
    expect(record.agent_id).toBe('a1');
    expect(record.last_assistant_message).toBe('ok');
    expect(record.ticket).toBeNull();
  });

  it('exits 0 on empty stdin (no payload at all)', () => {
    const repoRoot = makeTmpDir('persist-subagent-hook');
    const result = runHook(repoRoot, '');
    expect(result.status).toBe(0);
  });

  it('exits 0 on malformed (non-JSON) stdin', () => {
    const repoRoot = makeTmpDir('persist-subagent-hook');
    const result = runHook(repoRoot, 'not json at all {{{');
    expect(result.status).toBe(0);
  });

  it('exits 0 and still attributes correctly when a real pointer + bundle resolve active_task', () => {
    const repoRoot = makeTmpDir('persist-subagent-hook');
    const bundleDir = join(repoRoot, 'state', 'sessions', 'sess-abc');
    mkdirSync(bundleDir, { recursive: true });
    writeFileSync(
      join(repoRoot, 'state', 'session.json'),
      JSON.stringify({ schema_version: 2, active_session_id: 'sess-abc', updated_at: '2026-01-01T00:00:00.000Z' }),
      'utf8',
    );
    writeFileSync(
      join(bundleDir, 'session.json'),
      JSON.stringify({ mode: 'harness', active_task: 'TASK-219' }),
      'utf8',
    );

    const result = runHook(repoRoot, JSON.stringify({ agent_id: 'a1', last_assistant_message: 'done' }));
    expect(result.status).toBe(0);

    const logPath = join(bundleDir, 'subagent-log.jsonl');
    const record = JSON.parse(readFileSync(logPath, 'utf8').trim());
    expect(record.ticket).toBe('TASK-219');
  });
});
