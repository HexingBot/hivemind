// src/wargame-engine.js
// TASK-240 (CU1) — the per-project wargaming engine setting.
//
// PROJECT.md frontmatter carries `wargame_engine: wrecker | hivemind`.
//   hivemind = today's hive-adversarial-improve[-current-project] wargaming.
//   wrecker  = Wrecker's /wrecker:wargame (lives in Wrecker's plugin, not here).
//
// Empty-result contract (CLAUDE.md): readWargameEngine NEVER collapses "unset"
// into a chosen engine. Its `status` is one of:
//   'set'             — `engine` is a valid value; use it, do not ask.
//   'unset'           — key absent; the caller must ASK the human, never pick.
//   'invalid'         — key present with a bad value (`raw`); treated as unset
//                       for asking purposes, never as a choice.
//   'no-project-md'   — project not initialized; nothing to read.
//
// saveWargameEngine does a surgical frontmatter edit (every other byte of
// PROJECT.md is untouched) and never saves anything but a valid value; a
// skipped/empty/invalid answer leaves the file unmodified.

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWriteFile } from './atomic-write.js';
import { readProjectMd, WARGAME_ENGINES, normalizeWargameEngine } from './project-md.js';

export { WARGAME_ENGINES, normalizeWargameEngine };

export async function readWargameEngine({ repoRoot }) {
  if (!existsSync(join(repoRoot, 'PROJECT.md'))) return { status: 'no-project-md' };
  const { frontmatter } = await readProjectMd({ repoRoot });
  const raw = frontmatter.wargame_engine;
  if (raw === undefined || raw === null || raw === '') return { status: 'unset' };
  const engine = normalizeWargameEngine(String(raw));
  // Strict: only the exact canonical spelling counts as set on read.
  if (engine === null || engine !== raw) return { status: 'invalid', raw: String(raw) };
  return { status: 'set', engine };
}

/**
 * @returns {Promise<{saved: boolean, engine?: string, reason?: string}>}
 *   saved:false reasons: 'skipped' (empty/null answer), 'invalid-value',
 *   'no-project-md'. In every saved:false case PROJECT.md is not modified.
 */
export async function saveWargameEngine({ repoRoot, value }) {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    return { saved: false, reason: 'skipped' };
  }
  const engine = normalizeWargameEngine(value);
  if (engine === null) return { saved: false, reason: 'invalid-value' };
  const target = join(repoRoot, 'PROJECT.md');
  if (!existsSync(target)) return { saved: false, reason: 'no-project-md' };

  const text = await readFile(target, 'utf8');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  if (lines[0] !== '---') throw new Error('PROJECT.md is missing the opening "---" frontmatter delimiter');
  const close = lines.indexOf('---', 1);
  if (close === -1) throw new Error('PROJECT.md frontmatter has no closing "---" delimiter');

  const newLine = `wargame_engine: ${engine}`;
  let idx = -1;
  for (let i = 1; i < close; i++) {
    if (/^wargame_engine:/.test(lines[i])) { idx = i; break; }
  }
  if (idx === -1) lines.splice(close, 0, newLine);
  else lines[idx] = newLine;
  await atomicWriteFile(target, lines.join(eol));
  return { saved: true, engine };
}
