// src/bundle-compaction.js
// TASK-103 — bundle hygiene: compaction/rotation for a bundle's decisions/
// subagent_results (deep-review sweep #2 R11 + R10). The live bundle grew
// unbounded (83 decisions / 63 subagent_results / 260KB) after the v1 length
// caps on free-text fields were removed (src/schemas.js) with no replacing
// sensor. This module is that sensor's companion mechanism: it keeps
// session.json bounded by rotating everything past the most-recent N
// decisions/subagent_results into an append-only archive.jsonl living
// alongside session.json in the same bundle dir — no data loss, and the
// bundle stays self-contained (state/README.md's "copy the dir" contract).
//
// R29 coordination (knowledge/graph/graph.json decision nodes): the archive
// lives INSIDE the bundle directory, so a graph node whose `ref` is the bare
// bundle-dir path (`state/sessions/<id>/session.json`) remains addressable at
// the directory level — a reader who doesn't find a decision in session.json's
// live `decisions` array checks archive.jsonl next (documented in
// state/README.md and the orchestrator-routing SKILL.md). Nodes carrying a
// `#<at>` fragment that point at an entry which rotated out were repointed
// (one-time, by this ticket) to `archive.jsonl#<at>` so the fragment keeps
// resolving to the exact entry instead of going stale.
//
// MAX_DECISIONS / MAX_SUBAGENT_RESULTS mirror the maxItems caps on
// src/schemas.js#bundleStateSchema and state/bundle.schema.json — the schema
// is the ENFORCED sensor (AC3); this module is how a caller stays under it
// without losing history (AC2).

import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import {
  bundleArchivePath, readBundleSessionOrThrow, writeBundleSession,
} from './bundle.js';

export const MAX_DECISIONS = 15;
export const MAX_SUBAGENT_RESULTS = 15;

/**
 * Partition `items` (each carrying an `at` ISO-8601 string) into
 * `{ kept, archived }`: `kept` holds the `maxItems` entries with the most
 * recent `at` value, `archived` holds the rest. Both buckets preserve the
 * ORIGINAL relative order of `items` — this does not re-sort the array, it
 * only decides which entries stay.
 *
 * `at` values are compared by parsed Date, not string order, and are
 * evaluated independently of the input array's own ordering: the live
 * bundle's decisions/subagent_results arrays are mostly-but-not-perfectly
 * newest-first (a handful of entries are out of order), so a naive
 * `slice(0, maxItems)` would silently keep the wrong entries. Ties (equal
 * `at`) are broken by original index ascending, for determinism.
 *
 * Pure — no I/O, does not mutate `items`.
 *
 * @param {Array<{at: string}>} items
 * @param {number} maxItems
 * @returns {{ kept: Array, archived: Array }}
 */
export function partitionMostRecent(items, maxItems) {
  const list = Array.isArray(items) ? items : [];
  if (list.length <= maxItems) return { kept: [...list], archived: [] };

  const withIndex = list.map((item, index) => ({ item, index }));
  withIndex.sort((a, b) => {
    const ta = Date.parse(a.item.at);
    const tb = Date.parse(b.item.at);
    if (tb !== ta) return tb - ta;
    return a.index - b.index;
  });
  const keptIndexes = new Set(withIndex.slice(0, maxItems).map((e) => e.index));

  const kept = [];
  const archived = [];
  list.forEach((item, index) => {
    (keptIndexes.has(index) ? kept : archived).push(item);
  });
  return { kept, archived };
}

/**
 * Pure compaction: given a bundle state object, returns the compacted state
 * (every field spread verbatim except decisions/subagent_results, which are
 * replaced by their `kept` slice) plus whatever rotated out of each array.
 * Does NOT touch disk. Required fields, mode, loop_auth, loop_state, and the
 * current handoff_summary are untouched — only the two arrays are trimmed.
 *
 * @param {object} bundle
 * @param {{ maxDecisions?: number, maxSubagentResults?: number }} [opts]
 */
export function compactBundleState(bundle, opts = {}) {
  const maxDecisions = opts.maxDecisions ?? MAX_DECISIONS;
  const maxSubagentResults = opts.maxSubagentResults ?? MAX_SUBAGENT_RESULTS;

  const { kept: keptDecisions, archived: archivedDecisions } = partitionMostRecent(
    bundle.decisions,
    maxDecisions,
  );
  const { kept: keptSubagentResults, archived: archivedSubagentResults } = partitionMostRecent(
    bundle.subagent_results,
    maxSubagentResults,
  );

  const compacted = {
    ...bundle,
    decisions: keptDecisions,
    subagent_results: keptSubagentResults,
  };

  return { compacted, archivedDecisions, archivedSubagentResults };
}

/**
 * Append archived decisions/subagent_results to the bundle's archive.jsonl,
 * one JSON object per line, tagged with `type` ('decision' |
 * 'subagent_result') and `archived_at`. Append-only — never rewrites or
 * removes prior lines, so repeated compactions accumulate without data loss.
 * No-ops (creates nothing) when both arrays are empty.
 *
 * @returns {number} number of lines appended
 */
export function appendBundleArchive(repoRoot, sessionId, { decisions = [], subagentResults = [] }, archivedAt) {
  if (decisions.length === 0 && subagentResults.length === 0) return 0;

  const p = bundleArchivePath(repoRoot, sessionId);
  if (!existsSync(dirname(p))) mkdirSync(dirname(p), { recursive: true });

  const at = archivedAt || new Date().toISOString();
  const lines = [
    ...decisions.map((d) => JSON.stringify({ type: 'decision', archived_at: at, ...d })),
    ...subagentResults.map((s) => JSON.stringify({ type: 'subagent_result', archived_at: at, ...s })),
  ];
  appendFileSync(p, lines.join('\n') + '\n', 'utf8');
  return lines.length;
}

/**
 * I/O compaction: reads the active bundle by sessionId, compacts it, appends
 * anything rotated out to archive.jsonl, then writes the compacted bundle
 * back via writeBundleSession (which schema-validates before the atomic
 * write — TASK-103 AC1). No-ops (no write, no archive append) when the
 * bundle is already within both caps, so repeated calls are idempotent.
 *
 * @param {{ repoRoot: string, sessionId: string, maxDecisions?: number, maxSubagentResults?: number }} opts
 */
export async function compactBundleSession({
  repoRoot, sessionId, maxDecisions, maxSubagentResults,
}) {
  const bundle = readBundleSessionOrThrow(repoRoot, sessionId, 'compactBundleSession');
  const { compacted, archivedDecisions, archivedSubagentResults } = compactBundleState(
    bundle,
    { maxDecisions, maxSubagentResults },
  );

  if (archivedDecisions.length === 0 && archivedSubagentResults.length === 0) {
    return {
      sessionId, archivedDecisions: 0, archivedSubagentResults: 0, compacted: false,
    };
  }

  const archivedAt = new Date().toISOString();
  appendBundleArchive(
    repoRoot,
    sessionId,
    { decisions: archivedDecisions, subagentResults: archivedSubagentResults },
    archivedAt,
  );

  await writeBundleSession(repoRoot, sessionId, { ...compacted, updated_at: archivedAt });

  return {
    sessionId,
    archivedDecisions: archivedDecisions.length,
    archivedSubagentResults: archivedSubagentResults.length,
    compacted: true,
  };
}
