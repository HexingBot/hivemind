// tests/e2e/mcp-append-comment-uat-guard.spec.js
// TASK-108 — narrow the write-side uat-comment fabrication channel (Gate 2
// residual, minted from the TASK-099 review MEDIUM-2). append_comment
// (src/mcp-server.js) previously accepted author:'uat' from ANY caller
// regardless of operating mode, letting a loop-mode orchestrator fabricate a
// convention-format all-PASS uat comment and pass Gate 2 with no human
// involvement.
//
// TEST MODE — mcp-server.js's append_comment handler does NOT yet call
// loopModeUatCommentGuard before appendComment(...). These specs MUST FAIL
// against the current implementation:
//   - (a) throws/isError expected, but the call currently succeeds (comment
//     is written) -> assertion failure on missing behavior, not import error.
//
// SEAM CONTRACT encoded here:
//   - mcp-server.js imports `loopModeUatCommentGuard` from src/close-guard.js
//     and calls `await loopModeUatCommentGuard({ repoRoot, author })` INSIDE
//     the append_comment handler, BEFORE `appendComment(...)`. A thrown
//     UatCommentGuardError surfaces the same way every other guard throw
//     does in this file: the SDK converts it to `{ isError: true }` (or an
//     awaited rejection, depending on transport) — no manual try/catch
//     needed in the handler itself.
//   - Only author === 'uat' is gated; every other author (orchestrator,
//     developer, reviewer, tester, ...) is unaffected in loop mode.
//   - Harness mode (the default — no active session, or an active session
//     with mode !== 'loop') is completely unaffected: author:'uat' stays
//     freely writable there, preserving the normal UAT-recording flow.
//   - The granted-delegation path (loop mode +
//     loop_auth.uat_delegated_to_orchestrator === true) must still be able
//     to record its delegated uat comment.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync, rmSync, mkdirSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createServer } from '../../src/mcp-server.js';
import { makeRepoSkeleton } from '../helpers/fixtures.js';

function parse(result) {
  return JSON.parse(result.content[0].text);
}

/** Seed an active bundle with the given mode/loop_auth inside an existing repoRoot. */
function seedBundleMode(repoRoot, { mode, loopAuth, sessionId = '20260714T173300Z-b108c0de' } = {}) {
  writeFileSync(
    join(repoRoot, 'state', 'session.json'),
    JSON.stringify({
      schema_version: 2,
      active_session_id: sessionId,
      updated_at: '2026-07-14T17:33:00Z',
    }, null, 2),
    'utf8',
  );
  const bundleDir = join(repoRoot, 'state', 'sessions', sessionId);
  mkdirSync(bundleDir, { recursive: true });
  writeFileSync(
    join(bundleDir, 'session.json'),
    JSON.stringify({
      schema_version: 2,
      session_id: sessionId,
      lifecycle_state: 'active',
      updated_at: '2026-07-14T17:33:00Z',
      active_task: 'TASK-108',
      workflow_step: 'impl',
      next_action: 'mcp append_comment uat guard specs',
      handoff_summary: 'in progress',
      open_questions: [],
      blockers: [],
      decisions: [],
      subagent_results: [],
      pending_human_confirmation: null,
      ...(mode !== undefined ? { mode } : {}),
      ...(loopAuth !== undefined ? { loop_auth: loopAuth } : {}),
    }, null, 2),
    'utf8',
  );
}

describe('TASK-108 — MCP append_comment: loop-mode uat-comment fabrication guard', () => {
  let repoRoot;
  let client;
  let server;

  beforeEach(async () => {
    repoRoot = mkdtempSync(join(tmpdir(), 'mcp-append-uat-guard-'));
    makeRepoSkeleton(repoRoot);

    server = createServer({ repoRoot });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'task-108-test', version: '0.0.0' });
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
  });

  afterEach(async () => {
    if (client) await client.close();
    if (repoRoot) rmSync(repoRoot, { recursive: true, force: true });
  });

  async function createTicket() {
    const created = parse(await client.callTool({
      name: 'create_task',
      arguments: {
        title: 'TASK-108 fixture ticket',
        description: 'exercised by the append_comment uat guard specs',
        acceptance_criteria: ['covered by TASK-108 specs'],
        priority: 'medium',
        verification_tier: 'uat-only',
      },
    }));
    return created.key;
  }

  // (a) loop mode + no delegation + author:'uat' -> blocked, no comment written.
  it('blocks author:"uat" in loop mode when uat_delegated_to_orchestrator is not granted', async () => {
    seedBundleMode(repoRoot, { mode: 'loop', loopAuth: { auto_close_on_green_review: true } });
    const key = await createTicket();

    let surfaced = false;
    try {
      const res = await client.callTool({
        name: 'append_comment',
        arguments: { key, author: 'uat', body: 'All steps PASS.' },
      });
      if (res && res.isError) surfaced = true;
    } catch {
      surfaced = true;
    }
    expect(surfaced, 'author:"uat" must not be writable in unauthorized loop mode').toBe(true);

    const task = parse(await client.callTool({ name: 'get_task', arguments: { key } }));
    expect(task.comments.some((c) => c.author === 'uat')).toBe(false);
  });

  // (b) loop mode + uat_delegated_to_orchestrator:true + author:'uat' -> allowed.
  it('allows author:"uat" in loop mode once uat_delegated_to_orchestrator is granted', async () => {
    seedBundleMode(repoRoot, {
      mode: 'loop',
      loopAuth: { auto_close_on_green_review: true, uat_delegated_to_orchestrator: true },
    });
    const key = await createTicket();

    const res = await client.callTool({
      name: 'append_comment',
      arguments: { key, author: 'uat', body: 'All steps PASS — verified by Orchestrator at the human\'s request.' },
    });
    expect(res.isError).toBeFalsy();

    const task = parse(await client.callTool({ name: 'get_task', arguments: { key } }));
    const last = task.comments[task.comments.length - 1];
    expect(last.author).toBe('uat');
  });

  // (c) harness mode + author:'uat' -> allowed (unaffected — the normal UAT-recording flow).
  it('allows author:"uat" in harness mode (no active session) — the normal UAT-recording flow is unaffected', async () => {
    const key = await createTicket();

    const res = await client.callTool({
      name: 'append_comment',
      arguments: { key, author: 'uat', body: 'All steps PASS.' },
    });
    expect(res.isError).toBeFalsy();

    const task = parse(await client.callTool({ name: 'get_task', arguments: { key } }));
    const last = task.comments[task.comments.length - 1];
    expect(last.author).toBe('uat');
    expect(last.body).toBe('All steps PASS.');
  });

  it('allows author:"uat" in harness mode explicitly (active session, mode: "harness")', async () => {
    seedBundleMode(repoRoot, { mode: 'harness' });
    const key = await createTicket();

    const res = await client.callTool({
      name: 'append_comment',
      arguments: { key, author: 'uat', body: 'All steps PASS.' },
    });
    expect(res.isError).toBeFalsy();

    const task = parse(await client.callTool({ name: 'get_task', arguments: { key } }));
    const last = task.comments[task.comments.length - 1];
    expect(last.author).toBe('uat');
  });

  // (d) loop mode + author:'orchestrator' (no delegation) -> allowed. Only
  // author === 'uat' is gated.
  it('allows author:"orchestrator" in unauthorized loop mode (only author:"uat" is gated)', async () => {
    seedBundleMode(repoRoot, { mode: 'loop', loopAuth: {} });
    const key = await createTicket();

    const res = await client.callTool({
      name: 'append_comment',
      arguments: { key, author: 'orchestrator', body: 'Working on it.' },
    });
    expect(res.isError).toBeFalsy();

    const task = parse(await client.callTool({ name: 'get_task', arguments: { key } }));
    const last = task.comments[task.comments.length - 1];
    expect(last.author).toBe('orchestrator');
  });

  it('allows author:"developer" and author:"reviewer" in unauthorized loop mode', async () => {
    seedBundleMode(repoRoot, { mode: 'loop', loopAuth: {} });
    const key = await createTicket();

    const devRes = await client.callTool({
      name: 'append_comment',
      arguments: { key, author: 'developer', body: 'Implemented.' },
    });
    expect(devRes.isError).toBeFalsy();

    const revRes = await client.callTool({
      name: 'append_comment',
      arguments: { key, author: 'reviewer', body: 'LGTM.' },
    });
    expect(revRes.isError).toBeFalsy();

    const task = parse(await client.callTool({ name: 'get_task', arguments: { key } }));
    const authors = task.comments.map((c) => c.author);
    expect(authors).toContain('developer');
    expect(authors).toContain('reviewer');
  });
});
