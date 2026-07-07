// src/mcp-server.js
// TASK-026 — Plugin chain P6: the MCP (Model Context Protocol) task-store server.
//
// SCOPE BOUNDARY (AC4 — the "broaden-to-non-Code" seam, TASK-020.research §E.2):
//
//   A non-Claude-Code MCP client (claude.ai, Claude Desktop, or any MCP host)
//   WILL get the seven task-store tools below — full ticket/task CRUD on the
//   local task store: list the backlog (list_todos / list_ready), read a
//   ticket (get_task), create tickets (create_task), transition status
//   (transition_status), append comments (append_comment), and atomically
//   close a ticket (close_task, TASK-082). The MCP seam turns the framework's
//   ticket store into a cross-client API.
//
//   Such a client WON'T get the orchestrator -> developer/reviewer/researcher
//   subagent loop, and it does NOT get the RESUME-FIRST session-state
//   orchestration or the TDD-enforced dev loop. Those are Claude Code-exclusive,
//   file-based constructs (agents/, .claude/skills/, state/ session bundles) that
//   MCP cannot install or drive. In one line: the MCP seam exposes the *ticket
//   store* to any client, but the *orchestration* stays Claude Code-only.
//
//   TASK-106 (R18) added an EIGHTH tool, `kb_lookup`, that is NOT ticket CRUD:
//   it wraps the local grep knowledge base (src/knowledge.js's lookupKnowledge
//   + recordKbReuse) so the Researcher subagent can call a real, reproducible
//   lookup instead of hand-emulating the scoring algorithm via Grep. Any MCP
//   client gets it too — see PROJECT.md's amended scope line ("the MCP server
//   extends ticket CRUD plus a KB-lookup tool").
//
// DESIGN: `createServer({ repoRoot })` is a factory returning a configured
// McpServer with all eight tools registered, each closing over `repoRoot`. The
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
  closeTask,
} from './task-store.js';
import { loopModeCloseGuard } from './close-guard.js';
import { lookupKnowledge, recordKbReuse } from './knowledge.js';

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
 * Build and return a configured McpServer with all seven task-store tools plus
 * kb_lookup (TASK-106) registered, each closing over `repoRoot`. Throwing
 * handlers surface to the client as { isError: true } (the SDK converts a
 * thrown error), which keeps state uncorrupted on bad input rather than
 * silently succeeding.
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
      // TASK-082 — loopModeCloseGuard is composed unconditionally on every
      // call: it decides for itself whether loop mode is even active
      // (getMode defaults to 'harness', a no-op), so this is safe in
      // harness mode / with no active session and only bites when status
      // === 'done' AND loop mode is active AND unauthorized.
      await transitionStatus({ repoRoot, key, status, closeGuard: loopModeCloseGuard });
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

  server.registerTool(
    'close_task',
    {
      description:
        'Atomically close a task: transition to done, append the closing '
        + 'comment, and record linked_commits/linked_prs in a single '
        + 'validate-then-write pass (TASK-082). Enforces the uat-only '
        + 'done-guard and the loop-mode close guard.',
      inputSchema: {
        key: z.string().describe('Task key, e.g. TASK-026'),
        comment: z.object({ author: z.string(), body: z.string() }),
        linked_commits: z.array(z.string()).optional(),
        linked_prs: z.array(z.string()).optional(),
      },
    },
    async ({
      key, comment, linked_commits, linked_prs,
    }) => {
      await closeTask({
        repoRoot,
        key,
        comment,
        linked_commits: linked_commits ?? [],
        linked_prs: linked_prs ?? [],
        closeGuard: loopModeCloseGuard,
      });
      return ok({ ok: true });
    },
  );

  // TASK-106 (R18) — kb_lookup: wraps lookupKnowledge + recordKbReuse (both
  // src/knowledge.js) so the Researcher can call a real, reproducible KB
  // lookup instead of hand-emulating the three-pass scoring algorithm. Every
  // returned hit's last_seen_at is bumped (its reuse signal) before the
  // envelope is built, so the ranking below is computed from the PRE-bump
  // scores/ids but the id-based tie-break makes that irrelevant to
  // reproducibility. Hits are re-sorted score desc, then id asc: an
  // independent, immutable tie-break — unlike lookupKnowledge's own recency
  // tie-break, it cannot be perturbed by the very last_seen_at bump this call
  // performs.
  server.registerTool(
    'kb_lookup',
    {
      description:
        'Look up the local grep knowledge base (knowledge/entries/) for a '
        + 'question. Runs the deterministic three-pass tag/symptom/body '
        + 'scoring in code and returns the top hits as { id, path, score }, '
        + 'sorted score desc then id asc. As a side effect, bumps '
        + 'last_seen_at on every returned entry (its reuse signal).',
      inputSchema: {
        question: z.string(),
      },
    },
    async ({ question }) => {
      const { kb_hits } = await lookupKnowledge({ repoRoot, question });
      const ranked = kb_hits
        .slice()
        .sort((a, b) => (b.score - a.score) || a.id.localeCompare(b.id));
      for (const hit of ranked) {
        await recordKbReuse({ repoRoot, entryId: hit.id });
      }
      return ok({
        query: question,
        kb_hits: ranked.map((hit) => ({
          id: hit.id,
          path: join(repoRoot, 'knowledge', 'entries', `${hit.id}.md`),
          score: hit.score,
        })),
      });
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
