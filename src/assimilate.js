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
// CONTENT SECURITY GATE (TASK-122, locked 2026-07-08; DEFAULT-DENY inversion
// TASK-140, locked 2026-07-12): license is NOT a safety assurance — a
// self-declared frontmatter license is forgeable, and says nothing about
// whether the skill's *instructions* try to exfiltrate secrets or run
// arbitrary commands. Every pending_approval/blocked_security payload
// additionally carries:
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
// on the next call. DEFAULT-DENY (TASK-140): the gate checks for the
// POSITIVE `reviewerVerdict?.verdict === 'safe'`, never the negative
// `=== 'suspicious'` — any value that is NOT exactly `'safe'` (absent,
// `'suspicious'`, an unrecognized string, a typo, differently-cased `'Safe'`,
// or an empty string) refuses the write (`status: 'blocked_security'`)
// UNLESS the caller passes an explicit `opts.securityOverride: true` (strict
// boolean; TASK-122's override semantics are unchanged — a truthy
// non-boolean value never bypasses the gate). The pre-TASK-140 gate checked
// the negative (`=== 'suspicious'`) and so failed OPEN on every other
// value, including an entirely absent verdict — that gap is what this
// inversion closes; an approve can now never write without either an
// explicit 'safe' verdict or an explicit override.
//
// TWO-HASH INTEGRITY (TASK-142, closes A4): the pre-TASK-142 code computed a
// single `integrity` hash over `source` BEFORE tagDescriptionForHivemind /
// appendProvenanceBlock rewrote the owned copy — so the recorded hash
// described the UPSTREAM source, and could never verify the actual staged
// bytes under assimilated-skills/<id>/. Now TWO hashes are recorded:
//   - `source_integrity` — sha256 of the UNMODIFIED upstream `source`,
//     computed BEFORE any rewrite (computeProvenanceFields, unchanged
//     computation from before — only the field name changed).
//   - `content_integrity` — sha256 of the OWNED artifact as staged, computed
//     AFTER the description-tag + provenance-block rewrite (the exact bytes
//     an approve commits). Self-referential (the hash is over bytes that
//     include the block that carries the hash) — resolved by the ONE
//     documented rule at src/pack-apply.js#hashOwnedSkillDir (imported
//     below): the WELL-FORMED `- content_integrity: ...` value, scoped to
//     inside the provenance block, is canonicalized away before hashing, so
//     the writer here and the verifier in src/pack-apply.js#executeInstall
//     always agree byte-for-byte. See rescopeWithContentIntegrity below for
//     why the final on-disk text is built by calling buildProvenanceBlock a
//     SECOND time with the real value (never a text-wide regex splice) —
//     that HIGH (reviewer-reproduced post-approve tamper hole plus a
//     duplicate-line hazard) is closed by construction, not by a broader
//     regex.
// The verifier side (src/pack-apply.js's TOCTOU close, A3) re-hashes the
// staged bytes against `content_integrity` immediately before materialize
// and fails closed on a mismatch — see that module's header for the full
// contract and its documented backward-compat handling of pre-TASK-142
// (`integrity`-only) lock entries.

import { existsSync, mkdirSync, rmSync, cpSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';

import { detectLicense, classifyLicense } from './license-detect.js';
import { readLock, writeLock, addOwner } from './integrations-lock.js';
import { hashDir, hashOwnedSkillDir } from './pack-apply.js';
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
// expects: a flat `- key: value` bullet list under the heading. TASK-142:
// two integrity lines now, not one -- see the module header's TWO-HASH
// INTEGRITY note.
function buildProvenanceBlock({ origin, pin, spdx_id, source_integrity, content_integrity, assimilated_at }) {
  return [
    PROVENANCE_HEADING,
    '',
    `- origin: ${origin}`,
    `- pin: ${pin}`,
    `- spdx_id: ${spdx_id}`,
    `- source_integrity: ${source_integrity}`,
    `- content_integrity: ${content_integrity}`,
    `- assimilated_at: ${assimilated_at}`,
    '',
  ].join('\n');
}

function appendProvenanceBlock(text, fields) {
  const base = text.endsWith('\n') ? text : `${text}\n`;
  return `${base}\n${buildProvenanceBlock(fields)}`;
}

// Shared by the pending_approval preview and the real write: both need the
// exact same source_integrity hash (over the UNMODIFIED source, before any
// description-tag/provenance-block rewrite) and the exact same clock read,
// so a human reviewing a pending_approval payload sees the real values an
// approve would commit -- not a second, possibly-different computation.
// content_integrity is NOT computed here -- it depends on the rewritten
// text/bytes, which don't exist yet at this point; see
// rescopeWithContentIntegrity below.
function computeProvenanceFields(source, { origin, pin, spdx_id, now }) {
  return {
    origin,
    pin,
    spdx_id,
    source_integrity: `sha256:${hashDir(source)}`,
    assimilated_at: now(),
  };
}

// TASK-142 -- the ONE place both the pending_approval preview and the real
// approve-time write compute the rewritten SKILL.md text + its
// content_integrity, so they can never diverge. `originalSkillText` is the
// SKILL.md text BEFORE any rewrite; `hashDirPath` is the directory
// hashOwnedSkillDir should walk for every OTHER file (the pending_approval
// preview passes the untouched `source` dir -- nothing has been copied yet;
// the approve path passes `ownedDir`, already cpSync'd from `source` but with
// its SKILL.md not yet overwritten). Either way, hashOwnedSkillDir's
// `skillText` override means the CURRENT on-disk SKILL.md content at
// `hashDirPath` is never read -- only the rewritten text computed here is
// hashed for that one file, so this works identically whether or not the
// rewrite has actually been written to disk yet.
//
// Resolves the self-reference (content_integrity's line is part of what it
// hashes) by writing the TRANSIENT placeholder "(pending)" into that line,
// hashing (hashOwnedSkillDir canonicalizes that exact well-formed value away,
// scoped to inside the provenance block -- see that function's header),
// then building the FINAL text by calling buildProvenanceBlock a SECOND time
// with the real computed value, rather than text-splicing the placeholder
// occurrence via a regex. This is deliberate, not an optimization: a
// text-wide regex replace (the pre-fix approach) replaces only the FIRST
// match in the whole file, which is WRONG the moment a skill's own BODY
// happens to contain a line shaped like `- content_integrity: sha256:...`
// (the body always precedes the appended block, so it would "win" the
// first-match race) -- reviewer-reproduced HIGH/MEDIUM. Reconstructing the
// tail deterministically from `fields` sidesteps text search entirely: there
// is no scanning of body content, so a decoy line can never be targeted by
// the splice, and the provenance block always attests to the value that was
// actually hashed.
function rescopeWithContentIntegrity(originalSkillText, fields, hashDirPath) {
  const taggedText = tagDescriptionForHivemind(originalSkillText);
  const withPlaceholder = appendProvenanceBlock(taggedText, { ...fields, content_integrity: '(pending)' });
  const contentIntegrity = `sha256:${hashOwnedSkillDir(hashDirPath, { skillText: withPlaceholder })}`;
  const finalFields = { ...fields, content_integrity: contentIntegrity };
  const finalText = appendProvenanceBlock(taggedText, finalFields);
  const block = buildProvenanceBlock(finalFields);
  return { finalText, contentIntegrity, block };
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

// TASK-144 -- strict-shape validation seam for opts.reviewerVerdict. The
// security-reviewer subagent (.claude/agents/security-reviewer.md) and
// hivemind-assimilate-skill Step 4 both commit to a STRICT return shape,
// { verdict: 'safe'|'suspicious', reasoning: string }, exactly two keys, no
// more, no fewer. Without this seam, assimilateSkill's default-deny gate
// (TASK-140) only ever inspects `reviewerVerdict?.verdict === 'safe'` --
// which correctly DENIES any wrong verdict *value* ('unsafe', 'Safe', '',
// absent -- all already regression-locked by the TASK-140 default-deny
// matrix in tests/e2e/assimilate.spec.js and must keep returning
// status:'blocked_security', never throwing) but says nothing about the rest
// of the object's SHAPE. A caller (a buggy Orchestrator-side JSON parse of
// the subagent's reply, a future non-CLI integration, a hand-rolled verdict)
// could hand in `{ verdict: 'safe', reasoning: 123, somethingElse: true }` --
// off-shape, but `.verdict === 'safe'` still passes the loose check and the
// write would silently proceed on a malformed object. THAT is the gap this
// closes: a verdict object that IS present is validated structurally
// (correct type, exactly the two expected keys, both fields the right
// primitive type) and a violation is a HARD, SURFACED throw -- never folded
// into the deny path and never silently treated as safe.
//
// Deliberately scoped, matching the ALREADY-LOCKED TASK-140 behavior this
// ticket aligns with rather than replaces:
//   - `reviewerVerdict` itself absent (null/undefined) is the legitimate
//     "not yet reviewed" state (no security-reviewer spawn has happened yet,
//     or a pending_approval preview is being computed before Step 4 runs).
//     That is NOT an error here -- it is left to the existing default-deny
//     gate, which already, correctly, refuses the write
//     (status:'blocked_security') for an absent verdict on approve. Throwing
//     here for "absent" would break that already-regression-locked contract
//     (tests/e2e/assimilate.spec.js's DEFAULT_DENY_MATRIX 'absent
//     reviewerVerdict' case, tests/e2e/pack-ctl.spec.js's
//     "no_security_verdict_at_all" case).
//   - `reviewerVerdict.verdict` holding a well-typed but UNRECOGNIZED string
//     ('unsafe', 'Safe', '', 'suspicious') is likewise NOT a shape violation
//     -- the key exists, the value is a string, the object is otherwise
//     well-formed. That is a VALUE the deny gate already handles correctly
//     (denies, does not throw); this validator only reaches for shape bugs
//     the deny gate cannot see (wrong type, wrong key set, wrong field
//     types) -- the exact case where an "off-shape but verdict says safe"
//     object could otherwise slip through undetected.
export function validateReviewerVerdict(reviewerVerdict) {
  if (reviewerVerdict === null || reviewerVerdict === undefined) return;

  if (typeof reviewerVerdict !== 'object' || Array.isArray(reviewerVerdict)) {
    throw new Error(
      `assimilateSkill: reviewerVerdict must be an object shaped { verdict: 'safe'|'suspicious', reasoning: string }, got ${JSON.stringify(reviewerVerdict)}`,
    );
  }

  const REQUIRED_KEYS = ['verdict', 'reasoning'];
  const keys = Object.keys(reviewerVerdict);
  const missing = REQUIRED_KEYS.filter((k) => !keys.includes(k));
  const extra = keys.filter((k) => !REQUIRED_KEYS.includes(k));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `assimilateSkill: reviewerVerdict has an off-shape key set (expected exactly ["verdict","reasoning"]; missing: ${JSON.stringify(missing)}, extra: ${JSON.stringify(extra)})`,
    );
  }

  if (typeof reviewerVerdict.verdict !== 'string') {
    throw new Error(
      `assimilateSkill: reviewerVerdict.verdict must be a string, got ${JSON.stringify(reviewerVerdict.verdict)} (${typeof reviewerVerdict.verdict})`,
    );
  }

  if (typeof reviewerVerdict.reasoning !== 'string') {
    throw new Error(
      `assimilateSkill: reviewerVerdict.reasoning must be a string, got ${JSON.stringify(reviewerVerdict.reasoning)} (${typeof reviewerVerdict.reasoning})`,
    );
  }
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
 *   status. DEFAULT-DENY (TASK-140): on `decision: 'approve'`, the write
 *   proceeds ONLY when `reviewerVerdict?.verdict === 'safe'` exactly — an
 *   absent reviewerVerdict, an unrecognized string, a typo, wrong case, or
 *   `'suspicious'` all block (`status: 'blocked_security'`) unless
 *   `opts.securityOverride === true`. STRICT SHAPE (TASK-144): when present,
 *   this must be an object with exactly the keys `verdict` (string) and
 *   `reasoning` (string) — validated by `validateReviewerVerdict` before any
 *   other work; an off-shape object throws synchronously rather than being
 *   silently folded into the deny path.
 * @param {boolean} [opts.securityOverride] - explicit human override that
 *   allows `decision: 'approve'` to proceed despite a non-'safe'
 *   `reviewerVerdict`. Default false. Strict boolean `true` only — a truthy
 *   non-boolean value (e.g. the string `'true'`) does NOT override. Has no
 *   effect when the verdict is already 'safe'.
 * @returns {Promise<object>} `{ status: 'pending_approval'|'declined'|'blocked_security'|'assimilated', id, spdx_id, classification, scan, reviewer, ... }`.
 *   A `pending_approval` payload additionally carries `origin`, `pin`,
 *   `source_integrity`, `content_integrity` (TASK-142 -- two hashes, not one;
 *   see the module header's TWO-HASH INTEGRITY note), `assimilated_at`, and
 *   `provenance_preview` (the exact provenance-block text an `approve` would
 *   write), plus `scan` (structured risky-pattern findings, src/skill-scan.js)
 *   and `reviewer` (the injected verdict, or null) — everything a human needs
 *   to decide, computed WITHOUT writing anything. A `blocked_security`
 *   payload (reachable via `decision: 'approve'` whenever
 *   `reviewerVerdict?.verdict !== 'safe'` — absent, `'suspicious'`, or any
 *   other non-'safe' value — and `securityOverride` is not strictly `true`)
 *   carries the same `scan`/`reviewer` fields and also writes NOTHING — an
 *   approve alone can never write without a 'safe' verdict or an explicit
 *   override. A `blocked_provenance` status (TASK-143, reachable for ANY
 *   `decision`, including no decision at all) means `source`'s own SKILL.md
 *   already contains a "## Sources & provenance (hivemind)" heading — a
 *   third-party skill must never arrive carrying a hivemind-authored
 *   provenance block (forgeable origin/pin/integrity that could otherwise
 *   masquerade as genuine). Writes NOTHING; carries only `id`, `status`, and
 *   `reason` — checked before license detection/scanning even run, so no
 *   `spdx_id`/`classification`/`scan`/`reviewer` fields are present.
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

  // TASK-144 -- hard, surfaced error on an off-shape (present but malformed)
  // reviewerVerdict, BEFORE any other work; see validateReviewerVerdict's
  // header for exactly what counts as off-shape vs. an already-locked
  // legitimate deny value. Throws synchronously (this function is async, so
  // the throw becomes a rejected promise -- callers already `await` this
  // call and must handle rejection same as any other thrown Error here).
  validateReviewerVerdict(reviewerVerdict);

  const sourceSkillPath = join(source, SKILL_FILENAME);
  if (!existsSync(sourceSkillPath)) {
    throw new Error(`assimilateSkill: no ${SKILL_FILENAME} found at "${source}"`);
  }

  // TASK-143 (security, provenance spoofing) -- WRITER half of a
  // defense-in-depth fix; the PARSER half is src/pack-reconcile.js#parseProvenance's
  // matching lastIndexOf change (that module's TASK-143 comment). A malicious
  // (or accidentally pre-seeded) third-party skill could ship its OWN
  // "## Sources & provenance (hivemind)" heading -- forged origin/pin/spdx_id/
  // integrity/assimilated_at -- and, pre-fix, that FIRST-in-file forged block
  // shadowed the genuine block src/assimilate.js appends at the END (reconcile's
  // old text.indexOf first-match parse). DECISION (documented, per the ticket's
  // own guidance): REFUSE, not strip. This module's HUMAN-GATE POLICY (see the
  // header above) already makes the human's `decision: 'approve'` the sole
  // write authority, so a typed refusal here is simpler to reason about than a
  // strip that could itself be gamed (e.g. a heading value crafted to survive
  // whatever strip regex was chosen, or a strip that silently proceeds without
  // the human ever knowing the source was tampered with). Checked
  // unconditionally -- before license detection or content scanning, and
  // regardless of `decision` -- so a poisoned source is refused even at the
  // pending_approval preview stage; a human reviewing a preview should never
  // see numbers computed from bytes that would be refused on approve anyway.
  // A skill with no such heading is completely unaffected (existing behavior
  // preserved) -- this is a pure pre-check, not a rewrite of anything below.
  const sourceSkillText = readFileSync(sourceSkillPath, 'utf8');
  if (sourceSkillText.includes(PROVENANCE_HEADING)) {
    return {
      id: resourceId,
      status: 'blocked_provenance',
      reason: `source SKILL.md at "${source}" already contains a "${PROVENANCE_HEADING}" heading -- a third-party skill must not arrive carrying a hivemind-authored provenance block; refusing to assimilate`,
    };
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
    // and the (possibly not-yet-computed) reviewer verdict. TASK-142: the
    // preview now carries content_integrity too -- a best-effort hash of what
    // the OWNED artifact would be if approved on these exact upstream bytes
    // right now (see rescopeWithContentIntegrity; `source` itself, not yet
    // copied anywhere, stands in for the not-yet-existing ownedDir).
    const fields = computeProvenanceFields(source, { origin, pin, spdx_id: license.spdx_id, now });
    const scan = computeSkillScan(source, sourceSkillPath);
    // TASK-143 -- reuse the same read the provenance-heading guard above
    // already performed rather than reading sourceSkillPath a second time;
    // the guard already proved this text carries no pre-existing heading.
    const { contentIntegrity, block } = rescopeWithContentIntegrity(sourceSkillText, fields, source);
    return {
      ...base,
      status: 'pending_approval',
      origin: fields.origin,
      pin: fields.pin,
      source_integrity: fields.source_integrity,
      content_integrity: contentIntegrity,
      assimilated_at: fields.assimilated_at,
      provenance_preview: block,
      scan,
      reviewer: reviewerVerdict,
    };
  }

  // decision === 'approve' -- for ANY classification, but TASK-122/TASK-140's
  // content security gate can still refuse the write. DEFAULT-DENY
  // (TASK-140): the write proceeds ONLY when reviewerVerdict?.verdict ===
  // 'safe' exactly -- absent, unrecognized, differently-cased, empty, or
  // 'suspicious' ALL block, unless the caller passes an explicit
  // securityOverride === true (strict boolean; TASK-122's override semantics
  // unchanged). Scan findings ALONE never block -- they're surfaced for the
  // human, same as license classification.
  const scan = computeSkillScan(source, sourceSkillPath);
  if (reviewerVerdict?.verdict !== 'safe' && securityOverride !== true) {
    return {
      ...base,
      status: 'blocked_security',
      scan,
      reviewer: reviewerVerdict,
      reason: `security-reviewer verdict is ${JSON.stringify(reviewerVerdict?.verdict ?? null)}, not "safe" (default-deny); an explicit securityOverride is required to proceed`,
    };
  }

  const fields = computeProvenanceFields(source, { origin, pin, spdx_id: license.spdx_id, now });

  const ownedDir = join(root, DEFAULT_STAGING_SUBDIR, resourceId);
  mkdirSync(dirname(ownedDir), { recursive: true });
  rmSync(ownedDir, { recursive: true, force: true }); // clean-replace: re-assimilate is idempotent
  cpSync(source, ownedDir, { recursive: true });

  // TASK-142 -- content_integrity (over the OWNED artifact, post-rewrite) is
  // computed and folded into the SAME write as the description-tag +
  // provenance-block rewrite; see rescopeWithContentIntegrity's header for
  // why the final text is deterministically REBUILT (not text-spliced) --
  // the fix for the reviewer-reproduced HIGH/MEDIUM.
  const ownedSkillPath = join(ownedDir, SKILL_FILENAME);
  const original = readFileSync(ownedSkillPath, 'utf8');
  const { finalText, contentIntegrity } = rescopeWithContentIntegrity(original, fields, ownedDir);
  writeFileSync(ownedSkillPath, finalText, 'utf8');

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
    source_integrity: fields.source_integrity,
    content_integrity: contentIntegrity,
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
    source_integrity: fields.source_integrity,
    content_integrity: contentIntegrity,
    assimilated_at: fields.assimilated_at,
    owners: lock.resources[id].owners,
    scan,
    reviewer: reviewerVerdict,
  };
}
