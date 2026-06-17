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
      type: 'command',
      command: stopHookCmd,
    },
    sessionStartHook: {
      type: 'command',
      matcher: 'clear|compact',
      command: sessionStartCmd,
    },
  };
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

  // hooks.Stop: append if not already present (match by script name).
  if (!Array.isArray(out.hooks.Stop)) {
    out.hooks.Stop = [];
  } else {
    out.hooks.Stop = [...out.hooks.Stop];
  }
  const hasStopHook = out.hooks.Stop.some(
    (h) => h && typeof h.command === 'string' && h.command.includes('stop-hook.mjs'),
  );
  if (!hasStopHook) {
    out.hooks.Stop.push(entries.stopHook);
  }

  // hooks.SessionStart: append if not already present.
  if (!Array.isArray(out.hooks.SessionStart)) {
    out.hooks.SessionStart = [];
  } else {
    out.hooks.SessionStart = [...out.hooks.SessionStart];
  }
  const hasSessionStartHook = out.hooks.SessionStart.some(
    (h) => h && typeof h.command === 'string' && h.command.includes('session-start.mjs'),
  );
  if (!hasSessionStartHook) {
    out.hooks.SessionStart.push(entries.sessionStartHook);
  }

  return out;
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
