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
//
// TASK-110 (R10 one level down): the SAME unbounded-growth pattern recurred
// one level down inside loop_state (beta_findings array / note string, both
// free-form since loop_state itself is additionalProperties:true). Rather
// than inventing a second archive, compactLoopState below extends this same
// module and compactBundleSession appends to the SAME archive.jsonl with two
// new type tags ('loop_state_beta_finding' | 'loop_state_note').

import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import {
  bundleArchivePath, readBundleSessionOrThrow, writeBundleSession,
} from './bundle.js';

export const MAX_DECISIONS = 15;
export const MAX_SUBAGENT_RESULTS = 15;

// TASK-110 (R10 one level down) — loop_state.beta_findings/note grew
// unbounded the same way decisions/subagent_results did; these mirror the
// caps declared on src/schemas.js#bundleStateSchema's loop_state.properties
// (and state/bundle.schema.json's mirror) — keep all three in lock-step.
export const MAX_BETA_FINDINGS = 15;
export const MAX_NOTE_LENGTH = 4000;

// Marker left in loop_state.note in place of the original text once it has
// been rotated to archive.jsonl (type 'loop_state_note') — short enough to
// always be within MAX_NOTE_LENGTH.
const ROTATED_NOTE_MARKER = '(rotated: prior note archived to archive.jsonl — see type: "loop_state_note" entries)';

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
 * TASK-110 — partition a plain array (e.g. loop_state.beta_findings — items
 * are free-text strings with no `at` timestamp to sort by) into `{ kept,
 * archived }`: `kept` holds the LAST `maxItems` entries (append order, so the
 * tail is the most recent), `archived` holds everything before that. Both
 * buckets preserve original relative order. Pure — no I/O, does not mutate
 * `items`. Distinct from partitionMostRecent (which sorts by `.at` on object
 * items) because these items carry no timestamp to sort by.
 *
 * @param {Array<string>} items
 * @param {number} maxItems
 * @returns {{ kept: Array, archived: Array }}
 */
export function partitionArrayTail(items, maxItems) {
  const list = Array.isArray(items) ? items : [];
  if (list.length <= maxItems) return { kept: [...list], archived: [] };
  return {
    kept: list.slice(list.length - maxItems),
    archived: list.slice(0, list.length - maxItems),
  };
}

/**
 * TASK-110 — pure compaction for loop_state.beta_findings/note, the same
 * unbounded-growth pattern TASK-103 fixed for decisions/subagent_results one
 * level down. Returns the compacted bundle (every field spread verbatim
 * except loop_state.beta_findings/note) plus whatever rotated out of each.
 * Does NOT touch disk. All other loop_state keys (current_ticket, phase,
 * iteration, completed_this_run, run_started_at, goal, maxIterations, ...)
 * are preserved verbatim — only beta_findings/note are ever mutated here.
 *
 * `archivedNote` is `null` when note is absent/within cap (nothing to
 * rotate) or the full original note string when it overflowed maxNoteLength
 * — the ONLY signal compactBundleSession needs to decide whether to append a
 * 'loop_state_note' archive line.
 *
 * @param {object} bundle
 * @param {{ maxBetaFindings?: number, maxNoteLength?: number }} [opts]
 */
export function compactLoopState(bundle, opts = {}) {
  const maxBetaFindings = opts.maxBetaFindings ?? MAX_BETA_FINDINGS;
  const maxNoteLength = opts.maxNoteLength ?? MAX_NOTE_LENGTH;
  const loopState = (bundle && bundle.loop_state) || {};

  const hasBetaFindings = Array.isArray(loopState.beta_findings);
  const { kept: keptBetaFindings, archived: archivedBetaFindings } = hasBetaFindings
    ? partitionArrayTail(loopState.beta_findings, maxBetaFindings)
    : { kept: undefined, archived: [] };

  const hasNote = typeof loopState.note === 'string';
  const noteOverflows = hasNote && loopState.note.length > maxNoteLength;
  const archivedNote = noteOverflows ? loopState.note : null;

  const nextLoopState = { ...loopState };
  if (hasBetaFindings) nextLoopState.beta_findings = keptBetaFindings;
  if (noteOverflows) nextLoopState.note = ROTATED_NOTE_MARKER;

  const compacted = bundle && bundle.loop_state !== undefined
    ? { ...bundle, loop_state: nextLoopState }
    : { ...bundle };

  return { compacted, archivedBetaFindings, archivedNote };
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
 * Append archived decisions/subagent_results/loop_state beta_findings/note
 * to the bundle's archive.jsonl, one JSON object per line, tagged with
 * `type` ('decision' | 'subagent_result' | 'loop_state_beta_finding' |
 * 'loop_state_note') and `archived_at`. Append-only — never rewrites or
 * removes prior lines, so repeated compactions accumulate without data loss.
 * No-ops (creates nothing) when there is nothing to archive.
 *
 * TASK-110 coordinates with (does not duplicate) the TASK-103 archive: the
 * SAME file, same append-only line-per-entry shape, two new type tags.
 *
 * @param {{ decisions?: Array, subagentResults?: Array, betaFindings?: Array<string>, note?: string|null }} entries
 * @returns {number} number of lines appended
 */
export function appendBundleArchive(
  repoRoot,
  sessionId,
  {
    decisions = [], subagentResults = [], betaFindings = [], note = null,
  },
  archivedAt,
) {
  if (decisions.length === 0 && subagentResults.length === 0 && betaFindings.length === 0 && note === null) {
    return 0;
  }

  const p = bundleArchivePath(repoRoot, sessionId);
  if (!existsSync(dirname(p))) mkdirSync(dirname(p), { recursive: true });

  const at = archivedAt || new Date().toISOString();
  const lines = [
    ...decisions.map((d) => JSON.stringify({ type: 'decision', archived_at: at, ...d })),
    ...subagentResults.map((s) => JSON.stringify({ type: 'subagent_result', archived_at: at, ...s })),
    ...betaFindings.map((text) => JSON.stringify({ type: 'loop_state_beta_finding', archived_at: at, text })),
    ...(note !== null ? [JSON.stringify({ type: 'loop_state_note', archived_at: at, text: note })] : []),
  ];
  appendFileSync(p, lines.join('\n') + '\n', 'utf8');
  return lines.length;
}

/**
 * I/O compaction: reads the active bundle by sessionId, compacts it, appends
 * anything rotated out to archive.jsonl, then writes the compacted bundle
 * back via writeBundleSession (which schema-validates before the atomic
 * write — TASK-103 AC1). No-ops (no write, no archive append) when the
 * bundle is already within all caps, so repeated calls are idempotent.
 *
 * TASK-110 extends this SAME function (not a parallel path) to also compact
 * loop_state.beta_findings/note via compactLoopState, rotating overflow into
 * the SAME archive.jsonl appendBundleArchive already writes.
 *
 * @param {{ repoRoot: string, sessionId: string, maxDecisions?: number, maxSubagentResults?: number, maxBetaFindings?: number, maxNoteLength?: number }} opts
 */
export async function compactBundleSession({
  repoRoot, sessionId, maxDecisions, maxSubagentResults, maxBetaFindings, maxNoteLength,
}) {
  const bundle = readBundleSessionOrThrow(repoRoot, sessionId, 'compactBundleSession');
  const { compacted: arraysCompacted, archivedDecisions, archivedSubagentResults } = compactBundleState(
    bundle,
    { maxDecisions, maxSubagentResults },
  );
  const { compacted, archivedBetaFindings, archivedNote } = compactLoopState(
    arraysCompacted,
    { maxBetaFindings, maxNoteLength },
  );

  const nothingArchived = archivedDecisions.length === 0
    && archivedSubagentResults.length === 0
    && archivedBetaFindings.length === 0
    && archivedNote === null;

  if (nothingArchived) {
    return {
      sessionId,
      archivedDecisions: 0,
      archivedSubagentResults: 0,
      archivedBetaFindings: 0,
      archivedNote: false,
      compacted: false,
    };
  }

  const archivedAt = new Date().toISOString();
  appendBundleArchive(
    repoRoot,
    sessionId,
    {
      decisions: archivedDecisions,
      subagentResults: archivedSubagentResults,
      betaFindings: archivedBetaFindings,
      note: archivedNote,
    },
    archivedAt,
  );

  await writeBundleSession(repoRoot, sessionId, { ...compacted, updated_at: archivedAt });

  return {
    sessionId,
    archivedDecisions: archivedDecisions.length,
    archivedSubagentResults: archivedSubagentResults.length,
    archivedBetaFindings: archivedBetaFindings.length,
    archivedNote: archivedNote !== null,
    compacted: true,
  };
}
