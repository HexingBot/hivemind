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
import {
  mkdirSync, readFileSync, existsSync, statSync,
  openSync, closeSync, writeSync, fsyncSync, constants,
} from 'node:fs';
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
    // TASK-085 HIGH — a zero-byte TASK-NNN.json is createTask's exclusive-
    // create reservation window (openSync(O_CREAT|O_EXCL) succeeded but the
    // real payload's writeSync hasn't landed yet — a µs-scale window in
    // normal operation, or a permanent crash-orphan if the process died in
    // it), NOT corruption. Skip it silently rather than throwing an untyped
    // SyntaxError out of JSON.parse(''); sweepTasksTmpFiles reaps a STALE one
    // (age-gated) so it never accretes forever. Non-empty corrupt JSON is
    // UNCHANGED — it still throws (locked policy, see
    // tests/e2e/task-018-corruption-policy.spec.js).
    if (raw.length === 0) continue;
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

// TASK-083 AC3 — only reap tmps older than this. atomicWriteFiles's phase-1/
// phase-2 window (tmp durable on disk, not yet renamed) is real but narrow
// (tens of ms, wider under the Windows EBUSY retry path); 60s comfortably
// clears that window so a sweep never deletes an in-flight write.
const TMP_SWEEP_MIN_AGE_MS = 60000;

/**
 * AC3 — best-effort removal of orphan tasks/*.tmp.* files left behind by an
 * interrupted atomic write. No-op when tasks/ does not exist (a wiped or
 * never-initialized repo is legal). Always resolves; per-file unlink errors
 * are swallowed because this is housekeeping, not a write path.
 *
 * Age-gated (TASK-083): a tmp younger than TMP_SWEEP_MIN_AGE_MS is skipped —
 * it may be a concurrent writer's in-flight atomicWriteFiles() call, not a
 * crash orphan. Only tmps old enough to be safely assumed abandoned are reaped.
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
  const now = Date.now();
  for (const name of entries) {
    if (TMP_FILE_RE.test(name)) {
      const p = join(dir, name);
      try {
        const { mtimeMs } = statSync(p);
        if (now - mtimeMs < TMP_SWEEP_MIN_AGE_MS) continue;
        await unlink(p);
        removed.push(name);
      } catch {
        // Best-effort — another writer may have already promoted/removed it,
        // or the stat/unlink raced with it in some other way.
      }
    } else if (TASK_FILENAME_RE.test(name)) {
      // TASK-085 HIGH — reap a STALE zero-byte TASK-NNN.json: the residual
      // window of createTask's exclusive-create reservation step (see
      // readAllTasks's matching skip-zero-byte comment). Same age-gate as tmp
      // reaping — a FRESH zero-byte file may be another writer's in-flight
      // reservation, not a crash orphan. Non-zero-byte files are untouched
      // (this branch never reaps a real, populated task file).
      const p = join(dir, name);
      try {
        const st = statSync(p);
        if (st.size !== 0) continue;
        if (now - st.mtimeMs < TMP_SWEEP_MIN_AGE_MS) continue;
        await unlink(p);
        removed.push(name);
      } catch {
        // Best-effort — another writer may have already completed/removed it.
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
 * TASK-107 (L1) — thrown by listReady when a task's depends_on references a
 * key absent from the on-disk task set. Mirrors the contract src/drive-loop.js's
 * depsAreDone already established for the same "dangling depends_on" defect
 * class (TASK-096, R1 HIGH): a depKey with no matching on-disk task can never
 * reach status='done', so silently excluding the ticket from list_ready left
 * it invisibly stranded with no signal why. Failing loudly here (rather than
 * a third silent-omission convention) surfaces the typo/removed-task bug at
 * the call site instead. `.code` lets callers (and tests) distinguish this
 * from any other listReady failure programmatically, same convention as
 * KeyCollisionError/UatGuardError above.
 */
export class DanglingDependencyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DanglingDependencyError';
    this.code = 'E_DANGLING_DEPENDS_ON';
  }
}

/**
 * AC4 — return all status=='todo' tasks whose depends_on entries each point at
 * an existing on-disk task with status=='done'. Tasks with no depends_on are
 * trivially ready. A depends_on key that resolves to an existing task but is
 * not yet 'done' is the normal in-progress case (excluded, no throw). A
 * depends_on key with NO matching on-disk task at all is a dangling reference
 * (typo, or the dep was deleted) — by definition it can never reach 'done', so
 * TASK-107 makes this throw a DanglingDependencyError naming the stranded
 * ticket and the missing dep, instead of silently omitting the ticket from
 * the ready list (mirrors depsAreDone's contract in src/drive-loop.js).
 * Sorted by numeric key (AC6).
 * @throws {DanglingDependencyError} If any todo task's depends_on references
 *   a key absent from the on-disk task set.
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
      if (!dep) {
        throw new DanglingDependencyError(
          `listReady: task ${t.key} depends_on "${depKey}", which does not exist `
          + `as an on-disk task (no tasks/${depKey}.json). Fix the dangling `
          + 'depends_on reference (typo, or the dependency was deleted) — a '
          + 'ticket can never become ready while it points at a task that does '
          + 'not exist.',
        );
      }
      if (dep.status !== 'done') return false;
    }
    return true;
  });
  return ready.sort(numericKeyOrder);
}

/**
 * TASK-085 AC5 — thrown by createTask when a concurrent writer wins the
 * derived-key race, either caught by the pre-write existsSync guard or by the
 * post-write verify-after-write re-read. `.code` lets callers (and tests)
 * distinguish this from any other createTask failure programmatically.
 */
export class KeyCollisionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'KeyCollisionError';
    this.code = 'E_KEY_COLLISION';
  }
}

/**
 * TASK-082 — thrown by the uat-only done-guard (see checkUatGuard below).
 * Deliberately self-contained (no bundle/operating-mode/loop-auth imports) —
 * task-store.js must not hard-couple to bundle internals. `.code` lets
 * callers (and tests) distinguish this from an incidental /uat/i message
 * match on some other error.
 */
export class UatGuardError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UatGuardError';
    this.code = 'UAT_GUARD_REQUIRED';
  }
}

// TASK-186 AC2/AC6 — harness mode's design assumption is that a human is
// genuinely present, so this stays a LIGHT content check, not the full
// structured per-step machinery loop mode's Gate 2 enforces in
// src/close-guard.js (hasExplicitHumanVerdictMarker): a recognizable verdict
// word must appear in a non-empty body. That is deliberately weaker than
// Gate 2 — the asymmetry is the documented answer to "how does harness mode
// differ from loop mode here": loop mode has no human in the loop by
// definition, so it earns the stricter structured check; harness mode trusts
// a human recorded the comment and only closes the "mere presence of ANY
// author:'uat' comment, regardless of content" hole (an empty body, or a
// body carrying no verdict word at all, no longer satisfies it).
const UAT_VERDICT_WORD_RE = /\bpass\b/i;

// TASK-186 fix round (MEDIUM) — UAT_VERDICT_WORD_RE alone fails open on a
// mixed, honest record: one step "PASS", one step "FAIL", and an explicit
// "Overall result: FAIL" line still contains the word "pass" (from the
// passing step) and satisfied the gate. Reject outright whenever the body
// records an explicit overall FAIL, regardless of any "pass" token
// elsewhere. Corpus-safe: 0 of this repo's 45 real last-uat-comment bodies
// carry an "Overall result: FAIL" line (verified against live tasks/, see
// tests/uat-verdict-marker-compat.spec.js), so this costs nothing against
// real data.
const OVERALL_FAIL_RE = /overall result:?\s*fail/i;

/**
 * TASK-186 — true when task's most recent 'uat'-authored comment has a
 * non-empty body naming a recognizable verdict (the word PASS) and does not
 * itself record an explicit overall FAIL. False when there is no 'uat'
 * comment at all, the body is empty/whitespace-only, the body names no
 * verdict word, or the body states "Overall result: FAIL" — see the doc
 * comment above for why this is a lighter check than close-guard.js's
 * loop-mode Gate 2 marker.
 */
export function hasRecordedUatVerdict(task) {
  const comments = Array.isArray(task && task.comments) ? task.comments : [];
  const uatComments = comments.filter((c) => c && c.author === 'uat');
  if (uatComments.length === 0) return false;
  const last = uatComments[uatComments.length - 1];
  const body = String((last && last.body) || '').trim();
  if (body === '') return false;
  if (OVERALL_FAIL_RE.test(body)) return false;
  return UAT_VERDICT_WORD_RE.test(body);
}

/**
 * TASK-082 (TASK-186 hardened) — a task whose verification_tier is
 * 'uat-only' may only reach 'done' once its most recent comment authored
 * 'uat' records a recognizable verdict (see hasRecordedUatVerdict).
 * Self-contained: reads only task.verification_tier + task.comments, no
 * bundle/session access. Throws UatGuardError; callers run this BEFORE any
 * mutation/write so a thrown guard leaves the task file untouched.
 */
function checkUatGuard(task) {
  if (task.verification_tier !== 'uat-only') return;
  if (!hasRecordedUatVerdict(task)) {
    throw new UatGuardError(
      `task ${task.key} is verification_tier "uat-only" and cannot transition to "done" without its `
        + 'most recent "uat" comment recording a recognizable verdict (a non-empty body naming a PASS result)',
    );
  }
}

/**
 * AC2 (single-writer) — set a task's status, bump updated_at, regenerate the
 * index. Validates the status enum before touching disk; throws on unknown
 * key with the key string in the message. The constructed payload is run
 * through ajv against tasks/schema.json BEFORE the atomic write so a bad
 * timestamp (or any other schema violation) leaves on-disk bytes unchanged.
 *
 * TASK-082 — when status === 'done': the uat-only done-guard runs
 * unconditionally first, then (if provided) `closeGuard({ repoRoot, task,
 * key })` runs and may throw to block the transition. Both checks run BEFORE
 * any disk I/O. Transitions to any other status never run either guard.
 * task-store.js imports NOTHING from bundle/operating-mode/loop-auth/
 * close-guard — `closeGuard` is an injected seam so this module stays
 * decoupled from session/bundle internals (the MCP layer supplies
 * loopModeCloseGuard).
 */
export async function transitionStatus({
  repoRoot,
  key,
  status,
  now = () => new Date().toISOString(),
  closeGuard,
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

  if (status === 'done') {
    checkUatGuard(task);
    if (typeof closeGuard === 'function') {
      await closeGuard({ repoRoot, task, key });
    }
  }

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

// Commit sha shape check for closeTask's linked_commits — 7 to 40 lowercase
// or uppercase hex chars (short or full sha).
const COMMIT_SHA_RE = /^[0-9a-f]{7,40}$/i;

/**
 * TASK-082 (AC3) — close out a task in a single validate-then-atomic pass:
 * status -> 'done', append the closing comment, append linked_commits/
 * linked_prs, bump updated_at, regenerate index.json. ALL validation (unknown
 * key, the uat-only done-guard, the optional closeGuard, and the commit-sha
 * shape check on every linked_commits entry) happens BEFORE any disk I/O, so
 * any failure leaves both the task file and index.json byte-unchanged — this
 * is deliberately NOT a sequence of transitionStatus/appendComment calls
 * (each of which would be its own atomic write and could leave a partial
 * close on a mid-sequence failure).
 */
export async function closeTask({
  repoRoot,
  key,
  comment,
  linked_commits = [],
  linked_prs = [],
  now = () => new Date().toISOString(),
  closeGuard,
}) {
  // SINGLE-WRITER: see module header.
  const allTasks = await readAllTasks(repoRoot);
  const task = allTasks.find((t) => t.key === key);
  if (!task) throw new Error(`unknown task key: ${key}`);

  checkUatGuard(task);
  if (typeof closeGuard === 'function') {
    await closeGuard({ repoRoot, task, key });
  }

  for (const sha of linked_commits) {
    if (typeof sha !== 'string' || !COMMIT_SHA_RE.test(sha)) {
      throw new Error(
        `invalid commit sha ${JSON.stringify(sha)} — must match ${COMMIT_SHA_RE}`,
      );
    }
  }

  const stamp = now();
  const newComment = { author: comment.author, at: stamp, body: comment.body };
  task.status = 'done';
  task.comments = Array.isArray(task.comments) ? [...task.comments, newComment] : [newComment];
  task.linked_commits = Array.isArray(task.linked_commits)
    ? [...task.linked_commits, ...linked_commits]
    : [...linked_commits];
  task.linked_prs = Array.isArray(task.linked_prs)
    ? [...task.linked_prs, ...linked_prs]
    : [...linked_prs];
  task.updated_at = stamp;

  // AC5-style guarantee — validate before any disk I/O.
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
  marker,
  source_tier,
  confidence,
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
    // Spine calibration (Phase 2) — optional; schema-validated below. Enums/ceilings are enforced
    // by validateTaskOrThrow before any disk I/O, and the reviewer runs the calibration validators.
    ...(marker !== undefined ? { marker } : {}),
    ...(source_tier !== undefined ? { source_tier } : {}),
    ...(confidence !== undefined ? { confidence } : {}),
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
  const taskBytes = JSON.stringify(task, null, 2) + '\n';
  const payload = Buffer.from(taskBytes, 'utf8');

  // AC4 (TASK-083) + AC5(a)/(c) + review-HIGH (TASK-085) — collision guard:
  // derivedNextKey() and this write are not atomic, so a concurrent
  // createTask call can win the race for the same key in between. A plain
  // existsSync() check (the original AC4 fix) is ITSELF a check-then-write
  // TOCTOU — a second writer can still slip in between the check and the
  // write. Hardened to a real OS-level exclusive create directly against the
  // derived-key path: O_CREAT|O_EXCL either reserves the slot —
  // deterministically, even against a genuinely concurrent second OS process
  // (see tests/e2e/task-store-resilience.spec.js AC5(c)) — or fails with
  // EEXIST when a competitor already claimed it, exactly like the existsSync
  // check used to, just race-free.
  //
  // review-HIGH fix: the FULL validated payload is written through the SAME
  // reserved fd (write+fsync+close), mirroring writeLockExclusive in
  // src/session-lock.js, INSTEAD of closing the fd empty and relying on a
  // later atomicWriteFiles() rename to fill it in. The earlier design left
  // target sitting at 0 bytes for the entire tmp-write+fsync window (tens of
  // ms) — a concurrent reader (readAllTasks via listTodos/listReady/
  // transitionStatus/createTask) would throw an untyped SyntaxError on
  // JSON.parse(''), and a crash in that window left target permanently empty
  // (unreachable by both the tmp sweep — TASK_FILENAME_RE, not TMP_FILE_RE —
  // and deriveNextKey, which counts it toward maxN forever). Writing the real
  // bytes directly through the reservation fd shrinks that window to the µs
  // between openSync and writeSync; readAllTasks additionally skips a
  // zero-byte task file outright (treats it as an in-flight reservation, not
  // corruption) and sweepTasksTmpFiles reaps a STALE one — see both comments
  // above — closing the residual window completely. atomicWriteFiles is used
  // for index.json only now; the task file never goes through a rename.
  let reserveFd;
  try {
    reserveFd = openSync(target, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  } catch (err) {
    if (err && err.code === 'EEXIST') {
      throw new KeyCollisionError(
        `createTask: key collision — ${target} already exists (a concurrent writer won the race for ${key})`,
      );
    }
    throw err;
  }
  try {
    let written = 0;
    while (written < payload.length) {
      written += writeSync(reserveFd, payload, written, payload.length - written);
    }
    fsyncSync(reserveFd);
  } finally {
    closeSync(reserveFd);
  }

  // Verify-after-write, kept as belt-and-braces (TASK-085 review MEDIUM-1
  // parity with session-lock): a LEGITIMATE second createTask call can never
  // reach this point for the same key (it would have failed EEXIST above),
  // but re-reading and comparing against the exact bytes we intended to write
  // still catches a rogue direct mutation of the just-created file landing in
  // the (tiny, but real) window before we've verified it.
  const onDisk = readFileSync(target, 'utf8');
  if (onDisk !== taskBytes) {
    throw new KeyCollisionError(
      `createTask: verify-after-write detected a competing writer's payload ` +
      `at ${target} (derived-key collision) — our write was overwritten ` +
      'immediately after landing.',
    );
  }

  await atomicWriteFiles([
    { target: indexFilePath(repoRoot), bytes: buildIndexBytes(allTasks, stamp) },
  ]);

  return { key, path: target };
}
