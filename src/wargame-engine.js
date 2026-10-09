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
  // Duplicate `wargame_engine:` lines: the writer replaces the first, the frontmatter parser reads the
  // last, so disagreeing duplicates would make set and get contradict each other. Never report `set` then.
  const lines = (await readFile(join(repoRoot, 'PROJECT.md'), 'utf8')).split(/\r?\n/);
  const close = lines[0] === '---' ? lines.indexOf('---', 1) : -1;
  const vals = [];
  for (let i = 1; close > 0 && i < close; i++) {
    const m = /^wargame_engine:\s*(.*)$/.exec(lines[i]);
    if (m) vals.push(normalizeWargameEngine(m[1].trim().replace(/^(["'])(.*)\1$/, '$2')) ?? `?${m[1]}`);
  }
  if (vals.length > 1 && new Set(vals).size > 1) return { status: 'invalid', raw: 'duplicate wargame_engine lines disagree' };
  const { frontmatter } = await readProjectMd({ repoRoot });
  const raw = frontmatter.wargame_engine;
  if (raw === undefined || raw === null || raw === '') return { status: 'unset' };
  // Hand edits in natural YAML form work: strip matching surrounding quotes and
  // lowercase before validating (TASK-240 LOW-3). Genuinely bad values stay invalid.
  const unquoted = String(raw).trim().replace(/^(["'])(.*)\1$/, '$2');
  const engine = normalizeWargameEngine(unquoted);
  if (engine === null) return { status: 'invalid', raw: String(raw) };
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
  // Keep every line's own EOL (mixed-EOL files stay byte-identical outside the one line we touch).
  const parts = text.split(/(\r?\n)/);
  const rows = [];
  for (let i = 0; i < parts.length; i += 2) rows.push({ line: parts[i], eol: parts[i + 1] ?? '' });
  if (rows[0].line !== '---') throw new Error('PROJECT.md is missing the opening "---" frontmatter delimiter');
  const close = rows.findIndex((r, i) => i > 0 && r.line === '---');
  if (close === -1) throw new Error('PROJECT.md frontmatter has no closing "---" delimiter');

  const newLine = `wargame_engine: ${engine}`;
  const hits = [];
  for (let i = 1; i < close; i++) if (/^wargame_engine:/.test(rows[i].line)) hits.push(i);
  if (hits.length === 0) rows.splice(close, 0, { line: newLine, eol: rows[close - 1].eol || '\n' });
  else {
    rows[hits[0]].line = newLine; // replace the first ...
    for (const i of hits.slice(1).reverse()) rows.splice(i, 1); // ... and leave exactly one line
  }
  await atomicWriteFile(target, rows.map((r) => r.line + r.eol).join(''));
  return { saved: true, engine };
}
