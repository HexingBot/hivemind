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

/**
 * Phase/consolidation hard-stop (Phase 6). An autonomous run must never barrel past a
 * consolidation checkpoint: every `consolidateEvery` completed tickets the loop pauses so the
 * human can consolidate (review the batch, update the knowledge base) before the next phase.
 * Conservative by default — lifted only when the human has granted `autoConsolidate`, mirroring
 * the loop_auth gates. Returns { stop, reason }; reason is the empty string when not stopping.
 *
 * @param {{ completedThisRun: number, consolidateEvery?: number, autoConsolidate?: boolean }} opts
 * @returns {{ stop: boolean, reason: string }}
 */
export function consolidationGate({
  completedThisRun,
  consolidateEvery = 5,
  autoConsolidate = false,
}) {
  if (autoConsolidate) return { stop: false, reason: '' };
  if (consolidateEvery > 0 && completedThisRun > 0 && completedThisRun % consolidateEvery === 0) {
    return {
      stop: true,
      reason: `Consolidation checkpoint: ${completedThisRun} tickets completed this run (every ${consolidateEvery}). Pausing for human consolidation — review the batch and update the knowledge base, then resume. Grant auto_consolidate to lift this gate.`,
    };
  }
  return { stop: false, reason: '' };
}

/**
 * Loop-until-dry (Phase 6): run research rounds until `maxDryRounds` CONSECUTIVE rounds find
 * nothing new, bounded by `maxRounds`. This is the inner research loop the outer drive-loop wraps
 * — a simple round counter misses the tail; dry-streak counting is what makes research "deep".
 * `runRound(roundIndex)` returns the count of new facts admitted that round.
 *
 * @param {{ runRound: (i: number) => Promise<number>, maxDryRounds?: number, maxRounds?: number }} opts
 * @returns {Promise<{ rounds: number, dryStreak: number, totalNew: number, reason: string }>}
 */
export async function loopUntilDry({ runRound, maxDryRounds = 2, maxRounds = 10 }) {
  let rounds = 0;
  let dryStreak = 0;
  let totalNew = 0;
  while (rounds < maxRounds && dryStreak < maxDryRounds) {
    const newFacts = await runRound(rounds);
    rounds += 1;
    totalNew += newFacts;
    dryStreak = newFacts > 0 ? 0 : dryStreak + 1;
  }
  const reason = dryStreak >= maxDryRounds
    ? `dry: ${maxDryRounds} consecutive round(s) found nothing new`
    : `round cap reached (${rounds}/${maxRounds})`;
  return { rounds, dryStreak, totalNew, reason };
}
