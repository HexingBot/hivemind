// src/claude-md.js
// TASK-025 — Plugin chain P5: the project-level CLAUDE.md routing activation.
//
// A plugin-root CLAUDE.md is NOT loaded as orchestrator context, so /init-project
// must MERGE an activation block into the USER's project-level CLAUDE.md. The
// user's own content is sacred — never clobbered; only a fenced marker block is
// owned by the framework.
//
// This module is split into a PURE merge core (mergeRoutingBlock +
// routingBlockContent, no disk I/O — unit-tested by tests/claude-md-merge.spec.js)
// and a thin disk writer (writeOrchestratorRouting, driven by runInit and
// exercised end-to-end by tests/claude-md-init.spec.js). The consent decision
// lives in the CALLER (bin/init.js); this module only knows how to merge and
// write once told to.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// The EXACT delimiter lines. Only the bytes BETWEEN (and including) these two
// markers are owned by the framework; everything else in the file is the user's.
export const BEGIN_MARKER = '<!-- BEGIN hivemind routing -->';
export const END_MARKER = '<!-- END hivemind routing -->';

/**
 * The canonical orchestrator activation, worded to the v2 pointer+bundle session
 * model. This is the inner body of the routing block: the RESUME-FIRST four-step
 * sequence, the First-chat routing rule (PROJECT.md absent → init-project), the
 * workflow loop, and repo etiquette. It must NOT carry any v1 single-file archive
 * language (no <updated_at>.json, no "idle template" reset).
 *
 * @returns {string}
 */
export function routingBlockContent() {
  return [
    '## Orchestrator activation (hivemind)',
    '',
    'This project is operated by a multi-agent team. The main thread is the',
    '**Orchestrator**: it plans and delegates to the `researcher`, `developer`, and',
    '`reviewer` subagents — it does not write production code itself.',
    '',
    '### RESUME-FIRST (do this before anything else in every new chat)',
    '',
    'Session state is split across two layers: a tiny **pointer file** at',
    '`state/session.json` (`schema_version`, `active_session_id`, `updated_at`) and a',
    'self-contained **bundle directory** at `state/sessions/<active_session_id>/`',
    'whose own `session.json` holds the substantive state (`workflow_step`,',
    '`handoff_summary`, `next_action`, `open_questions`, `blockers`, `decisions`,',
    '`subagent_results`). The very first action of every new chat is:',
    '',
    '1. Read `state/session.json` (the pointer). If it is absent or',
    '   `active_session_id` is null, the orchestrator is idle — confirm with the',
    '   human before starting a new session.',
    '2. If `active_session_id` is non-null, read',
    '   `state/sessions/<active_session_id>/session.json` for the handoff state.',
    '3. If that bundle\'s `active_task` is non-null, read `tasks/<active_task>.json`',
    '   to load the work item.',
    '4. Restate `handoff_summary` and `next_action` to the human in one short',
    '   paragraph and confirm before acting.',
    '',
    '### First-chat routing',
    '',
    'If `PROJECT.md` does not exist in the repo root, the framework has not been',
    'initialized for this project — run the `/init-project` command (the project',
    'intake wizard) before any other workflow step. If `PROJECT.md` already exists,',
    'proceed to RESUME-FIRST.',
    '',
    '### Workflow loop (every unit of work)',
    '',
    '1. Read the next `status: todo` ticket, extract acceptance criteria, and',
    '   assign its `verification_tier` (`tdd`, `tests-after`, or `uat-only`) if it',
    '   does not already carry one.',
    '2. Plan: decompose into research / verification / implementation / review.',
    '3. Research (if needed): spawn the `researcher` for any unknown stack.',
    '4. Verify per tier: `tdd` writes failing tests before any implementation',
    '   lands; `tests-after` implements first, then adds a minimal set of',
    '   regression locks; `uat-only` implements only and is verified by',
    '   conversational UAT with the human.',
    '5. Implement: the `developer` makes the tier\'s tests (if any) pass without',
    '   breaking existing ones.',
    '6. Review: spawn the `reviewer` in a fresh context; block on any HIGH finding.',
    '7. Update the ticket on a green review, then pause or end the session.',
    '',
    'To self-drive this loop across several tickets toward a stated goal instead',
    'of repeating these steps by hand, use `/hivemind:loop`.',
    '',
    '### Repository etiquette',
    '',
    '- Conventional Commits (`feat:`, `fix:`, `test:`, `refactor:`, `docs:`,',
    '  `chore:`); one logical change per commit.',
    '- Never commit secrets; never `--no-verify`; never force-push a shared branch.',
    '- Human-in-the-loop for destructive or irreversible actions.',
  ].join('\n');
}

/**
 * PURE merge: given the current CLAUDE.md text (or null/undefined when absent)
 * and the inner routing content, return the new full file text. Invariants:
 *   - absent  → just the marker block (markers + content).
 *   - present WITHOUT markers → user content preserved BYTE-FOR-BYTE, the block
 *     appended after it (separated by a blank line, with a trailing newline).
 *   - present WITH an existing block → replace ONLY the bytes between (and
 *     including) the markers; everything outside is byte-identical.
 *   - idempotent: re-merging the SAME routing content yields identical bytes.
 *
 * @param {string|null|undefined} existing
 * @param {string} routing
 * @returns {string}
 */
export function mergeRoutingBlock(existing, routing) {
  const block = `${BEGIN_MARKER}\n${routing}\n${END_MARKER}`;

  if (existing === null || existing === undefined || existing === '') {
    // Absent file → the block plus a trailing newline so a freshly written
    // CLAUDE.md is newline-terminated like a normal text file.
    return `${block}\n`;
  }

  const begin = existing.indexOf(BEGIN_MARKER);
  const end = existing.indexOf(END_MARKER);

  if (begin !== -1 && end !== -1 && end > begin) {
    // Replace ONLY the marked region (from BEGIN through END inclusive),
    // leaving the prefix and suffix byte-identical. This is what makes a
    // re-merge idempotent: the prefix/suffix never move and the block bytes
    // reproduce exactly for the same routing content.
    const prefix = existing.slice(0, begin);
    const suffix = existing.slice(end + END_MARKER.length);
    return `${prefix}${block}${suffix}`;
  }

  // Present, no marker block → append. Preserve the user's content verbatim;
  // ensure exactly one blank line separates it from our block, and terminate
  // with a newline.
  const sep = existing.endsWith('\n') ? '\n' : '\n\n';
  return `${existing}${sep}${block}\n`;
}

/**
 * Disk writer used by runInit. Reads the project's CLAUDE.md (if any), merges in
 * the canonical routing block, and writes it back. The caller is responsible for
 * the consent decision — by the time this is called, consent is already granted.
 *
 * @param {object} opts
 * @param {string} opts.repoRoot
 * @returns {{path: string, wrote: boolean, hadBlock: boolean}}
 */
export function writeOrchestratorRouting({ repoRoot }) {
  const path = join(repoRoot, 'CLAUDE.md');
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : null;
  const hadBlock = existing !== null && hasRoutingBlock(existing);
  const merged = mergeRoutingBlock(existing, routingBlockContent());
  if (existing !== null && merged === existing) {
    // Idempotent no-op: nothing to write.
    return { path, wrote: false, hadBlock };
  }
  writeFileSync(path, merged, 'utf8');
  return { path, wrote: true, hadBlock };
}

/**
 * Whether the given CLAUDE.md text already carries the framework's marker block.
 * Exported so the caller (bin/init.js) can implement PROMPT-ONCE: an existing
 * block means a re-run replaces it WITHOUT re-prompting for consent.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function hasRoutingBlock(text) {
  if (typeof text !== 'string') return false;
  const begin = text.indexOf(BEGIN_MARKER);
  const end = text.indexOf(END_MARKER);
  return begin !== -1 && end !== -1 && end > begin;
}

/**
 * Read the project's CLAUDE.md text, or null when absent. A small disk helper so
 * the caller can detect an existing marker block (PROMPT-ONCE) without importing
 * fs itself.
 *
 * @param {string} repoRoot
 * @returns {string|null}
 */
export function readProjectClaudeMd(repoRoot) {
  const path = join(repoRoot, 'CLAUDE.md');
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}
