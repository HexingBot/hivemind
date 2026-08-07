// src/claude-settings.js
// TASK-008 — Write/merge .claude/settings.json with context-monitor hooks and
// statusLine so newly-scaffolded projects get auto-wiring out of the box.
//
// Design:
//   - Deep-merge: preserves ALL pre-existing keys and hook arrays.
//   - Never clobbers pre-existing hooks — appends our entries.
//   - Idempotent: a second run does not add duplicate entries.
//   - Absolute plugin root baked at call time (CLAUDE_PLUGIN_ROOT is NOT
//     expanded in project-level settings.json — see claude-code-plugin-path-resolution
//     skill for the authoritative rationale).
//
// TASK-209 — why the version-pinned absolute path is not eliminated outright:
//   See context-monitor/repin.mjs's own header comment ("TASK-209 AC4
//   rationale, RESTATED after the fix round") for the current, accurate
//   account of what repin.mjs's path self-heal does and does not close. The
//   original claim here — that the stale-path failure was "already closed" by
//   repin.mjs alone — was retracted after TASK-210's own finding that a FLAT
//   shape entry (see buildContextMonitorEntries below) never fires at all,
//   independent of whether its path is current; repairing a path that was
//   never going to execute repairs nothing observable. TASK-210 closes the
//   shape half (this file); repin.mjs closes the path half (both required).

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

// ---------------------------------------------------------------------------
// Plugin root resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the absolute path to the plugin root at module-load time.
 *
 * Priority order (mirrors the skill's recommendation):
 *   1. CLAUDE_PLUGIN_ROOT env var (set by Claude Code when running as a hook)
 *   2. Derived from this file's location: this file lives at <plugin-root>/src/,
 *      so plugin root is one level up.
 *
 * @returns {string} absolute path to the plugin root directory
 */
export function resolvePluginRoot() {
  if (process.env.CLAUDE_PLUGIN_ROOT) {
    return process.env.CLAUDE_PLUGIN_ROOT;
  }
  // ESM: import.meta.url is available.
  // CJS bundle (esbuild): import.meta.url may be empty; fall back to __dirname.
  const here = import.meta.url
    ? dirname(fileURLToPath(import.meta.url))
    : (typeof __dirname !== 'undefined' ? __dirname : process.cwd());
  // This file lives at <plugin-root>/src/claude-settings.js, so go up one level.
  return resolve(here, '..');
}

// ---------------------------------------------------------------------------
// Settings merge logic (pure, exported for testing)
// ---------------------------------------------------------------------------

/**
 * Build the context-monitor entries to inject into settings.json.
 *
 * TASK-210 — hooks.Stop/hooks.SessionStart entries use the documented NESTED
 * shape (`{ matcher?, hooks: [{ type, command }] }`), matching the plugin's
 * own hooks/hooks.json and the official hooks reference: "You cannot place a
 * handler directly on the matcher group. Handlers must nest inside the hooks
 * array." Verified empirically against `claude doctor`: the flat shape (a
 * `command` sitting directly on the array element) is rejected as invalid
 * settings (`hooks.Stop.0.hooks: Expected array, but received undefined`);
 * the nested shape below produces zero validation errors. `matcher` is only
 * valid for events that support it — SessionStart does, Stop does not, so
 * `stopHook` carries no `matcher` key at all (not even `undefined`).
 *
 * `statusLine` is a different top-level settings key with a different
 * (flat, genuinely-honoured) shape — not part of the hooks schema — and is
 * unaffected by this change.
 *
 * @param {string} pluginRoot - absolute path to the plugin root
 * @returns {{ statusLine: object, stopHook: object, sessionStartHook: object }}
 */
export function buildContextMonitorEntries(pluginRoot) {
  const cmDir = join(pluginRoot, 'context-monitor');

  // Windows paths use backslashes; node commands in strings on Windows work
  // with either separator, but we quote the path to handle spaces.
  const statusLineCmd = `node "${join(cmDir, 'statusline.mjs')}"`;
  const stopHookCmd   = `node "${join(cmDir, 'stop-hook.mjs')}"`;
  const sessionStartCmd = `node "${join(cmDir, 'session-start.mjs')}"`;

  return {
    statusLine: {
      type: 'command',
      command: statusLineCmd,
    },
    stopHook: {
      // No `matcher` key — Stop does not support one.
      hooks: [{ type: 'command', command: stopHookCmd }],
    },
    sessionStartHook: {
      matcher: 'clear|compact',
      hooks: [{ type: 'command', command: sessionStartCmd }],
    },
  };
}

// ---------------------------------------------------------------------------
// Shape-agnostic entry matching (TASK-210)
// ---------------------------------------------------------------------------

/**
 * Every command string found inside a hooks.<Event> array element, handling
 * BOTH the canonical nested shape (`entry.hooks[]`) and the legacy flat shape
 * (`entry.command` directly) so callers can detect "is this ours" regardless
 * of which shape is currently on disk.
 *
 * @param {*} entry
 * @returns {string[]}
 */
function commandsOf(entry) {
  if (!entry || typeof entry !== 'object') return [];
  if (Array.isArray(entry.hooks)) {
    return entry.hooks
      .filter((h) => h && typeof h.command === 'string')
      .map((h) => h.command);
  }
  if (typeof entry.command === 'string') return [entry.command];
  return [];
}

/**
 * True if `entry` (whichever shape) references `scriptName` by filename —
 * i.e. it is one of OUR own context-monitor entries, not an unrelated
 * user/third-party hook.
 *
 * @param {*} entry
 * @param {string} scriptName - e.g. 'stop-hook.mjs'
 * @returns {boolean}
 */
function isOurHookEntry(entry, scriptName) {
  return commandsOf(entry).some((cmd) => cmd.includes(scriptName));
}

/**
 * Reconcile a single hooks.<Event> array against our canonical entry:
 *   - If OUR entry is present but in the legacy FLAT shape, replace it
 *     in place (same array index) with `canonicalEntry` — this is the
 *     shape MIGRATION for pre-existing projects (TASK-210 AC4).
 *   - If OUR entry is present and already nested, leave it byte-for-byte
 *     untouched (no needless rewrite — keeps idempotency/serialization
 *     stable).
 *   - If OUR entry is absent and `inject` is true, append `canonicalEntry`.
 *   - If OUR entry is absent and `inject` is false, do nothing (heal-only —
 *     used by the automatic migration hook, which must never force-enable
 *     context-monitor for a project that never had it).
 *   - Every other (unrelated) entry is left completely untouched.
 *
 * @param {Array} arr - existing hooks.<Event> array (or undefined)
 * @param {string} scriptName - e.g. 'stop-hook.mjs'
 * @param {object} canonicalEntry - the correct nested-shape entry
 * @param {{ inject: boolean }} opts
 * @returns {{ arr: Array, changed: boolean }}
 */
function reconcileHookArray(arr, scriptName, canonicalEntry, { inject }) {
  const base = Array.isArray(arr) ? arr : [];
  const idx = base.findIndex((h) => isOurHookEntry(h, scriptName));

  if (idx === -1) {
    if (!inject) return { arr: base, changed: false };
    return { arr: [...base, canonicalEntry], changed: true };
  }

  if (Array.isArray(base[idx].hooks)) {
    // Already correctly nested — no rewrite needed.
    return { arr: base, changed: false };
  }

  // Legacy flat shape — migrate in place.
  const next = [...base];
  next[idx] = canonicalEntry;
  return { arr: next, changed: true };
}

/**
 * Deep-merge the context-monitor entries into an existing (or empty) settings object.
 *
 * Rules:
 *   - If `statusLine` is absent: add it.
 *   - If `statusLine` already exists: leave it unchanged (caller's preference wins).
 *   - hooks.Stop: append stopHook if no entry already references stop-hook.mjs.
 *   - hooks.SessionStart: append sessionStartHook if no entry already references
 *     session-start.mjs.
 *   - All other keys and arrays in `existing` are preserved byte-for-byte.
 *
 * @param {object} existing - parsed settings object (may be {})
 * @param {{ statusLine, stopHook, sessionStartHook }} entries - from buildContextMonitorEntries
 * @returns {object} new merged settings object (does not mutate `existing`)
 */
export function mergeContextMonitorSettings(existing, entries) {
  // Shallow clone so we never mutate the caller's object.
  const out = { ...existing };

  // statusLine: add only if absent.
  if (!out.statusLine) {
    out.statusLine = entries.statusLine;
  }

  // hooks: deep-merge arrays.
  if (!out.hooks || typeof out.hooks !== 'object') {
    out.hooks = {};
  } else {
    out.hooks = { ...out.hooks };
  }

  // hooks.Stop: append if absent; migrate in place if present but legacy-flat
  // (TASK-210) — this is what makes writeClaudeSettings self-repairing for
  // projects initialized before the nested-shape fix, without duplicating or
  // reordering unrelated entries.
  out.hooks.Stop = reconcileHookArray(out.hooks.Stop, 'stop-hook.mjs', entries.stopHook, {
    inject: true,
  }).arr;

  // hooks.SessionStart: same treatment.
  out.hooks.SessionStart = reconcileHookArray(
    out.hooks.SessionStart,
    'session-start.mjs',
    entries.sessionStartHook,
    { inject: true },
  ).arr;

  return out;
}

/**
 * Heal-only sibling of mergeContextMonitorSettings (TASK-210 AC4/AC6): migrates
 * a pre-existing LEGACY FLAT context-monitor hook entry to the documented
 * nested shape, in place, WITHOUT ever injecting a new entry into a project
 * that never had one. This is the narrower contract required by the automatic
 * plugin-level migration hook (context-monitor/settings-migrate.mjs), which
 * — like context-monitor/repin.mjs's existing path-repair hook — must never
 * force-enable context-monitor for a project that opted out by removing the
 * entries.
 *
 * Composition with repin.mjs (TASK-209): repin.mjs repairs stale PATHS
 * regardless of shape (it already traverses both flat and nested for that);
 * this function repairs SHAPE (flat -> nested). It does NOT leave the path
 * untouched in the migrating case: the one case that rewrites a command at
 * all — a flat->nested migration — always rebuilds it from the CURRENT
 * plugin root via `entries`, same as a fresh write, so a migrated entry is
 * also path-current the instant it's migrated. An ALREADY-NESTED entry is
 * left completely alone by this function (reconcileHookArray's no-rewrite
 * branch) and can still carry a stale path — that residual case is exactly
 * what repin.mjs's traversal exists to cover.
 * Both hooks are independently idempotent and safe to run every session; see
 * context-monitor/settings-migrate.mjs for the disk-level orchestration
 * (including how it avoids clobbering a concurrent repin.mjs write).
 *
 * @param {object} existing - parsed settings object (may be {})
 * @param {{ statusLine, stopHook, sessionStartHook }} entries - from buildContextMonitorEntries
 * @returns {{ settings: object, changed: boolean }}
 */
export function migrateContextMonitorShape(existing, entries) {
  if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
    return { settings: existing, changed: false };
  }
  if (!existing.hooks || typeof existing.hooks !== 'object' || Array.isArray(existing.hooks)) {
    return { settings: existing, changed: false };
  }

  let changed = false;
  const hooks = { ...existing.hooks };

  const stopResult = reconcileHookArray(hooks.Stop, 'stop-hook.mjs', entries.stopHook, {
    inject: false,
  });
  if (stopResult.changed) {
    hooks.Stop = stopResult.arr;
    changed = true;
  }

  const ssResult = reconcileHookArray(
    hooks.SessionStart,
    'session-start.mjs',
    entries.sessionStartHook,
    { inject: false },
  );
  if (ssResult.changed) {
    hooks.SessionStart = ssResult.arr;
    changed = true;
  }

  if (!changed) return { settings: existing, changed: false };

  return { settings: { ...existing, hooks }, changed: true };
}

// ---------------------------------------------------------------------------
// Disk writer
// ---------------------------------------------------------------------------

/**
 * Write or merge .claude/settings.json in the target project with context-monitor
 * entries. Reads any existing settings.json, deep-merges, and writes back.
 *
 * @param {object} opts
 * @param {string} opts.repoRoot - absolute path to the target project root
 * @param {string} [opts.pluginRoot] - override plugin root (for testing)
 * @returns {{ path: string, wrote: boolean }}
 */
export function writeClaudeSettings({ repoRoot, pluginRoot }) {
  const effectivePluginRoot = pluginRoot ?? resolvePluginRoot();
  const entries = buildContextMonitorEntries(effectivePluginRoot);

  const claudeDir = join(repoRoot, '.claude');
  const settingsPath = join(claudeDir, 'settings.json');

  // Read existing settings (if any).
  let existing = {};
  if (existsSync(settingsPath)) {
    try {
      existing = JSON.parse(readFileSync(settingsPath, 'utf8'));
      if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
        // Malformed — treat as empty.
        existing = {};
      }
    } catch {
      existing = {};
    }
  }

  const merged = mergeContextMonitorSettings(existing, entries);
  const serialized = JSON.stringify(merged, null, 2) + '\n';

  // Check for idempotency (skip disk write if nothing changed).
  if (existsSync(settingsPath)) {
    const currentRaw = readFileSync(settingsPath, 'utf8');
    if (currentRaw === serialized) {
      return { path: settingsPath, wrote: false };
    }
  }

  mkdirSync(claudeDir, { recursive: true });
  writeFileSync(settingsPath, serialized, 'utf8');
  return { path: settingsPath, wrote: true };
}
