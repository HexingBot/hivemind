// tests/e2e/audit-reviewer-verdict-cli.spec.js
// TASK-217 — e2e coverage for the real `bin/audit-reviewer-verdict.js` CLI:
// spawns the entry script as a child process (same convention as
// tests/e2e/uat-audit-cli.spec.js) against a tmp repo skeleton carrying a
// real `state/sessions/<id>/subagent-log.jsonl` fixture, so the argv/
// exit-code/read-only wiring itself is under test, not just the in-process
// pure `auditReviewerVerdictProvenance`.
//
// TIER: slow (real mkdtemp + process spawn) — belongs under tests/e2e/.
//
// AC coverage:
//   AC2 — the audit never mutates tasks/*.json (mtime + content hash
//         byte-identical before/after a real run) — one of the two concrete
//         demonstrations AC2 asks for (the other is reviewer.md's unchanged
//         `tools:` line, shown directly in the hand-off, not a test).
//   AC4 — the durable log record backs a real "corroborated" verdict without
//         any transcription step: the CLI reads the fixture log directly and
//         reports corroborated, never having been told what the "reviewer"
//         said by anything other than the log file itself.
//
// Regla 2 (harm named): without this spec, a CLI wiring bug (e.g. the wrong
// exit code, or a stray write call slipped into main()) would ship
// undetected — the pure-logic spec above never touches bin/ or a real
// subagent-log.jsonl fixture on disk, so it cannot catch either.
//
// RED-GREEN EVIDENCE (do not remove — non-vacuity proof):
//   RED: temporarily changed bin/audit-reviewer-verdict.js's exitCodeFor to
//        `return 0;` unconditionally and re-ran this file — the
//        "not-corroborated exits 2" test failed with `expected +0 to be 2`.
//        Restored the real ternary immediately after.
//   GREEN: re-ran with the real implementation restored — both tests in this
//        file passed.

import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { makeRepoSkeleton } from '../helpers/fixtures.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';
import { REPO_ROOT } from '../helpers/repoRoot.js';

afterAll(cleanupAll);

const CLI = join(REPO_ROOT, 'bin', 'audit-reviewer-verdict.js');

function runCli(args, { cwd }) {
  const cleanEnv = { ...process.env };
  delete cleanEnv.CLAUDE_PROJECT_DIR; // force cwd-based repoRoot resolution
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, env: cleanEnv, encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function reviewedTask(key, reviewerCommentBody) {
  return {
    key,
    title: 't',
    description: 'd',
    acceptance_criteria: ['a'],
    status: 'in_review',
    priority: 'medium',
    labels: [],
    assignee: null,
    depends_on: [],
    linked_commits: [],
    linked_prs: [],
    comments: [{ author: 'reviewer', at: '2026-09-10T00:00:00Z', body: reviewerCommentBody }],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    jira_key: null,
    verification_tier: 'tests-after',
  };
}

function writeSubagentLog(repoDir, sessionId, records) {
  const dir = join(repoDir, 'state', 'sessions', sessionId);
  mkdirSync(dir, { recursive: true });
  const body = records.map((r) => JSON.stringify(r)).join('\n') + '\n';
  writeFileSync(join(dir, 'subagent-log.jsonl'), body, 'utf8');
}

describe('not-corroborated ticket — real CLI run exits 2', () => {
  it('a reviewer comment with no backing log record for its ticket exits 2', () => {
    const repoDir = makeTmpDir('af-reviewer-verdict-notcorrob');
    makeRepoSkeleton(repoDir, {
      tasks: { 'TASK-900': reviewedTask('TASK-900', '## Verdict\nPASS') },
    });
    writeSubagentLog(repoDir, 'sess-1', [
      { agent_type: 'reviewer', ticket: 'TASK-901', last_assistant_message: '## Verdict\nPASS' },
    ]);

    const { status, stdout } = runCli(['--json'], { cwd: repoDir });
    expect(status).toBe(2);
    const payload = JSON.parse(stdout);
    expect(payload.not_corroborated.count).toBe(1);
    expect(payload.not_corroborated.tickets[0].key).toBe('TASK-900');
  });
});

describe('corroborated ticket via a real durable log record — AC4 and AC2 (read-only)', () => {
  it('a matching, agreeing log record corroborates without any tasks/ mutation', () => {
    const repoDir = makeTmpDir('af-reviewer-verdict-corrob');
    makeRepoSkeleton(repoDir, {
      tasks: { 'TASK-910': reviewedTask('TASK-910', '## Verdict\nPASS') },
    });
    writeSubagentLog(repoDir, 'sess-1', [
      { agent_type: 'reviewer', ticket: 'TASK-910', last_assistant_message: '## Verdict\nPASS' },
    ]);

    const taskFile = join(repoDir, 'tasks', 'TASK-910.json');
    const before = { mtimeMs: statSync(taskFile).mtimeMs, hash: hashFile(taskFile) };

    const { status, stdout } = runCli(['--json'], { cwd: repoDir });
    expect(status).toBe(0);
    const payload = JSON.parse(stdout);
    expect(payload.corroborated.count).toBe(1);
    expect(payload.not_corroborated.count).toBe(0);

    const after = { mtimeMs: statSync(taskFile).mtimeMs, hash: hashFile(taskFile) };
    expect(after).toEqual(before);
  });
});

function hashFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}
