---
name: mcp-server
description: How to build, bundle, register, and test a minimal stdio MCP (Model Context Protocol) server in Node.js with the official @modelcontextprotocol/sdk. Load this when implementing or modifying an MCP server (src/mcp-server.js, .mcp.json), when wrapping internal functions as MCP tools, when bundling the SDK with esbuild into a CJS artifact, or when the eventual Atlassian-MCP migration swaps the task-store backend. Triggers on @modelcontextprotocol/sdk, McpServer, StdioServerTransport, registerTool, InMemoryTransport, or ${CLAUDE_PROJECT_DIR} in an MCP context.
---

# MCP Server (Node.js, stdio) — Team Training Skill

Build a minimal stdio MCP server with the official TypeScript/JS SDK, bundle it
with esbuild into a committed CJS artifact (same pattern as the other plugin
entrypoints), register it in a plugin `.mcp.json`, and test it deterministically
with the SDK's in-memory transport — no live client needed.

## When to Use This Skill

Use when authoring or editing `src/mcp-server.js` / `dist/mcp-server.cjs` /
`.mcp.json`; when wrapping existing functions as MCP tools; when adding
`@modelcontextprotocol/sdk` to esbuild's bundle; when writing a round-trip MCP
test; or when migrating the task-store MCP surface to a Jira/Atlassian backend
(the tool names stay; only the wrapped functions change).

## Core Facts (pinned)

- **Package:** `@modelcontextprotocol/sdk` — add as a **devDependency** (esbuild
  inlines it into `dist/mcp-server.cjs`, exactly like `ajv`/`gray-matter`).
- **Version:** pin a stable `1.x` (latest stable line is `1.29.x`). Do **not**
  use `2.0.0-alpha.*` (that is what `main` on GitHub now is — alpha, unstable).
- **Peer dep:** `zod` (use `zod@^3.25` — the SDK's documented compatible range;
  the quickstart installs `zod@3`). esbuild bundles it too, so devDependency.
- **Runtime:** SDK `engines: node >=20`. We target `node20`. ESM source,
  bundled to CJS by esbuild — supported.
- **Current tool API:** `server.registerTool(name, config, handler)` on
  `McpServer`. This is the current recommended high-level API (NOT the
  low-level `setRequestHandler(ListToolsRequestSchema/CallToolRequestSchema)`,
  and NOT the older `server.tool(...)` overload).
- **inputSchema is a raw zod *shape object*** — `{ key: z.string() }` — NOT a
  `z.object({...})` wrapper. The SDK wraps it for you. Args arrive already
  validated and destructured: `async ({ key }) => ...`.

## Core Workflows

1. **Imports + construct** (exact specifiers — the `.js` suffixes are required):
   ```js
   import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
   import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
   import { z } from 'zod';

   const server = new McpServer({ name: 'hivemind-tasks', version: '0.1.0' });
   ```

2. **Register a tool** — config is `{ title?, description, inputSchema }`;
   handler returns a `content` array:
   ```js
   server.registerTool(
     'transition_status',
     {
       description: 'Set a task status (todo|in_progress|in_review|blocked|done).',
       inputSchema: {
         key: z.string().describe('Task key, e.g. TASK-026'),
         status: z.enum(['todo', 'in_progress', 'in_review', 'blocked', 'done']),
       },
     },
     async ({ key, status }) => {
       await transitionStatus({ repoRoot: REPO_ROOT, key, status });
       return { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] };
     },
   );
   ```

3. **Resolve the project root at runtime.** Bind once at module load:
   ```js
   const REPO_ROOT = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
   ```
   `.mcp.json` substitutes `${CLAUDE_PROJECT_DIR}` into the server's `env`, so
   the env var is present in the spawned process. NEVER use `process.cwd()` of
   the bundle, `import.meta.url`, or `${CLAUDE_PLUGIN_ROOT}` for project I/O —
   those point at the immutable plugin cache, not the user's repo.

4. **Connect + start.** `connect()` begins listening; there is no separate
   `start()`. Log only to **stderr** (stdout carries JSON-RPC):
   ```js
   async function main() {
     const transport = new StdioServerTransport();
     await server.connect(transport);
     console.error('hivemind-tasks MCP server on stdio');
   }
   main().catch((e) => { console.error(e); process.exit(1); });
   ```

5. **Bundle with esbuild** — add a third entry to `scripts/build-plugin.mjs`
   (`src/mcp-server.js` → `dist/mcp-server.cjs`, `format: 'cjs'`,
   `platform: 'node'`, `target: 'node20'`, `bundle: true`). Then add
   `"dist/mcp-server.cjs"` to `.claude-plugin/shipped-bin.json`'s `bin` array.

6. **Register in `.mcp.json`** at the plugin root, pointing at the **bundle**:
   ```json
   {
     "mcpServers": {
       "hivemind-tasks": {
         "command": "node",
         "args": ["${CLAUDE_PLUGIN_ROOT}/dist/mcp-server.cjs"],
         "env": { "CLAUDE_PROJECT_DIR": "${CLAUDE_PROJECT_DIR}" }
       }
     }
   }
   ```
   Because the SDK is bundled into the `.cjs`, NO `NODE_PATH` is needed (this
   supersedes the §E.1 spike sketch that used `${CLAUDE_PLUGIN_DATA}/node_modules`
   — that was the data-dir approach P3 replaced with esbuild bundling). Re-add
   `"mcpServers": "./.mcp.json"` to `plugin.json` in the same change.

7. **Test deterministically** with the in-memory transport — see
   [`references/in-memory-test-harness.md`](references/in-memory-test-harness.md).
   `InMemoryTransport.createLinkedPair()` returns `[clientTransport,
   serverTransport]`; connect your `McpServer` to one and a `Client` to the
   other and call `client.callTool(...)` in-process.

## Best Practices

- **Do** bundle the SDK + zod into the committed `dist/*.cjs` — *because* a
  git-URL plugin install runs no `npm install`; ESM `import` ignores `NODE_PATH`.
- **Do** keep tool names = Jira-compatible field names — *because* the Atlassian
  migration swaps the wrapped function, not the tool surface.
- **Do** return every result as `{ content: [{ type: 'text', text: <JSON string> }] }`
  — *because* MCP content is text/typed blocks, not raw objects. Stringify.
- **Don't** write to stdout (`console.log`) — *because* it corrupts JSON-RPC.
  Use `console.error` (stderr).
- **Don't** wrap `inputSchema` in `z.object(...)` — *because* the high-level API
  expects the raw shape; wrapping double-wraps and breaks arg parsing.
- **Don't** resolve project paths from the plugin location — *because* the plugin
  ships to an immutable cache dir; only `${CLAUDE_PROJECT_DIR}` is the user repo.

## Common Pitfalls

- **`ERR_PACKAGE_PATH_NOT_EXPORTED` / cannot find `@modelcontextprotocol/server`.**
  The package is `@modelcontextprotocol/sdk` with subpath exports
  (`/server/mcp.js`, `/server/stdio.js`, `/client/index.js`,
  `/inMemory.js`). The bare `@modelcontextprotocol/server` specifier does not
  exist — it is a doc-summary abbreviation. Always use the `/sdk/...` form with
  the `.js` suffix.
- **Tool returns nothing / client sees empty.** The handler must return an
  object with a `content` array. To signal failure, throw (the SDK converts it
  to `{ isError: true }`) or return `{ isError: true, content: [...] }`.
- **`get_task` has no task-store function.** `task-store.js` exports no
  `getTask`/`readTask`; implement `get_task` by reading
  `tasks/<key>.json` under `REPO_ROOT` and returning the parsed object (or
  `null` when absent). See references for the exact wrapper map.
- **Alpha SDK.** `npm i @modelcontextprotocol/sdk@latest` may pull a `2.x`
  alpha if the dist-tag drifts. Pin an explicit `1.x` semver.

## Verification

- Unit/round-trip: `npm test` — the in-memory harness round-trips
  `create_task → list_todos → transition_status → get_task` against a temp repo.
- Bundle sanity: `node scripts/build-plugin.mjs` then
  `node dist/mcp-server.cjs` should start and print the stderr banner (Ctrl-C to
  stop); a crash on start means a bundling miss (externals, dynamic require).
- Install sanity: `claude plugin details hivemind` must report
  `MCP servers (1)` with no startup error.

## References

- [`references/in-memory-test-harness.md`](references/in-memory-test-harness.md)
  — full vitest round-trip harness (Client + InMemoryTransport linked pair).
- [`references/tool-contract.md`](references/tool-contract.md) — the seven
  tool→args→returns→wraps rows and the exact `task-store.js` signatures.
- [`references/esbuild-and-mcp-json.md`](references/esbuild-and-mcp-json.md) —
  esbuild bundling gotchas + the `.mcp.json` interpolation rules.

## Provenance

- **Authored by:** Researcher subagent on behalf of ticket `TASK-026`.
- **Primary sources:**
  - https://modelcontextprotocol.io/docs/develop/build-server (TypeScript tab)
  - https://github.com/modelcontextprotocol/typescript-sdk (README + src/inMemory.ts)
  - https://www.npmjs.com/package/@modelcontextprotocol/sdk
- **Last verified:** 2026-05-29 (SDK stable 1.29.x; main is 2.0.0-alpha.0).
