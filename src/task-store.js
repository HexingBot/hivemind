// src/task-store.js
// Local task store adapter (TASK-001). Per-task JSON files under tasks/<key>.json
// are the source of truth; tasks/index.json is a regenerable summary written
// after every mutation. All writes flow through src/atomic-write.js so a crash
// mid-write leaves the on-disk file intact.
//
// TASK-009 hardening pass:
//   - verifyAndRepairIndex hook in listTodos (drift-detect-and-repair).
//   - sweepTasksTmpFiles to reap orphan tasks/*.tmp.* left by interrupted writes.
//   - listReady to surface only tasks whose depends_on are all done.
//   - ajv schema validation BEFORE every atomic write (transitionStatus,
//     appendComment, createTask) so a bad payload never reaches disk.
//   - numericKeyOrder comparator so TASK-999 sorts before TASK-1000.
//   - createTask self-bootstraps tasks/ via mkdirSync(tasksDir, {recursive: true}).
//
// SINGLE-WRITER ASSUMPTION: the framework currently runs exactly one
// orchestrator per repo, so the read-then-write sequence in transitionStatus,
// appendComment, and createTask does NOT defend against TOCTOU races between
// readAllTasks() and atomicWriteFiles(). A sibling task mutated by a second
// concurrent writer between those two calls would be reflected staleley in
// the regenerated index.json. If/when multi-writer support is required, lift
// this assumption via a file-lock (or a database-backed adapter) and remove
// this comment along with the matching note in tasks/README.md.

import {
  readFile, readdir, unlink,
} from 'node:fs/promises';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

// TASK-023 — the task schema is INLINED via a JSON import rather than read at
// runtime from an `import.meta.url`-relative path. esbuild inlines this import
// into the self-contained dist/*.cjs plugin entrypoints, so the bundle carries
// the schema and needs no fs read (under cjs bundling `import.meta.url` is empty
// and the old fileURLToPath read crashed at module init). The `with { type:
// 'json' }` import attribute resolves identically under Vite (vitest), raw Node
// ESM, and esbuild. tasks/schema.json remains the on-disk source of truth.
import __schema from '../tasks/schema.json' with { type: 'json' };

import { atomicWriteFiles } from './atomic-write.js';

// Mirror of tasks/schema.json#/properties/status/enum. Hard-coded to avoid file
// I/O on every call; keep in sync with tasks/schema.json (the source of truth).
const STATUSES = ['todo', 'in_progress', 'in_review', 'blocked', 'done'];
const PRIORITIES = ['low', 'medium', 'high', 'critical'];

// TASK-NNN.json — at least 3 digits, matches the schema's key pattern.
export const TASK_FILENAME_RE = /^TASK-(\d{3,})\.json$/;
// Tmp suffix written by src/atomic-write.js — `${pid}-${randomBytes(6).hex}`.
// The hex tail is 12 lowercase hex chars but we accept the broader shape to
// stay forgiving of future changes to the suffix recipe.
const TMP_FILE_RE = /\.tmp\.[0-9a-f]+(?:-[0-9a-f]+)?$/i;

// ----- ajv compile-once-per-process. The schema is the inlined JSON import
// above (tasks/schema.json) and the validator is reused on every write. -----
const __ajv = new Ajv({ allErrors: true, strict: false });
addFormats(__ajv);
const __validateTask = __ajv.compile(__schema);

/**
 * Validate a task payload against tasks/schema.json. Throws on failure with
 * ajv's error messages joined into the thrown Error's message — the phrase
 * "must match format" is preserved verbatim from ajv-formats so callers (and
 * tests) can match it.
 */
function validateTaskOrThrow(task) {
  const ok = __validateTask(task);
  if (ok) return;
  const errs = __validateTask.errors || [];
  const msg = errs
    .map((e) => `${e.instancePath || '/'} ${e.message}`)
    .join('; ');
  throw new Error(`task payload failed schema validation: ${msg}`);
}

function tasksDir(repoRoot) {
  return join(repoRoot, 'tasks');
}

function taskFilePath(repoRoot, key) {
  return join(tasksDir(repoRoot), `${key}.json`);
}

function indexFilePath(repoRoot) {
  return join(tasksDir(repoRoot), 'index.json');
}

/**
 * AC6 — compare two task-shaped objects (or strings) by the trailing integer
 * of their `key` field (or themselves if strings). Falls back to a stable
 * string compare when the regex can't extract an integer.
 */
export function numericKeyOrder(a, b) {
  const ka = typeof a === 'string' ? a : a.key;
  const kb = typeof b === 'string' ? b : b.key;
  const ma = /-(\d+)$/.exec(ka);
  const mb = /-(\d+)$/.exec(kb);
  if (ma && mb) {
    const na = parseInt(ma[1], 10);
    const nb = parseInt(mb[1], 10);
    if (na !== nb) return na - nb;
    return 0;
  }
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

/**
 * Read every per-task file under tasks/, skipping schema.json and index.json.
 * Returns objects in undefined order — callers sort as needed.
 */
async function readAllTasks(repoRoot) {
  const dir = tasksDir(repoRoot);
  let entries;
  try {
    entries = await readdir(dir);
  } catch (err) {
    if (err && err.code === 'ENOENT') return [];
    throw err;
  }
  const taskFiles = entries.filter((name) => TASK_FILENAME_RE.test(name));
  const out = [];
  for (const name of taskFiles) {
    const raw = await readFile(join(dir, name), 'utf8');
    out.push(JSON.parse(raw));
  }
  return out;
}

/**
 * Build the tasks/index.json payload from a list of task objects.
 * Shape: { generated_at, tasks: [{key, title, status, priority}] } sorted by
 * the trailing numeric portion of the key (AC6).
 * Returned as a string ready for atomic write.
 */
function buildIndexBytes(tasks, generatedAt) {
  const summary = tasks
    .map((t) => ({
      key: t.key,
      title: t.title,
      status: t.status,
      priority: t.priority,
    }))
    .sort(numericKeyOrder);
  return JSON.stringify({ generated_at: generatedAt, tasks: summary }, null, 2) + '\n';
}

/**
 * AC1 — drift detection between tasks/*.json (source of truth) and
 * tasks/index.json (regenerable summary). If the index disagrees with the
 * file set OR an index entry is missing one of the required summary fields,
 * regenerate index.json from the file set via atomicWriteFile. Otherwise this
 * is a no-op (happy path — no spurious mtime churn).
 *
 * Returns true if a repair was performed, false if the index was already in sync.
 */
async function verifyAndRepairIndex(repoRoot, tasks, now = () => new Date().toISOString()) {
  const idxPath = indexFilePath(repoRoot);
  if (!existsSync(idxPath)) {
    // No index yet — only repair (write a fresh one) if there ARE on-disk tasks.
    // An empty repo with no tasks AND no index is a legitimate idle state.
    if (tasks.length === 0) return false;
    const stamp = now();
    await atomicWriteFiles([
      { target: idxPath, bytes: buildIndexBytes(tasks, stamp) },
    ]);
    return true;
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(idxPath, 'utf8'));
  } catch {
    // Corrupt index — regenerate.
    const stamp = now();
    await atomicWriteFiles([
      { target: idxPath, bytes: buildIndexBytes(tasks, stamp) },
    ]);
    return true;
  }
  const indexEntries = Array.isArray(parsed.tasks) ? parsed.tasks : [];
  const fileKeys = tasks.map((t) => t.key).sort();
  const idxKeys = indexEntries.map((e) => e && e.key).filter(Boolean).sort();

  let drift = false;
  if (fileKeys.length !== idxKeys.length) {
    drift = true;
  } else {
    for (let i = 0; i < fileKeys.length; i++) {
      if (fileKeys[i] !== idxKeys[i]) { drift = true; break; }
    }
  }
  if (!drift) {
    // Also check that every index entry carries the required summary fields.
    for (const e of indexEntries) {
      if (!e || typeof e.key !== 'string' || typeof e.title !== 'string'
        || typeof e.status !== 'string' || typeof e.priority !== 'string') {
        drift = true;
        break;
      }
    }
  }
  if (!drift) return false;

  const stamp = now();
  await atomicWriteFiles([
    { target: idxPath, bytes: buildIndexBytes(tasks, stamp) },
  ]);
  return true;
}

/**
 * AC3 — best-effort removal of orphan tasks/*.tmp.* files left behind by an
 * interrupted atomic write. No-op when tasks/ does not exist (a wiped or
 * never-initialized repo is legal). Always resolves; per-file unlink errors
 * are swallowed because this is housekeeping, not a write path.
 */
export async function sweepTasksTmpFiles({ repoRoot }) {
  const dir = tasksDir(repoRoot);
  let entries;
  try {
    entries = await readdir(dir);
  } catch (err) {
    if (err && err.code === 'ENOENT') return { removed: [] };
    throw err;
  }
  const removed = [];
  for (const name of entries) {
    if (TMP_FILE_RE.test(name)) {
      try {
        await unlink(join(dir, name));
        removed.push(name);
      } catch {
        // Best-effort — another writer may have already promoted/removed it.
      }
    }
  }
  return { removed };
}

/**
 * AC1 + AC3 + AC6 — return all tasks with status=='todo', sorted by the
 * trailing numeric portion of the key. Sources from the per-task files;
 * index.json is intentionally ignored for the result set so a stale or
 * missing index never poisons planning. Side effects (housekeeping):
 *   1. sweepTasksTmpFiles  — reap orphan tmp files.
 *   2. verifyAndRepairIndex — rewrite index.json if it disagrees with the file set.
 */
export async function listTodos({ repoRoot }) {
  // AC3 — housekeeping hook at the very top so every read trims orphans
  // before any subsequent fs op can race against them.
  await sweepTasksTmpFiles({ repoRoot });

  const tasks = await readAllTasks(repoRoot);

  // AC1 — drift-detect-and-repair before returning anything to the caller.
  await verifyAndRepairIndex(repoRoot, tasks);

  return tasks
    .filter((t) => t.status === 'todo')
    .sort(numericKeyOrder);
}

/**
 * AC4 — return all status=='todo' tasks whose depends_on entries each point at
 * an existing on-disk task with status=='done'. Tasks with no depends_on are
 * trivially ready. A depends_on key with no matching on-disk file is by
 * definition unsatisfied (the dep can never reach done), so the task is
 * excluded. Sorted by numeric key (AC6).
 */
export async function listReady({ repoRoot }) {
  // Mirror the listTodos housekeeping so listReady is a safe stand-alone call
  // from the orchestrator without first calling listTodos.
  await sweepTasksTmpFiles({ repoRoot });
  const tasks = await readAllTasks(repoRoot);
  await verifyAndRepairIndex(repoRoot, tasks);

  const byKey = new Map(tasks.map((t) => [t.key, t]));
  const ready = tasks.filter((t) => {
    if (t.status !== 'todo') return false;
    const deps = Array.isArray(t.depends_on) ? t.depends_on : [];
    for (const depKey of deps) {
      const dep = byKey.get(depKey);
      if (!dep) return false; // unknown dep -> unsatisfied
      if (dep.status !== 'done') return false;
    }
    return true;
  });
  return ready.sort(numericKeyOrder);
}

/**
 * AC2 (single-writer) — set a task's status, bump updated_at, regenerate the
 * index. Validates the status enum before touching disk; throws on unknown
 * key with the key string in the message. The constructed payload is run
 * through ajv against tasks/schema.json BEFORE the atomic write so a bad
 * timestamp (or any other schema violation) leaves on-disk bytes unchanged.
 */
export async function transitionStatus({
  repoRoot,
  key,
  status,
  now = () => new Date().toISOString(),
}) {
  if (!STATUSES.includes(status)) {
    throw new Error(
      `invalid status "${status}" — must be one of ${STATUSES.join(', ')}`,
    );
  }
  // SINGLE-WRITER: readAllTasks -> mutate -> atomicWriteFiles is NOT race-safe
  // against a concurrent writer. See the module header for the full rationale.
  const allTasks = await readAllTasks(repoRoot);
  const task = allTasks.find((t) => t.key === key);
  if (!task) throw new Error(`unknown task key: ${key}`);

  const stamp = now();
  task.status = status;
  task.updated_at = stamp;

  // AC5 — validate before any disk I/O.
  validateTaskOrThrow(task);

  await atomicWriteFiles([
    { target: taskFilePath(repoRoot, key), bytes: JSON.stringify(task, null, 2) + '\n' },
    { target: indexFilePath(repoRoot), bytes: buildIndexBytes(allTasks, stamp) },
  ]);
}

/**
 * AC2 (single-writer) — append a {author, at, body} comment to a task, bump
 * updated_at, regenerate the index. Existing comments are preserved verbatim
 * and in order; the new comment is pushed at the end. Same ajv validate-before-
 * write guarantee as transitionStatus.
 */
export async function appendComment({
  repoRoot,
  key,
  author,
  body,
  now = () => new Date().toISOString(),
}) {
  // SINGLE-WRITER: see module header.
  const allTasks = await readAllTasks(repoRoot);
  const task = allTasks.find((t) => t.key === key);
  if (!task) throw new Error(`unknown task key: ${key}`);

  const stamp = now();
  const comment = { author, at: stamp, body };
  task.comments = Array.isArray(task.comments) ? [...task.comments, comment] : [comment];
  task.updated_at = stamp;

  // AC5 — validate before any disk I/O.
  validateTaskOrThrow(task);

  await atomicWriteFiles([
    { target: taskFilePath(repoRoot, key), bytes: JSON.stringify(task, null, 2) + '\n' },
    { target: indexFilePath(repoRoot), bytes: buildIndexBytes(allTasks, stamp) },
  ]);
}

/**
 * Derive the next task key by scanning tasks/ for TASK-NNN.json filenames,
 * finding the max numeric suffix, and incrementing by 1. Non-matching files
 * (schema.json, index.json, README.md, .tmp files, etc.) are ignored entirely.
 * Padding width is max(3, digits(next)) so 999 -> "TASK-1000".
 */
async function deriveNextKey(repoRoot) {
  const dir = tasksDir(repoRoot);
  let entries;
  try {
    entries = await readdir(dir);
  } catch (err) {
    if (err && err.code === 'ENOENT') entries = [];
    else throw err;
  }
  let maxN = 0;
  for (const name of entries) {
    const m = TASK_FILENAME_RE.exec(name);
    if (!m) continue;
    const n = parseInt(m[1], 10);
    if (n > maxN) maxN = n;
  }
  const next = maxN + 1;
  const width = Math.max(3, String(next).length);
  return `TASK-${String(next).padStart(width, '0')}`;
}

/**
 * Create a new task: derive next key, validate inputs, write the task file
 * and regenerate index.json — both writes flow through a single
 * atomicWriteFiles() call so the two-phase invariant holds (all fsyncs before
 * any rename). Validation happens BEFORE any disk write so a bad call leaves
 * the store untouched.
 *
 * AC7 — self-bootstraps tasks/ via mkdirSync(..., {recursive: true}) before
 * the first atomic write so callers on a fresh repo (no prior task store)
 * don't ENOENT on the sibling tmp file. Callers like src/backlog-seeder.js
 * no longer need their own mkdir workaround.
 *
 * AC5 — validates the constructed payload against tasks/schema.json BEFORE
 * the atomic write so a bad timestamp leaves the store untouched.
 */
// Mirror of tasks/schema.json#/properties/verification_tier/enum.
const VERIFICATION_TIERS = ['tdd', 'tests-after', 'uat-only'];

export async function createTask({
  repoRoot,
  title,
  description,
  acceptance_criteria,
  priority,
  labels = [],
  depends_on = [],
  verification_tier,
  now = () => new Date().toISOString(),
}) {
  // Validate enums + required-array shape before touching disk.
  if (!Array.isArray(acceptance_criteria) || acceptance_criteria.length === 0) {
    throw new Error(
      'acceptance_criteria must be a non-empty array (schema minItems: 1)',
    );
  }
  if (!PRIORITIES.includes(priority)) {
    throw new Error(
      `invalid priority "${priority}" — must be one of ${PRIORITIES.join(', ')}`,
    );
  }
  if (verification_tier !== undefined && !VERIFICATION_TIERS.includes(verification_tier)) {
    throw new Error(
      `invalid verification_tier "${verification_tier}" — must be one of ${VERIFICATION_TIERS.join(', ')}`,
    );
  }

  const key = await deriveNextKey(repoRoot);
  const stamp = now(); // Single call so created_at === updated_at byte-for-byte.

  const task = {
    key,
    title,
    description,
    acceptance_criteria,
    status: 'todo',
    priority,
    labels,
    assignee: null,
    depends_on,
    linked_commits: [],
    linked_prs: [],
    comments: [],
    created_at: stamp,
    updated_at: stamp,
    jira_key: null,
    ...(verification_tier !== undefined ? { verification_tier } : {}),
  };

  // AC5 — schema validate BEFORE any disk I/O so a bad payload (e.g. a `now`
  // that returns a non-ISO string) leaves the store untouched.
  validateTaskOrThrow(task);

  // Read existing tasks AFTER validation so we don't pay the I/O on bad input.
  const existing = await readAllTasks(repoRoot);
  const allTasks = [...existing, task];

  // AC7 — self-bootstrap tasks/ before the first atomic write. A fresh repo
  // with no tasks/ would otherwise ENOENT on atomic-write's sibling tmp file.
  mkdirSync(tasksDir(repoRoot), { recursive: true });

  const target = taskFilePath(repoRoot, key);
  await atomicWriteFiles([
    { target, bytes: JSON.stringify(task, null, 2) + '\n' },
    { target: indexFilePath(repoRoot), bytes: buildIndexBytes(allTasks, stamp) },
  ]);

  return { key, path: target };
}
