// tests/mcp-server.spec.js
// TASK-026 — Plugin chain P6: MCP task-store server (AC1 surface + AC3 round-trip).
//
// Authoritative design: tasks/TASK-020.research.md §E.1 (the six-tool
// tool→args→returns→wraps table) + §E.2 (WILL/WON'T scope boundary), and the
// `mcp-server` training skill (.claude/skills/mcp-server/SKILL.md +
// references/in-memory-test-harness.md + references/tool-contract.md).
//
// DESIGN UNDER TEST (per the skill's "factory, not a side-effecting module"):
//   src/mcp-server.js exports `createServer({ repoRoot })` → a configured
//   McpServer with all six tools registered, each closing over `repoRoot`. The
//   server only auto-connects a StdioServerTransport when run as the entrypoint,
//   so the test injects a per-test temp `repoRoot` instead of relying on the
//   CLAUDE_PROJECT_DIR env var. We link it to an SDK Client through
//   InMemoryTransport.createLinkedPair() and call tools in-process — deterministic,
//   no subprocess, no stdio.
//
// THE SIX TOOLS (§E.1, verified against src/task-store.js exports):
//   list_todos        {}                                  -> Task[]      wraps listTodos({repoRoot})
//   list_ready        {}                                  -> Task[]      wraps listReady({repoRoot})
//   get_task          { key }                             -> Task|null   reads tasks/<key>.json (NO task-store export)
//   create_task       { title, description,
//                       acceptance_criteria, priority,
//                       labels?, depends_on? }            -> { key, path } wraps createTask({repoRoot,...})
//   transition_status { key, status }                     -> { ok: true } wraps transitionStatus({repoRoot,key,status})
//   append_comment    { key, author, body }               -> { ok: true } wraps appendComment({repoRoot,key,author,body})
//
// TESTS-FIRST FAILURE SURFACE (documented, both legitimate "right reasons"):
//   1. src/mcp-server.js does not exist yet  -> import fails (module-not-found).
//   2. Even once the module is stubbed, it imports @modelcontextprotocol/sdk +
//      zod, which are NOT installed yet (no node_modules entry) -> import fails
//      (cannot resolve the SDK). The static `import { createServer }` below makes
//      the whole module fail to load before any `it()` runs, so EVERY test in
//      this file errors at collection time. That is the expected tests-first
//      state for the impl phase to clear by writing src/mcp-server.js + adding
//      the SDK/zod devDeps + bundling. Do NOT install deps in the test phase.
//
// Tool results come back as { content: [{ type:'text', text:'<JSON string>' }] },
// so every positive assertion JSON.parse()es the text content (see parse()).

import {
  describe, it, expect, beforeEach, afterEach,
} from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createServer } from '../../src/mcp-server.js';
import { makeRepoSkeleton } from '../helpers/fixtures.js';

// Tool results are { content: [{ type:'text', text:'<json>' }] }. Parse helper.
function parse(result) {
  return JSON.parse(result.content[0].text);
}

describe('TASK-026 — MCP task-store server (in-memory round-trip)', () => {
  let repoRoot;
  let client;
  let server;

  beforeEach(async () => {
    // A fresh temp framework-repo skeleton (state/ + tasks/) per test, so the
    // task store starts empty and create_task derives TASK-001 deterministically.
    repoRoot = mkdtempSync(join(tmpdir(), 'mcp-task-'));
    makeRepoSkeleton(repoRoot);

    server = createServer({ repoRoot });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'task-026-test', version: '0.0.0' });
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
  // AC1 — the surface is complete: exactly the named tools register.
  // TASK-082 added a seventh tool, close_task — see
  // tests/e2e/mcp-close-task.spec.js for its dedicated coverage.
  // ---------------------------------------------------------------------------
  it('createServer_returns_an_McpServer_instance', () => {
    expect(server).toBeInstanceOf(McpServer);
  });

  it('registers_exactly_the_nine_named_tools', async () => {
    // TASK-106 (R18) added an eighth tool, kb_lookup — see
    // tests/e2e/kb-lookup-seam.spec.js for its dedicated coverage.
    // TASK-168 (KB-GRAPH-1) added a ninth tool, kb_graph_query — see
    // tests/e2e/kb-graph-query.spec.js for its dedicated coverage.
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
  // AC3 — the core round-trip:
  //   create_task -> list_todos shows it -> transition_status to done ->
  //   get_task reflects the new status.
  // ---------------------------------------------------------------------------
  it('round_trips_create_then_list_todos_then_transition_then_get_task', async () => {
    // create_task -> { key, path }
    const created = parse(await client.callTool({
      name: 'create_task',
      arguments: {
        title: 'Round-trip task',
        description: 'made via the MCP create_task tool',
        acceptance_criteria: ['it round-trips through the MCP surface'],
        priority: 'medium',
      },
    }));
    expect(created.key, 'create_task must return the minted key').toMatch(/^TASK-\d{3,}$/);
    expect(typeof created.path).toBe('string');
    const key = created.key;
    // The wrapper bound repoRoot to the temp project, so the file lands there.
    expect(existsSync(join(repoRoot, 'tasks', `${key}.json`))).toBe(true);

    // list_todos shows the freshly-created (status: todo) ticket.
    const todos = parse(await client.callTool({ name: 'list_todos', arguments: {} }));
    expect(Array.isArray(todos)).toBe(true);
    expect(todos.map((t) => t.key)).toContain(key);

    // transition_status -> done returns { ok: true }.
    const transitioned = parse(await client.callTool({
      name: 'transition_status',
      arguments: { key, status: 'done' },
    }));
    expect(transitioned.ok).toBe(true);

    // get_task reflects the new status (read straight from tasks/<key>.json).
    const task = parse(await client.callTool({
      name: 'get_task',
      arguments: { key },
    }));
    expect(task).not.toBeNull();
    expect(task.key).toBe(key);
    expect(task.status).toBe('done');

    // And a done task no longer appears in list_todos.
    const todosAfter = parse(await client.callTool({ name: 'list_todos', arguments: {} }));
    expect(todosAfter.map((t) => t.key)).not.toContain(key);
  });

  // ---------------------------------------------------------------------------
  // AC1/AC3 — the remaining two tools (list_ready + append_comment) work.
  // ---------------------------------------------------------------------------
  it('list_ready_surfaces_a_todo_task_with_no_unmet_dependencies', async () => {
    const created = parse(await client.callTool({
      name: 'create_task',
      arguments: {
        title: 'Ready task',
        description: 'no deps, so trivially ready',
        acceptance_criteria: ['surfaces in list_ready'],
        priority: 'low',
      },
    }));
    const ready = parse(await client.callTool({ name: 'list_ready', arguments: {} }));
    expect(Array.isArray(ready)).toBe(true);
    expect(ready.map((t) => t.key)).toContain(created.key);
  });

  it('append_comment_appends_a_comment_and_returns_ok', async () => {
    const created = parse(await client.callTool({
      name: 'create_task',
      arguments: {
        title: 'Commentable task',
        description: 'will receive a comment',
        acceptance_criteria: ['append_comment works'],
        priority: 'medium',
      },
    }));
    const key = created.key;

    // TASK-188 AC4 — author is now constrained to a known enum
    // (COMMENT_AUTHORS); 'tester' was never a real role, just an arbitrary
    // round-trip probe value. 'developer' exercises the identical round-trip
    // without relying on an author string the system doesn't actually use.
    const appended = parse(await client.callTool({
      name: 'append_comment',
      arguments: { key, author: 'developer', body: 'a round-trip comment' },
    }));
    expect(appended.ok).toBe(true);

    const task = parse(await client.callTool({ name: 'get_task', arguments: { key } }));
    expect(Array.isArray(task.comments)).toBe(true);
    const last = task.comments[task.comments.length - 1];
    expect(last.author).toBe('developer');
    expect(last.body).toBe('a round-trip comment');
  });

  // ---------------------------------------------------------------------------
  // AC3 (negative path) — bad input surfaces an error (isError / throw) rather
  // than silently corrupting state. The SDK converts a thrown handler error into
  // a result with isError === true.
  // ---------------------------------------------------------------------------
  it('transition_status_with_an_invalid_status_surfaces_an_error', async () => {
    const created = parse(await client.callTool({
      name: 'create_task',
      arguments: {
        title: 'Bad transition target',
        description: 'will be asked to transition to a bogus status',
        acceptance_criteria: ['invalid status is rejected'],
        priority: 'high',
      },
    }));
    const key = created.key;

    // An invalid status enum value. Whether zod rejects it at the input boundary
    // or task-store throws "invalid status", the call must surface as an error,
    // not a silent success — assert via thrown rejection OR result.isError.
    let surfaced = false;
    try {
      const res = await client.callTool({
        name: 'transition_status',
        arguments: { key, status: 'not_a_real_status' },
      });
      if (res && res.isError) surfaced = true;
    } catch {
      surfaced = true;
    }
    expect(surfaced, 'an invalid status must surface as an error, not a silent ok').toBe(true);

    // State is uncorrupted: the task is still in its original todo status.
    const task = parse(await client.callTool({ name: 'get_task', arguments: { key } }));
    expect(task.status).toBe('todo');
  });

  it('get_task_for_a_nonexistent_key_returns_null_not_a_throw', async () => {
    // §E.1: get_task returns Task | null. A well-formed but absent key is a
    // legitimate null, NOT an error (only a MALFORMED key is rejected — next test).
    const res = await client.callTool({ name: 'get_task', arguments: { key: 'TASK-999' } });
    expect(res.isError).toBeFalsy();
    const value = parse(res);
    expect(value).toBeNull();
  });

  it('get_task_with_a_malformed_key_surfaces_an_error', async () => {
    // The key guard (/^TASK-\d{3,}$/) rejects a path-injection-shaped key before
    // any read. zod regex on the inputSchema (or an inline guard) must reject it.
    let surfaced = false;
    try {
      const res = await client.callTool({
        name: 'get_task',
        arguments: { key: '../../etc/passwd' },
      });
      if (res && res.isError) surfaced = true;
    } catch {
      surfaced = true;
    }
    expect(surfaced, 'a malformed key must be rejected, never read off disk').toBe(true);
  });
});
