#!/usr/bin/env node
/**
 * settings-migrate.mjs — Plugin-level SessionStart hook: migrate a consuming
 * project's context-monitor hook entries from the legacy FLAT shape to the
 * documented NESTED shape (TASK-210).
 *
 * Problem: `buildContextMonitorEntries` (src/claude-settings.js) used to emit
 * `{ type: 'command', command }` directly on the hooks.Stop/SessionStart
 * array elements. Per the official hooks reference and confirmed empirically
 * against `claude doctor` (TASK-210 AC1), that flat shape is INVALID — "You
 * cannot place a handler directly on the matcher group. Handlers must nest
 * inside the hooks array." — so every project initialized before this fix
 * carries hook entries that have never fired. A corrected writer
 * (writeClaudeSettings / --apply-settings) only helps NEW writes; a project
 * that already has the stale flat entry on disk needs it actively migrated.
 *
 * "A user who reads nothing gets it" (TASK-210 AC4): this script runs as a
 * PLUGIN-level SessionStart hook (registered in hooks/hooks.json, matcher
 * `startup|resume|clear|compact` — the same broad matcher repin.mjs uses),
 * so — exactly like repin.mjs's existing self-heal for stale PATHS — it
 * fires automatically on every session, in every consuming project, with no
 * user action required. Because it runs from the plugin's OWN hooks.json,
 * ${CLAUDE_PLUGIN_ROOT} is expanded, so this script's own path never goes
 * stale (same reasoning as repin.mjs).
 *
 * Composition with context-monitor/repin.mjs (TASK-209): the two hooks have
 * a clean division of labor and touch disjoint aspects of the same entries —
 *   - repin.mjs   : repairs a stale DIRECTORY PREFIX, regardless of shape
 *                   (it already traverses both flat and nested for that).
 *                   It deliberately never converts flat -> nested.
 *   - this script : converts the WRAPPING SHAPE flat -> nested, regardless
 *                   of path staleness (the migrated entry is rebuilt from the
 *                   CURRENT plugin root, so it is also path-current the
 *                   moment it's migrated). It deliberately never touches an
 *                   entry that is already correctly nested.
 * Together: after both hooks have run at least once, every context-monitor
 * entry is BOTH correctly shaped (so it actually fires) AND correctly
 * pathed (so it keeps firing across future plugin updates).
 *
 * Both are independently idempotent, heal-only (never inject an entry into a
 * project that never had one), and never throw. Because Claude Code may run
 * multiple SessionStart hooks for the same event and each does its own
 * read-modify-write of the SAME settings.json, this script re-reads the file
 * immediately before writing and silently SKIPS the write (no error, exit 0)
 * if the on-disk content changed since its initial read — avoiding a lost
 * update if it raced with repin.mjs. A skipped write is not a permanent
 * miss: both hooks run again next session, and both operations are
 * idempotent and converge to the same end-state regardless of ordering, so a
 * single-session race heals itself by the very next SessionStart at the
 * latest.
 *
 * Deps: node builtins + src/claude-settings.js (node builtins only itself —
 * fs/path/url — so this remains safe to run from a git-clone plugin install,
 * which always includes src/ alongside context-monitor/).
 */

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { buildContextMonitorEntries, migrateContextMonitorShape, resolvePluginRoot } from '../src/claude-settings.js';

/**
 * Resolve the consuming project root from the hook's stdin JSON.
 * Priority: stdin.cwd -> CLAUDE_PROJECT_DIR env -> process.cwd()
 * (mirrors repin.mjs's resolution order for consistency).
 */
function resolveProjectRoot() {
  try {
    const raw = readFileSync(0, 'utf8');
    const data = JSON.parse(raw);
    if (data && typeof data.cwd === 'string' && data.cwd.length > 0) {
      return data.cwd;
    }
  } catch {
    // stdin empty or not JSON — fall through.
  }

  if (process.env.CLAUDE_PROJECT_DIR && process.env.CLAUDE_PROJECT_DIR.length > 0) {
    return process.env.CLAUDE_PROJECT_DIR;
  }

  return process.cwd();
}

/**
 * Read, migrate (shape only), and atomically write the project's
 * .claude/settings.json. Exported for e2e testing.
 *
 * TASK-210 fix round (HIGH-1) — `readSettings` is an injectable seam (default:
 * the real `readFileSync`) that ONLY the two settings.json reads go through.
 * This exists so the write-race guard below can be exercised deterministically
 * in a spec (a real filesystem race is too timing-sensitive to hit reliably
 * in-process) by returning different bytes on the second call than the
 * first, without mocking node:fs globally or touching the atomic-write path.
 * Production callers never pass this — it always defaults to the real fs read.
 *
 * TASK-210 second fix round — `writeSettings` is the same pattern applied to
 * the write side (default: the real `writeFileSync`), so a spec can reach
 * the 'write-failed' outcome by injecting a throwing fake — cheaper and more
 * portable than real fs-permission machinery (chmod is a no-op on win32
 * directories, which is why that outcome was previously unspecced).
 *
 * @param {object} opts
 * @param {string} opts.projectRoot - absolute path to the consuming project root
 * @param {string} opts.pluginRoot  - absolute path to the CURRENT plugin root
 * @param {(path: string, enc: string) => string} [opts.readSettings] - injectable
 *   settings.json reader, defaults to the real `readFileSync`.
 * @param {(path: string, data: string, enc: string) => void} [opts.writeSettings] -
 *   injectable tmp-file writer, defaults to the real `writeFileSync`.
 * @returns {{
 *   wrote: boolean, path: string, migratedCount: number,
 *   outcome: 'no-file'|'malformed'|'nothing-to-migrate'|'skipped-race'|'write-failed'|'migrated',
 * }}
 */
export function migrateSettingsFile({
  projectRoot, pluginRoot, readSettings = readFileSync, writeSettings = writeFileSync,
}) {
  const settingsPath = join(projectRoot, '.claude', 'settings.json');

  if (!existsSync(settingsPath)) {
    return { wrote: false, path: settingsPath, migratedCount: 0, outcome: 'no-file' };
  }

  let before;
  let parsed;
  try {
    before = readSettings(settingsPath, 'utf8');
    parsed = JSON.parse(before);
  } catch {
    // TASK-210 fix round (MEDIUM-1) — distinguish "nothing to do" from "the
    // user's settings.json is broken and will never migrate this way".
    return { wrote: false, path: settingsPath, migratedCount: 0, outcome: 'malformed' };
  }

  const entries = buildContextMonitorEntries(pluginRoot);
  const { settings, changed } = migrateContextMonitorShape(parsed, entries);
  if (!changed) {
    return { wrote: false, path: settingsPath, migratedCount: 0, outcome: 'nothing-to-migrate' };
  }

  // Count how many entries were actually migrated (for the report message).
  let migratedCount = 0;
  if (settings.hooks?.Stop !== parsed.hooks?.Stop) migratedCount += 1;
  if (settings.hooks?.SessionStart !== parsed.hooks?.SessionStart) migratedCount += 1;

  // CAS-style race guard: if the file changed since we read it (e.g. a
  // concurrent repin.mjs write), skip this write entirely rather than
  // clobbering it — the next session's run will re-attempt and converge.
  let nowRaw;
  try {
    nowRaw = readSettings(settingsPath, 'utf8');
  } catch {
    return { wrote: false, path: settingsPath, migratedCount: 0, outcome: 'malformed' };
  }
  if (nowRaw !== before) {
    return { wrote: false, path: settingsPath, migratedCount: 0, outcome: 'skipped-race' };
  }

  const serialized = JSON.stringify(settings, null, 2) + '\n';
  const claudeDir = dirname(settingsPath);
  mkdirSync(claudeDir, { recursive: true });
  const tmpPath = join(claudeDir, `.settings-migrate-${randomBytes(6).toString('hex')}.tmp`);
  try {
    writeSettings(tmpPath, serialized, 'utf8');
    renameSync(tmpPath, settingsPath);
  } catch {
    try {
      if (existsSync(tmpPath)) {
        unlinkSync(tmpPath);
      }
    } catch { /* ignore */ }
    // TASK-210 fix round (MEDIUM-1) — a real write failure (EPERM, read-only
    // dir, disk full) must be distinguishable from "nothing needed doing".
    return { wrote: false, path: settingsPath, migratedCount: 0, outcome: 'write-failed' };
  }

  return { wrote: true, path: settingsPath, migratedCount, outcome: 'migrated' };
}

/**
 * Build the SessionStart additionalContext note reporting a completed
 * migration. Pure/exported for testing so the wording is locked without
 * spawning a subprocess for every assertion.
 *
 * @param {number} migratedCount
 * @returns {string}
 */
export function buildMigrateReportMessage(migratedCount) {
  const label = migratedCount === 1 ? 'entry' : 'entries';
  return (
    `hivemind: migrated ${migratedCount} context-monitor hook ${label} in ` +
    '.claude/settings.json to the schema-valid nested shape (TASK-210). They were ' +
    'written before this fix and had never fired — they now do. No action needed.'
  );
}

/**
 * Build the SessionStart additionalContext note for a NON-SUCCESS outcome
 * that must not be silently indistinguishable from "nothing needed doing"
 * (TASK-210 fix round, MEDIUM-1 — the same silent-failure class this ticket
 * exists to close). Only 'malformed' and 'write-failed' warrant surfacing:
 * 'no-file' and 'nothing-to-migrate' are legitimate, common, and already
 * quiet by design; 'skipped-race' self-heals next session and staying quiet
 * avoids alarm fatigue on a routine, expected occurrence.
 *
 * @param {'malformed'|'write-failed'} outcome
 * @returns {string|null} null if `outcome` does not warrant a note.
 */
export function buildMigrateWarningMessage(outcome) {
  if (outcome === 'malformed') {
    return (
      'hivemind: could not migrate context-monitor hook entries in ' +
      '.claude/settings.json — the file is not valid JSON. The context-monitor ' +
      'Stop/SessionStart hooks may not be firing until this file is fixed by hand.'
    );
  }
  if (outcome === 'write-failed') {
    return (
      'hivemind: found context-monitor hook entries in .claude/settings.json ' +
      'that need migrating to the schema-valid nested shape, but the write failed ' +
      '(permissions, read-only directory, or disk full). The context-monitor ' +
      'Stop/SessionStart hooks are still not firing — check .claude/settings.json ' +
      'is writable.'
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main entry (when invoked as a hook subprocess, not imported by tests)
// ---------------------------------------------------------------------------

const __selfPath = import.meta.url ? fileURLToPath(import.meta.url) : '';
const __argv1 = process.argv[1] || '';

const __isMain = Boolean(
  __selfPath &&
  __argv1 &&
  (
    __selfPath === __argv1 ||
    __selfPath.replace(/\\/g, '/') === __argv1.replace(/\\/g, '/')
  ),
);

if (__isMain) {
  const projectRoot = resolveProjectRoot();
  const pluginRoot = resolvePluginRoot();

  try {
    const result = migrateSettingsFile({ projectRoot, pluginRoot });
    let additionalContext = null;
    if (result.wrote && result.migratedCount > 0) {
      additionalContext = buildMigrateReportMessage(result.migratedCount);
    } else {
      // TASK-210 fix round (MEDIUM-1) — surface the two non-success outcomes
      // that are NOT self-evidently fine (malformed JSON / a real write
      // failure), so they are never silently indistinguishable from "nothing
      // needed doing". 'no-file', 'nothing-to-migrate', and 'skipped-race'
      // stay quiet — see buildMigrateWarningMessage's doc for why.
      additionalContext = buildMigrateWarningMessage(result.outcome);
    }
    if (additionalContext) {
      const response = {
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext,
        },
      };
      process.stdout.write(JSON.stringify(response));
    }
  } catch {
    // Exit 0 always — a migration failure must never block the session.
  }

  process.exit(0);
}
