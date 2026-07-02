// src/inspection.js
// Read-only inspection commands per research §E.
//   listSessions({ repoRoot })           — table of all bundle dirs
//   showSession({ repoRoot, id })        — parsed session.json + summary.md text
//
// Both MUST NOT mutate the pointer or any bundle file.

import {
  existsSync, readFileSync, readdirSync, statSync,
} from 'node:fs';
import { join } from 'node:path';

import { sweepAndRecover } from './recovery.js';

/**
 * List all bundle directories under state/sessions/, newest-first.
 *
 * @param {{ repoRoot: string }} args
 * @returns {Promise<Array<{
 *   id: string,
 *   created_at: string|null,
 *   ended_at: string|null,
 *   lifecycle_state: string|null,
 *   active_task: string|null,
 *   workflow_step: string|null,
 * }>>}
 */
export async function listSessions({ repoRoot }) {
  if (!repoRoot) throw makeErr('E_INSPECT_ARGS', 'listSessions: repoRoot is required');
  const sessionsDir = join(repoRoot, 'state', 'sessions');
  if (!existsSync(sessionsDir)) return [];

  const rows = [];
  for (const dirent of readdirSync(sessionsDir, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue;
    const id = dirent.name;
    const bundleDir = join(sessionsDir, id);
    const row = {
      id,
      created_at: null,
      ended_at: null,
      lifecycle_state: null,
      active_task: null,
      workflow_step: null,
    };

    try {
      const manifest = JSON.parse(
        readFileSync(join(bundleDir, 'manifest.json'), 'utf8'),
      );
      row.created_at = manifest.created_at || null;
    } catch {
      // manifest unreadable — leave created_at null
    }

    try {
      const bundleState = JSON.parse(
        readFileSync(join(bundleDir, 'session.json'), 'utf8'),
      );
      row.lifecycle_state = bundleState.lifecycle_state || null;
      row.active_task = 'active_task' in bundleState ? bundleState.active_task : null;
      row.workflow_step = bundleState.workflow_step || null;
      // For ended sessions, the bundle's updated_at is the closest thing to ended_at.
      if (row.lifecycle_state === 'ended') {
        row.ended_at = bundleState.updated_at || null;
      }
    } catch {
      // session.json unreadable
    }

    rows.push(row);
  }

  // Sort newest-first by created_at, falling back to id (which is lexicographic-time-sortable).
  rows.sort((a, b) => {
    const ac = a.created_at || '';
    const bc = b.created_at || '';
    if (bc !== ac) return bc.localeCompare(ac);
    return b.id.localeCompare(a.id);
  });

  return rows;
}

/**
 * Show a single bundle's session.json + summary.md. Read-only.
 *
 * @param {{ repoRoot: string, id: string }} args
 */
export async function showSession({ repoRoot, id }) {
  if (!repoRoot) throw makeErr('E_INSPECT_ARGS', 'showSession: repoRoot is required');
  if (!id) throw makeErr('E_INSPECT_ARGS', 'showSession: id is required');

  const bundleDir = join(repoRoot, 'state', 'sessions', id);
  if (!existsSync(bundleDir)) {
    throw makeErr('E_BUNDLE_NOT_FOUND', `showSession: bundle ${id} not found`);
  }

  // AC1 (TASK-083) — sweep orphan tmps / recover a corrupt target before
  // reading. See src/recovery.js's header for the case table.
  sweepAndRecover({ bundleDir });

  const sessionPath = join(bundleDir, 'session.json');
  if (!existsSync(sessionPath)) {
    throw makeErr('E_BUNDLE_MALFORMED',
      `showSession: ${sessionPath} missing even after the recovery sweep — no tmp was available to recover from`);
  }
  const session_json = JSON.parse(readFileSync(sessionPath, 'utf8'));

  const summaryPath = join(bundleDir, 'summary.md');
  let summary_md;
  if (existsSync(summaryPath)) {
    summary_md = readFileSync(summaryPath, 'utf8');
  } else {
    const state = session_json.lifecycle_state || 'unknown';
    summary_md = `Session is still ${state}; no summary yet.`;
  }

  return { session_json, summary_md };
}

function makeErr(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}
