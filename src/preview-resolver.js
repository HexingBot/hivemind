// src/preview-resolver.js
// TASK-065 — App-preview config resolver.
//
// Exported function:
//   resolvePreviewConfig({ repoRoot })
//
// Returns:
//   { mode: 'web'|'process'|'none', command: string|null, cwd: repoRoot,
//     url: string|null, source: 'configured'|'inferred'|'none' }
//
// Precedence:
//   1. PROJECT.md frontmatter has any of preview_command/preview_url/preview_port
//      → source='configured'
//   2. package.json scripts: dev > start > serve  → source='inferred'
//   3. Nothing usable → mode='none', source='none', no throw.

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Port-derivation heuristic
// Patterns that indicate a port number in a script string:
//   --port <N>  |  -p <N>  |  PORT=<N>  |  localhost:<N>  |  0.0.0.0:<N>
// ---------------------------------------------------------------------------
const PORT_PATTERNS = [
  /--port\s+(\d+)/,
  /-p\s+(\d+)/,
  /PORT=(\d+)/,
  /localhost:(\d+)/,
  /0\.0\.0\.0:(\d+)/,
];

/**
 * Try to extract a port number from a script string.
 * Returns the first matched port as a string, or null if none found.
 *
 * @param {string} script
 * @returns {string|null}
 */
function extractPort(script) {
  for (const re of PORT_PATTERNS) {
    const m = script.match(re);
    if (m) return m[1];
  }
  return null;
}

/**
 * Derive mode and url from a port string.
 *
 * @param {string|null} port
 * @returns {{ mode: 'web'|'process', url: string|null }}
 */
function modeFromPort(port) {
  if (port !== null) {
    return { mode: 'web', url: `http://localhost:${port}` };
  }
  return { mode: 'process', url: null };
}

/**
 * Resolve the app-preview configuration for the given repo root.
 *
 * @param {{ repoRoot: string }} opts
 * @returns {Promise<{ mode: 'web'|'process'|'none', command: string|null,
 *   cwd: string, url: string|null, source: 'configured'|'inferred'|'none' }>}
 */
export async function resolvePreviewConfig({ repoRoot }) {
  const none = { mode: 'none', command: null, cwd: repoRoot, url: null, source: 'none' };

  // -------------------------------------------------------------------------
  // 1. Check PROJECT.md frontmatter for preview fields.
  // -------------------------------------------------------------------------
  const projectMdPath = join(repoRoot, 'PROJECT.md');
  if (existsSync(projectMdPath)) {
    try {
      const text = await readFile(projectMdPath, 'utf8');
      const frontmatter = extractFrontmatter(text);

      const hasPreviewFields =
        frontmatter.preview_command !== undefined ||
        frontmatter.preview_url !== undefined ||
        frontmatter.preview_port !== undefined;

      if (hasPreviewFields) {
        const command = frontmatter.preview_command ?? null;
        const explicitMode = frontmatter.preview_mode ?? null;
        const previewUrl = frontmatter.preview_url ?? null;
        const previewPort = frontmatter.preview_port ?? null;

        // Determine url: preview_url takes precedence, else derive from port.
        let url = previewUrl;
        if (url === null && previewPort !== null) {
          url = `http://localhost:${previewPort}`;
        }

        // Determine mode:
        // - explicit preview_mode wins IFF it is a valid enum value (web|process)
        // - an unrecognized preview_mode falls back to url/port-based derivation
        //   (clamping: source stays 'configured', the bad value is silently dropped)
        // - else web if url/port present, else process
        const mode =
          (explicitMode === 'web' || explicitMode === 'process')
            ? explicitMode
            : (url !== null || previewPort !== null ? 'web' : 'process');

        return { mode, command, cwd: repoRoot, url, source: 'configured' };
      }
    } catch {
      // If PROJECT.md is malformed/unreadable, fall through to inference.
    }
  }

  // -------------------------------------------------------------------------
  // 2. Inference: scan package.json scripts in priority order: dev > start > serve.
  // -------------------------------------------------------------------------
  const packageJsonPath = join(repoRoot, 'package.json');
  if (existsSync(packageJsonPath)) {
    try {
      const raw = await readFile(packageJsonPath, 'utf8');
      const pkg = JSON.parse(raw);
      const scripts = (pkg && typeof pkg.scripts === 'object' && pkg.scripts !== null)
        ? pkg.scripts
        : {};

      const CANDIDATES = ['dev', 'start', 'serve'];
      for (const scriptName of CANDIDATES) {
        if (typeof scripts[scriptName] === 'string') {
          const scriptStr = scripts[scriptName];
          const command = `npm run ${scriptName}`;
          const port = extractPort(scriptStr);
          const { mode, url } = modeFromPort(port);
          return { mode, command, cwd: repoRoot, url, source: 'inferred' };
        }
      }
    } catch {
      // Malformed package.json — fall through to none.
    }
  }

  // -------------------------------------------------------------------------
  // 3. Nothing usable found.
  // -------------------------------------------------------------------------
  return none;
}

// ---------------------------------------------------------------------------
// Lightweight frontmatter extractor (does not need the full project-md parser;
// we only need the preview_* scalar values from the YAML frontmatter block).
// ---------------------------------------------------------------------------

/**
 * Parse the YAML frontmatter of a PROJECT.md string and return a plain object
 * containing only the top-level scalar key/value pairs.
 *
 * This is intentionally minimal: it only handles scalar (string) values. It
 * does NOT need to handle arrays or nested objects for the preview fields.
 *
 * @param {string} text  Full text of PROJECT.md.
 * @returns {Record<string, string>}  Frontmatter key/value pairs as strings.
 */
function extractFrontmatter(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== '---') return {};

  let closeIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') { closeIdx = i; break; }
  }
  if (closeIdx === -1) return {};

  const result = {};
  for (let i = 1; i < closeIdx; i++) {
    const line = lines[i];
    if (line.trim().length === 0) continue;
    const m = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (m) result[m[1]] = m[2].trim();
  }
  return result;
}
