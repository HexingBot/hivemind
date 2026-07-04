// src/recovery.js
// Orphan-tmp sweep + recovery (research §C "Failure modes" table).
//
// Cases handled:
//   - tmp present, target present and parseable -> delete the tmp.
//   - tmp present, target missing                -> promote the newest tmp to target.
//   - tmp present, target present but unparseable -> promote newest tmp (atomic-write
//     guarantees the tmp had a complete payload by the time rename was attempted).

import {
  readdirSync, existsSync, readFileSync, unlinkSync, renameSync, statSync,
} from 'node:fs';
import { join } from 'node:path';

const TMP_PATTERN = /^session\.json\.tmp\./;

// TASK-085 AC6 — mirror of src/task-store.js's TMP_SWEEP_MIN_AGE_MS. A tmp
// younger than this may be a concurrent writer's in-flight atomicWriteFile()
// call (prepare/rename window), not a crash orphan — only tmps old enough to
// be safely assumed abandoned are reaped in the "target exists and
// parseable" branch below.
const TMP_SWEEP_MIN_AGE_MS = 60000;

/**
 * Sweep a bundle directory for orphan session.json tmp files and reconcile.
 *
 * @param {{ bundleDir: string }} args
 * @returns {{ actions: Array<{type: string, path: string, detail?: string}> }}
 */
export function sweepAndRecover({ bundleDir }) {
  const actions = [];
  if (!existsSync(bundleDir)) return { actions };

  const entries = readdirSync(bundleDir);
  const tmps = entries.filter((n) => TMP_PATTERN.test(n));
  if (tmps.length === 0) return { actions };

  const target = join(bundleDir, 'session.json');
  const targetExists = existsSync(target);
  let targetParseable = false;
  if (targetExists) {
    try {
      JSON.parse(readFileSync(target, 'utf8'));
      targetParseable = true;
    } catch {
      targetParseable = false;
    }
  }

  if (targetExists && targetParseable) {
    // Target is good — delete tmps old enough to be safely assumed abandoned
    // (TASK-085 AC6 age-gate). A tmp younger than TMP_SWEEP_MIN_AGE_MS is
    // skipped: it may be a concurrent writer's in-flight atomicWriteFile()
    // call, not a crash orphan.
    const nowMs = Date.now();
    for (const t of tmps) {
      const tpath = join(bundleDir, t);
      if (nowMs - safeMtime(tpath) < TMP_SWEEP_MIN_AGE_MS) continue;
      try {
        unlinkSync(tpath);
        actions.push({ type: 'deleted_orphan_tmp', path: tpath });
      } catch (err) {
        actions.push({ type: 'delete_failed', path: tpath, detail: err.message });
      }
    }
    return { actions };
  }

  // Target missing or unparseable — promote the newest tmp.
  const ranked = tmps
    .map((n) => ({ name: n, path: join(bundleDir, n), mtimeMs: safeMtime(join(bundleDir, n)) }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  // Validate top candidate before promotion.
  let promoted = null;
  for (const candidate of ranked) {
    try {
      JSON.parse(readFileSync(candidate.path, 'utf8'));
      // Looks valid — promote it.
      renameSync(candidate.path, target);
      actions.push({ type: 'promoted_tmp', path: candidate.path, detail: target });
      promoted = candidate;
      break;
    } catch (err) {
      actions.push({ type: 'tmp_unparseable', path: candidate.path, detail: err.message });
    }
  }

  // Clean up any remaining tmps (age-gated for symmetry with the branch
  // above — TASK-085 review LOW-1: a fresh LOSING candidate might still be
  // another writer's in-flight prepare, not a genuine loser of the
  // promotion race, so it is left alone until it ages past the same
  // TMP_SWEEP_MIN_AGE_MS threshold. The newest candidate is always promoted
  // regardless of its own age — that decision is unaffected by this gate.
  const nowMs2 = Date.now();
  for (const c of ranked) {
    if (promoted && c.path === promoted.path) continue;
    if (!existsSync(c.path)) continue;
    if (nowMs2 - safeMtime(c.path) < TMP_SWEEP_MIN_AGE_MS) continue;
    try {
      unlinkSync(c.path);
      actions.push({ type: 'deleted_orphan_tmp', path: c.path });
    } catch (err) {
      actions.push({ type: 'delete_failed', path: c.path, detail: err.message });
    }
  }

  return { actions };
}

function safeMtime(p) {
  try {
    return statSync(p).mtimeMs;
  } catch {
    return 0;
  }
}
