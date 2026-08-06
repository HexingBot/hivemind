#!/usr/bin/env node
/**
 * repin.mjs — Plugin-level SessionStart hook: re-pin context-monitor paths.
 *
 * Problem: init bakes a LITERAL ABSOLUTE path to the plugin scripts into a
 * project's .claude/settings.json. After a plugin version update, that path
 * becomes STALE (the scripts move to a new versioned directory), silently
 * breaking the statusline + hooks.
 *
 * Solution: this script runs as a plugin-level SessionStart hook. Because it
 * runs inside the PLUGIN'S OWN hooks/hooks.json, ${CLAUDE_PLUGIN_ROOT} IS
 * expanded by Claude Code — giving us the CURRENT plugin root each session.
 *
 * What it does:
 *   1. Locates the consuming project's .claude/settings.json.
 *   2. Checks whether any baked context-monitor paths differ from the current
 *      plugin root's context-monitor/ directory.
 *   3. If stale paths are found, rewrites ONLY those paths (atomic write).
 *   4. No-ops if paths are already current (idempotent).
 *   5. NEVER injects new context-monitor entries (heal-only, never force-enable).
 *   6. Never throws — a re-pin failure must not block the session.
 *   7. TASK-209 — when (and only when) it actually repairs a stale path, prints
 *      a SessionStart hookSpecificOutput.additionalContext note to stdout (the
 *      same channel session-start.mjs already uses for HANDOFF.md restoration)
 *      so the repair is visible in the session transcript instead of silent.
 *      A no-op run (paths already current) prints nothing, same as before.
 *
 * Project root resolution (priority order):
 *   1. stdin JSON `cwd` field (standard hook input)
 *   2. CLAUDE_PROJECT_DIR env var
 *   3. process.cwd()
 *
 * Plugin root resolution:
 *   CLAUDE_PLUGIN_ROOT env var (set by Claude Code when running as a plugin hook)
 *
 * Deps: node builtins only (no package.json dependencies).
 */

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit-testing)
// ---------------------------------------------------------------------------

/**
 * Returns true if `cmd` references a context-monitor script by filename.
 *
 * @param {string|null|undefined} cmd
 * @returns {boolean}
 */
export function isContextMonitorCommand(cmd) {
  if (typeof cmd !== 'string' || cmd.length === 0) return false;
  // Any of the four shipped context-monitor scripts.
  return (
    /statusline\.mjs/.test(cmd) ||
    /stop-hook\.mjs/.test(cmd) ||
    /session-start\.mjs/.test(cmd) ||
    /repin\.mjs/.test(cmd)
  );
}

/**
 * Rewrite the directory prefix of a context-monitor command from `oldCmDir`
 * to `newCmDir`.  The script filename (everything after the last separator) is
 * preserved verbatim.
 *
 * @param {string} cmd      - the full command string, e.g. `node "/old/path/statusline.mjs"`
 * @param {string} oldCmDir - the stale directory
 * @param {string} newCmDir - the current directory
 * @returns {string} the command with the path replaced
 */
export function repinCommand(cmd, oldCmDir, newCmDir) {
  if (oldCmDir === newCmDir) return cmd;
  // Use a simple string replacement: find the oldCmDir prefix anywhere in the command.
  // We replace ALL occurrences in case of edge cases, though there should be only one.
  return cmd.split(oldCmDir).join(newCmDir);
}

/**
 * Normalize a path to use forward slashes (cross-platform canonical form for comparisons).
 * Preserves UNC paths and Windows drive letters.
 *
 * @param {string} p
 * @returns {string}
 */
function normalizeSeps(p) {
  return p.replace(/\\/g, '/');
}

/**
 * Inspect and (if needed) rewrite context-monitor paths in an in-memory
 * settings object. This is the pure, disk-free core of the re-pin logic.
 *
 * Contract:
 *   - heal-only: only existing context-monitor entries are rewritten; no new
 *     entries are injected.
 *   - idempotent: returns needsWrite=false when all paths already equal newCmDir.
 *   - safe on edge cases: null/undefined/array settings → {needsWrite: false, settings: input}.
 *   - does not mutate the input object.
 *
 * @param {object|null|undefined} settings - parsed settings object
 * @param {string} newCmDir - the current context-monitor directory
 * @returns {object & { needsWrite: boolean, repairedCount: number }} — the
 *   (possibly-repinned) settings object with `needsWrite`/`repairedCount`
 *   mixed in. `repairedCount` (TASK-209) is the number of individual command
 *   strings actually rewritten (0 when nothing was stale) — it is what lets
 *   callers report the repair rather than perform it silently. For
 *   non-object inputs (null/undefined/array), returns
 *   `{ needsWrite: false, repairedCount: 0 }`.
 */
export function repinSettingsObject(settings, newCmDir) {
  // Guard: must be a plain, non-array object.
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return { needsWrite: false, repairedCount: 0 };
  }

  // Normalize newCmDir for comparison (cross-platform).
  const newCmDirNorm = normalizeSeps(newCmDir);

  let needsWrite = false;
  let repairedCount = 0;
  const out = { ...settings };

  // --- statusLine ---
  if (
    out.statusLine &&
    typeof out.statusLine === 'object' &&
    typeof out.statusLine.command === 'string' &&
    isContextMonitorCommand(out.statusLine.command)
  ) {
    // Detect the old cm dir from the existing command path.
    const oldDir = detectCmDir(out.statusLine.command);
    if (oldDir && normalizeSeps(oldDir) !== newCmDirNorm) {
      out.statusLine = {
        ...out.statusLine,
        command: repinCommand(out.statusLine.command, oldDir, newCmDir),
      };
      needsWrite = true;
      repairedCount += 1;
    }
  }

  // --- hooks ---
  if (out.hooks && typeof out.hooks === 'object' && !Array.isArray(out.hooks)) {
    const newHooks = { ...out.hooks };
    let hooksChanged = false;

    for (const eventName of Object.keys(newHooks)) {
      const arr = newHooks[eventName];
      if (!Array.isArray(arr)) continue;

      let arrChanged = false;
      const newArr = arr.map((entry) => {
        if (!entry || typeof entry !== 'object') return entry;
        if (typeof entry.command !== 'string') return entry;
        if (!isContextMonitorCommand(entry.command)) return entry;

        const oldDir = detectCmDir(entry.command);
        if (!oldDir || normalizeSeps(oldDir) === newCmDirNorm) return entry;

        arrChanged = true;
        repairedCount += 1;
        return { ...entry, command: repinCommand(entry.command, oldDir, newCmDir) };
      });

      if (arrChanged) {
        newHooks[eventName] = newArr;
        hooksChanged = true;
      }
    }

    if (hooksChanged) {
      out.hooks = newHooks;
      needsWrite = true;
    }
  }

  // Return the repinned settings merged with the needsWrite/repairedCount
  // flags so callers can do both `const { needsWrite } = repinSettingsObject(...)`
  // and `result.statusLine.command` on the same return value.
  return { ...out, needsWrite, repairedCount };
}

/**
 * Extract the context-monitor directory from a command string by finding the
 * parent directory of the referenced .mjs script.
 *
 * Examples:
 *   `node "/old/v1/context-monitor/statusline.mjs"` → `/old/v1/context-monitor`
 *   `node /old/v1/context-monitor/statusline.mjs`   → `/old/v1/context-monitor`
 *
 * @param {string} cmd
 * @returns {string|null}
 */
function detectCmDir(cmd) {
  // Match a quoted or unquoted path ending in one of the known scripts.
  const m = cmd.match(/"([^"]+(?:statusline|stop-hook|session-start|repin)\.mjs)"|([^\s"]+(?:statusline|stop-hook|session-start|repin)\.mjs)/);
  if (!m) return null;
  const scriptPath = m[1] || m[2];
  // Return the directory containing the script.
  return dirname(scriptPath);
}

// ---------------------------------------------------------------------------
// Disk-level repin (exported for e2e testing)
// ---------------------------------------------------------------------------

/**
 * Read, re-pin, and atomically write the project's .claude/settings.json.
 *
 * @param {object} opts
 * @param {string} opts.projectRoot   - absolute path to the consuming project root
 * @param {string} opts.currentCmDir  - the current context-monitor directory
 * @returns {Promise<{ wrote: boolean, path: string, repairedCount: number }>}
 *   `repairedCount` (TASK-209) is always present so callers can decide whether
 *   to report the repair; it is 0 whenever `wrote` is false.
 */
export async function repinFile({ projectRoot, currentCmDir }) {
  const settingsPath = join(projectRoot, '.claude', 'settings.json');

  // If the settings file doesn't exist, nothing to heal.
  if (!existsSync(settingsPath)) {
    return { wrote: false, path: settingsPath, repairedCount: 0 };
  }

  // Read and parse — silent no-op on malformed JSON.
  let parsed;
  try {
    const raw = readFileSync(settingsPath, 'utf8');
    parsed = JSON.parse(raw);
  } catch {
    return { wrote: false, path: settingsPath, repairedCount: 0 };
  }

  // Run the pure re-pin logic. The return value has needsWrite + repairedCount + settings props spread in.
  const repinned = repinSettingsObject(parsed, currentCmDir);
  if (!repinned.needsWrite) {
    return { wrote: false, path: settingsPath, repairedCount: 0 };
  }

  // Serialize: exclude the synthetic needsWrite/repairedCount flags from the JSON output.
  const { needsWrite: _nw, repairedCount, ...settingsToWrite } = repinned;
  const serialized = JSON.stringify(settingsToWrite, null, 2) + '\n';

  // Atomic write: write to a temp file in the same directory, then rename.
  // (Same-directory temp ensures rename is on the same filesystem.)
  const claudeDir = dirname(settingsPath);
  mkdirSync(claudeDir, { recursive: true });
  const tmpPath = join(claudeDir, `.repin-${randomBytes(6).toString('hex')}.tmp`);
  try {
    writeFileSync(tmpPath, serialized, 'utf8');
    renameSync(tmpPath, settingsPath);
  } catch (err) {
    // Clean up the temp file on failure; swallow error.
    try {
      if (existsSync(tmpPath)) {
        const { unlinkSync } = await import('node:fs');
        unlinkSync(tmpPath);
      }
    } catch { /* ignore */ }
    return { wrote: false, path: settingsPath, repairedCount: 0 };
  }

  return { wrote: true, path: settingsPath, repairedCount };
}

// ---------------------------------------------------------------------------
// AC2 signal (TASK-209) — the message shown when a repair actually happened
// ---------------------------------------------------------------------------

/**
 * Build the SessionStart additionalContext note reporting a completed repair.
 * Pure/exported for testing so the wording is locked without spawning a
 * subprocess for every assertion.
 *
 * @param {number} repairedCount - number of command strings rewritten (> 0)
 * @returns {string}
 */
export function buildRepinReportMessage(repairedCount) {
  const plural = repairedCount === 1 ? '' : 's';
  return (
    `hivemind: repaired ${repairedCount} stale context-monitor path${plural} in ` +
    '.claude/settings.json. They pointed at a previously-installed plugin version ' +
    'that no longer exists on disk (expected after `/plugin update`) — the ' +
    'statusline and context-monitor hooks are now re-pointed at the current install. ' +
    'No action needed.'
  );
}

// ---------------------------------------------------------------------------
// Main entry (when invoked as a hook subprocess)
// ---------------------------------------------------------------------------

/**
 * Resolve the consuming project root from the hook's stdin JSON.
 * Priority: stdin.cwd → CLAUDE_PROJECT_DIR env → process.cwd()
 */
function resolveProjectRoot() {
  // Read hook stdin (non-blocking; hook subprocesses receive JSON on stdin).
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
 * Resolve the current plugin root. When running as a plugin hook subprocess,
 * CLAUDE_PLUGIN_ROOT is set by Claude Code.
 */
function resolveCurrentPluginRoot() {
  if (process.env.CLAUDE_PLUGIN_ROOT && process.env.CLAUDE_PLUGIN_ROOT.length > 0) {
    return process.env.CLAUDE_PLUGIN_ROOT;
  }
  // Fallback: derive from this file's location (this file is at
  // <plugin-root>/context-monitor/repin.mjs, so go up two levels).
  const here = import.meta.url
    ? dirname(fileURLToPath(import.meta.url))
    : (typeof __dirname !== 'undefined' ? __dirname : process.cwd());
  // here is <plugin-root>/context-monitor/; plugin root is one level up.
  return join(here, '..');
}

// ---------------------------------------------------------------------------
// Main entry (when invoked as a hook subprocess, not imported by tests)
// ---------------------------------------------------------------------------

// Main-module check: compare this file's path to process.argv[1].
// When imported by vitest, process.argv[1] points at vitest's runner,
// not this file — so the check correctly skips the hook body.
const __selfPath = import.meta.url
  ? fileURLToPath(import.meta.url)
  : '';
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
  const pluginRoot = resolveCurrentPluginRoot();
  const currentCmDir = join(pluginRoot, 'context-monitor');

  try {
    const result = await repinFile({ projectRoot, currentCmDir });
    // TASK-209 AC2 — only emit when a repair actually happened; a no-op run
    // (paths already current, no settings.json, malformed JSON, heal-only
    // skip) stays exactly as quiet as before.
    if (result.wrote && result.repairedCount > 0) {
      const response = {
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: buildRepinReportMessage(result.repairedCount),
        },
      };
      process.stdout.write(JSON.stringify(response));
    }
  } catch {
    // Exit 0 always — a re-pin failure must never block the session.
  }

  process.exit(0);
}
