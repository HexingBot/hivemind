// src/graph-freshness.js
// TASK-169 — graph-freshness sensor: pure logic to detect done tickets in
// tasks/ that have no corresponding task-<digits> node in
// knowledge/graph/graph.json. Nothing previously kept the graph synced to the
// task store; the write-at-close protocol was convention, not code. This
// module converts that silent drift into a caught defect at the test:all gate
// (see tests/graph-freshness.spec.js).
//
// ID CONVENTION: mirrors src/graph-id-migration.js's canonical task shape —
// task-<digits>, where <digits> is taken verbatim (including any leading
// zeros) from the ticket key's numeric suffix. e.g. TASK-001 -> task-001,
// TASK-104 -> task-104. This matches the TASK_UPPER_RE derivation in
// src/graph-id-migration.js's deriveCanonicalId (task-032 style, not
// zero-stripped).
//
// This module performs NO disk I/O — callers (the sensor spec, backfill
// scripts) own loading tasks/*.json and knowledge/graph/graph.json.

const TASK_KEY_RE = /^TASK-(\d+)$/;

/**
 * Derive the canonical graph node id for a task store key.
 * Returns null when the key doesn't match the TASK-<digits> shape.
 *
 * @param {string} key
 * @returns {string|null}
 */
export function taskKeyToNodeId(key) {
  const m = TASK_KEY_RE.exec(String(key));
  if (!m) return null;
  return `task-${m[1]}`;
}

/**
 * Return the ticket keys with status 'done' that either (a) have no
 * corresponding task-<digits> node in the graph, or (b) have a key that
 * doesn't even match the TASK-<digits> shape (a malformed key). Tickets in
 * any other status (todo, in_progress, blocked, in_review) are never
 * flagged, per AC2.
 *
 * TASK-175 item 13 — a malformed done-ticket key used to be silently
 * skipped: taskKeyToNodeId(key) returns null for it, and the old guard
 * (`nodeId !== null && !nodeIds.has(nodeId)`) only ever pushed when a real
 * node id was derived, so a malformed key escaped detection forever instead
 * of failing the sensor closed. A malformed key is folded into the same
 * `missing` bucket now, by the same reasoning as a truly-missing node: the
 * sensor cannot prove a graph node exists for it, so it must not pass
 * silently — the malformed key itself is the defect to surface and fix.
 *
 * @param {{tasks: Array<{key: string, status: string}>,
 *          graph: {nodes: Array<{id: string}>}}} opts
 * @returns {string[]} ticket keys missing a graph node (including malformed
 *   keys), in input order
 */
export function findDoneTicketsMissingGraphNodes({ tasks, graph }) {
  const nodeIds = new Set((graph?.nodes ?? []).map((n) => n.id));
  const missing = [];
  for (const task of tasks ?? []) {
    if (task.status !== 'done') continue;
    const nodeId = taskKeyToNodeId(task.key);
    if (nodeId === null || !nodeIds.has(nodeId)) missing.push(task.key);
  }
  return missing;
}
