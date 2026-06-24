// src/drive-loop.js
// TASK-062 — Pure, testable helpers for the goal-driven autonomous drive loop.
//
// DESIGN: All functions are PURE — they operate on plain task objects passed in
// as arguments and never perform I/O, spawn processes, or call Date.now(). The
// drive loop orchestrator (implemented in the /hivemind:loop command)
// handles all I/O and agentic dispatch; these helpers encode only the non-agentic
// decision logic.
//
// READINESS: selectNextTicket accepts the FULL task list and computes readiness
// internally (a task is ready when status is 'todo' AND every dep in depends_on
// is in the list with status 'done'). This matches the listReady logic in
// src/task-store.js. Callers may also pass a pre-filtered ready list; the helper
// is safe in either case because it re-checks readiness before selecting.
//
// PRIORITY ORDER: critical > high > medium > low. Ties broken by ascending
// numeric key (TASK-001 before TASK-002).

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

const PRIORITY_RANK = { critical: 4, high: 3, medium: 2, low: 1 };

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Extract the trailing integer from a TASK-NNN key for tie-breaking.
 * Returns Infinity if the key doesn't match (sorts last, which is safe).
 */
function keyNumber(key) {
  const m = /-(\d+)$/.exec(key);
  return m ? parseInt(m[1], 10) : Infinity;
}

/**
 * Return true when the task's all depends_on keys are satisfied (status 'done')
 * in the provided task list. Tasks with no depends_on are trivially ready.
 */
function depsAreDone(task, byKey) {
  const deps = Array.isArray(task.depends_on) ? task.depends_on : [];
  for (const depKey of deps) {
    const dep = byKey.get(depKey);
    if (!dep || dep.status !== 'done') return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Determine whether a task belongs to the goal.
 *
 * A goal is one of:
 *   { label: string }   — task must carry that label in its labels array.
 *   { keys: string[] }  — task key must appear in the keys array.
 *
 * @param {object} task  - A plain task object (key, labels, ...).
 * @param {{ label?: string, keys?: string[] }} goal
 * @returns {boolean}
 */
export function matchesGoal(task, goal) {
  if (!task || !goal) return false;
  if (typeof goal.label === 'string') {
    return Array.isArray(task.labels) && task.labels.includes(goal.label);
  }
  if (Array.isArray(goal.keys)) {
    return goal.keys.includes(task.key);
  }
  return false;
}

/**
 * From the full task list (or a pre-filtered ready list), select the ONE task
 * that matches the goal AND is ready (status 'todo', all deps done), ordered by
 * priority (critical > high > medium > low), then by ascending numeric key.
 *
 * @param {object[]} tasks - Array of plain task objects.
 * @param {{ label?: string, keys?: string[] }} goal
 * @returns {object|null} The selected task, or null if none is ready.
 */
export function selectNextTicket(tasks, goal) {
  if (!Array.isArray(tasks) || tasks.length === 0) return null;

  const byKey = new Map(tasks.map((t) => [t.key, t]));

  const candidates = tasks.filter(
    (t) => t.status === 'todo' && matchesGoal(t, goal) && depsAreDone(t, byKey),
  );

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const ra = PRIORITY_RANK[a.priority] ?? 0;
    const rb = PRIORITY_RANK[b.priority] ?? 0;
    if (ra !== rb) return rb - ra; // descending priority
    return keyNumber(a.key) - keyNumber(b.key); // ascending key
  });

  return candidates[0];
}

/**
 * Count done and total goal-matching tasks.
 *
 * @param {object[]} tasks
 * @param {{ label?: string, keys?: string[] }} goal
 * @returns {{ done: number, total: number }}
 */
export function goalProgress(tasks, goal) {
  if (!Array.isArray(tasks)) return { done: 0, total: 0 };
  const matching = tasks.filter((t) => matchesGoal(t, goal));
  const done = matching.filter((t) => t.status === 'done').length;
  return { done, total: matching.length };
}

/**
 * Return true when total > 0 and every goal-matching task is 'done'.
 *
 * @param {object[]} tasks
 * @param {{ label?: string, keys?: string[] }} goal
 * @returns {boolean}
 */
export function goalSatisfied(tasks, goal) {
  const { done, total } = goalProgress(tasks, goal);
  return total > 0 && done === total;
}

/**
 * Return true when the goal is NOT satisfied and selectNextTicket returns null
 * (all remaining goal tickets are blocked, in_review, or have unsatisfied deps).
 * This signals the loop to surface to the human rather than spin.
 *
 * @param {object[]} tasks
 * @param {{ label?: string, keys?: string[] }} goal
 * @returns {boolean}
 */
export function goalStuck(tasks, goal) {
  if (goalSatisfied(tasks, goal)) return false;
  return selectNextTicket(tasks, goal) === null;
}

/**
 * Backstop check: decide whether the loop should stop based on iteration count
 * and consecutive-no-progress count. Returns { stop: boolean, reason: string }.
 * When stop is false, reason is the empty string.
 *
 * Callers MUST surface the reason to the human — no silent truncation.
 *
 * @param {{
 *   iteration: number,
 *   maxIterations: number,
 *   consecutiveNoProgress: number,
 *   maxNoProgress: number,
 * }} opts
 * @returns {{ stop: boolean, reason: string }}
 */
export function shouldStop({
  iteration,
  maxIterations,
  consecutiveNoProgress,
  maxNoProgress,
}) {
  if (iteration >= maxIterations) {
    return {
      stop: true,
      reason: `Hard iteration ceiling reached (${iteration}/${maxIterations}). Loop stopped to avoid unbounded token spend. Review remaining tickets and restart the loop if work should continue.`,
    };
  }
  if (consecutiveNoProgress >= maxNoProgress) {
    return {
      stop: true,
      reason: `Loop made no progress for ${consecutiveNoProgress} consecutive iteration(s) (max allowed: ${maxNoProgress}). This may indicate a dependency cycle, all remaining tickets blocked/in_review, or a persistent reviewer REQUEST-CHANGES. Surfacing to the human for manual review.`,
    };
  }
  return { stop: false, reason: '' };
}
