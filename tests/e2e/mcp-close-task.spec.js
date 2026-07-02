// tests/e2e/mcp-close-task.spec.js
// TASK-082 — deep-review S1: MCP surface for the uat-only done-guard, the
// loop-mode close guard, and the new close_task tool.
//
// TEST MODE — these specs exercise src/mcp-server.js through the same
// InMemoryTransport pattern as tests/e2e/mcp-server.spec.js (TASK-026). They
// MUST FAIL against the current mcp-server.js:
//   - transition_status does not yet compose the uat-only guard or the
//     loop-mode closeGuard (task-store.js doesn't enforce either yet either)
//     -> the "surfaces as isError" assertions fail because the call succeeds
//     instead of erroring.
//   - close_task is not a registered tool yet -> registers_close_task_tool
//     fails (tool absent from listTools()), and calling it throws
//     "Tool close_task not found" (MCP's own not-found surface) — the
//     expected tests-first failure for a not-yet-registered tool on an
//     already-existing server module.
//
// SEAM CONTRACT encoded here:
//   - mcp-server.js imports `loopModeCloseGuard` from src/close-guard.js and
//     passes it as the `closeGuard` option to EVERY transitionStatus/closeTask
//     call it makes (transition_status tool AND the new close_task tool).
//     loopModeCloseGuard itself decides whether loop mode is even active, so
//     composing it unconditionally is safe in harness mode / no session.
//   - New tool `close_task`:
//       inputSchema: { key: z.string(), comment: z.object({ author:
//         z.string(), body: z.string() }), linked_commits:
//         z.array(z.string()).optional(), linked_prs:
//         z.array(z.string()).optional() }
//       handler: await closeTask({ repoRoot, key, comment, linked_commits,
//         linked_prs, closeGuard: loopModeCloseGuard }); return ok({ ok: true }).
//     Thrown errors (UatGuardError, LoopCloseGuardError, bad commit sha, or a
//     plain "unknown task key") surface the same way transition_status's
//     existing bad-status test proves: isError true OR a thrown rejection.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync,
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
function seedBundleMode(repoRoot, { mode, loopAuth, sessionId = '20260702T130000Z-a1b2c3d4' } = {}) {
  writeFileSync(
    join(repoRoot, 'state', 'session.json'),
    JSON.stringify({
      schema_version: 2,
      active_session_id: sessionId,
      updated_at: '2026-07-02T13:00:00Z',
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
      updated_at: '2026-07-02T13:00:00Z',
      active_task: 'TASK-082',
      workflow_step: 'impl',
      next_action: 'mcp close_task specs',
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

describe('TASK-082 — MCP: uat-only guard, loop-mode guard, close_task tool', () => {
  let repoRoot;
  let client;
  let server;

  beforeEach(async () => {
    repoRoot = mkdtempSync(join(tmpdir(), 'mcp-close-task-'));
    makeRepoSkeleton(repoRoot);

    server = createServer({ repoRoot });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'task-082-test', version: '0.0.0' });
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
  });

  afterEach(async () => {
    if (client) await client.close();
    if (repoRoot) rmSync(repoRoot, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // AC3 — the close_task tool is registered.
  // ---------------------------------------------------------------------------
  it('registers_close_task_as_a_seventh_tool', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'append_comment',
        'close_task',
        'create_task',
        'get_task',
        'list_ready',
        'list_todos',
        'transition_status',
      ].sort(),
    );
  });

  // ---------------------------------------------------------------------------
  // AC1 — uat-only done-guard, MCP surface.
  // ---------------------------------------------------------------------------
  it('transition_status_surfaces_the_uat_guard_as_an_error_for_a_uat_only_task_without_a_uat_comment', async () => {
    const created = parse(await client.callTool({
      name: 'create_task',
      arguments: {
        title: 'uat-only ticket',
        description: 'no uat comment yet',
        acceptance_criteria: ['blocked by the uat guard'],
        priority: 'medium',
        verification_tier: 'uat-only',
      },
    }));
    const key = created.key;

    let surfaced = false;
    try {
      const res = await client.callTool({
        name: 'transition_status',
        arguments: { key, status: 'done' },
      });
      if (res && res.isError) surfaced = true;
    } catch {
      surfaced = true;
    }
    expect(surfaced, 'a uat-only task without a uat comment must not close silently').toBe(true);

    const task = parse(await client.callTool({ name: 'get_task', arguments: { key } }));
    expect(task.status).toBe('todo');
  });

  it('transition_status_succeeds_for_a_uat_only_task_after_a_uat_comment_is_appended', async () => {
    const created = parse(await client.callTool({
      name: 'create_task',
      arguments: {
        title: 'uat-only ticket, satisfied',
        description: 'has a uat comment',
        acceptance_criteria: ['closes normally'],
        priority: 'medium',
        verification_tier: 'uat-only',
      },
    }));
    const key = created.key;

    await client.callTool({
      name: 'append_comment',
      arguments: { key, author: 'uat', body: 'All steps PASS.' },
    });

    const transitioned = await client.callTool({
      name: 'transition_status',
      arguments: { key, status: 'done' },
    });
    expect(transitioned.isError).toBeFalsy();

    const task = parse(await client.callTool({ name: 'get_task', arguments: { key } }));
    expect(task.status).toBe('done');
  });

  // ---------------------------------------------------------------------------
  // AC2 — loop-mode close guard, MCP surface.
  // ---------------------------------------------------------------------------
  it('transition_status_surfaces_the_loop_mode_guard_as_an_error_when_unauthorized', async () => {
    seedBundleMode(repoRoot, { mode: 'loop', loopAuth: {} });

    const created = parse(await client.callTool({
      name: 'create_task',
      arguments: {
        title: 'tdd ticket in unauthorized loop mode',
        description: 'blocked by the loop-mode close guard',
        acceptance_criteria: ['blocked'],
        priority: 'medium',
        verification_tier: 'tdd',
      },
    }));
    const key = created.key;

    let surfaced = false;
    try {
      const res = await client.callTool({
        name: 'transition_status',
        arguments: { key, status: 'done' },
      });
      if (res && res.isError) surfaced = true;
    } catch {
      surfaced = true;
    }
    expect(surfaced, 'closing to done in unauthorized loop mode must not succeed silently').toBe(true);

    const task = parse(await client.callTool({ name: 'get_task', arguments: { key } }));
    expect(task.status).toBe('todo');
  });

  it('transition_status_succeeds_in_loop_mode_once_auto_close_on_green_review_is_true', async () => {
    seedBundleMode(repoRoot, { mode: 'loop', loopAuth: { auto_close_on_green_review: true } });

    const created = parse(await client.callTool({
      name: 'create_task',
      arguments: {
        title: 'tdd ticket in authorized loop mode',
        description: 'allowed to close',
        acceptance_criteria: ['closes normally'],
        priority: 'medium',
        verification_tier: 'tdd',
      },
    }));
    const key = created.key;

    const transitioned = await client.callTool({
      name: 'transition_status',
      arguments: { key, status: 'done' },
    });
    expect(transitioned.isError).toBeFalsy();

    const task = parse(await client.callTool({ name: 'get_task', arguments: { key } }));
    expect(task.status).toBe('done');
  });

  // ---------------------------------------------------------------------------
  // AC3 — close_task: happy path and atomicity.
  // ---------------------------------------------------------------------------
  it('close_task_applies_transition_comment_commits_prs_and_index_regen_in_one_call', async () => {
    const created = parse(await client.callTool({
      name: 'create_task',
      arguments: {
        title: 'close_task happy path',
        description: 'exercised end-to-end',
        acceptance_criteria: ['closes via close_task'],
        priority: 'medium',
        verification_tier: 'tdd',
      },
    }));
    const key = created.key;

    const result = await client.callTool({
      name: 'close_task',
      arguments: {
        key,
        comment: { author: 'developer', body: 'Shipped.' },
        linked_commits: ['abc1234'],
        linked_prs: ['https://example.com/pr/9'],
      },
    });
    expect(result.isError).toBeFalsy();
    expect(parse(result).ok).toBe(true);

    const task = parse(await client.callTool({ name: 'get_task', arguments: { key } }));
    expect(task.status).toBe('done');
    expect(task.linked_commits).toContain('abc1234');
    expect(task.linked_prs).toContain('https://example.com/pr/9');
    const last = task.comments[task.comments.length - 1];
    expect(last.author).toBe('developer');
    expect(last.body).toBe('Shipped.');

    const idx = JSON.parse(readFileSync(join(repoRoot, 'tasks', 'index.json'), 'utf8'));
    const entry = idx.tasks.find((t) => t.key === key);
    expect(entry.status).toBe('done');
  });

  it('close_task_with_an_invalid_commit_sha_leaves_task_file_and_index_byte_unchanged', async () => {
    const created = parse(await client.callTool({
      name: 'create_task',
      arguments: {
        title: 'close_task bad sha',
        description: 'mid-validation failure',
        acceptance_criteria: ['no partial write'],
        priority: 'medium',
        verification_tier: 'tdd',
      },
    }));
    const key = created.key;

    const taskPath = join(repoRoot, 'tasks', `${key}.json`);
    const indexPath = join(repoRoot, 'tasks', 'index.json');
    expect(existsSync(taskPath)).toBe(true);
    const beforeTask = readFileSync(taskPath, 'utf8');
    const beforeIndex = readFileSync(indexPath, 'utf8');

    let surfaced = false;
    try {
      const res = await client.callTool({
        name: 'close_task',
        arguments: {
          key,
          comment: { author: 'developer', body: 'Shipped.' },
          linked_commits: ['not-a-real-sha!'],
        },
      });
      if (res && res.isError) surfaced = true;
    } catch {
      surfaced = true;
    }
    expect(surfaced, 'an invalid commit sha must be rejected, not silently written').toBe(true);

    expect(readFileSync(taskPath, 'utf8')).toBe(beforeTask);
    expect(readFileSync(indexPath, 'utf8')).toBe(beforeIndex);
  });

  it('close_task_uat_guard_firing_leaves_task_file_and_index_byte_unchanged', async () => {
    const created = parse(await client.callTool({
      name: 'create_task',
      arguments: {
        title: 'close_task uat guard',
        description: 'mid-validation failure via the uat guard',
        acceptance_criteria: ['no partial write'],
        priority: 'medium',
        verification_tier: 'uat-only',
      },
    }));
    const key = created.key;

    const taskPath = join(repoRoot, 'tasks', `${key}.json`);
    const indexPath = join(repoRoot, 'tasks', 'index.json');
    const beforeTask = readFileSync(taskPath, 'utf8');
    const beforeIndex = readFileSync(indexPath, 'utf8');

    let surfaced = false;
    try {
      const res = await client.callTool({
        name: 'close_task',
        arguments: {
          key,
          comment: { author: 'developer', body: 'Shipped.' },
        },
      });
      if (res && res.isError) surfaced = true;
    } catch {
      surfaced = true;
    }
    expect(surfaced, 'close_task must not close a uat-only task with no uat comment').toBe(true);

    expect(readFileSync(taskPath, 'utf8')).toBe(beforeTask);
    expect(readFileSync(indexPath, 'utf8')).toBe(beforeIndex);
  });

  // deep-review MEDIUM-2 — close_task IS the close path for unattended loop
  // runs, but until now no spec exercised it under loop mode: if the
  // close_task handler dropped `closeGuard: loopModeCloseGuard` (the only
  // thing wiring loop-mode policy into this tool), no test would fail.
  it('close_task_surfaces_the_loop_mode_guard_as_an_error_when_unauthorized', async () => {
    seedBundleMode(repoRoot, { mode: 'loop', loopAuth: {} });

    const created = parse(await client.callTool({
      name: 'create_task',
      arguments: {
        title: 'close_task in unauthorized loop mode',
        description: 'blocked by the loop-mode close guard',
        acceptance_criteria: ['blocked'],
        priority: 'medium',
        verification_tier: 'tdd',
      },
    }));
    const key = created.key;

    const taskPath = join(repoRoot, 'tasks', `${key}.json`);
    const indexPath = join(repoRoot, 'tasks', 'index.json');
    const beforeTask = readFileSync(taskPath, 'utf8');
    const beforeIndex = readFileSync(indexPath, 'utf8');

    let surfaced = false;
    try {
      const res = await client.callTool({
        name: 'close_task',
        arguments: {
          key,
          comment: { author: 'developer', body: 'Shipped.' },
        },
      });
      if (res && res.isError) surfaced = true;
    } catch {
      surfaced = true;
    }
    expect(surfaced, 'close_task in unauthorized loop mode must not succeed silently').toBe(true);

    const task = parse(await client.callTool({ name: 'get_task', arguments: { key } }));
    expect(task.status).toBe('todo');
    expect(readFileSync(taskPath, 'utf8')).toBe(beforeTask);
    expect(readFileSync(indexPath, 'utf8')).toBe(beforeIndex);
  });
});
