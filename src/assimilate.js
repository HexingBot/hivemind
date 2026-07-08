// src/assimilate.js
// TASK-120 — hivemind-assimilate-skill workflow (docs/design/addon-packs-plan.md
// §7 assimilation, §12 license-detection spec). This is the actual v1
// assimilation primitive the four prior Wave-1 modules were built to compose:
//   - src/license-detect.js    — detectLicense / classifyLicense: decision
//     support only (see the human-gate policy note below) — never itself a
//     write authority.
//   - src/integrations-lock.js — readLock/writeLock/addOwner: ownership edges.
//   - src/pack-reconcile.js    — probeSkills's PROVISIONAL provenance-block
//     parser; assimilateSkill is the block's actual writer. The format below
//     is written to match that parser exactly (flat `- key: value` bullets
//     under the "## Sources & provenance (hivemind)" heading) — see that
//     module's PROVISIONAL comment, which this reconciles against.
//   - src/pack-apply.js        — applyPlan materializes assimilated-skills/<id>/
//     into the live .claude/skills/<id>/ tree; assimilateSkill only ever
//     writes the OWNED staging copy, never the live dir directly.
//
// HUMAN-GATE POLICY (locked, 2026-07-08): NO skill ever adopts without an
// explicit human sign-off — not even a permissive one. Every call without
// `decision: 'approve'` is a dry-run vet: it reads the skill at `source`,
// runs detectLicense/classifyLicense, computes what integrity/provenance
// WOULD be, and returns a `pending_approval` review payload — WRITING
// NOTHING. `decision: 'decline'` is a terminal no (status: declined),
// equally a no-write. Only `decision: 'approve'` performs the actual write
// (copy into assimilated-skills/<resourceId>/, re-scope the description,
// append the provenance block, record the lock entry). Classification
// (permissive/copyleft/unknown) is decision SUPPORT surfaced in the
// payload, never itself a write authority — a self-reported "permissive"
// finding must never be able to auto-adopt.

import { existsSync, mkdirSync, rmSync, cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

import { detectLicense, classifyLicense } from './license-detect.js';
import { readLock, writeLock, addOwner } from './integrations-lock.js';
import { hashDir } from './pack-apply.js';

const SKILL_FILENAME = 'SKILL.md';
const DEFAULT_STAGING_SUBDIR = 'assimilated-skills';
const PROVENANCE_HEADING = '## Sources & provenance (hivemind)';
const HIVEMIND_TAG = ' (assimilated for Hivemind)';

function defaultNow() {
  return new Date().toISOString();
}

// Same targeted-splice pattern as src/agent-generator.js's
// patchAgentModelContent (TASK-036 review ruling: patch the frontmatter
// substring in place, never split/rejoin the whole file). Idempotent — a
// description that already carries the tag is left untouched. A missing or
// malformed frontmatter fence is also left untouched: not every third-party
// skill author writes machine-parseable YAML, and the provenance block below
// is the load-bearing provenance record either way.
function tagDescriptionForHivemind(text) {
  const open = text.match(/^---(\r?\n)/);
  if (!open) return text;
  const fmStart = open[0].length;
  const rest = text.slice(fmStart);
  const close = rest.match(/(^|\r?\n)---(\r?\n|$)/);
  if (!close) return text;

  const innerEnd = fmStart + close.index + close[1].length;
  const inner = text.slice(fmStart, innerEnd);

  const descRe = /^description:[^\r\n]*/m;
  const match = inner.match(descRe);
  if (!match || match[0].includes(HIVEMIND_TAG.trim())) return text;

  const newInner = inner.replace(descRe, `${match[0]}${HIVEMIND_TAG}`);
  return text.slice(0, fmStart) + newInner + text.slice(innerEnd);
}

// Format LOCKED to what src/pack-reconcile.js's parseProvenance already
// expects: a flat `- key: value` bullet list under the heading.
function buildProvenanceBlock({ origin, pin, spdx_id, integrity, assimilated_at }) {
  return [
    PROVENANCE_HEADING,
    '',
    `- origin: ${origin}`,
    `- pin: ${pin}`,
    `- spdx_id: ${spdx_id}`,
    `- integrity: ${integrity}`,
    `- assimilated_at: ${assimilated_at}`,
    '',
  ].join('\n');
}

function appendProvenanceBlock(text, fields) {
  const base = text.endsWith('\n') ? text : `${text}\n`;
  return `${base}\n${buildProvenanceBlock(fields)}`;
}

// Shared by the pending_approval preview and the real write: both need the
// exact same integrity hash (over the UNMODIFIED source, before any
// description-tag/provenance-block rewrite) and the exact same clock read,
// so a human reviewing a pending_approval payload sees the real values an
// approve would commit -- not a second, possibly-different computation.
function computeProvenanceFields(source, { origin, pin, spdx_id, now }) {
  return {
    origin,
    pin,
    spdx_id,
    integrity: `sha256:${hashDir(source)}`,
    assimilated_at: now(),
  };
}

/**
 * Assimilate a third-party skill: run the license-detection decision-support
 * chain, then EITHER return a pending_approval/declined review payload
 * (default — writes nothing) OR, only with an explicit `decision: 'approve'`,
 * copy it into the owned `assimilated-skills/<resourceId>/` staging dir with
 * a re-scoped description and a provenance block, and record it in
 * integrations.lock.json under the calling pack's ownership.
 *
 * @param {object} opts
 * @param {string} opts.source - local directory path to the skill (a fixture
 *   dir in tests, a pre-cloned checkout in real runs). Must contain a
 *   top-level SKILL.md.
 * @param {string} opts.resourceId - bare resource id; the owned copy's dir
 *   name is exactly this (assimilated-skills/<resourceId>/, lock key
 *   skill:<resourceId> — kept flat so it lines up with probeSkills()'s id
 *   space once materialized into .claude/skills/<resourceId>/).
 * @param {string} opts.pack - owning pack-id@version edge, e.g. "design-power@0.1.0".
 * @param {string} [opts.origin] - vendor/repo the skill came from; only
 *   needed on the approve path (never required to reach a pending_approval/
 *   declined verdict, which write nothing — though it's echoed into the
 *   pending_approval preview too, since that's what an approve would commit).
 * @param {string} [opts.pin] - pinned commit SHA or exact version; same as origin.
 * @param {string} [opts.repoRoot] - the SOURCE skill's clone/repo root, when
 *   `source` is a subdirectory of a larger checkout (e.g. bin/assimilate-skill.js's
 *   --subdir). Forwarded to detectLicense as its `repoRoot` fallback dir (distinct
 *   from `source`/skillDir) so a LICENSE file that lives at the clone root, not
 *   inside the skill's own subdir, is still found. Omit when `source` IS the repo
 *   root (no --subdir) -- detectLicense already checks skillDir first either way.
 * @param {'approve'|'decline'} [opts.decision] - the human's verdict. HUMAN-GATE
 *   POLICY: this is the ONLY thing that can trigger a write, for ANY
 *   classification (including permissive) — a license finding is decision
 *   support, never a write authority. Absent -> status 'pending_approval'
 *   (not yet decided); 'decline' -> status 'declined' (a terminal no); either
 *   way nothing is written. Only 'approve' performs the write.
 * @param {{owner: string, repo: string}} [opts.github] - repo coordinates
 *   forwarded to detectLicense's GitHub Licenses API step.
 * @param {Function} [opts.fetch] - injected GitHub Licenses API transport,
 *   forwarded to detectLicense as fetchGithubLicense; omit to skip that step
 *   (no network — this is what keeps assimilateSkill itself network-free).
 * @param {() => string} [opts.now] - injectable clock (ISO-8601), default
 *   `() => new Date().toISOString()`.
 * @param {string} [opts.root] - repo root the staging dir + lockfile live
 *   under; default process.cwd().
 * @param {string} [opts.lockPath] - default <root>/integrations.lock.json.
 *   Created fresh (schema_version 1, empty resources) if it doesn't exist yet.
 * @param {'hard'|'soft'} [opts.required] - the lock entry's required tier,
 *   default 'soft'.
 * @returns {Promise<object>} `{ status: 'pending_approval'|'declined'|'assimilated', id, spdx_id, classification, ... }`.
 *   A `pending_approval` payload additionally carries `origin`, `pin`,
 *   `integrity`, `assimilated_at`, and `provenance_preview` (the exact
 *   provenance-block text an `approve` would write) — everything a human
 *   needs to decide, computed WITHOUT writing anything.
 */
export async function assimilateSkill(opts) {
  const {
    source,
    resourceId,
    pack,
    origin,
    pin,
    repoRoot,
    decision,
    github,
    fetch: fetchGithubLicense,
    now = defaultNow,
    root = process.cwd(),
    lockPath = join(root, 'integrations.lock.json'),
    required = 'soft',
  } = opts;

  const sourceSkillPath = join(source, SKILL_FILENAME);
  if (!existsSync(sourceSkillPath)) {
    throw new Error(`assimilateSkill: no ${SKILL_FILENAME} found at "${source}"`);
  }

  const license = await detectLicense({ skillDir: source, repoRoot, github, fetchGithubLicense });
  const classification = classifyLicense(license.spdx_id);

  const base = {
    id: resourceId,
    spdx_id: license.spdx_id,
    classification,
    detected_via: license.detected_via,
    source_path: license.source_path,
  };

  if (decision !== 'approve') {
    if (decision === 'decline') {
      // Terminal no -- write NOTHING. No preview needed; the caller already said no.
      return { ...base, status: 'declined' };
    }
    // No decision yet, for ANY classification (permissive included) -- write
    // NOTHING, but compute + return everything an approve would commit, so
    // the human reviewing this has the real numbers, not a placeholder.
    const fields = computeProvenanceFields(source, { origin, pin, spdx_id: license.spdx_id, now });
    return {
      ...base,
      status: 'pending_approval',
      origin: fields.origin,
      pin: fields.pin,
      integrity: fields.integrity,
      assimilated_at: fields.assimilated_at,
      provenance_preview: buildProvenanceBlock(fields),
    };
  }

  // decision === 'approve' -- the ONLY path that writes, for ANY classification.
  const fields = computeProvenanceFields(source, { origin, pin, spdx_id: license.spdx_id, now });

  const ownedDir = join(root, DEFAULT_STAGING_SUBDIR, resourceId);
  mkdirSync(dirname(ownedDir), { recursive: true });
  rmSync(ownedDir, { recursive: true, force: true }); // clean-replace: re-assimilate is idempotent
  cpSync(source, ownedDir, { recursive: true });

  const ownedSkillPath = join(ownedDir, SKILL_FILENAME);
  const original = readFileSync(ownedSkillPath, 'utf8');
  const rescoped = appendProvenanceBlock(tagDescriptionForHivemind(original), fields);
  writeFileSync(ownedSkillPath, rescoped, 'utf8');

  const id = `skill:${resourceId}`;
  let lock;
  try {
    lock = await readLock(lockPath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    lock = { schema_version: 1, resources: {} };
  }
  lock.resources[id] = {
    kind: 'skill',
    origin: fields.origin,
    pin: fields.pin,
    integrity: fields.integrity,
    scope: 'project',
    owners: [],
    required,
    installed_at: fields.assimilated_at,
    install_method: 'assimilated',
    verified: 'unsigned',
  };
  addOwner(lock, id, pack);
  await writeLock(lockPath, lock);

  return {
    ...base,
    status: 'assimilated',
    path: ownedDir,
    origin: fields.origin,
    pin: fields.pin,
    integrity: fields.integrity,
    assimilated_at: fields.assimilated_at,
    owners: lock.resources[id].owners,
  };
}
