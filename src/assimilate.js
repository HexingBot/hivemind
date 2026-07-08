// src/assimilate.js
// TASK-120 — hivemind-assimilate-skill workflow (docs/design/addon-packs-plan.md
// §7 assimilation, §12 license-detection spec). This is the actual v1
// assimilation primitive the four prior Wave-1 modules were built to compose:
//   - src/license-detect.js    — detectLicense / classifyLicense: the human gate.
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
// Flow: read the skill at `source` (a local directory — a fixture dir in
// tests, a pre-cloned checkout in real runs; no network happens here) ->
// detectLicense -> classifyLicense. permissive -> proceed automatically.
// copyleft | unknown -> return `awaiting_human` and write NOTHING, unless the
// caller re-invokes with an explicit `decision: 'approve'`; a declined or
// absent decision is always a strict no-op on disk and on the lock.
//
// On proceed: copy `source` into `assimilated-skills/<resourceId>/`
// (clean-replace via rmSync+cpSync, mirroring pack-apply's executeInstall fix
// — TASK-119 review's carried LOW — so re-assimilating the same id is
// idempotent), re-scope the copied SKILL.md's frontmatter description,
// append the provenance block, and record a lock entry + ownership edge.

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

/**
 * Assimilate a third-party skill: license-gate it, then (once cleared) copy
 * it into the owned `assimilated-skills/<resourceId>/` staging dir with a
 * re-scoped description and a provenance block, and record it in
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
 *   needed on the proceed path (never required to reach an awaiting_human/
 *   declined verdict, which write nothing).
 * @param {string} [opts.pin] - pinned commit SHA or exact version; same as origin.
 * @param {'approve'|'decline'} [opts.decision] - human verdict on a
 *   copyleft/unknown license. Absent is treated as "not yet decided"
 *   (status: awaiting_human); 'decline' is a terminal no (status: declined).
 *   Either way nothing is written; only 'approve' unblocks the proceed path.
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
 * @returns {Promise<object>} `{ status: 'assimilated'|'awaiting_human'|'declined', id, spdx_id, ... }`.
 */
export async function assimilateSkill(opts) {
  const {
    source,
    resourceId,
    pack,
    origin,
    pin,
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

  const license = await detectLicense({ skillDir: source, github, fetchGithubLicense });
  const classification = classifyLicense(license.spdx_id);

  const base = {
    id: resourceId,
    spdx_id: license.spdx_id,
    classification,
    detected_via: license.detected_via,
    source_path: license.source_path,
  };

  if (classification !== 'permissive' && decision !== 'approve') {
    // Copyleft/unknown, without an explicit approval yet -- write NOTHING.
    // 'decline' is a terminal no; an absent decision is "not yet decided" --
    // both leave the tree and lock untouched, which is the guarantee under test.
    return { ...base, status: decision === 'decline' ? 'declined' : 'awaiting_human' };
  }

  // Proceed: permissive auto-OK, or copyleft/unknown carrying an explicit approval.
  const integrity = `sha256:${hashDir(source)}`;
  const assimilated_at = now();

  const ownedDir = join(root, DEFAULT_STAGING_SUBDIR, resourceId);
  mkdirSync(dirname(ownedDir), { recursive: true });
  rmSync(ownedDir, { recursive: true, force: true }); // clean-replace: re-assimilate is idempotent
  cpSync(source, ownedDir, { recursive: true });

  const provenanceFields = { origin, pin, spdx_id: license.spdx_id, integrity, assimilated_at };
  const ownedSkillPath = join(ownedDir, SKILL_FILENAME);
  const original = readFileSync(ownedSkillPath, 'utf8');
  const rescoped = appendProvenanceBlock(tagDescriptionForHivemind(original), provenanceFields);
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
    origin,
    pin,
    integrity,
    scope: 'project',
    owners: [],
    required,
    installed_at: assimilated_at,
    install_method: 'assimilated',
    verified: 'unsigned',
  };
  addOwner(lock, id, pack);
  await writeLock(lockPath, lock);

  return {
    ...base,
    status: 'assimilated',
    path: ownedDir,
    origin,
    pin,
    integrity,
    assimilated_at,
    owners: lock.resources[id].owners,
  };
}
