# MCP tool contract + task-store.js signatures (TASK-026)

source_tier: T2

Authoritative tool surface is `tasks/TASK-020.research.md` §E.1, reproduced here
with the verified `src/task-store.js` export names and call signatures.

## The seven task-store tools (§E.1 + TASK-082's `close_task`) plus `kb_lookup` (TASK-106)

| MCP tool | Args | Returns | Wraps |
|----------|------|---------|-------|
| `list_todos` | `{}` | `Task[]` (status==todo, numeric-key order) | `listTodos({repoRoot})` |
| `list_ready` | `{}` | `Task[]` (todo with all deps done) | `listReady({repoRoot})` |
| `get_task` | `{ key: string }` | `Task \| null` | read `tasks/<key>.json` |
| `create_task` | `{ title, description, acceptance_criteria: string[], priority, labels?: string[], depends_on?: string[], verification_tier?: "tdd"\|"tests-after"\|"uat-only", marker?: string, source_tier?: "T1"\|"T2"\|"T3"\|"T4"\|"TX", confidence?: { source_credibility?, assertion_strength?, corroboration?, verification_status? } }` | `{ key, path }` | `createTask({repoRoot, …})` |
| `transition_status` | `{ key: string, status: "todo"\|"in_progress"\|"in_review"\|"blocked"\|"done" }` | `{ ok: true }` | `transitionStatus({repoRoot, key, status, closeGuard: loopModeCloseGuard})` (TASK-082 — closeGuard wired through unconditionally; no-ops outside loop mode) |
| `append_comment` | `{ key: string, author: string, body: string }` | `{ ok: true }` | `loopModeUatCommentGuard({repoRoot, author})` (TASK-108, no-op unless loop mode + author:'uat' + undelegated) then `appendComment({repoRoot, key, author, body})` |
| `close_task` | `{ key: string, comment: { author: string, body: string }, linked_commits?: string[], linked_prs?: string[] }` | `{ ok: true }` | `closeTask({repoRoot, key, comment, linked_commits, linked_prs, closeGuard})` |
| `kb_lookup` (TASK-106) | `{ question: string }` | `{ query: string, kb_hits: [{ id, path, score }], reuse: { bumped: string[], failed: [{ id, error }] } }` (kb_hits sorted score desc, then id asc) | `lookupKnowledge({repoRoot, question})` then `recordKbReuse({repoRoot, entryId})` for every returned hit, one bump at a time (TASK-113(c): a throwing bump is caught per-hit and reported in `reuse.failed` — it does not abort the other hits or the call) |

The first seven map 1:1 onto the Jira-compatible field names in `tasks/schema.json`, so
that surface survives the eventual Atlassian-MCP migration (backend swaps from local
JSON to Jira; the tool names stay). `kb_lookup` is NOT ticket CRUD — it is a scoped
extension of the MCP surface (see the WILL/WON'T docstring below) wrapping
`src/knowledge.js`'s grep-KB lookup so the Researcher subagent gets an executable,
reproducible lookup instead of hand-emulating the scoring algorithm.

## Verified `src/task-store.js` exports (single object-arg, all async)

- `listTodos({ repoRoot })` → `Promise<Task[]>` (status==='todo', numeric-key
  order). Side effects: sweeps orphan tmp files + repairs `index.json`.
- `listReady({ repoRoot })` → `Promise<Task[]>` (todo whose every `depends_on`
  points at an on-disk `done` task; unknown dep ⇒ excluded).
- `createTask({ repoRoot, title, description, acceptance_criteria, priority,
  labels = [], depends_on = [], verification_tier?, marker?, source_tier?,
  confidence?, now? })` → `Promise<{ key, path }>`.
  - Throws if `acceptance_criteria` is empty/not-array, if `priority` not in
    `low|medium|high|critical`, if `verification_tier` is provided and not in
    `tdd|tests-after|uat-only`, or on schema-validation failure (message
    contains `task payload failed schema validation`).
  - `verification_tier`, `marker`, `source_tier`, `confidence` are Spine
    calibration fields (Phase 2): optional, omitted from the written task
    entirely when `undefined`, schema-validated by `validateTaskOrThrow`
    before any disk I/O.
- `transitionStatus({ repoRoot, key, status, now?, closeGuard? })` →
  `Promise<void>`.
  - Throws `invalid status "<s>" — must be one of ...` for a bad status.
  - Throws `unknown task key: <key>` if no such task.
  - On a transition to `done`: runs the uat-only done-guard, then — if
    `closeGuard` is a function — awaits `closeGuard({ repoRoot, task, key })`
    before writing (TASK-082). The MCP layer passes `loopModeCloseGuard` (see
    `src/close-guard.js`): a no-op unless the active session is in **loop**
    mode, in which case it throws `LoopCloseGuardError` unless the bundle's
    `loop_auth.auto_close_on_green_review === true`.
  - Returns nothing → the `transition_status` wrapper synthesizes `{ ok: true }`.
- `appendComment({ repoRoot, key, author, body, now? })` → `Promise<void>`.
  - Throws `unknown task key: <key>` if absent. Wrapper synthesizes `{ ok: true }`.
  - **TASK-108 — the `append_comment` tool handler (not `appendComment`
    itself; task-store.js stays decoupled) calls
    `loopModeUatCommentGuard({ repoRoot, author })` BEFORE `appendComment(...)`**
    to narrow the Gate 2 uat-comment fabrication channel (see
    `src/close-guard.js`): a no-op unless `author === 'uat'` AND the active
    session is in loop mode, in which case it throws `UatCommentGuardError`
    (`code: 'LOOP_UAT_COMMENT_DENIED'`) unless the bundle's
    `loop_auth.uat_delegated_to_orchestrator === true`. Harness mode and every
    non-`'uat'` author are unaffected.
- `closeTask({ repoRoot, key, comment: { author, body }, linked_commits = [],
  linked_prs = [], now?, closeGuard? })` → `Promise<void>` (TASK-082).
  - Atomically transitions the task to `done`, appends `comment`, appends
    `linked_commits`/`linked_prs`, and bumps `updated_at` in a single
    validate-then-write pass (unlike a `transitionStatus` + `appendComment`
    pair, which are two separate atomic writes and could leave a partial
    close on a mid-sequence failure).
  - **uat-only done-guard:** if `task.verification_tier === 'uat-only'`, the
    task must already carry a comment with `author === 'uat'` recording the
    UAT verdict — otherwise throws before any disk I/O (`... cannot transition
    to "done" without a "uat" comment recording the UAT verdict`).
  - **`closeGuard` seam:** an optional `({ repoRoot, task, key }) => Promise<void>`
    called after the uat-only guard and before any write; it may throw to
    block the close. The MCP layer passes `loopModeCloseGuard` (see
    `src/close-guard.js`): a no-op unless the active session is in **loop**
    mode, in which case it throws `LoopCloseGuardError` unless the bundle's
    `loop_auth.auto_close_on_green_review === true`.
  - Validates every `linked_commits` entry against `/^[0-9a-f]{7,40}$/i`
    (short or full commit sha) before writing; throws on the first bad shape.
  - Throws `unknown task key: <key>` if absent. Wrapper synthesizes `{ ok: true }`.

### `get_task` has NO task-store function — implement it inline

There is no `getTask`/`readTask` export. Implement the `get_task` tool by reading
the file directly under `repoRoot`:

```js
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

async function readTask(repoRoot, key) {
  try {
    const raw = await readFile(join(repoRoot, 'tasks', `${key}.json`), 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err && err.code === 'ENOENT') return null; // §E.1: Task | null
    throw err;
  }
}
```

Validate `key` against the schema's key shape (`/^TASK-\d{3,}$/`) before the read
to avoid path-injection via a crafted `key` (e.g. `../../etc/passwd`). Reject
anything that does not match.

## Result shaping (every tool)

Wrap the returned value in the MCP content envelope and stringify:

```js
const ok = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
```

- `list_todos` → `ok(await listTodos({ repoRoot }))`
- `list_ready` → `ok(await listReady({ repoRoot }))`
- `get_task` → `ok(await readTask(repoRoot, key))` (may be `null`)
- `create_task` → `ok(await createTask({ repoRoot, ... }))` → `{ key, path }`
- `transition_status` → `await transitionStatus(...); return ok({ ok: true });`
- `append_comment` → `await loopModeUatCommentGuard({ repoRoot, author }); await appendComment(...); return ok({ ok: true });` (TASK-108 — guard runs first, narrows the Gate 2 write-side channel)
- `close_task` → `await closeTask({ ..., closeGuard: loopModeCloseGuard }); return ok({ ok: true });`

Errors: let the wrapped function throw; the SDK converts a thrown error to
`{ isError: true, content: [{ type:'text', text: <message> }] }`. That is the
desired behavior for unknown-key / invalid-status / validation failures — no
manual try/catch needed unless you want to reshape the message.

## zod inputSchema shapes (raw shape objects, not z.object)

```js
const PRIORITY = z.enum(['low', 'medium', 'high', 'critical']);
const STATUS = z.enum(['todo', 'in_progress', 'in_review', 'blocked', 'done']);
const VERIFICATION_TIER = z.enum(['tdd', 'tests-after', 'uat-only']);
const MARKER = z.enum(['[EXPLICIT]', '[INFERRED:strong]', '[INFERRED:weak]', '[INFERRED]', '[ASSUMED]', '[MISSING_INFO]']);
const SOURCE_TIER = z.enum(['T1', 'T2', 'T3', 'T4', 'TX']);
const CONFIDENCE = z.object({
  source_credibility: z.number().min(0).max(1).optional(),
  assertion_strength: z.number().min(0).max(1).optional(),
  corroboration: z.number().min(0).max(1).optional(),
  verification_status: z.number().min(0).max(1).optional(),
});

// list_todos / list_ready
inputSchema: {}

// get_task
inputSchema: { key: z.string().regex(/^TASK-\d{3,}$/) }

// create_task
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
}

// transition_status
inputSchema: { key: z.string(), status: STATUS }

// append_comment
inputSchema: { key: z.string(), author: z.string(), body: z.string() }

// close_task (TASK-082)
inputSchema: {
  key: z.string(),
  comment: z.object({ author: z.string(), body: z.string() }),
  linked_commits: z.array(z.string()).optional(),
  linked_prs: z.array(z.string()).optional(),
}

// kb_lookup (TASK-106)
inputSchema: { question: z.string() }
```

## WILL / WON'T docstring (AC4) — put this at the top of src/mcp-server.js

A non-Claude-Code MCP client (claude.ai, Claude Desktop, any MCP host) **WILL**
get the seven task-store tools: read the backlog, read/create tickets, transition
status, append comments, and atomically close a ticket (`close_task`) — full CRUD
on the ticket store — plus, since TASK-106, an eighth tool, `kb_lookup`, that
looks up the local grep knowledge base (not ticket CRUD, but still exposed to
any MCP client). It **WON'T** get the
orchestrator → developer/reviewer/researcher subagent loop, the RESUME-FIRST
session-state orchestration, or the TDD-enforced dev loop — those are Claude
Code-exclusive file-based constructs that MCP cannot install or drive. In one
line: the MCP seam turns the framework's *ticket store* (plus one KB-lookup
tool) into a cross-client API, but the *orchestration* stays Claude Code-only.
