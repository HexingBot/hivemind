// src/pack-orchestrator.js
// TASK-132 — FP-4: reconcilePack({ repoRoot, descriptor, profileResult, owner }),
// the thin end-to-end composer for a single addon pack (Phase F,
// docs/design/addon-packs-plan.md). Wires the three collaborators that
// already exist into one call, faithfully — it does NOT reimplement any of
// their logic:
//   1. src/pack-resources.js#resolveDesired(descriptor, profileResult) — FP-3,
//      the desired resource set for THIS project's scored design profile.
//   2. src/pack-reconcile.js#probeSkills(root) + #plan(desired, lock, actual)
//      — the actual-state probe and the pure desired-vs-actual diff.
//   3. src/pack-apply.js#applyPlan({plan, lockPath, root, owner}) — the
//      applier that materializes skill installs/removes and commits the
//      lockfile atomically exactly once.
//
// Wave-1 scope inherited, not re-decided here: plan() only ever proposes
// install/remove/replace for kind:"skill" resources; a non-skill (mcp/
// plugin) resource structurally never reaches applyPlan — it is surfaced
// only in plan()'s own `report` (blocking iff required:"hard", leave-and-
// report iff "soft"), which this composer forwards verbatim.
//
// Real disk I/O (probe, lock read/write, skill materialize) — not a bundled
// plugin entrypoint (see scripts/build-plugin.mjs ENTRYPOINT_NAMES; nothing
// under bin/ imports this module), so no `npm run build:plugin` rebuild is
// needed for this ticket.

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { readLock, writeLock } from './integrations-lock.js';
import { probeSkills, plan } from './pack-reconcile.js';
import { applyPlan, HardResourceFailureError } from './pack-apply.js';
import { resolveDesired } from './pack-resources.js';

const DEFAULT_LOCK_FILENAME = 'integrations.lock.json';

/**
 * Reconcile ONE addon pack's desired resource set against the live project,
 * end to end: resolveDesired -> probeSkills + readLock -> plan -> applyPlan.
 *
 * @param {object} opts
 * @param {string} opts.repoRoot - project/repo root.
 * @param {object} opts.descriptor - a validated pack descriptor
 *   (src/pack-descriptor.js#validatePackDescriptor); resources[] plus
 *   `id`/`version` (used to derive the default owner edge).
 * @param {{tier: string, axes: object, activations: object}} opts.profileResult
 *   - scoreComplexity(answers)'s return value (src/design-profile.js).
 * @param {string} [opts.owner] - ownership edge recorded on every install/
 *   remove; defaults to "<descriptor.id>@<descriptor.version>".
 * @param {string} [opts.lockPath] - defaults to <repoRoot>/integrations.lock.json.
 * @param {string} [opts.sourceRoot] - forwarded to applyPlan; defaults to
 *   applyPlan's own default (<repoRoot>/assimilated-skills).
 * @returns {Promise<{
 *   aborted: boolean,
 *   installed: Array<{id: string, resource: object}>,
 *   replaced: Array<{id: string, resource: object, from: string, to: string}>,
 *   report: Array<object>,
 *   error?: HardResourceFailureError,
 * }>}
 *   `installed` is the subset of the plan's install ops that are actually
 *   live on disk after the run (re-derived via a post-run probeSkills, never
 *   assumed from the plan alone — a soft-failed or never-attempted install
 *   is excluded). `replaced` (TASK-199) is the subset of the plan's replace
 *   ops applyPlan actually MATERIALIZED — derived from applyPlan's own report
 *   entries (`executed: true`), never from a post-run probe (a soft-failed
 *   replace leaves the live dir's PRIOR content in place, so presence alone
 *   can't distinguish success from failure the way it can for a fresh
 *   install); a deliberately deferred/kept-as-is replace (TASK-182's
 *   installed-newer/undecidable branches, `executed: false`) is correctly
 *   excluded too — it is a designed no-op, not a failure. `report` merges
 *   plan()'s own Wave-2 (non-skill) entries with applyPlan's apply-time
 *   report (soft failures, deferred replaces). On a hard-required resource's
 *   failure, `aborted` is true and `error` is the HardResourceFailureError
 *   applyPlan threw — never re-thrown to the caller — while whatever ops
 *   already succeeded are still committed to the lock (applyPlan's own
 *   leave-and-report guarantee).
 */
export async function reconcilePack(opts = {}) {
  const { repoRoot, descriptor, profileResult, sourceRoot, sourceRoots } = opts;
  if (!repoRoot) throw new Error('reconcilePack: repoRoot is required');
  if (!descriptor) throw new Error('reconcilePack: descriptor is required');

  const owner = opts.owner || `${descriptor.id}@${descriptor.version}`;
  const lockPath = opts.lockPath || join(repoRoot, DEFAULT_LOCK_FILENAME);

  // applyPlan's readLock has no ENOENT fallback of its own (unlike
  // src/assimilate.js's inline try/catch) — ensure the precondition it
  // expects (a lockfile that exists) is met before delegating to it, rather
  // than duplicating its read/diff logic.
  if (!existsSync(lockPath)) {
    await writeLock(lockPath, { schema_version: 1, resources: {} });
  }

  const desired = resolveDesired(descriptor, profileResult);
  const actual = probeSkills(repoRoot);
  const lock = await readLock(lockPath);
  const reconcilePlan = plan(desired, lock, actual);

  const applyOpts = { plan: reconcilePlan, lockPath, root: repoRoot, owner };
  if (sourceRoot) applyOpts.sourceRoot = sourceRoot;
  // TASK-181 — fallback owned-copy dirs (the plugin's own assimilated-skills/),
  // searched after the project's own staging dir. Forwarded verbatim; applyPlan
  // owns the ordering and dedupe.
  if (sourceRoots) applyOpts.sourceRoots = sourceRoots;

  let applyReport = [];
  let aborted = false;
  let error;
  try {
    const applyResult = await applyPlan(applyOpts);
    applyReport = applyResult.report;
  } catch (err) {
    if (!(err instanceof HardResourceFailureError)) throw err;
    aborted = true;
    error = err;
  }

  // Re-derive what actually landed from a fresh probe rather than trusting
  // the plan's install list wholesale — a soft-failed or not-yet-attempted
  // (post-abort) op never wrote a live dir, so it is correctly excluded here
  // without duplicating applyPlan's own success/failure bookkeeping.
  const actualAfter = probeSkills(repoRoot);
  const installed = reconcilePlan.install.filter((op) => Boolean(actualAfter[op.id]));

  // TASK-199 — the replace-bucket analogue of `installed` above, but derived
  // from applyPlan's REPORT rather than a post-run probe: a replace op's live
  // dir already existed before the run (that's what makes it a replace, not
  // an install), so a soft-failed materialize leaves the OLD content in
  // place and a bare existsSync check would read it as "landed" either way.
  // applyPlan's own report entry is the only reliable signal — `executed:
  // true` means the copy actually happened; `executed: false` (deferred,
  // TASK-182 keep-as-is) and a soft-failure entry (no `executed` field at
  // all, see applyPlan's replace-loop catch) both correctly stay excluded.
  const replaceReportById = new Map();
  for (const entry of applyReport) {
    if (entry && entry.id) replaceReportById.set(entry.id, entry);
  }
  const replaced = reconcilePlan.replace.filter((op) => replaceReportById.get(op.id)?.executed === true);

  const result = {
    aborted,
    installed,
    replaced,
    report: [...reconcilePlan.report, ...applyReport],
  };
  if (error) result.error = error;
  return result;
}
