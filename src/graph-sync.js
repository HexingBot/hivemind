// graph-sync — the seam that makes the canonical wisearcher graph the source of truth and
// src/knowledge-graph.js a read-through PROJECTION/cache. A node write goes to BOTH: the local
// graph (always, cheap, offline-safe) AND the canonical brain graph via kb_assert (best-effort;
// queued when the brain is down — never lost). Reads can prefer the canonical graph and fall
// back to the local projection. See .knowledge/derived/brain-contract.md (§ "Writing hivemind's
// own nodes") and PLAN.md P1.5.

import { addNode as _addNode, neighbors as _neighbors, UnknownNodeIdError } from './knowledge-graph.js';

function makeErr(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

// local node.type -> canonical Entity type
const TYPE_MAP = { knowledge_entry: 'Knowledge', task: 'Task', decision: 'Decision', skill: 'Skill' };

// default marker/tier per node kind — hivemind's own artifacts are explicit project facts;
// a knowledge_entry is a distilled lesson (strong inference). Callers may override.
const DEFAULTS = {
  decision: { marker: 'EXPLICIT', source_tier: 'T2' },
  task: { marker: 'EXPLICIT', source_tier: 'T2' },
  skill: { marker: 'EXPLICIT', source_tier: 'T2' },
  knowledge_entry: { marker: 'INFERRED:strong', source_tier: 'T2' },
};

/** Map a local graph node {id,type,ref,label} → kb_assert args (pure). */
export function mapNodeToAssert(node, { topic, marker, sourceTier } = {}) {
  if (!node || !node.type || !node.label) {
    throw makeErr('E_GRAPH_NODE', 'node requires at least { type, label }');
  }
  const d = DEFAULTS[node.type] || { marker: 'INFERRED:weak', source_tier: 'T3' };
  return {
    topic,
    text: node.label,
    type: TYPE_MAP[node.type] || node.type,
    marker: marker || d.marker,
    source_tier: sourceTier || d.source_tier,
    source_ref: node.ref || node.id,
  };
}

/**
 * Write a node to the projection (local graph) and mirror it to the canonical graph (brain).
 * The local write is the cache and always happens; the canonical write is best-effort and
 * degrades gracefully (brain-client queues it when offline).
 *
 * TASK-171 (KB-GRAPH-4) — the canonical mirror is best-effort in the fullest
 * sense: a THROWING brain.assert() (not just a degraded { source: 'queued' }
 * return) is caught here and folded into the returned `canonical` shape
 * rather than propagated. Callers on the atomic close_task path (see
 * src/mcp-server.js) rely on this: the local projection write is the only
 * part of recordNode that may legitimately throw (e.g. a real disk error),
 * and even that is handled best-effort-after by the caller, never inline
 * with the ticket close itself.
 */
export async function recordNode({ brain, repoRoot, node, topic, marker, sourceTier, addNode = _addNode }) {
  await addNode({ repoRoot, node });                       // projection (cache)
  const assertArgs = mapNodeToAssert(node, { topic, marker, sourceTier });
  let canonical;
  if (!brain) {
    canonical = { source: 'skipped' };
  } else {
    try {
      canonical = await brain.assert(assertArgs);
    } catch (err) {
      canonical = { source: 'failed', error: err?.message || String(err) };
    }
  }
  return { projection: 'ok', canonical };
}

/**
 * Read neighbors canonical-first: ask the brain when a canonical id is known and the brain is
 * up; otherwise fall back to the local projection (knowledge-graph.js neighbors).
 */
export async function neighborsCanonicalFirst({ brain, repoRoot, id, canonicalId, neighbors = _neighbors }) {
  if (brain && canonicalId) {
    const r = await brain.neighbors({ canonical_id: canonicalId });
    if (r.source === 'brain') return { source: 'brain', neighbors: r.neighbors };
  }
  // TASK-104: neighbors() now throws UnknownNodeIdError instead of silently
  // returning [] for an id absent from the LOCAL projection. That is an
  // expected, documented degradation HERE SPECIFICALLY — a node can exist
  // canonically but not yet be mirrored locally. Every other caller of
  // neighbors() must let the throw propagate.
  try {
    const local = await neighbors({ repoRoot, id });
    return { source: 'projection', neighbors: local };
  } catch (err) {
    if (err instanceof UnknownNodeIdError || err?.code === 'E_GRAPH_UNKNOWN_ID') {
      return { source: 'projection', neighbors: [] };
    }
    throw err;
  }
}
