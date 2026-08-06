# In-memory MCP test harness (vitest, no live client)

The SDK ships an `InMemoryTransport` whose static `createLinkedPair()` returns a
pair of linked transports `[clientTransport, serverTransport]`. Connect your
`McpServer` to one and a `Client` to the other; calls flow in-process. This is
the automatable harness for AC3 — no subprocess, no stdio, deterministic.

## Imports

```js
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
```

## Recommended structure: a factory, not a side-effecting module

`src/mcp-server.js` should export a `createServer({ repoRoot })` that builds and
returns an `McpServer` with all ten tools registered (seven task-store tools plus
three extension tools — `kb_lookup` (TASK-106), `kb_graph_query` (TASK-168),
`mcp_build_status` (TASK-204)), and ONLY auto-connect a
`StdioServerTransport` when run as the entrypoint. That lets the test inject a
per-test temp `repoRoot` instead of relying on the `CLAUDE_PROJECT_DIR` env var.

```js
// src/mcp-server.js (shape)
export function createServer({ repoRoot }) {
  const server = new McpServer({ name: 'hivemind-tasks', version: '0.1.0' });
  // ...registerTool x10, each closing over `repoRoot`...
  return server;
}

// entrypoint guard: only runs when executed directly, not when imported by tests
// (under esbuild-CJS, import.meta is unavailable; use a CJS-safe guard such as
//  `if (require.main === module)` in the bundled form, or a small bin wrapper).
```

Note: pick an entrypoint guard that survives esbuild CJS bundling. A clean option
is to keep `src/mcp-server.js` import-only (export `createServer` + a `main()`)
and have the bundled `dist/mcp-server.cjs` entry call `main()` from a thin
`bin/`-style wrapper, OR rely on `require.main === module` which esbuild emits
correctly for the CJS target. Confirm at impl time with a `node dist/mcp-server.cjs`
smoke run.

## The round-trip test (AC3)

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/mcp-server.js';

// Tool results are { content: [{ type:'text', text:'<json>' }] }. Parse helper:
function parse(result) {
  return JSON.parse(result.content[0].text);
}

describe('MCP task-store round-trip', () => {
  let repoRoot;
  let client;

  beforeEach(async () => {
    repoRoot = mkdtempSync(join(tmpdir(), 'mcp-task-'));
    const server = createServer({ repoRoot });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test', version: '0.0.0' });
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
  });

  afterEach(async () => {
    await client.close();
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('create -> list_todos -> transition -> get_task reflects done', async () => {
    // create_task
    const created = parse(await client.callTool({
      name: 'create_task',
      arguments: {
        title: 'Round-trip task',
        description: 'made via MCP',
        acceptance_criteria: ['it round-trips'],
        priority: 'medium',
      },
    }));
    const key = created.key;
    expect(key).toMatch(/^TASK-\d{3,}$/);

    // list_todos shows it
    const todos = parse(await client.callTool({ name: 'list_todos', arguments: {} }));
    expect(todos.map((t) => t.key)).toContain(key);

    // transition_status -> done
    const transitioned = parse(await client.callTool({
      name: 'transition_status',
      arguments: { key, status: 'done' },
    }));
    expect(transitioned.ok).toBe(true);

    // get_task reflects the new status
    const task = parse(await client.callTool({
      name: 'get_task',
      arguments: { key },
    }));
    expect(task.status).toBe('done');
  });
});
```

## Notes

- `client.callTool({ name, arguments })` is the SDK client call shape; it returns
  the same `{ content: [...] , isError? }` object the handler returned.
- `listTools()` on the client is a cheap extra assertion that all ten tools
  registered (assert the returned `tools` array has length 10 with the expected
  names: `list_todos`, `list_ready`, `get_task`, `create_task`,
  `transition_status`, `append_comment`, `close_task`, `kb_lookup`,
  `kb_graph_query`, `mcp_build_status`) — good for an AC1-style "the surface is
  complete" check.
- Connect server and client concurrently (`Promise.all`) — the in-memory
  handshake needs both ends live.
- Each test gets a fresh `mkdtempSync` repo, so the task store starts empty and
  `create_task` derives `TASK-001`. No cross-test contamination.
- Because this is in-process, errors thrown by a tool surface as
  `result.isError === true` with the message in `content` — assert on that for
  negative-path tests (e.g. `get_task` on an unknown key, `transition_status`
  with an invalid status). `close_task` has two extra guard paths worth a
  negative-path test each: the uat-only done-guard (a `verification_tier:
  'uat-only'` task closed with no prior `author: 'uat'` comment) and the
  loop-mode close guard (only reachable in loop mode without
  `loop_auth.auto_close_on_green_review`; harness-mode tests hit this as a
  no-op and don't need to simulate it).
