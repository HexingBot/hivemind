// Wargame harness — hive-adversarial-improve, rule 1: the live pipeline is the
// REAL shipped code, composed exactly as src/mcp-server.js composes it.
//
//   transition_status -> transitionStatus({ ..., closeGuard: loopModeCloseGuard, exception })
//   append_comment    -> await loopModeUatCommentGuard({ repoRoot, author }); appendComment(...)
//   close_task        -> await loopModeUatCommentGuard({ repoRoot, author: comment.author });
//                        closeTask({ ..., closeGuard: loopModeCloseGuard })
//
// Nothing here reimplements a guard. If a probe passes, it passed the shipped path.

import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';

const REPO = 'C:/Fun/hivemind/hivemind';
const src = (f) => pathToFileURL(join(REPO, 'src', f)).href;

const store = await import(src('task-store.js'));
const guards = await import(src('close-guard.js'));

const { createTask, appendComment, transitionStatus, closeTask } = store;
const { loopModeCloseGuard, loopModeUatCommentGuard } = guards;

let seq = 0;
const madeDirs = [];

/** Fresh temp repo with a real schema, in the requested operating mode. */
export function makeRepo({ mode = 'harness', loopAuth, sessionId = '20260702T120000Z-wargame' } = {}) {
  const root = join(tmpdir(), `wargame-${process.pid}-${++seq}-${Date.now()}`);
  madeDirs.push(root);
  mkdirSync(join(root, 'tasks'), { recursive: true });
  mkdirSync(join(root, 'state', 'sessions', sessionId), { recursive: true });

  // real schema, not a fixture copy
  copyFileSync(join(REPO, 'tasks', 'schema.json'), join(root, 'tasks', 'schema.json'));

  writeFileSync(
    join(root, 'state', 'session.json'),
    JSON.stringify({ schema_version: 2, active_session_id: sessionId, updated_at: '2026-07-02T12:00:00Z' }, null, 2),
  );
  writeFileSync(
    join(root, 'state', 'sessions', sessionId, 'session.json'),
    JSON.stringify({
      schema_version: 2, session_id: sessionId, lifecycle_state: 'active',
      updated_at: '2026-07-02T12:00:00Z', active_task: null, workflow_step: 'impl',
      next_action: 'wargame', handoff_summary: 'wargame', open_questions: [], blockers: [],
      decisions: [], subagent_results: [], pending_human_confirmation: null,
      ...(mode !== undefined ? { mode } : {}),
      ...(loopAuth !== undefined ? { loop_auth: loopAuth } : {}),
    }, null, 2),
  );
  return root;
}

/** The four tool surfaces, composed as mcp-server.js composes them. */
export const tools = {
  async create_task(repoRoot, args) {
    return createTask({ repoRoot, ...args });
  },
  async append_comment(repoRoot, { key, author, body }) {
    await loopModeUatCommentGuard({ repoRoot, author });          // mcp-server.js:456
    return appendComment({ repoRoot, key, author, body });
  },
  async transition_status(repoRoot, { key, status, exception }) {
    return transitionStatus({ repoRoot, key, status, closeGuard: loopModeCloseGuard, exception }); // :431
  },
  async close_task(repoRoot, { key, comment, linked_commits, linked_prs, exception }) {
    if (comment) await loopModeUatCommentGuard({ repoRoot, author: comment.author }); // :511
    return closeTask({
      repoRoot, key, comment, linked_commits, linked_prs, exception,
      closeGuard: loopModeCloseGuard,                                                  // :518
    });
  },
};

export function readTask(repoRoot, key) {
  return JSON.parse(readFileSync(join(repoRoot, 'tasks', `${key}.json`), 'utf8'));
}

/**
 * Run one probe: a named sequence of { tool, args } steps.
 * Returns { reachedDone, steps: [...], finalTask } — never throws.
 */
export async function runProbe({ id, mode = 'harness', loopAuth, steps }) {
  const repoRoot = makeRepo({ mode, loopAuth });
  const log = [];
  let key = null;

  for (const step of steps) {
    const args = { ...step.args };
    if (key && args.key === '$KEY') args.key = key;
    try {
      const out = await tools[step.tool](repoRoot, args);
      if (out && out.key && !key) key = out.key;
      log.push({ tool: step.tool, ok: true, result: out && out.key ? { key: out.key } : (out ?? null) });
    } catch (err) {
      log.push({ tool: step.tool, ok: false, code: err.code || err.name, message: String(err.message).slice(0, 200) });
      if (step.stopOnError !== false) break;
    }
  }

  let finalTask = null;
  try { finalTask = key ? readTask(repoRoot, key) : null; } catch { /* not created */ }

  return {
    id,
    reachedDone: finalTask?.status === 'done',
    finalStatus: finalTask?.status ?? '(no task)',
    commentAuthors: (finalTask?.comments || []).map((c) => c.author),
    linkedCommits: finalTask?.linked_commits ?? [],
    steps: log,
    repoRoot,
  };
}

export function cleanup() {
  for (const d of madeDirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } }
}

export function report(r) {
  const verdict = r.reachedDone ? 'REACHED done' : `blocked at ${r.finalStatus}`;
  console.log(`\n[${r.id}] ${verdict}`);
  for (const s of r.steps) {
    console.log(`   ${s.ok ? 'ok  ' : 'FAIL'} ${s.tool}${s.ok ? '' : `  -> ${s.code}: ${s.message}`}`);
  }
  if (r.commentAuthors.length) console.log(`   comment authors: ${JSON.stringify(r.commentAuthors)}`);
  if (r.linkedCommits.length) console.log(`   linked_commits : ${JSON.stringify(r.linkedCommits)}`);
}
