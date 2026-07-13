// src/framework-context.js
// TASK-152 — isFrameworkRepo({ repoRoot }) detector.
//
// The framework had no primitive answering "is the current repo the hivemind
// framework itself, or a project built with it?" This is the seam that the
// framework-vs-consumer skill guards (sibling scoping tickets) depend on.
//
// TRUE iff repoRoot is the hivemind framework repo:
//   - <repoRoot>/.claude-plugin/plugin.json exists AND parses as JSON AND
//     its `name` field === 'hivemind'
//   - <repoRoot>/src is a directory
//   - <repoRoot>/bin/init.js exists
//
// FALSE (never throws) for every other case: missing/malformed plugin.json,
// a plugin.json whose name !== 'hivemind' (a consumer project that installed
// the plugin and set its own name), or a partial checkout missing src/ or
// bin/init.js even when the name matches.
//
// Deliberately does NOT read CLAUDE_PROJECT_NAME or any other env var, and
// does NOT fall back to process.cwd() — the verdict is a pure function of
// the files under the passed repoRoot, matching src/repo-root.js's pattern
// of taking every input as an explicit argument rather than reading process
// state internally.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

/**
 * @param {{ repoRoot: string }} args
 * @returns {boolean} true iff repoRoot is the hivemind framework repo itself.
 */
export function isFrameworkRepo({ repoRoot }) {
  // Guard first: an empty/non-string repoRoot would make path.join() produce
  // a relative path that fs then silently resolves against process.cwd() —
  // exactly the CWD dependence the contract forbids. Reject before any fs
  // call reaches that footgun.
  if (typeof repoRoot !== 'string' || repoRoot.trim() === '') return false;

  // A non-empty but RELATIVE repoRoot (e.g. '.') has the same footgun: fs
  // resolves it against process.cwd() rather than treating it as opaque.
  // Only an absolute path can ever produce a true verdict.
  if (!isAbsolute(repoRoot)) return false;

  try {
    const pluginJsonPath = join(repoRoot, '.claude-plugin', 'plugin.json');
    const raw = readFileSync(pluginJsonPath, 'utf8');
    const manifest = JSON.parse(raw);
    if (!manifest || manifest.name !== 'hivemind') return false;

    const srcPath = join(repoRoot, 'src');
    if (!statSync(srcPath).isDirectory()) return false;

    const initPath = join(repoRoot, 'bin', 'init.js');
    if (!existsSync(initPath)) return false;

    return true;
  } catch {
    // Missing plugin.json, malformed JSON, missing src/, missing repoRoot
    // itself, permission errors — all collapse to "not the framework repo".
    return false;
  }
}
