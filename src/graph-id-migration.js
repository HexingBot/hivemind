// src/graph-id-migration.js
// TASK-104 — one canonical id convention for knowledge/graph/graph.json, plus
// the pure mechanics behind the one-time migration off the legacy mixed
// convention (uppercase `TASK-<n>` task keys, raw ISO decision timestamps).
//
// CANONICAL ID SHAPES (per node type — documented identically in the
// orchestrator-routing skill's close-protocol section and the graphify skill):
//   task            -> task-<digits>             e.g. task-104
//   decision        -> decision-<YYYYMMDD>-<slug> e.g. decision-20260704-release-v0-10-0-minor-bump
//   skill           -> skill-<slug>               e.g. skill-graphify
//   knowledge_entry -> ke-<slug>                  e.g. ke-windows-atomic-rename
//
// DECISION SLUG DERIVATION (mechanical, deterministic — same input always
// produces the same output, no lookups, no randomness):
//   1. date part = the raw-ISO id's leading YYYY-MM-DD with dashes stripped.
//   2. If the label itself restates that same "YYYY-MM-DD " prefix, strip it
//      first (avoids a redundant date appearing twice in the slug).
//   3. Lowercase the remaining label, collapse every run of non [a-z0-9]
//      characters into a single space, split into words, drop empties.
//   4. Take the first 6 words and join with '-'.
//   5. slug id = `decision-${datePart}-${first6Words.join('-')}`.
//
// This module performs NO disk I/O — src/knowledge-graph.js (loadGraph /
// writeGraph) and scripts/migrate-graph-ids.mjs own the file boundary.

const ISO_DATE_ID_RE = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const TASK_UPPER_RE = /^TASK-(\d+)$/;

const CANONICAL_PATTERNS = {
  task: /^task-\d+$/,
  decision: /^decision-\d{8}-[a-z0-9-]+$/,
  skill: /^skill-[a-z0-9-]+$/,
  knowledge_entry: /^ke-[a-z0-9-]+$/,
};

/** The canonical id RegExp for a node type, or undefined for an unknown type. */
export function canonicalIdPattern(type) {
  return CANONICAL_PATTERNS[type];
}

/** True when node.id already matches the canonical pattern for node.type. */
export function isCanonicalId(node) {
  const pattern = CANONICAL_PATTERNS[node && node.type];
  if (!pattern) return false;
  return pattern.test(node.id);
}

function deriveDecisionSlug(id, label) {
  const m = ISO_DATE_ID_RE.exec(id);
  if (!m) return null; // not a raw-ISO id — caller decides what to do
  const datePart = `${m[1]}${m[2]}${m[3]}`;
  const isoDatePrefix = `${m[1]}-${m[2]}-${m[3]} `;
  const body = String(label || '').startsWith(isoDatePrefix)
    ? label.slice(isoDatePrefix.length)
    : String(label || '');
  const words = body
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6);
  return `decision-${datePart}-${words.join('-')}`;
}

/**
 * Derive the canonical id for a node under the legacy conventions this ticket
 * fixes. Returns the SAME id when the node is already canonical, or when its
 * shape isn't one of the handled legacy forms (unhandled shapes are left
 * untouched — the AC4 sensor flags anything that still fails
 * `isCanonicalId` after migration).
 *
 * @param {{id: string, type: string, label?: string}} node
 * @returns {string}
 */
export function deriveCanonicalId(node) {
  if (isCanonicalId(node)) return node.id;
  if (node.type === 'task') {
    const m = TASK_UPPER_RE.exec(node.id);
    if (m) return `task-${m[1]}`;
  }
  if (node.type === 'decision') {
    const slug = deriveDecisionSlug(node.id, node.label);
    if (slug) return slug;
  }
  return node.id;
}

/**
 * Pure, mechanical migration over a {nodes, edges} pair. Renames every node id
 * to its canonical form and rewrites every edge endpoint that referenced a
 * renamed id. Never touches `ref`, `label`, `type`, or `relation`.
 *
 * If two distinct original ids happen to derive the SAME canonical id (not
 * expected with the current disjoint uppercase/lowercase task numeric ranges,
 * but guarded for a future re-run), the first node encountered (stable array
 * order) is
 * kept and later collisions are dropped with a console.warn — both original
 * ids still resolve edge endpoints to the kept node, so no edge goes dangling.
 *
 * @param {{nodes: Array, edges: Array}} graph
 * @returns {{nodes: Array, edges: Array, renameMap: Map<string,string>,
 *            before: {nodeCount:number, edgeCount:number},
 *            after: {nodeCount:number, edgeCount:number}}}
 */
export function migrateGraphIds({ nodes, edges }) {
  const before = { nodeCount: nodes.length, edgeCount: edges.length };
  const renameMap = new Map();
  const seenCanonical = new Map(); // canonicalId -> kept node
  const migratedNodes = [];

  for (const node of nodes) {
    const canonicalId = deriveCanonicalId(node);
    if (canonicalId !== node.id) renameMap.set(node.id, canonicalId);
    const existing = seenCanonical.get(canonicalId);
    if (existing) {
      // eslint-disable-next-line no-console
      console.warn(
        `migrateGraphIds: dropping duplicate node "${node.id}" -> "${canonicalId}" ` +
          `(already kept "${existing.id}")`,
      );
      continue;
    }
    const migrated = { ...node, id: canonicalId };
    seenCanonical.set(canonicalId, migrated);
    migratedNodes.push(migrated);
  }

  const resolve = (oldId) => renameMap.get(oldId) ?? oldId;
  const migratedEdges = edges.map((edge) => ({
    ...edge,
    from: resolve(edge.from),
    to: resolve(edge.to),
  }));

  const after = { nodeCount: migratedNodes.length, edgeCount: migratedEdges.length };
  return {
    nodes: migratedNodes, edges: migratedEdges, renameMap, before, after,
  };
}

/**
 * AC4 sensor helper: returns an array of human-readable violation strings —
 * empty when every node id matches its type's canonical pattern AND every
 * edge endpoint resolves to an existing node. Used both by the fast-tier
 * sensor spec and by scripts/migrate-graph-ids.mjs as a post-migration
 * self-check before the migrated graph is written to disk.
 *
 * @param {{nodes: Array, edges: Array}} graph
 * @returns {string[]}
 */
export function validateCanonicalGraph({ nodes, edges }) {
  const violations = [];
  const idSet = new Set(nodes.map((n) => n.id));

  for (const node of nodes) {
    if (!isCanonicalId(node)) {
      violations.push(
        `node id "${node.id}" (type ${node.type}) does not match the canonical pattern for its type`,
      );
    }
  }
  for (const edge of edges) {
    if (!idSet.has(edge.from)) {
      violations.push(`edge "from" endpoint "${edge.from}" does not resolve to an existing node`);
    }
    if (!idSet.has(edge.to)) {
      violations.push(`edge "to" endpoint "${edge.to}" does not resolve to an existing node`);
    }
  }
  return violations;
}
