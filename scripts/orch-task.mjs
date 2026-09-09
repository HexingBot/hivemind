#!/usr/bin/env node
/**
 * Orchestrator-side thin CLI over src/task-store.js.
 *
 * Same validated code path the MCP task-store server wraps (ajv validation +
 * every mutation-seam guard + tasks/index.json regen) — NOT the degraded raw
 * `Edit` fallback. Exists because the hivemind-tasks MCP server is not
 * reachable in this session.
 *
 *   node scripts/orch-task.mjs transition <KEY> <status>
 *   node scripts/orch-task.mjs comment <KEY> <author>   # body on stdin
 *   node scripts/orch-task.mjs close <KEY> <sha,sha>    # body on stdin
 */
import { readFileSync } from 'node:fs'
import { transitionStatus, appendComment, closeTask } from '../src/task-store.js'

const repoRoot = process.cwd()
const [op, key, arg] = process.argv.slice(2)
const stdin = () => readFileSync(0, 'utf8').trim()

const ops = {
  transition: () => transitionStatus({ repoRoot, key, status: arg }),
  comment: () => appendComment({ repoRoot, key, author: arg, body: stdin() }),
  close: () =>
    closeTask({
      repoRoot,
      key,
      comment: { author: 'orchestrator', body: stdin() },
      linked_commits: arg ? arg.split(',').filter(Boolean) : [],
    }),
}

if (!ops[op]) {
  console.error(`unknown op: ${op}`)
  process.exit(2)
}

try {
  await ops[op]()
  console.log(JSON.stringify({ ok: true, op, key }))
} catch (err) {
  console.error(JSON.stringify({ ok: false, code: err.code ?? null, message: err.message }))
  process.exit(1)
}
