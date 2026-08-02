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
    // TASK-106 (R18) later added an eighth tool, kb_lookup, and TASK-168
    // (KB-GRAPH-1) a ninth, kb_graph_query — see tests/e2e/kb-lookup-seam.spec.js
    // and tests/e2e/kb-graph-query.spec.js — so this list is now nine, not
    // seven, but close_task's historical position (7th added) is what this
    // test name documents; kept for that narrative continuity.
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'append_comment',
        'close_task',
        'create_task',
        'get_task',
        'kb_graph_query',
        'kb_lookup',
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

  // ---------------------------------------------------------------------------
  // AC4 (TASK-099) — Gate 2: close_task also enforces the loop-mode
  // uat-delegation guard (not just Gate 1's auto_close_on_green_review).
  // close_task is the primary supported close path (SKILL.md's Ticket-update
  // protocol), so this proves the extended guard reaches it, not just
  // transition_status.
  // ---------------------------------------------------------------------------
  it('close_task_surfaces_the_uat_delegation_guard_when_only_delegated_verification_phrasing_is_recorded_and_delegation_is_not_granted', async () => {
    seedBundleMode(repoRoot, { mode: 'loop', loopAuth: { auto_close_on_green_review: true } });

    const created = parse(await client.callTool({
      name: 'create_task',
      arguments: {
        title: 'close_task uat delegation guard',
        description: 'blocked by Gate 2 (uat delegation)',
        acceptance_criteria: ['blocked without delegation or a human verdict marker'],
        priority: 'medium',
        verification_tier: 'uat-only',
      },
    }));
    const key = created.key;

    // Only delegated-verification phrasing is on record; delegation was not
    // granted (uat_delegated_to_orchestrator is absent from loopAuth above).
    await client.callTool({
      name: 'append_comment',
      arguments: {
        key,
        author: 'uat',
        body: "Step 1: expected X, observed X, verdict PASS — verified by Orchestrator at the human's request.\nOverall result: PASS.",
      },
    });

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
          comment: { author: 'orchestrator', body: 'Shipped.' },
        },
      });
      if (res && res.isError) surfaced = true;
    } catch {
      surfaced = true;
    }
    expect(surfaced, 'close_task must not close a uat-only task in loop mode on delegated-only phrasing without delegation granted').toBe(true);

    const task = parse(await client.callTool({ name: 'get_task', arguments: { key } }));
    expect(task.status).toBe('todo');
    expect(readFileSync(taskPath, 'utf8')).toBe(beforeTask);
    expect(readFileSync(indexPath, 'utf8')).toBe(beforeIndex);
  });

  // ---------------------------------------------------------------------------
  // TASK-163 — defense-in-depth follow-up from TASK-108: close_task's own
  // `comment` param reaches appendComment via closeTask WITHOUT passing
  // through loopModeUatCommentGuard. append_comment already refuses
  // author:'uat' in unauthorized loop mode (TASK-108,
  // tests/e2e/mcp-append-comment-uat-guard.spec.js) — close_task must enforce
  // the SAME rule on its own comment.author.
  //
  // TEST MODE — the close_task handler does NOT yet call
  // loopModeUatCommentGuard before closeTask(...). These specs MUST FAIL
  // against the current mcp-server.js: the "surfaces as isError" assertion
  // fails because the call currently succeeds (the uat comment is written and
  // the ticket closes) instead of erroring.
  //
  // tdd-tier fixtures are used throughout (not uat-only) so this guard is
  // isolated from the unrelated uat-only done-guard/Gate 2 checks exercised
  // above.
  // ---------------------------------------------------------------------------
  describe('TASK-163 — close_task comment write-channel: loop-mode uat-comment guard', () => {
    async function createTddTicket() {
      const created = parse(await client.callTool({
        name: 'create_task',
        arguments: {
          title: 'TASK-163 fixture ticket',
          description: 'exercised by the close_task uat-comment guard specs',
          acceptance_criteria: ['covered by TASK-163 specs'],
          priority: 'medium',
          verification_tier: 'tdd',
        },
      }));
      return created.key;
    }

    // AC1 — blocked at the same guard seam as append_comment, before the
    // comment is written to disk.
    it('blocks close_task comment.author:"uat" in loop mode when uat_delegated_to_orchestrator is not granted', async () => {
      seedBundleMode(repoRoot, { mode: 'loop', loopAuth: { auto_close_on_green_review: true } });
      const key = await createTddTicket();

      const taskPath = join(repoRoot, 'tasks', `${key}.json`);
      const indexPath = join(repoRoot, 'tasks', 'index.json');
      const beforeTask = readFileSync(taskPath, 'utf8');
      const beforeIndex = readFileSync(indexPath, 'utf8');

      let surfaced = false;
      try {
        const res = await client.callTool({
          name: 'close_task',
          arguments: { key, comment: { author: 'uat', body: 'All steps PASS.' } },
        });
        if (res && res.isError) surfaced = true;
      } catch {
        surfaced = true;
      }
      expect(surfaced, 'close_task must not accept an unauthorized author:"uat" closing comment in loop mode').toBe(true);

      const task = parse(await client.callTool({ name: 'get_task', arguments: { key } }));
      expect(task.status).toBe('todo');
      expect(task.comments.some((c) => c.author === 'uat')).toBe(false);
      expect(readFileSync(taskPath, 'utf8')).toBe(beforeTask);
      expect(readFileSync(indexPath, 'utf8')).toBe(beforeIndex);
    });

    // AC2 — the delegated loop close still records.
    it('allows close_task comment.author:"uat" in loop mode once uat_delegated_to_orchestrator is granted', async () => {
      seedBundleMode(repoRoot, {
        mode: 'loop',
        loopAuth: { auto_close_on_green_review: true, uat_delegated_to_orchestrator: true },
      });
      const key = await createTddTicket();

      const res = await client.callTool({
        name: 'close_task',
        arguments: {
          key,
          comment: { author: 'uat', body: 'All steps PASS — verified by Orchestrator at the human\'s request.' },
        },
      });
      expect(res.isError).toBeFalsy();

      const task = parse(await client.callTool({ name: 'get_task', arguments: { key } }));
      expect(task.status).toBe('done');
      const last = task.comments[task.comments.length - 1];
      expect(last.author).toBe('uat');
    });

    // AC2 — harness mode is unaffected.
    it('allows close_task comment.author:"uat" in harness mode (no active session) — unaffected', async () => {
      const key = await createTddTicket();

      const res = await client.callTool({
        name: 'close_task',
        arguments: { key, comment: { author: 'uat', body: 'All steps PASS.' } },
      });
      expect(res.isError).toBeFalsy();

      const task = parse(await client.callTool({ name: 'get_task', arguments: { key } }));
      expect(task.status).toBe('done');
      const last = task.comments[task.comments.length - 1];
      expect(last.author).toBe('uat');
    });

    // AC2 — only author:'uat' is gated; the legitimate close flow (any other
    // author) is unaffected, even in unauthorized loop mode.
    it('allows close_task comment.author:"orchestrator" in unauthorized loop mode (only author:"uat" is gated)', async () => {
      seedBundleMode(repoRoot, { mode: 'loop', loopAuth: { auto_close_on_green_review: true } });
      const key = await createTddTicket();

      const res = await client.callTool({
        name: 'close_task',
        arguments: { key, comment: { author: 'orchestrator', body: 'Shipped.' } },
      });
      expect(res.isError).toBeFalsy();

      const task = parse(await client.callTool({ name: 'get_task', arguments: { key } }));
      expect(task.status).toBe('done');
      const last = task.comments[task.comments.length - 1];
      expect(last.author).toBe('orchestrator');
    });
  });
});

// ---------------------------------------------------------------------------
// TASK-171 (KB-GRAPH-4) — close_task auto-creates the task-<digits> node in
// knowledge/graph/graph.json as part of the same close operation, via
// src/graph-sync.js#recordNode (local projection ALWAYS + best-effort
// canonical kb_assert mirror).
//
// ORDERING (AC2): closeTask() itself stays all-or-nothing (unchanged
// task-store.js code path); the graph-node write happens AFTER a successful
// close and is best-effort — a failure there (thrown by an injected `brain`
// or `recordNode`) must NEVER roll back or fail the already-durable close.
// createServer({ repoRoot, brain, recordNode }) exposes both as injection
// points at the MCP layer, mirroring the closeGuard injection pattern already
// used for loopModeCloseGuard/loopModeUatCommentGuard.
//
// TEST MODE — these specs MUST FAIL against the current mcp-server.js:
//   - createServer does not yet accept `brain`/`recordNode` options.
//   - the close_task handler does not yet call recordNode at all, so no
//     task-<digits> node is ever created and the tool result carries no
//     `graph_node` field.
// ---------------------------------------------------------------------------
describe('TASK-171 (KB-GRAPH-4) — close_task auto-creates the task graph node', () => {
  let repoRoot;
  let client;
  let server;

  async function connect(opts = {}) {
    repoRoot = mkdtempSync(join(tmpdir(), 'mcp-close-task-graph-'));
    makeRepoSkeleton(repoRoot);
    server = createServer({ repoRoot, ...opts });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'task-171-test', version: '0.0.0' });
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
  }

  afterEach(async () => {
    if (client) await client.close();
    if (repoRoot) rmSync(repoRoot, { recursive: true, force: true });
  });

  function loadGraphJson() {
    const path = join(repoRoot, 'knowledge', 'graph', 'graph.json');
    if (!existsSync(path)) return { schema_version: 1, nodes: [], edges: [] };
    return JSON.parse(readFileSync(path, 'utf8'));
  }

  // -------------------------------------------------------------------------
  // AC1 — node created on close, brain-absent (default: zero infra).
  // -------------------------------------------------------------------------
  it('creates a task-<digits> node with id/ref/label derived from the closed ticket, brain absent', async () => {
    await connect();

    const created = parse(await client.callTool({
      name: 'create_task',
      arguments: {
        title: 'TASK-171 graph node fixture',
        description: 'closed via close_task',
        acceptance_criteria: ['gets a graph node on close'],
        priority: 'medium',
        verification_tier: 'tdd',
      },
    }));
    const key = created.key;

    const result = await client.callTool({
      name: 'close_task',
      arguments: { key, comment: { author: 'developer', body: 'Shipped.' } },
    });
    expect(result.isError).toBeFalsy();
    const parsed = parse(result);
    expect(parsed.ok).toBe(true);
    expect(parsed.graph_node).toBe('created');

    const graph = loadGraphJson();
    const nodeId = key.replace(/^TASK-/, 'task-').toLowerCase();
    const node = graph.nodes.find((n) => n.id === nodeId);
    expect(node).toBeTruthy();
    expect(node.ref).toBe(`tasks/${key}.json`);
    expect(node.label).toBe('TASK-171 graph node fixture');
    expect(node.type).toBe('task');
  });

  // -------------------------------------------------------------------------
  // AC2 — idempotent: re-closing does not duplicate or error.
  // -------------------------------------------------------------------------
  it('is idempotent on re-close: the second close_task call reports "exists" and does not duplicate the node', async () => {
    await connect();

    const created = parse(await client.callTool({
      name: 'create_task',
      arguments: {
        title: 'TASK-171 idempotent re-close',
        description: 'closed twice',
        acceptance_criteria: ['no duplicate node'],
        priority: 'medium',
        verification_tier: 'tdd',
      },
    }));
    const key = created.key;

    const first = parse(await client.callTool({
      name: 'close_task',
      arguments: { key, comment: { author: 'developer', body: 'Shipped.' } },
    }));
    expect(first.graph_node).toBe('created');

    const second = await client.callTool({
      name: 'close_task',
      arguments: { key, comment: { author: 'developer', body: 'Re-closed.' } },
    });
    expect(second.isError).toBeFalsy();
    expect(parse(second).graph_node).toBe('exists');

    const graph = loadGraphJson();
    const nodeId = key.replace(/^TASK-/, 'task-').toLowerCase();
    const matches = graph.nodes.filter((n) => n.id === nodeId);
    expect(matches).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // AC2 — a node already present (created out-of-band) before the close is
  // also idempotent: no duplicate, no error.
  // -------------------------------------------------------------------------
  it('is idempotent when the node already exists before close_task runs', async () => {
    await connect();
    const { addNode } = await import('../../src/knowledge-graph.js');

    const created = parse(await client.callTool({
      name: 'create_task',
      arguments: {
        title: 'TASK-171 pre-existing node',
        description: 'node already present',
        acceptance_criteria: ['no duplicate, no error'],
        priority: 'medium',
        verification_tier: 'tdd',
      },
    }));
    const key = created.key;
    const nodeId = key.replace(/^TASK-/, 'task-').toLowerCase();

    await addNode({
      repoRoot,
      node: {
        id: nodeId, type: 'task', ref: `tasks/${key}.json`, label: 'pre-existing label',
      },
    });

    const result = parse(await client.callTool({
      name: 'close_task',
      arguments: { key, comment: { author: 'developer', body: 'Shipped.' } },
    }));
    expect(result.ok).toBe(true);
    expect(result.graph_node).toBe('exists');

    const graph = loadGraphJson();
    const matches = graph.nodes.filter((n) => n.id === nodeId);
    expect(matches).toHaveLength(1);
    // the pre-existing node is left untouched, not overwritten.
    expect(matches[0].label).toBe('pre-existing label');
  });

  // -------------------------------------------------------------------------
  // AC2 — a throwing graph writer must not corrupt close_task's atomicity:
  // the ticket close (task file + index.json) still succeeds, and the
  // failure is reported via graph_node instead of thrown.
  // -------------------------------------------------------------------------
  it('close_task still succeeds atomically when the injected graph writer throws', async () => {
    const throwingRecordNode = async () => {
      const err = new Error('disk full');
      err.code = 'E_DISK_FULL';
      throw err;
    };
    await connect({ recordNode: throwingRecordNode });

    const created = parse(await client.callTool({
      name: 'create_task',
      arguments: {
        title: 'TASK-171 throwing graph writer',
        description: 'graph write fails, close must not',
        acceptance_criteria: ['close still succeeds'],
        priority: 'medium',
        verification_tier: 'tdd',
      },
    }));
    const key = created.key;

    const result = await client.callTool({
      name: 'close_task',
      arguments: { key, comment: { author: 'developer', body: 'Shipped.' } },
    });
    expect(result.isError).toBeFalsy();
    const parsed = parse(result);
    expect(parsed.ok).toBe(true);
    expect(parsed.graph_node).toBe('failed:E_DISK_FULL');

    const task = parse(await client.callTool({ name: 'get_task', arguments: { key } }));
    expect(task.status).toBe('done');
    const last = task.comments[task.comments.length - 1];
    expect(last.body).toBe('Shipped.');
  });

  // -------------------------------------------------------------------------
  // AC2 — brain present but throwing: the canonical kb_assert mirror is
  // best-effort and must never block or fail the close; the LOCAL node is
  // still created.
  // -------------------------------------------------------------------------
  it('close_task still succeeds and still creates the local node when an injected brain throws on assert', async () => {
    const throwingBrain = {
      assert: async () => {
        throw new Error('brain unreachable');
      },
    };
    await connect({ brain: throwingBrain });

    const created = parse(await client.callTool({
      name: 'create_task',
      arguments: {
        title: 'TASK-171 throwing brain',
        description: 'canonical mirror fails, local write must not',
        acceptance_criteria: ['close still succeeds', 'local node still created'],
        priority: 'medium',
        verification_tier: 'tdd',
      },
    }));
    const key = created.key;

    const result = await client.callTool({
      name: 'close_task',
      arguments: { key, comment: { author: 'developer', body: 'Shipped.' } },
    });
    expect(result.isError).toBeFalsy();
    const parsed = parse(result);
    expect(parsed.ok).toBe(true);
    expect(parsed.graph_node).toBe('created');

    const task = parse(await client.callTool({ name: 'get_task', arguments: { key } }));
    expect(task.status).toBe('done');

    const graph = loadGraphJson();
    const nodeId = key.replace(/^TASK-/, 'task-').toLowerCase();
    expect(graph.nodes.some((n) => n.id === nodeId)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // AC3 — existing guards are unaffected by the graph-write addition: the
  // uat-only done-guard still blocks close_task BEFORE any write (task file,
  // index.json, AND no graph node is created either).
  // -------------------------------------------------------------------------
  it('does not create a graph node when the uat-only done-guard blocks the close', async () => {
    await connect();

    const created = parse(await client.callTool({
      name: 'create_task',
      arguments: {
        title: 'TASK-171 uat guard blocks graph write too',
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
        name: 'close_task',
        arguments: { key, comment: { author: 'developer', body: 'Shipped.' } },
      });
      if (res && res.isError) surfaced = true;
    } catch {
      surfaced = true;
    }
    expect(surfaced).toBe(true);

    const graph = loadGraphJson();
    const nodeId = key.replace(/^TASK-/, 'task-').toLowerCase();
    expect(graph.nodes.some((n) => n.id === nodeId)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TASK-175 item 9 — recordTaskGraphNode's 'skipped' branch and its
// `task?.title ?? key` label fallback have no direct test. Both are
// effectively UNREACHABLE through the close_task tool: schema.json's key
// pattern (`^TASK-[0-9]{3,}$`) is a strict subset of taskKeyToNodeId's own
// `/^TASK-(\d+)$/`, so closeTask's validateTaskOrThrow rejects any task whose
// key would make taskKeyToNodeId return null before this function is ever
// invoked from the tool. recordTaskGraphNode was exported (TASK-175) solely
// for this direct, function-level lock.
// ---------------------------------------------------------------------------
describe('TASK-175 item 9 — recordTaskGraphNode direct unit coverage', () => {
  it('returns "skipped" for a key that does not match TASK-<digits>, without touching the graph', async () => {
    const { recordTaskGraphNode } = await import('../../src/mcp-server.js');
    const recordNode = async () => { throw new Error('must not be called'); };

    const status = await recordTaskGraphNode({
      repoRoot: '/does/not/matter', key: 'LEGACY-1', brain: null, recordNode,
    });

    expect(status).toBe('skipped');
  });

  it('falls back to the raw key as the node label when the task file cannot be read back', async () => {
    const { recordTaskGraphNode } = await import('../../src/mcp-server.js');
    const repoRoot = mkdtempSync(join(tmpdir(), 'mcp-record-graph-node-label-fallback-'));
    makeRepoSkeleton(repoRoot);
    let capturedNode;
    const recordNode = async ({ node }) => { capturedNode = node; };

    try {
      // A well-formed key with no tasks/TASK-777.json on disk — readTask()
      // inside recordTaskGraphNode returns null (ENOENT), so `task?.title`
      // is undefined and the `?? key` fallback fires.
      const status = await recordTaskGraphNode({
        repoRoot, key: 'TASK-777', brain: null, recordNode,
      });

      expect(status).toBe('created');
      expect(capturedNode).toMatchObject({ id: 'task-777', label: 'TASK-777' });
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
