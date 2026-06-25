// src/mcp-server.js
// TASK-026 — Plugin chain P6: the MCP (Model Context Protocol) task-store server.
//
// SCOPE BOUNDARY (AC4 — the "broaden-to-non-Code" seam, TASK-020.research §E.2):
//
//   A non-Claude-Code MCP client (claude.ai, Claude Desktop, or any MCP host)
//   WILL get the six task-store tools below — full ticket/task CRUD on the local
//   task store: list the backlog (list_todos / list_ready), read a ticket
//   (get_task), create tickets (create_task), transition status
//   (transition_status), and append comments (append_comment). The MCP seam turns
//   the framework's ticket store into a cross-client API.
//
//   Such a client WON'T get the orchestrator -> developer/reviewer/researcher
//   subagent loop, and it does NOT get the RESUME-FIRST session-state
//   orchestration or the TDD-enforced dev loop. Those are Claude Code-exclusive,
//   file-based constructs (agents/, .claude/skills/, state/ session bundles) that
//   MCP cannot install or drive. In one line: the MCP seam exposes the *ticket
//   store* to any client, but the *orchestration* stays Claude Code-only.
//
// DESIGN: `createServer({ repoRoot })` is a factory returning a configured
// McpServer with all six tools registered, each closing over `repoRoot`. The
// module only auto-connects a StdioServerTransport when run as the entrypoint
// (the dual ESM/CJS guard at the bottom), so tests inject a per-test temp
// repoRoot via the in-memory transport instead of relying on CLAUDE_PROJECT_DIR.
//
// The tool names mirror the Jira-compatible field names in tasks/schema.json, so
// the eventual Atlassian-MCP migration swaps the wrapped task-store functions
// without changing this tool surface.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import {
  listTodos,
  listReady,
  createTask,
  transitionStatus,
  appendComment,
} from './task-store.js';

const PRIORITY = z.enum(['low', 'medium', 'high', 'critical']);
const STATUS = z.enum(['todo', 'in_progress', 'in_review', 'blocked', 'done']);
const VERIFICATION_TIER = z.enum(['tdd', 'tests-after', 'uat-only']);
// Spine calibration (Phase 2) — mirror of tasks/schema.json calibration fields.
const MARKER = z.enum(['[EXPLICIT]', '[INFERRED:strong]', '[INFERRED:weak]', '[INFERRED]', '[ASSUMED]', '[MISSING_INFO]']);
const SOURCE_TIER = z.enum(['T1', 'T2', 'T3', 'T4', 'TX']);
const CONFIDENCE = z.object({
  source_credibility: z.number().min(0).max(1).optional(),
  assertion_strength: z.number().min(0).max(1).optional(),
  corroboration: z.number().min(0).max(1).optional(),
  verification_status: z.number().min(0).max(1).optional(),
});

// Schema key shape (tasks/schema.json). Used as a path-injection guard on
// get_task: a crafted key like `../../etc/passwd` must be rejected before any
// read touches disk.
const KEY_RE = /^TASK-\d{3,}$/;

/** Wrap any tool result value in the MCP text-content envelope. */
function ok(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

/**
 * get_task has NO task-store export — implement it inline by reading
 * tasks/<key>.json under repoRoot. Returns the parsed task object, or null when
 * the file is absent (ENOENT). A malformed key is rejected (throw) BEFORE any
 * filesystem access, so a path-injection-shaped key never reads off disk.
 */
async function readTask(repoRoot, key) {
  if (!KEY_RE.test(key)) {
    throw new Error(`invalid task key: ${key} (must match ${KEY_RE})`);
  }
  try {
    const raw = await readFile(join(repoRoot, 'tasks', `${key}.json`), 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err && err.code === 'ENOENT') return null; // §E.1: Task | null
    throw err;
  }
}

/**
 * Build and return a configured McpServer with all six task-store tools
 * registered, each closing over `repoRoot`. Throwing handlers surface to the
 * client as { isError: true } (the SDK converts a thrown error), which keeps
 * state uncorrupted on bad input rather than silently succeeding.
 */
export function createServer({ repoRoot }) {
  const server = new McpServer({
    name: 'hivemind-tasks',
    version: '0.1.0',
  });

  server.registerTool(
    'list_todos',
    {
      description: 'List all tasks with status "todo" (numeric-key order).',
      inputSchema: {},
    },
    async () => ok(await listTodos({ repoRoot })),
  );

  server.registerTool(
    'list_ready',
    {
      description:
        'List "todo" tasks whose every dependency is done (ready to start).',
      inputSchema: {},
    },
    async () => ok(await listReady({ repoRoot })),
  );

  server.registerTool(
    'get_task',
    {
      description: 'Read a single task by key. Returns the task object or null.',
      inputSchema: {
        key: z.string().describe('Task key, e.g. TASK-026'),
      },
    },
    async ({ key }) => ok(await readTask(repoRoot, key)),
  );

  server.registerTool(
    'create_task',
    {
      description:
        'Create a new task (status "todo"). Returns the minted { key, path }.',
      inputSchema: {
        title: z.string(),
        description: z.string(),
        acceptance_criteria: z.array(z.string()).min(1),
        priority: PRIORITY,
        labels: z.array(z.string()).optional(),
        depends_on: z.array(z.string()).optional(),
        verification_tier: VERIFICATION_TIER.optional(),
        marker: MARKER.optional(),
        source_tier: SOURCE_TIER.optional(),
        confidence: CONFIDENCE.optional(),
      },
    },
    async ({ title, description, acceptance_criteria, priority, labels, depends_on, verification_tier, marker, source_tier, confidence }) =>
      ok(
        await createTask({
          repoRoot,
          title,
          description,
          acceptance_criteria,
          priority,
          ...(labels !== undefined ? { labels } : {}),
          ...(depends_on !== undefined ? { depends_on } : {}),
          ...(verification_tier !== undefined ? { verification_tier } : {}),
          ...(marker !== undefined ? { marker } : {}),
          ...(source_tier !== undefined ? { source_tier } : {}),
          ...(confidence !== undefined ? { confidence } : {}),
        }),
      ),
  );

  server.registerTool(
    'transition_status',
    {
      description:
        'Set a task status (todo|in_progress|in_review|blocked|done).',
      inputSchema: {
        key: z.string().describe('Task key, e.g. TASK-026'),
        status: STATUS,
      },
    },
    async ({ key, status }) => {
      await transitionStatus({ repoRoot, key, status });
      return ok({ ok: true });
    },
  );

  server.registerTool(
    'append_comment',
    {
      description: 'Append a comment ({ author, body }) to a task.',
      inputSchema: {
        key: z.string().describe('Task key, e.g. TASK-026'),
        author: z.string(),
        body: z.string(),
      },
    },
    async ({ key, author, body }) => {
      await appendComment({ repoRoot, key, author, body });
      return ok({ ok: true });
    },
  );

  return server;
}

/**
 * Entrypoint: bind repoRoot to CLAUDE_PROJECT_DIR (the user's repo, injected by
 * .mcp.json's env interpolation) and connect a stdio transport. NEVER write to
 * stdout — it carries JSON-RPC; log only to stderr.
 */
export async function main() {
  const repoRoot = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const server = createServer({ repoRoot });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr only — stdout is the JSON-RPC channel.
  console.error(`hivemind-tasks MCP server on stdio (repoRoot=${repoRoot})`);
}

// Dual ESM/CJS entrypoint guard (mirrors bin/init.js). Under raw Node ESM,
// import.meta.url is truthy and compared to argv[1]. Under the esbuild CJS
// bundle, import.meta is empty so we fall back to `require.main === module`.
// When imported (vitest), neither fires — createServer is used directly.
const __isEntryScript = import.meta.url
  ? Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href
  : (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module);

if (__isEntryScript) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
