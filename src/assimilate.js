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
//
// CONTENT SECURITY GATE (TASK-122, locked 2026-07-08): license is NOT a
// safety assurance — a self-declared frontmatter license is forgeable, and
// says nothing about whether the skill's *instructions* try to exfiltrate
// secrets or run arbitrary commands. Every pending_approval/blocked_security
// payload additionally carries:
//   - `scan` — src/skill-scan.js's structured findings over the skill's own
//     content (pure, sync, LLM-free pattern scan: shell-exec, network-fetch,
//     env-credential-access, filesystem-access-outside-skill, obfuscated-blob).
//     Decision SUPPORT only — findings alone never auto-block an approve.
//   - `reviewer` — an INJECTED verdict, `opts.reviewerVerdict` (shape
//     `{ verdict: 'safe'|'suspicious', reasoning }`), echoed back verbatim, or
//     `null` if the caller hasn't run that step yet.
//
// SECURITY REVIEW BOUNDARY: this module never spawns anything and stays
// LLM-free, matching the license/scan decision-support-only invariant above.
// Producing `reviewerVerdict` is ORCHESTRATOR glue at runtime — the
// Orchestrator spawns a security-reviewer subagent that reads the fetched
// skill's actual content INCLUDING its instruction text (the prompt-injection
// risk a code scanner cannot catch), and passes the resulting verdict back in
// on the next call. On `decision: 'approve'`, a `reviewerVerdict.verdict ===
// 'suspicious'` WITHOUT an explicit `opts.securityOverride: true` refuses the
// write (`status: 'blocked_security'`) — an approve alone can never override
// a suspicious content verdict. Absent a reviewerVerdict at all, approve
// proceeds unblocked (the Orchestrator is responsible for always running the
// reviewer step before calling approve in real usage; this module only
// enforces the case where a verdict WAS supplied and says suspicious).

import { existsSync, mkdirSync, rmSync, cpSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';

import { detectLicense, classifyLicense } from './license-detect.js';
import { readLock, writeLock, addOwner } from './integrations-lock.js';
import { hashDir } from './pack-apply.js';
import { scanSkillContent } from './skill-scan.js';

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

const SCAN_IGNORED_DIRS = new Set(['node_modules', '.git']);
const SCAN_MAX_FILE_BYTES = 1_000_000; // generous cap; scanning is line-based text matching, not binary analysis

// Same shape as license-detect.js's walkFiles -- small, local, and not worth
// sharing a dependency over (Ponytail rung 1: no second caller yet).
function walkSkillFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SCAN_IGNORED_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkSkillFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

// Scans the skill's own SKILL.md as the primary text, plus every other file
// in `source` (references/*.md, etc.) via scanSkillContent's `files` option.
// Unreadable/oversized/non-utf8 files are skipped rather than failing the
// whole assimilate call -- a scan gap is surfaced as fewer findings, never a
// thrown error blocking the human from even seeing the rest of the package.
//
// Exported (TASK-135) so bin/pack-ctl.js's `assimilate scan` subcommand can
// reuse this exact walk-and-scan behavior instead of reimplementing it.
export function computeSkillScan(source, sourceSkillPath) {
  const mainText = readFileSync(sourceSkillPath, 'utf8');
  const otherFiles = [];
  for (const full of walkSkillFiles(source)) {
    if (full === sourceSkillPath) continue;
    let size;
    try {
      size = statSync(full).size;
    } catch {
      continue;
    }
    if (size > SCAN_MAX_FILE_BYTES) continue;
    let content;
    try {
      content = readFileSync(full, 'utf8');
    } catch {
      continue;
    }
    otherFiles.push({ path: relative(source, full).split(sep).join('/'), content });
  }
  return scanSkillContent(mainText, { location: SKILL_FILENAME, files: otherFiles });
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
 * @param {{verdict: 'safe'|'suspicious', reasoning: string}} [opts.reviewerVerdict]
 *   - the security-reviewer subagent's verdict over the skill's content
 *   INCLUDING its instruction text (the Orchestrator's job to produce — see
 *   the CONTENT SECURITY GATE note above). Echoed back as `reviewer` in every
 *   status. Absent -> `reviewer: null`, and approve is NOT blocked by this
 *   check (only an explicit 'suspicious' verdict blocks).
 * @param {boolean} [opts.securityOverride] - explicit human override that
 *   allows `decision: 'approve'` to proceed despite a 'suspicious'
 *   `reviewerVerdict`. Default false. Has no effect otherwise.
 * @returns {Promise<object>} `{ status: 'pending_approval'|'declined'|'blocked_security'|'assimilated', id, spdx_id, classification, scan, reviewer, ... }`.
 *   A `pending_approval` payload additionally carries `origin`, `pin`,
 *   `integrity`, `assimilated_at`, and `provenance_preview` (the exact
 *   provenance-block text an `approve` would write), plus `scan` (structured
 *   risky-pattern findings, src/skill-scan.js) and `reviewer` (the injected
 *   verdict, or null) — everything a human needs to decide, computed WITHOUT
 *   writing anything. A `blocked_security` payload (only reachable via
 *   `decision: 'approve'` + a 'suspicious' `reviewerVerdict` with no
 *   `securityOverride`) carries the same `scan`/`reviewer` fields and also
 *   writes NOTHING — an approve alone can never override a suspicious verdict.
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
    reviewerVerdict = null,
    securityOverride = false,
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
    // TASK-122: the approval package also carries the content-security scan
    // and the (possibly not-yet-computed) reviewer verdict.
    const fields = computeProvenanceFields(source, { origin, pin, spdx_id: license.spdx_id, now });
    const scan = computeSkillScan(source, sourceSkillPath);
    return {
      ...base,
      status: 'pending_approval',
      origin: fields.origin,
      pin: fields.pin,
      integrity: fields.integrity,
      assimilated_at: fields.assimilated_at,
      provenance_preview: buildProvenanceBlock(fields),
      scan,
      reviewer: reviewerVerdict,
    };
  }

  // decision === 'approve' -- for ANY classification, but TASK-122's content
  // security gate can still refuse the write: a 'suspicious' reviewerVerdict
  // without an explicit securityOverride blocks here, before anything is
  // touched on disk. Scan findings ALONE never block -- they're surfaced for
  // the human, same as license classification.
  const scan = computeSkillScan(source, sourceSkillPath);
  if (reviewerVerdict?.verdict === 'suspicious' && securityOverride !== true) {
    return {
      ...base,
      status: 'blocked_security',
      scan,
      reviewer: reviewerVerdict,
      reason: 'security-reviewer verdict is suspicious; an explicit securityOverride is required to proceed',
    };
  }

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
    scan,
    reviewer: reviewerVerdict,
  };
}
