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
 *      A no-op run (paths already current) prints nothing, same as before. The
 *      message never claims "no action needed" unless every context-monitor
 *      command found in the file resolves under the current plugin root after
 *      this run — see buildRepinReportMessage.
 *   8. TASK-209 fix round (HIGH-1) — Claude Code's hook entries can be either
 *      shape: the CANONICAL nested shape (`{ matcher?, hooks: [{ type,
 *      command }] }`, the shape hooks/hooks.json itself uses) or a LEGACY flat
 *      shape (`{ type, command }` directly on the array element) that every
 *      project initialized before the nested shape existed still carries on
 *      disk. This script's job is PATH REPAIR ONLY for whichever shape it
 *      finds — it walks BOTH and rewrites a stale directory prefix wherever it
 *      appears. It deliberately does NOT migrate a flat entry to the nested
 *      shape; that migration (and which shape gets WRITTEN for new entries)
 *      belongs to src/claude-settings.js / TASK-210, not here.
 *
 * TASK-209 AC4 rationale, RESTATED after the fix round (do not read the
 * original claim as still accurate on its own — it was conditional on this
 * script actually repairing everything, which HIGH-1 disproved):
 *   The version-pinned absolute path baked into a consumer project's
 *   settings.json is not eliminated outright (no stable-launcher indirection
 *   was built) because this file's self-heal, running as a plugin-level
 *   SessionStart hook, closes the PATH half of the failure before the user
 *   can observe it — but only the path half, and only once both hook shapes
 *   are actually walked (the HIGH-1 fix, above). What this file's repair does
 *   NOT close: whether the SHAPE written into settings.json in the first
 *   place is one Claude Code will ever execute at all. TASK-210's own finding
 *   is that the flat shape is not valid Claude Code hook syntax per the
 *   product's own docs ("you cannot place a handler directly on the matcher
 *   group") — meaning a project whose entries were ever written in the flat
 *   shape may have hooks that have never fired, independent of whether their
 *   PATH is current. Repairing a path that was never going to execute repairs
 *   nothing observable. That is a WRITER/shape defect, not a path-staleness
 *   defect, and it is TASK-210's fix, not this file's — this file only
 *   promises that whatever shape IS on disk has its path kept current.
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
 * Normalize a path for STALENESS COMPARISON only (never for the value actually
 * written back — repinCommand always uses the caller-supplied newCmDir verbatim).
 * TASK-209 fix round (LOW) — Windows filesystem paths are case-insensitive, so a
 * pure separator-only normalization still treated a case-only difference (e.g. a
 * drive letter resolved as `c:` in one context and `C:` in another) as "stale",
 * causing a spurious rewrite — and, worse, a spurious "repaired" report — every
 * session even though nothing was ever actually wrong. Only fold case on win32;
 * POSIX filesystems are legitimately case-sensitive and must not be folded.
 *
 * @param {string} p
 * @returns {string}
 */
function normalizeForCompare(p) {
  const sepsNormalized = normalizeSeps(p);
  return process.platform === 'win32' ? sepsNormalized.toLowerCase() : sepsNormalized;
}

/**
 * Repair a single command string if (and only if) it is one of ours and stale.
 *
 * @param {string} cmd
 * @param {string} newCmDirNorm - normalizeForCompare(newCmDir)
 * @param {string} newCmDir - the real (non-normalized) replacement directory
 * @returns {{ command: string, changed: boolean }}
 */
function repinSite(cmd, newCmDirNorm, newCmDir) {
  if (typeof cmd !== 'string' || !isContextMonitorCommand(cmd)) {
    return { command: cmd, changed: false };
  }
  const oldDir = detectCmDir(cmd);
  if (oldDir && normalizeForCompare(oldDir) !== newCmDirNorm) {
    return { command: repinCommand(cmd, oldDir, newCmDir), changed: true };
  }
  return { command: cmd, changed: false };
}

/**
 * TASK-209 fix round (HIGH-2) — an INDEPENDENT verification pass, decoupled
 * from repinSettingsObject's own traversal, so "allCurrent" cannot just
 * re-report the same blind spot the traversal has. HIGH-1 was exactly this
 * failure mode: the traversal never visited the nested hook shape, so it had
 * nothing to say it was stale either — a flag derived FROM the traversal
 * would have been just as confidently wrong as the traversal itself.
 *
 * This instead walks the settings object generically (every string, at any
 * depth, under any key name or array shape) looking for anything that LOOKS
 * like one of our commands (isContextMonitorCommand), with no assumption
 * about where it lives. That makes it robust to shapes this file does not
 * structurally know how to repair (and even shapes nobody has written yet):
 * it will not find them "current" by omission the way silently skipping a
 * branch would.
 *
 * @param {*} node - any JSON-shaped value (object/array/string/etc.)
 * @param {string} newCmDirNorm - normalizeForCompare(newCmDir)
 * @param {WeakSet} [seen] - cycle guard (JSON can't cycle, but stay safe)
 * @returns {number} count of context-monitor commands found anywhere that do
 *   NOT resolve under newCmDir
 */
function countStaleContextMonitorCommandsDeep(node, newCmDirNorm, seen = new WeakSet()) {
  if (typeof node === 'string') {
    if (!isContextMonitorCommand(node)) return 0;
    const dir = detectCmDir(node);
    return (!dir || normalizeForCompare(dir) !== newCmDirNorm) ? 1 : 0;
  }
  if (Array.isArray(node)) {
    return node.reduce((sum, item) => sum + countStaleContextMonitorCommandsDeep(item, newCmDirNorm, seen), 0);
  }
  if (node && typeof node === 'object') {
    if (seen.has(node)) return 0;
    seen.add(node);
    return Object.values(node).reduce((sum, v) => sum + countStaleContextMonitorCommandsDeep(v, newCmDirNorm, seen), 0);
  }
  return 0;
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
 *   - TASK-209 fix round (HIGH-1) — traverses BOTH the canonical nested hook
 *     shape (`entry.hooks[]` array of `{ type, command }`) and the legacy flat
 *     shape (`{ type, command }` directly on the array element) for PATH
 *     REPAIR only. It never converts one shape into the other — that is a
 *     writer/migration concern (src/claude-settings.js, TASK-210), not this
 *     repairer's job.
 *
 * @param {object|null|undefined} settings - parsed settings object
 * @param {string} newCmDir - the current context-monitor directory
 * @returns {object & { needsWrite: boolean, repairedCount: number, allCurrent: boolean }}
 *   the (possibly-repinned) settings object with these flags mixed in.
 *   `repairedCount` (TASK-209) is the number of individual command strings
 *   actually rewritten (0 when nothing was stale). `allCurrent` (TASK-209 fix
 *   round, HIGH-2) is computed by an INDEPENDENT deep verification pass over
 *   the post-repair object (see countStaleContextMonitorCommandsDeep) — true
 *   only when EVERY context-monitor command found ANYWHERE in the file
 *   resolves under `newCmDir` after this run. Callers must not claim "no
 *   action needed" when this is false. For non-object inputs
 *   (null/undefined/array), returns
 *   `{ needsWrite: false, repairedCount: 0, allCurrent: true }` (nothing to
 *   report on — vacuously nothing is stale).
 */
export function repinSettingsObject(settings, newCmDir) {
  // Guard: must be a plain, non-array object.
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return { needsWrite: false, repairedCount: 0, allCurrent: true };
  }

  // Normalize newCmDir for comparison (cross-platform, case-insensitive on Windows).
  const newCmDirNorm = normalizeForCompare(newCmDir);

  let needsWrite = false;
  let repairedCount = 0;
  const out = { ...settings };

  // --- statusLine ---
  if (out.statusLine && typeof out.statusLine === 'object' && typeof out.statusLine.command === 'string') {
    const r = repinSite(out.statusLine.command, newCmDirNorm, newCmDir);
    if (r.changed) {
      out.statusLine = { ...out.statusLine, command: r.command };
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

        // Canonical nested shape: entry.hooks is an array of { type, command }.
        if (Array.isArray(entry.hooks)) {
          let innerChanged = false;
          const newInner = entry.hooks.map((inner) => {
            if (!inner || typeof inner !== 'object' || typeof inner.command !== 'string') return inner;
            const r = repinSite(inner.command, newCmDirNorm, newCmDir);
            if (!r.changed) return inner;
            innerChanged = true;
            repairedCount += 1;
            return { ...inner, command: r.command };
          });
          if (innerChanged) {
            arrChanged = true;
            return { ...entry, hooks: newInner };
          }
          return entry;
        }

        // Legacy flat shape: command sits directly on the array element.
        if (typeof entry.command !== 'string') return entry;
        const r = repinSite(entry.command, newCmDirNorm, newCmDir);
        if (!r.changed) return entry;
        arrChanged = true;
        repairedCount += 1;
        return { ...entry, command: r.command };
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

  // allCurrent (TASK-209 fix round, HIGH-2): an independent re-scan of the
  // POST-repair object, not a re-derivation of what the traversal above
  // happened to visit — see countStaleContextMonitorCommandsDeep's header.
  const allCurrent = countStaleContextMonitorCommandsDeep(out, newCmDirNorm) === 0;

  // Return the repinned settings merged with the needsWrite/repairedCount/
  // allCurrent flags so callers can do both `const { needsWrite } =
  // repinSettingsObject(...)` and `result.statusLine.command` on the same
  // return value.
  return { ...out, needsWrite, repairedCount, allCurrent };
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
 * @returns {Promise<{ wrote: boolean, path: string, repairedCount: number, allCurrent: boolean }>}
 *   `repairedCount` (TASK-209) is always present so callers can decide whether
 *   to report the repair; it is 0 whenever `wrote` is false. `allCurrent`
 *   (TASK-209 fix round) is true only when nothing context-monitor-shaped is
 *   left stale after this run — see repinSettingsObject's doc for what "stale"
 *   means when `wrote` is false (missing/malformed settings.json default to
 *   `true`: vacuously nothing is known to be stale, not "confirmed current").
 */
export async function repinFile({ projectRoot, currentCmDir }) {
  const settingsPath = join(projectRoot, '.claude', 'settings.json');

  // If the settings file doesn't exist, nothing to heal.
  if (!existsSync(settingsPath)) {
    return { wrote: false, path: settingsPath, repairedCount: 0, allCurrent: true };
  }

  // Read and parse — silent no-op on malformed JSON.
  let parsed;
  try {
    const raw = readFileSync(settingsPath, 'utf8');
    parsed = JSON.parse(raw);
  } catch {
    return { wrote: false, path: settingsPath, repairedCount: 0, allCurrent: true };
  }

  // Run the pure re-pin logic. The return value has needsWrite + repairedCount + allCurrent + settings props spread in.
  const repinned = repinSettingsObject(parsed, currentCmDir);
  if (!repinned.needsWrite) {
    return { wrote: false, path: settingsPath, repairedCount: 0, allCurrent: repinned.allCurrent };
  }

  // Serialize: exclude the synthetic needsWrite/repairedCount/allCurrent flags from the JSON output.
  const { needsWrite: _nw, repairedCount, allCurrent, ...settingsToWrite } = repinned;
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
    return { wrote: false, path: settingsPath, repairedCount: 0, allCurrent: false };
  }

  return { wrote: true, path: settingsPath, repairedCount, allCurrent };
}

// ---------------------------------------------------------------------------
// AC2 signal (TASK-209) — the message shown when a repair actually happened
// ---------------------------------------------------------------------------

/**
 * Build the SessionStart additionalContext note reporting a completed repair.
 * Pure/exported for testing so the wording is locked without spawning a
 * subprocess for every assertion.
 *
 * TASK-209 fix round (HIGH-2) — the first version of this message
 * unconditionally claimed "the statusline and context-monitor hooks are now
 * re-pointed" and "no action needed", regardless of whether that was actually
 * true. Against the (then-undiscovered, HIGH-1) nested-hook-shape blind spot,
 * that message shipped a FALSE ALL-CLEAR: the statusline was fixed, the hooks
 * were not, and the note said everything was fine. `allCurrent` is the caller's
 * proof, computed by repinSettingsObject/repinFile from the ACTUAL post-repair
 * state (not from repairedCount, which only counts what this run understood
 * how to fix) — never claim "no action needed" without it.
 *
 * @param {number} repairedCount - number of command strings rewritten (> 0)
 * @param {boolean} allCurrent - true only when every context-monitor command
 *   found in the file resolves under the current plugin root after this run
 * @returns {string}
 */
export function buildRepinReportMessage(repairedCount, allCurrent) {
  const plural = repairedCount === 1 ? '' : 's';
  const base = (
    `hivemind: repaired ${repairedCount} stale context-monitor path${plural} in ` +
    '.claude/settings.json. They pointed at a previously-installed plugin version ' +
    'that no longer exists on disk (expected after `/plugin update`).'
  );
  if (allCurrent) {
    return `${base} All context-monitor commands now resolve at the current install. No action needed.`;
  }
  return (
    `${base} Some context-monitor commands in .claude/settings.json still do NOT ` +
    'resolve at the current install and were not repaired automatically — check ' +
    'the statusLine and hooks entries in .claude/settings.json by hand.'
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
          additionalContext: buildRepinReportMessage(result.repairedCount, result.allCurrent),
        },
      };
      process.stdout.write(JSON.stringify(response));
    }
  } catch {
    // Exit 0 always — a re-pin failure must never block the session.
  }

  process.exit(0);
}
