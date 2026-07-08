// src/pack-reconcile.js
// TASK-118 — Skills env-probe + reconcile planner (pure). Wave-1 reconciler
// core (docs/design/addon-packs-plan.md §2 reconcile contract, §8 graceful
// degradation). Builds on the two landed Phase-A contracts:
//   - src/pack-descriptor.js  — desired resources come from a validated
//     pack descriptor's resources[] (bare ids, e.g. "shadcn-vue").
//   - src/integrations-lock.js — the lockfile's resources are keyed by a
//     kind-prefixed id ("skill:shadcn-vue", "mcp:firecrawl" — see the doc's
//     §2 examples). isOrphaned() THROWS UnknownResourceIdError on an id not
//     in lock.resources, so orphan detection here iterates the lock's own
//     keys rather than probing isOrphaned with a desired-set id that might
//     not be in the lock.
//
// probeSkills(root) does real disk I/O: it globs .claude/skills/**/SKILL.md
// (assimilated copies land there, docs/design/addon-packs-plan.md §7/§9) and
// normalizes what it finds into `skill:<relative-path>` ids so the result
// slots directly into the same id space as the lock and the descriptor.
//
// plan(desired, lock, actual) is PURE — no fs, no network, just the diff
// rules. It only ever plans skill-kind resources (Wave-1 scope, see the
// "Wave 1 scope" note below); a non-skill desired resource is surfaced in
// `report` rather than acted on.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';

const SKILL_FILENAME = 'SKILL.md';
const PROVENANCE_HEADING = '## Sources & provenance (hivemind)';

// Recursive directory walk collecting every SKILL.md, mirroring the
// ignore-nothing walker in src/license-detect.js (no glob dependency —
// MINIMALISM.md rung 3, a native fs.readdirSync recursion covers this).
function walkSkillFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkSkillFiles(full));
    else if (entry.isFile() && entry.name === SKILL_FILENAME) out.push(full);
  }
  return out;
}

// Parse the optional "## Sources & provenance (hivemind)" section an
// assimilated skill's SKILL.md carries (docs/design/addon-packs-plan.md §7:
// origin, pin, spdx_id, integrity, assimilated_at). Format is a flat bullet
// list of `- key: value` lines under the heading, up to the next heading or
// EOF. Absent heading -> undefined (not every skill is assimilated).
function parseProvenance(text) {
  const idx = text.indexOf(PROVENANCE_HEADING);
  if (idx === -1) return undefined;
  const rest = text.slice(idx + PROVENANCE_HEADING.length);
  const nextHeadingAt = rest.search(/\n#{1,6}\s/);
  const body = nextHeadingAt === -1 ? rest : rest.slice(0, nextHeadingAt);

  const provenance = {};
  const lineRe = /^[-*]\s*([a-zA-Z_]+)\s*:\s*(.+?)\s*$/gm;
  let m;
  while ((m = lineRe.exec(body)) !== null) {
    provenance[m[1]] = m[2];
  }
  return Object.keys(provenance).length ? provenance : undefined;
}

/**
 * Probe the real filesystem for installed skills under `<root>/.claude/skills`.
 * Real disk I/O — this is the e2e half of the ticket (tests/e2e/pack-reconcile.spec.js).
 *
 * @param {string} root - project/repo root.
 * @returns {Record<string, { path: string, provenance?: Record<string,string> }>}
 *   Keyed by "skill:<relative-path-from-.claude/skills>" (forward-slash
 *   joined, so id shape matches across OSes), e.g. "skill:shadcn-vue" or
 *   "skill:group/nested-skill" for a skill nested under a subfolder.
 */
export function probeSkills(root) {
  const skillsRoot = join(root, '.claude', 'skills');
  const result = {};
  if (!existsSync(skillsRoot)) return result;

  for (const skillFile of walkSkillFiles(skillsRoot)) {
    const skillDir = dirname(skillFile);
    const relId = relative(skillsRoot, skillDir).split(sep).join('/');
    const id = `skill:${relId}`;

    let text = '';
    try {
      text = readFileSync(skillFile, 'utf8');
    } catch {
      text = '';
    }
    const provenance = parseProvenance(text);

    result[id] = provenance ? { path: skillFile, provenance } : { path: skillFile };
  }
  return result;
}

/**
 * Diff desired resources against the lock + probed actual state into a plan.
 * PURE — no fs, no network; `actual` is the already-probed output of
 * probeSkills (or an equivalent stand-in in tests).
 *
 * Wave-1 scope: only `kind: "skill"` desired resources are planned
 * (install/remove/replace). A non-skill desired resource (mcp/plugin,
 * Wave 2 — addon-packs-plan.md §11) is out of scope for this planner: a
 * `required: "hard"` one is a real blocking gap (the pack needs something
 * this planner can't reconcile yet) and a `required: "soft"` one degrades
 * silently per §8, surfaced only as a non-blocking gap. Neither is ever
 * installed/removed/replaced here.
 *
 * @param {Array<object>} desired - resources[] from a validated pack descriptor.
 * @param {{ resources: Record<string, object> }} lock - integrations.lock.json payload.
 * @param {Record<string, object>} actual - probeSkills(root) output (or equivalent).
 * @returns {{ install: object[], remove: object[], replace: object[], report: object[] }}
 */
export function plan(desired, lock, actual) {
  const install = [];
  const remove = [];
  const replace = [];
  const report = [];

  const desiredList = Array.isArray(desired) ? desired : [];
  const lockResources = (lock && lock.resources) || {};
  const actualMap = actual || {};

  for (const resource of desiredList) {
    if (!resource) continue;

    if (resource.kind !== 'skill') {
      report.push({
        id: `${resource.kind}:${resource.id}`,
        reason: `resource kind "${resource.kind}" is out of scope for the Wave-1 (skills-only) planner`,
        blocking: resource.required === 'hard',
      });
      continue;
    }

    const id = `skill:${resource.id}`;
    const lockEntry = lockResources[id];
    const actualEntry = actualMap[id];

    if (!lockEntry && !actualEntry) {
      install.push({ id, resource });
      continue;
    }

    const currentPin = lockEntry ? lockEntry.pin : actualEntry?.provenance?.pin;
    if (currentPin !== undefined && currentPin !== resource.pin) {
      replace.push({ id, resource, from: currentPin, to: resource.pin });
    }
    // else: pins match (or there's no recorded pin to compare) -> no-op.
  }

  // Orphan removal only ever walks the lock's OWN keys (never a desired-set
  // id) — isOrphaned() in src/integrations-lock.js throws UnknownResourceIdError
  // on an id absent from lock.resources, so this mirrors that contract even
  // though we inline the owners-empty check here to stay fs/lock-object-free.
  for (const [id, entry] of Object.entries(lockResources)) {
    if (!entry || entry.kind !== 'skill') continue; // Wave 1 scope
    const owners = Array.isArray(entry.owners) ? entry.owners : [];
    const orphaned = owners.length === 0;
    if (orphaned && entry.required === 'soft') {
      remove.push({ id, entry });
    }
    // orphaned && required === 'hard': safe-removal needs owners-empty AND
    // (soft OR trust-mode) per addon-packs-plan.md §2 — trust-mode is a
    // later concern, so a hard orphan is left in place, not removed.
  }

  return { install, remove, replace, report };
}
