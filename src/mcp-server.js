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
import { execFileSync } from 'node:child_process';

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
  COMMENT_AUTHORS,
} from './task-store.js';
import { loopModeCloseGuard, loopModeUatCommentGuard } from './close-guard.js';
import { lookupKnowledge, recordKbReuse } from './knowledge.js';
import {
  GRAPH_SCHEMA, nodesByType, neighbors, loadGraph, UnknownNodeIdError,
} from './knowledge-graph.js';
import { neighborsCanonicalFirst, recordNode as _recordNode } from './graph-sync.js';
import { taskKeyToNodeId } from './graph-freshness.js';

const PRIORITY = z.enum(['low', 'medium', 'high', 'critical']);
const STATUS = z.enum(['todo', 'in_progress', 'in_review', 'blocked', 'done']);
const VERIFICATION_TIER = z.enum(['tdd', 'tests-after', 'uat-only']);
// TASK-188 AC4 — mirrors src/task-store.js's COMMENT_AUTHORS (itself a mirror
// of tasks/schema.json's comments.items.properties.author enum). Rejects an
// unknown author string at the MCP boundary with a friendly zod error before
// task-store.js's own (also-enforced) check ever runs.
const COMMENT_AUTHOR = z.enum(COMMENT_AUTHORS);
// Spine calibration (Phase 2) — mirror of tasks/schema.json calibration fields.
const MARKER = z.enum(['[EXPLICIT]', '[INFERRED:strong]', '[INFERRED:weak]', '[INFERRED]', '[ASSUMED]', '[MISSING_INFO]']);
const SOURCE_TIER = z.enum(['T1', 'T2', 'T3', 'T4', 'TX']);
const CONFIDENCE = z.object({
  source_credibility: z.number().min(0).max(1).optional(),
  assertion_strength: z.number().min(0).max(1).optional(),
  corroboration: z.number().min(0).max(1).optional(),
  verification_status: z.number().min(0).max(1).optional(),
});

// TASK-168 (KB-GRAPH-1) — kb_graph_query enums. Pulled directly off GRAPH_SCHEMA's
// $defs (src/knowledge-graph.js) rather than re-listed, so the tool's input schema
// cannot silently drift from the graph document schema it queries.
const GRAPH_NODE_TYPE = z.enum(GRAPH_SCHEMA.$defs.node.properties.type.enum);
const GRAPH_RELATION = z.enum(GRAPH_SCHEMA.$defs.edge.properties.relation.enum);
const GRAPH_DIRECTION = z.enum(['out', 'in']);

// Schema key shape (tasks/schema.json). Used as a path-injection guard on
// get_task: a crafted key like `../../etc/passwd` must be rejected before any
// read touches disk.
const KEY_RE = /^TASK-\d{3,}$/;

/** Wrap any tool result value in the MCP text-content envelope. */
function ok(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

// TASK-175 item 4 — read-steering hardening (LOW, repo-local trust model).
// kb_graph_query hands `ref` to agents that are told (orchestrator-routing
// SKILL.md) to auto-follow it as a path. Constrained here at the READ
// boundary rather than in GRAPH_SCHEMA (src/knowledge-graph.js) — schema is
// the WRITE-side contract every addNode/addEdge/writeGraph call validates
// against, and tightening it is a real trust-boundary change (deliberately
// out of scope for this LOW cleanup item; see the TASK-175 hand-off, and
// TASK-185's hand-off which re-confirmed the boundary; TASK-193 re-examined
// the boundary a third time — see that ticket's closing comment — and again
// decided consumption-point validation is the right and sufficient place for
// this control). A ref that is an absolute path, a `..` traversal segment
// anywhere in the string, a home-dir shorthand, a UNC \\host\share path,
// carries a URL scheme (http:, file:, javascript:, a Windows drive letter,
// ...), or contains a literal `%` at all is replaced with null rather than
// surfaced for an agent to blindly open.
//
// TASK-193 — the TASK-185 reviewer found that the prior rule (`..` only
// caught when flanked by a path separator or string start/end, plus a single
// literal-token `%2e%2e` check) let percent-encoded and dot-stripper-bait
// variants straight through: "%252e%252e/x" (double-encoded), "..%2fx" /
// "..%5cx" (literal ".." followed directly by an encoded separator, so the
// old flanking requirement never matched), "....//etc/passwd" (four dots
// before a doubled slash — bait for a naive "../"-stripper — contains no "%"
// and no flanked ".." either), and "a%00/etc/passwd" (encoded null byte).
// None of these was ever exploitable — no consumer in this repo
// percent-decodes or naively strips "../" before resolving a ref; every
// consumer opens it as a literal repo-relative path — but a token blacklist
// loses arms races by construction, so two changes replace it with
// whitelist-shaped rules instead of chasing more tokens: (1) `..` is now
// matched unanchored (bare `\.\.`, no flanking requirement) so it catches any
// occurrence, including inside a run of dots like "...."; (2) any bare `%` is
// rejected outright rather than matching specific encoded tokens, since a
// legitimate ref never needs one. Verified against the live
// knowledge/graph/graph.json before landing this: 0 of 233 refs contain `%`
// and 0 contain a literal ".." substring, so both rules are false-negative
// clean today (see the TASK-193 hand-off for the fresh count). Case-
// insensitive (`i`) so an uppercase scheme is still caught.
const UNSAFE_REF_RE = /^[/\\~]|^[a-zA-Z][a-zA-Z0-9+.-]*:|\.\.|%/i;

// TASK-175 — exported (was module-private) solely so tests/safe-ref.spec.js
// can unit-lock the guard directly (including running the AC3 mutation
// drills against it) without paying for a full MCP client/server round trip
// per input.
//
// TASK-185 — UNSAFE_REF_RE's checks are `^`-anchored, so a single leading
// space/tab defeated the whole guard while the value still resolved as the
// intended unsafe path for any consumer that trims (verified by direct
// execution of the pre-fix regex: " /etc/passwd", "\t/etc/passwd",
// "  ~/.ssh/id_rsa", and a leading-space UNC path all passed through
// unchanged). Reject outright — rather than silently clean and pass through —
// any ref that carries leading/trailing whitespace or an embedded CR/LF: no
// legitimate ref in this graph is ever padded, and a mid-string newline
// (e.g. "a\n/etc/passwd") can hide a later unsafe line from a naive consumer
// even though it isn't leading/trailing whitespace itself.
export function safeRef(ref) {
  if (typeof ref !== 'string') return null;
  if (ref !== ref.trim() || /[\r\n]/.test(ref)) return null;
  if (UNSAFE_REF_RE.test(ref)) return null;
  return ref;
}

/**
 * kb_graph_query (TASK-168) — reshape a node into a fixed key order (id, type,
 * ref, label) and sort the array by id ascending. This is what makes the
 * response byte-stable regardless of the on-disk node order in graph.json
 * (mirrors knowledge-graph.js's own serializeNode/sort convention).
 */
function sortNodesById(nodes) {
  return [...nodes]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((n) => ({
      id: n.id, type: n.type, ref: safeRef(n.ref), label: n.label,
    }));
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
 * TASK-171 (KB-GRAPH-4) — auto-create the task-<digits> node in
 * knowledge/graph/graph.json as part of close_task's guarded write path.
 *
 * ORDERING (documents the design decision, AC2): this is called AFTER
 * closeTask({...}) has already succeeded (see the close_task handler below).
 * closeTask's own atomic all-or-nothing write (task file + index.json) is
 * COMPLETE and durable by the time this function ever runs — nothing in here
 * can roll back or corrupt that write. This function's own write (the graph
 * node) is deliberately best-effort-AFTER: any failure (bad node id shape,
 * a real disk error, a throwing injected `recordNode`, or a throwing/queued
 * canonical `brain` mirror inside recordNode) is caught and folded into the
 * returned status string instead of thrown, so the close_task tool call
 * always resolves successfully once closeTask() itself has succeeded.
 *
 * IDEMPOTENCY (AC2): addNode's duplicate-id guard throws a plain Error with
 * no machine-readable .code (see src/knowledge-graph.js), so re-closing (or
 * a node created out-of-band before this call runs) is handled by checking
 * existence via loadGraph() FIRST — cheaper than a full addNode attempt plus
 * message-sniffing, and it never touches disk when the node is already
 * there.
 *
 * @returns {Promise<string>} 'skipped' (key doesn't match TASK-<digits>),
 *   'exists' (node already present), 'created', or `failed:<code>`.
 */
// TASK-175 item 9 — exported (was module-private) solely so
// tests/e2e/mcp-server.spec.js can lock the 'skipped' branch and the
// `task?.title ?? key` label fallback directly. Both are effectively
// unreachable THROUGH the close_task tool today: schema.json's key pattern
// (`^TASK-[0-9]{3,}$`) is a strict subset of taskKeyToNodeId's own
// `/^TASK-(\d+)$/`, so closeTask's validateTaskOrThrow rejects any task
// whose key would make taskKeyToNodeId return null before this function is
// ever called — hence the direct unit test rather than an MCP-tool-level one.
export async function recordTaskGraphNode({
  repoRoot, key, brain, recordNode,
}) {
  const nodeId = taskKeyToNodeId(key);
  if (!nodeId) return 'skipped';
  try {
    const graph = await loadGraph({ repoRoot });
    const wanted = nodeId.toLowerCase();
    const exists = (graph.nodes ?? []).some((n) => String(n.id).toLowerCase() === wanted);
    if (exists) return 'exists';

    const task = await readTask(repoRoot, key);
    await recordNode({
      brain,
      repoRoot,
      node: {
        id: nodeId,
        type: 'task',
        ref: `tasks/${key}.json`,
        label: task?.title ?? key,
      },
      topic: 'hivemind-tasks',
    });
    return 'created';
  } catch (err) {
    return `failed:${err?.code || 'unknown'}`;
  }
}

/**
 * TASK-188 AC6 — best-effort, ADVISORY-ONLY existence check for
 * close_task's linked_commits, run ONLY here at the MCP layer (never inside
 * src/task-store.js — closeTask is a pure state-store function with no git
 * dependency, deliberately: see the TASK-188 hand-off for why adding one
 * there was rejected). Never throws and never blocks the close (STRIDE-
 * Repudiation was scoped LOW in the originating probe, P8, and git
 * verification has too many legitimate false-negative paths — shallow
 * clones, rebased/squashed history, a sandboxed environment with no git
 * binary at all — to safely gate a close on it).
 *
 * Empty-result contract (TASK-192): the caller must be able to tell
 * "verified, none missing", "verified, some missing", and "could not
 * verify at all" APART — an unqualified `{}` (or a bare boolean) would
 * collapse the last two into indistinguishable silence, exactly the defect
 * class that contract exists to close. `checked: false` always carries a
 * `reason` naming WHY nothing was verified (`'none-linked'` — nothing to
 * check, not an error; `'git-unavailable'` — no git binary on PATH;
 * `'not-a-git-repo'` — repoRoot itself is not inside a git work tree, the
 * common case for e2e test fixtures built with plain mkdtemp). `checked:
 * true` always carries `present`/`missing` arrays that partition every
 * input sha.
 *
 * @returns {{checked: boolean, reason: string|null, present: string[], missing: string[]}}
 */
export function verifyLinkedCommits(repoRoot, shas) {
  const list = Array.isArray(shas) ? shas : [];
  if (list.length === 0) {
    return {
      checked: false, reason: 'none-linked', present: [], missing: [],
    };
  }
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: repoRoot, stdio: 'pipe' });
  } catch (err) {
    return {
      checked: false,
      reason: err && err.code === 'ENOENT' ? 'git-unavailable' : 'not-a-git-repo',
      present: [],
      missing: [],
    };
  }
  const present = [];
  const missing = [];
  for (const sha of list) {
    try {
      execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd: repoRoot, stdio: 'pipe' });
      present.push(sha);
    } catch {
      missing.push(sha);
    }
  }
  return {
    checked: true, reason: null, present, missing,
  };
}

/**
 * Build and return a configured McpServer with all seven task-store tools plus
 * kb_lookup (TASK-106) registered, each closing over `repoRoot`. Throwing
 * handlers surface to the client as { isError: true } (the SDK converts a
 * thrown error), which keeps state uncorrupted on bad input rather than
 * silently succeeding.
 */
export function createServer({ repoRoot, brain = null, recordNode = _recordNode }) {
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
        'Create a new task (status "todo"). Returns { key, path }, plus an ' +
        'optional advisory `warnings` array (e.g. a tier-vs-content mismatch ' +
        'signal) when present — never blocking, but worth surfacing to the human.',
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
        'Set a task status (todo|in_progress|in_review|blocked|done). '
        + "(TASK-187) status:'done' now requires a valid predecessor state "
        + "that implies a review occurred ('in_review') and, for tdd/"
        + 'tests-after tiers, a pre-existing reviewer comment plus a '
        + 'non-empty linked_commits. `exception: { reason, author? }` is '
        + 'the documented, auditable escape hatch for a legitimate '
        + "exception (e.g. a won't-do closure) — it records a separate "
        + "'[CLOSE-EXCEPTION]'-prefixed comment rather than bypassing silently.",
      inputSchema: {
        key: z.string().describe('Task key, e.g. TASK-026'),
        status: STATUS,
        exception: z.object({
          reason: z.string().describe('Non-empty, auditable justification for bypassing the close preconditions.'),
          author: COMMENT_AUTHOR.optional().describe("Author of the recorded [CLOSE-EXCEPTION] comment (default 'orchestrator')."),
        }).optional(),
      },
    },
    async ({
      key, status, exception,
    }) => {
      // TASK-082 — loopModeCloseGuard is composed unconditionally on every
      // call: it decides for itself whether loop mode is even active
      // (getMode defaults to 'harness', a no-op), so this is safe in
      // harness mode / with no active session and only bites when status
      // === 'done' AND loop mode is active AND unauthorized.
      await transitionStatus({
        repoRoot, key, status, closeGuard: loopModeCloseGuard, exception,
      });
      return ok({ ok: true });
    },
  );

  server.registerTool(
    'append_comment',
    {
      description: 'Append a comment ({ author, body }) to a task.',
      inputSchema: {
        key: z.string().describe('Task key, e.g. TASK-026'),
        author: COMMENT_AUTHOR,
        body: z.string(),
      },
    },
    async ({ key, author, body }) => {
      // TASK-108 — narrows the write-side uat-comment fabrication channel
      // (Gate 2 residual): a loop-mode caller may not author:'uat' unless
      // loop_auth.uat_delegated_to_orchestrator is granted. Composed
      // unconditionally, same pattern as loopModeCloseGuard on
      // transition_status/close_task — it decides for itself whether loop
      // mode is even active, so this is safe in harness mode / with no
      // active session and only bites when author === 'uat' AND loop mode
      // is active AND unauthorized.
      await loopModeUatCommentGuard({ repoRoot, author });
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
        + 'done-guard, the loop-mode close guard, (TASK-163) the '
        + 'loop-mode uat-comment write guard on comment.author, '
        + "(TASK-188) rejects comment.author 'reviewer', and (TASK-187) "
        + "requires status 'in_review' plus, for tdd/tests-after tiers, a "
        + 'pre-existing reviewer comment and a non-empty linked_commits. '
        + '`exception: { reason, author? }` is the documented, auditable '
        + "escape hatch for a legitimate exception (e.g. a won't-do "
        + "closure) — it records a separate '[CLOSE-EXCEPTION]'-prefixed "
        + 'comment rather than bypassing silently. Reports a best-effort, '
        + 'advisory-only linked_commits_verification (never blocks the '
        + 'close) — see the TASK-188 hand-off / tasks/schema.json.',
      inputSchema: {
        key: z.string().describe('Task key, e.g. TASK-026'),
        comment: z.object({ author: COMMENT_AUTHOR, body: z.string() }),
        linked_commits: z.array(z.string()).optional(),
        linked_prs: z.array(z.string()).optional(),
        exception: z.object({
          reason: z.string().describe('Non-empty, auditable justification for bypassing the close preconditions.'),
          author: COMMENT_AUTHOR.optional().describe("Author of the recorded [CLOSE-EXCEPTION] comment (default 'orchestrator')."),
        }).optional(),
      },
    },
    async ({
      key, comment, linked_commits, linked_prs, exception,
    }) => {
      // TASK-163 — defense-in-depth follow-up from TASK-108: close_task's own
      // `comment` param reached appendComment via closeTask WITHOUT passing
      // through loopModeUatCommentGuard, leaving a second write seam open
      // (append_comment already enforces this rule). Called BEFORE closeTask
      // so a denial never reaches closeTask's atomic write at all — same
      // unconditional-composition pattern as loopModeCloseGuard: the guard
      // decides for itself whether loop mode is even active, so this is safe
      // in harness mode / with no active session and only bites when
      // comment.author === 'uat' AND loop mode is active AND unauthorized.
      await loopModeUatCommentGuard({ repoRoot, author: comment.author });
      await closeTask({
        repoRoot,
        key,
        comment,
        linked_commits: linked_commits ?? [],
        linked_prs: linked_prs ?? [],
        closeGuard: loopModeCloseGuard,
        exception,
      });
      // TASK-188 AC6 — best-effort-AFTER, same ordering rationale as
      // graph_node below: closeTask() has already committed atomically, so a
      // verification failure here (or git being unavailable) never reaches
      // the caller as a rejection, only as this field's own `checked`/`reason`.
      const linked_commits_verification = verifyLinkedCommits(repoRoot, linked_commits ?? []);
      // TASK-171 (KB-GRAPH-4) — best-effort-AFTER: closeTask() above already
      // completed atomically. See recordTaskGraphNode's doc comment for the
      // full ordering rationale; a failure here never reaches the caller as
      // a rejection, only as this graph_node status string.
      const graph_node = await recordTaskGraphNode({
        repoRoot, key, brain, recordNode,
      });
      return ok({ ok: true, graph_node, linked_commits_verification });
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
  //
  // TASK-113(c) — the bump loop is non-atomic across hits (each recordKbReuse
  // call is its own atomic tmp+rename write, but the LOOP across several
  // hits is not a single transaction): one throwing bump (e.g. a hit whose
  // frontmatter id disagrees with its filename -> E_KB_NOT_FOUND) must not
  // silently abort the whole call after earlier hits already landed. Design
  // judgment (recorded in the hand-off): PARTIAL-REPORT over all-or-nothing —
  // a rollback of an already-durable bump would add a second failure surface
  // (the rollback write itself) to undo a write that was never unsafe.
  // Each hit's bump is now caught individually and the response states which
  // hits bumped and which failed, instead of throwing.
  server.registerTool(
    'kb_lookup',
    {
      description:
        'Look up the local grep knowledge base (knowledge/entries/) for a '
        + 'question. Runs the deterministic three-pass tag/symptom/body '
        + 'scoring in code and returns the top hits as { id, path, score }, '
        + 'sorted score desc then id asc. As a side effect, bumps '
        + 'last_seen_at on every returned entry (its reuse signal); the '
        + '{ reuse: { bumped, failed } } field in the response states which '
        + 'hits actually bumped and which failed, so one throwing bump never '
        + 'silently swallows the others.',
      inputSchema: {
        question: z.string(),
      },
    },
    async ({ question }) => {
      const { kb_hits } = await lookupKnowledge({ repoRoot, question });
      const ranked = kb_hits
        .slice()
        .sort((a, b) => (b.score - a.score) || a.id.localeCompare(b.id));

      const bumped = [];
      const failed = [];
      for (const hit of ranked) {
        try {
          await recordKbReuse({ repoRoot, entryId: hit.id });
          bumped.push(hit.id);
        } catch (err) {
          failed.push({ id: hit.id, error: err.message });
        }
      }

      return ok({
        query: question,
        kb_hits: ranked.map((hit) => ({
          id: hit.id,
          path: join(repoRoot, 'knowledge', 'entries', `${hit.id}.md`),
          score: hit.score,
        })),
        reuse: { bumped, failed },
      });
    },
  );

  // TASK-168 (KB-GRAPH-1) — kb_graph_query: the graph's first programmatic
  // query surface (before this ticket, knowledge/graph/graph.json was
  // WRITE-ONLY — populated at ticket-close but never queried at decision
  // time). Wraps neighbors()/nodesByType() (src/knowledge-graph.js).
  //
  // READ PATH (the merge seam, per the 2026-07-18 scope refinement,
  // tasks/TASK-168.json comment): an `id` query is routed through
  // src/graph-sync.js#neighborsCanonicalFirst so the SAME tool serves both a
  // brain-absent mode (falls back to the local projection — behavior
  // identical to a local-only tool) and a future brain-present mode (a
  // canonical wisearcher graph). `brain` IS wired through createServer as of
  // TASK-171 (close_task uses it) and is now forwarded to
  // neighborsCanonicalFirst here too (deep-review MEDIUM-1 fix — it was
  // dropped before this fix even when a caller injected one). BUT
  // neighborsCanonicalFirst's canonical path only engages when BOTH `brain`
  // AND `canonicalId` are present (`if (brain && canonicalId)` —
  // src/graph-sync.js), and this tool's schema has no `canonicalId` input, so
  // forwarding `brain` alone does not yet light up the canonical path: every
  // call here still resolves via the local-projection fallback today. A
  // follow-up ticket that plumbs `canonicalId` through would be enough to
  // engage it without touching neighborsCanonicalFirst itself. A `type`-only
  // query has no canonical equivalent yet and stays on the local projection
  // (nodesByType). `relation`/`direction` filters ALSO stay local-only for
  // now: neighborsCanonicalFirst's brain path (brain-contract.md's
  // `kb_neighbors`) is `canonical_id`-only with no relation/direction
  // parameter, so a filtered query calls the local `neighbors()` directly
  // instead of the canonical-first wrapper — documented here, not silently
  // dropped.
  //
  // DETERMINISM (AC2): output nodes are always re-shaped to a fixed key
  // order and sorted by id ascending (sortNodesById) before serialization,
  // so identical graph.json + identical args is byte-stable on repeat
  // invocation. This lock applies to the brain-ABSENT (local) path only —
  // brain-present results depend on live brain state and are out of scope
  // for the determinism guarantee (documented, not tested here).
  //
  // GRACEFUL DEGRADATION (AC3): a missing node id yields `{ nodes: [] }`,
  // never a throw (UnknownNodeIdError is caught, same contract
  // neighborsCanonicalFirst already gives every other caller). Args with
  // neither `id` nor `type` also yield an empty, documented result rather
  // than an error. An invalid enum value (type/relation/direction) is
  // rejected by the zod input schema before the handler runs, surfacing as
  // an MCP `isError` result — a typed error, not a server crash.
  //
  // TASK-172 (KB-GRAPH-1a) / TASK-173 (KB-GRAPH-1b) — NO supplied filter is
  // ever silently dropped. This invariant is now TOTAL (TASK-173 closed the
  // last gap): TASK-172's rejection guard required `type !== undefined`, so
  // { relation } alone or { direction } alone (no id, no type) fell through
  // to the "neither id nor type" branch and returned an empty result with
  // relation/direction SILENTLY IGNORED. The guard below fires whenever
  // relation/direction are supplied without an id, regardless of whether
  // type is also present.
  //   { id, type }: `type` is applied as a POST-FILTER on the neighbor
  //     result (only neighbors whose own node.type matches the requested
  //     type survive) — this composes with relation/direction, which
  //     already narrow the edge set before type is applied.
  //   `relation` or `direction` supplied WITHOUT an `id` (with or without
  //     `type`): relation and direction only mean something relative to an
  //     edge anchored at a specific node id; there is no such anchor, so
  //     this shape is REJECTED with a typed error (code
  //     E_UNANCHORED_EDGE_FILTER, thrown -> MCP `isError`) rather than
  //     silently ignoring relation/direction.
  server.registerTool(
    'kb_graph_query',
    {
      description:
        'Query the internal knowledge graph (knowledge/graph/graph.json) '
        + 'deterministically. Input: { id?, type?, relation?, direction? }. '
        + 'An `id` query returns connected nodes via '
        + 'graph-sync.js#neighborsCanonicalFirst (canonical-first when a '
        + 'brain AND a canonicalId are both present; local-projection '
        + 'fallback otherwise — this tool forwards an injected brain but has '
        + 'no canonicalId input, so every call here still uses the local '
        + 'fallback today). A `type`-only query returns all nodes of that type '
        + 'via nodesByType (local only). `relation`/`direction` narrow an '
        + '`id` query and are LOCAL-ONLY (no canonical-first equivalent '
        + 'yet). Output is { query, source, nodes } with nodes sorted by '
        + 'id ascending — byte-stable/reproducible for the same graph.json '
        + '+ args on the brain-absent (local) path; brain-present results '
        + 'depend on live brain state and are outside that determinism '
        + 'guarantee. A missing id yields empty nodes, never a throw; '
        + 'omitting both id and type also yields an empty, documented '
        + 'result. A node\'s `ref` is normally a repo-relative path — but it '
        + 'is replaced with `null` (TASK-175/TASK-185/TASK-193) when the '
        + 'stored value is unsafe to auto-follow as a path: absolute, a '
        + '`~`/UNC shorthand, a URL scheme (incl. a Windows drive letter), a '
        + '`..` substring anywhere in the string, a literal `%` character '
        + 'anywhere in the string (percent-encoding is rejected outright, '
        + 'not decoded), or leading/trailing whitespace / an embedded CR or '
        + 'LF. This is a raw string check — it does not decode, normalize, '
        + 'or resolve symlinks; it fully covers every consumer here today '
        + '(none decode or strip `../` before resolving) but is not a '
        + 'guarantee against a future consumer that does. Treat `ref: null` '
        + 'as "no safe path available", never as an error, and fall back to '
        + 'the node\'s `id`/`label` instead of opening it. No supplied filter is ever silently dropped: { id, type } '
        + 'applies `type` as a POST-FILTER on the neighbor result (only '
        + 'neighbors whose own type matches survive); `relation` or '
        + '`direction` supplied WITHOUT an `id` — alone, together, or '
        + 'combined with `type` — has no edge to anchor the filter on and '
        + 'is REJECTED with a typed error (E_UNANCHORED_EDGE_FILTER) '
        + 'instead of silently ignoring relation/direction.',
      inputSchema: {
        id: z.string().optional().describe('Node id, e.g. task-168 or decision-20260101-x'),
        type: GRAPH_NODE_TYPE.optional().describe('Node type — filters a type-only query'),
        relation: GRAPH_RELATION.optional().describe('Edge relation — narrows an id query (local-only)'),
        direction: GRAPH_DIRECTION.optional().describe('"out" | "in" — narrows an id query (local-only)'),
      },
    },
    async ({
      id, type, relation, direction,
    }) => {
      const query = {
        id: id ?? null, type: type ?? null, relation: relation ?? null, direction: direction ?? null,
      };

      // TASK-172 / TASK-173 — relation/direction narrow the edge set around
      // a specific node id; without an id there is nothing to anchor them
      // to. Reject rather than silently ignoring relation/direction,
      // whether or not `type` is also supplied (TASK-173 dropped the
      // `type !== undefined` conjunct that let { relation } / { direction }
      // alone fall through to the empty-result branch below).
      if (id === undefined && (relation !== undefined || direction !== undefined)) {
        const err = new Error(
          '[E_UNANCHORED_EDGE_FILTER] kb_graph_query: relation/direction '
          + `require an id to anchor the edge filter — got { type: ${type ? `"${type}"` : 'undefined'}, `
          + `relation: ${relation ?? 'undefined'}, direction: ${direction ?? 'undefined'} } without an id`,
        );
        err.code = 'E_UNANCHORED_EDGE_FILTER';
        throw err;
      }

      if (id !== undefined) {
        let nodes;
        let source;

        // relation/direction-filtered queries have no canonical-first path
        // yet (see the doc comment above) — go straight to the local
        // projection so the filter is honored, instead of silently
        // dropping it through neighborsCanonicalFirst (which does not
        // accept relation/direction).
        if (relation !== undefined || direction !== undefined) {
          try {
            nodes = await neighbors({
              repoRoot, id, relation, direction,
            });
            source = 'projection';
          } catch (err) {
            if (err instanceof UnknownNodeIdError) {
              nodes = [];
              source = 'projection';
            } else {
              throw err;
            }
          }
        } else {
          // Plain id query — the canonical-first merge seam. `brain` (when
          // injected via createServer, TASK-171) is now forwarded here
          // (deep-review MEDIUM-1 fix). This still resolves via the
          // local-projection fallback in practice: neighborsCanonicalFirst's
          // canonical path additionally requires `canonicalId`, which this
          // tool's schema does not accept — see the doc comment above.
          const result = await neighborsCanonicalFirst({ brain, repoRoot, id });
          nodes = result.neighbors;
          source = result.source;
        }

        // TASK-172 — `type` narrows an id query as a POST-FILTER on the
        // neighbor result (only neighbors whose own node.type matches),
        // instead of being silently dropped when both id and type are
        // supplied.
        if (type !== undefined) {
          nodes = nodes.filter((n) => n.type === type);
        }

        return ok({ query, source, nodes: sortNodesById(nodes) });
      }

      if (type !== undefined) {
        const nodes = await nodesByType({ repoRoot, type });
        return ok({ query, source: 'projection', nodes: sortNodesById(nodes) });
      }

      // Neither id nor type supplied — documented empty result, not a throw.
      return ok({ query, source: 'projection', nodes: [] });
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
