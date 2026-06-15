// src/project-md.js
// TASK-011 — persist the intake answers as a human-readable PROJECT.md with a
// machine-readable YAML frontmatter. Writer and reader share a single id-to-
// section table so round-trip is lossless without duplicated maps drifting
// out of sync.
//
// File layout:
//   ---
//   name: <project_name>
//   type: <project_type>
//   created_at: <ISO timestamp>
//   schema_version: 1
//   ---
//
//   # <project_name>
//
//   ## Description
//   <project_description>
//
//   ## Target users
//   <target_users>
//
//   ## Primary use cases
//   - <use case 1>
//   - <use case 2>
//
//   ## Success criteria
//   <success_criteria>
//
//   ## Stack
//   - <key>: <value>
//   - ...
//
// Frontmatter parser is a deliberately tiny subset (see parseFrontmatter): it
// accepts ONLY scalar `key: value` lines and inline `[a, b, c]` arrays. Any
// nested-object form (a line ending in `:` followed by an indented line)
// raises an error rather than silently coercing — this keeps the schema
// closed so future contributors can't sneak in unstructured config.

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { atomicWriteFile } from './atomic-write.js';

// TASK-023 — the frontmatter schema is INLINED via a JSON import rather than
// read at runtime from an `import.meta.url`-relative path, so esbuild can bundle
// it into the self-contained dist/*.cjs plugin entrypoints (under cjs bundling
// `import.meta.url` is empty and the old fileURLToPath read crashed at module
// init). The import resolves identically under Vite (vitest), raw Node ESM, and
// esbuild. state/PROJECT.schema.json remains the on-disk source of truth.
import __projectSchema from '../state/PROJECT.schema.json' with { type: 'json' };

const PROJECT_MD = 'PROJECT.md';
const SCHEMA_VERSION = 1;

// The frontmatter schema is consulted by coerceFrontmatterScalar to gate numeric
// coercion on the schema-declared type (TASK-016 AC2). Normalize to guarantee a
// `properties` object so coercion no-ops gracefully if the schema ever lacks it.
const FRONTMATTER_SCHEMA = (__projectSchema && __projectSchema.properties)
  ? __projectSchema
  : { ...(__projectSchema || {}), properties: {} };

// Single source of truth for body-section <-> answer-id mapping. Used by both
// writer and reader so the round-trip cannot drift. Keys are ordered: that
// order is the order sections appear in the file. `bullets: true` means the
// section value is rendered as a markdown bullet list and parsed back as an
// array; otherwise the section is a single prose block.
//
// TASK-045 — four definition sections (problem_statement, goals, scope_in,
// scope_out) are appended AFTER the existing well-known sections and BEFORE
// the ## Stack section (which is always emitted last, outside this loop).
const BODY_SECTIONS = [
  { id: 'project_description', heading: 'Description', bullets: false },
  { id: 'target_users', heading: 'Target users', bullets: false },
  { id: 'primary_use_cases', heading: 'Primary use cases', bullets: true },
  { id: 'success_criteria', heading: 'Success criteria', bullets: false },
  { id: 'problem_statement', heading: 'Problem', bullets: false },
  { id: 'goals', heading: 'Goals', bullets: true },
  { id: 'scope_in', heading: 'Scope (in)', bullets: true },
  { id: 'scope_out', heading: 'Scope (out)', bullets: true },
];

// Frontmatter answer ids are written into YAML rather than the body. Everything
// not in BODY_SECTIONS and not in this set lands in the `## Stack` section.
const FRONTMATTER_IDS = new Set(['project_name', 'project_type']);

// Keys that receive dedicated lossless encoding in the frontmatter rather than
// being written into the Stack body section. They are excluded from the Stack
// key loop UNCONDITIONALLY (TASK-036 review ruling 1b: agent_models is NEVER
// emitted to or parsed from the Stack section — frontmatter is its only home,
// so a stale Stack line can never shadow a frontmatter map).
const SPECIAL_FRONTMATTER_IDS = new Set(['agent_models']);

// Valid model aliases and pattern for full model IDs (mirrors PROJECT.schema.json).
const MODEL_ALIASES = new Set(['sonnet', 'opus', 'haiku', 'fable', 'inherit']);
const FULL_MODEL_ID_RE = /^claude-[a-z0-9-]+$/;
// Recognized spawned-agent names for the agent_models map.
const VALID_AGENT_NAMES = new Set(['reviewer', 'developer', 'researcher']);

/**
 * Write PROJECT.md at <repoRoot>/PROJECT.md via atomicWriteFile.
 *
 * @param {object} opts
 * @param {string} opts.repoRoot - absolute path to the project root
 * @param {object} opts.answers - intake answers (must include project_name,
 *   project_type at minimum)
 * @param {() => string} [opts.now] - injectable clock for created_at
 * @returns {Promise<{path: string}>}
 */
export async function writeProjectMd({ repoRoot, answers, now = () => new Date().toISOString() }) {
  // Validate required answers BEFORE touching disk so a missing field surfaces
  // at the point of error (TASK-016 AC4) rather than downstream at ajv. The
  // empty-string check is deliberate: a downstream renderer that emits
  // `name: \n` would still write a syntactically valid frontmatter that ajv
  // would then reject — confusing the caller about where the bug originated.
  const requiredFrontmatterAnswers = ['project_name', 'project_type'];
  for (const id of requiredFrontmatterAnswers) {
    const v = answers ? answers[id] : undefined;
    if (v === undefined || v === null || v === '') {
      throw new Error(`writeProjectMd: missing required answer: ${id}`);
    }
  }

  // TASK-036 — write-time validation of the agent_models map (AC1): reject an
  // invalid shape, unknown agent names, or invalid model values BEFORE any
  // disk write, naming the offender. null means "wizard question skipped" and
  // is tolerated (no key is written); a string is rejected — callers
  // (bin/init.js) must parse the wizard pair-syntax into an object first.
  const am = answers ? answers.agent_models : undefined;
  if (am !== undefined && am !== null) {
    if (typeof am !== 'object' || Array.isArray(am)) {
      throw new Error(
        `writeProjectMd: agent_models must be an object map of agent → model (got ${typeof am})`,
      );
    }
    for (const [agent, model] of Object.entries(am)) {
      if (!VALID_AGENT_NAMES.has(agent)) {
        throw new Error(
          `writeProjectMd: invalid agent_models key "${agent}" — ` +
          `valid agents: ${[...VALID_AGENT_NAMES].join(', ')}`,
        );
      }
      if (
        typeof model !== 'string' ||
        (!MODEL_ALIASES.has(model) && !FULL_MODEL_ID_RE.test(model))
      ) {
        throw new Error(
          `writeProjectMd: invalid agent_models value "${model}" for agent "${agent}" — ` +
          `must be one of ${[...MODEL_ALIASES].join(', ')} or match /^claude-[a-z0-9-]+$/`,
        );
      }
    }
  }

  const target = join(repoRoot, PROJECT_MD);
  const createdAt = now();
  const body = renderProjectMd(answers, createdAt);
  await atomicWriteFile(target, body);
  return { path: target };
}

/**
 * Read PROJECT.md from <repoRoot>/PROJECT.md and return `{answers, frontmatter}`.
 *
 * @param {object} opts
 * @param {string} opts.repoRoot
 * @returns {Promise<{answers: object, frontmatter: object}>}
 */
export async function readProjectMd({ repoRoot }) {
  const target = join(repoRoot, PROJECT_MD);
  if (!existsSync(target)) {
    throw new Error(`PROJECT.md not found at ${target}`);
  }
  const text = await readFile(target, 'utf8');
  return parseProjectMd(text);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderProjectMd(answers, createdAt) {
  const name = answers.project_name ?? '';
  const type = answers.project_type ?? '';

  // Frontmatter — scalar lines only; the colon constraint applies only here
  // (body prose and Stack `- key: value` entries accept colons freely because
  // the Stack parser only splits on the FIRST colon per line).
  const fmLines = [
    '---',
    `name: ${name}`,
    `type: ${type}`,
    `created_at: ${createdAt}`,
    `schema_version: ${SCHEMA_VERSION}`,
  ];

  // TASK-036 — agent_models: write as an inline object map on a single line
  // so the in-house YAML subset parser (which only handles scalars/arrays at
  // the top level) can restore it losslessly. Format: `{key: value, ...}`.
  // Only write when the map is present and non-null with at least one key.
  if (answers.agent_models && typeof answers.agent_models === 'object' &&
      Object.keys(answers.agent_models).length > 0) {
    const mapStr = Object.entries(answers.agent_models)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');
    fmLines.push(`agent_models: {${mapStr}}`);
  }

  fmLines.push('---', '');

  // Body — title + the four well-known sections in BODY_SECTIONS order, then
  // a Stack section listing everything else.
  const out = [...fmLines, `# ${name}`, ''];

  for (const sec of BODY_SECTIONS) {
    if (!Object.prototype.hasOwnProperty.call(answers, sec.id)) continue;
    const value = answers[sec.id];
    // TASK-045 — omit the section entirely when the value is empty: an empty
    // string for prose sections or an empty array for bullet sections produces
    // no heading and no content (matching the absent-key behaviour). This guard
    // covers both the new definition sections and any existing section whose
    // caller supplies an empty value.
    if (sec.bullets) {
      const items = Array.isArray(value) ? value : [value];
      if (items.length === 0) continue;
      out.push(`## ${sec.heading}`);
      for (const item of items) {
        out.push(`- ${item}`);
      }
    } else {
      const str = String(value);
      if (str.length === 0) continue;
      out.push(`## ${sec.heading}`);
      out.push(str);
    }
    out.push('');
  }

  // Stack: every answer key not consumed above. agent_models is consumed
  // UNCONDITIONALLY (TASK-036 review ruling 1b) — frontmatter is its only
  // home; it must never appear as a Stack bullet in any form.
  const consumed = new Set([
    ...FRONTMATTER_IDS,
    ...SPECIAL_FRONTMATTER_IDS,
    ...BODY_SECTIONS.map((s) => s.id),
  ]);
  // Also exclude keys with null/undefined values from the Stack section —
  // null signals "question was skipped" (required:false in the engine) and
  // must not produce a stack entry (TASK-036: skipped agent_models must be
  // absent after round-trip, not present as the string "null").
  const stackKeys = Object.keys(answers).filter(
    (k) => !consumed.has(k) && answers[k] !== null && answers[k] !== undefined,
  );
  if (stackKeys.length > 0) {
    out.push('## Stack');
    for (const key of stackKeys) {
      out.push(`- ${key}: ${formatStackValue(answers[key])}`);
    }
    out.push('');
  }

  return out.join('\n');
}

function formatStackValue(value) {
  if (Array.isArray(value)) {
    // Inline-array items must escape backslash first then comma so the read-back
    // split on ',' (after unescaping) is lossless even when items legitimately
    // contain commas (TASK-016 AC1). Order matters: escaping '\' to '\\' before
    // ',' to '\,' avoids double-escaping the slash we just added.
    return `[${value.map((v) => encodeArrayItem(String(v))).join(', ')}]`;
  }
  return String(value);
}

// Encode an inline-array item: backslash first, then comma. The reader
// (decodeArrayItem) reverses the encoding in a single left-to-right scan.
function encodeArrayItem(s) {
  return s.replace(/\\/g, '\\\\').replace(/,/g, '\\,');
}

// Decode a single inline-array item. A single left-to-right scan is required
// because a naive `replaceAll('\\,', ',').replaceAll('\\\\', '\\')` mis-handles
// the input `\\,` (which on disk means "literal backslash followed by item
// separator"): the first replace would consume the trailing `\,` as an escaped
// comma instead of recognizing the leading `\\` as an escaped backslash.
function decodeArrayItem(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\' && i + 1 < s.length) {
      const next = s[i + 1];
      if (next === '\\') {
        out += '\\';
        i++;
        continue;
      }
      if (next === ',') {
        out += ',';
        i++;
        continue;
      }
      // Lone backslash followed by anything else: emit the backslash
      // literally and let the next iteration handle `next`.
      out += '\\';
      continue;
    }
    out += ch;
  }
  return out;
}

// Split an inline-array inner string on UNESCAPED commas. Any comma preceded
// by an odd number of backslashes is part of the item, not a separator.
function splitInlineArray(inner) {
  const items = [];
  let buf = '';
  let i = 0;
  while (i < inner.length) {
    const ch = inner[i];
    if (ch === '\\' && i + 1 < inner.length) {
      // Carry the escape through to the decoder verbatim — the decoder is the
      // only thing that resolves '\\' vs '\,' to their literal chars.
      buf += ch + inner[i + 1];
      i += 2;
      continue;
    }
    if (ch === ',') {
      items.push(buf);
      buf = '';
      i++;
      continue;
    }
    buf += ch;
    i++;
  }
  items.push(buf);
  return items.map((s) => decodeArrayItem(s.trim()));
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function parseProjectMd(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== '---') {
    throw new Error('PROJECT.md is missing the opening "---" frontmatter delimiter');
  }
  let closeIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') {
      closeIdx = i;
      break;
    }
  }
  if (closeIdx === -1) {
    throw new Error('PROJECT.md frontmatter has no closing "---" delimiter');
  }

  const fmLines = lines.slice(1, closeIdx);
  const frontmatter = parseFrontmatter(fmLines);

  const bodyLines = lines.slice(closeIdx + 1);
  const sections = parseBodySections(bodyLines);

  // Reconstruct the answers map. Frontmatter contributes name/type plus the
  // writer-added created_at and schema_version (kept under their original
  // frontmatter keys so the schema validator can run against `frontmatter`
  // alone, while round-trip callers see everything in `answers`).
  const answers = {};
  if (frontmatter.name !== undefined) answers.project_name = frontmatter.name;
  if (frontmatter.type !== undefined) answers.project_type = frontmatter.type;
  if (frontmatter.created_at !== undefined) answers.created_at = frontmatter.created_at;
  if (frontmatter.schema_version !== undefined) answers.schema_version = frontmatter.schema_version;
  // TASK-036 — restore agent_models from frontmatter when present.
  // Only set when the map is a non-null object with at least one key so that
  // an absent map stays absent (undefined) in answers.
  if (frontmatter.agent_models !== undefined &&
      frontmatter.agent_models !== null &&
      typeof frontmatter.agent_models === 'object' &&
      Object.keys(frontmatter.agent_models).length > 0) {
    answers.agent_models = frontmatter.agent_models;
  }

  for (const sec of BODY_SECTIONS) {
    const block = sections.get(sec.heading);
    if (block === undefined) continue;
    if (sec.bullets) {
      answers[sec.id] = parseBullets(block);
    } else {
      const joined = block.join('\n').trim();
      if (joined.length > 0) {
        answers[sec.id] = joined;
      }
    }
  }

  // Stack: each bullet is `- key: value`. The key is taken verbatim (snake_case
  // preserved); values are coerced back from `[a, b, c]` to arrays when the
  // writer used the inline-array form.
  const stack = sections.get('Stack');
  if (stack !== undefined) {
    for (const line of stack) {
      const m = line.match(/^-\s+([^:]+):\s*(.*)$/);
      if (!m) continue;
      const key = m[1].trim();
      // TASK-036 review ruling 1b — agent_models is NEVER parsed from Stack:
      // frontmatter is its only home. A stale Stack bullet (e.g. leftover
      // prose from a pre-fix write) must not clobber the frontmatter map.
      if (SPECIAL_FRONTMATTER_IDS.has(key)) continue;
      const rawValue = m[2].trim();
      answers[key] = parseStackValue(rawValue);
    }
  }

  return { answers, frontmatter };
}

/**
 * In-house YAML subset parser. Accepts ONLY:
 *   - blank lines (ignored)
 *   - `key: value` scalar lines (value taken verbatim, trimmed)
 *   - `key: [a, b, c]` inline arrays (split on ',' and trimmed)
 * Numeric-looking values are coerced to Number; integers stay integers.
 * Anything else — notably a `key:` line followed by an indented continuation
 * (nested object) — raises an error rather than guessing.
 */
function parseFrontmatter(fmLines) {
  const out = {};
  for (let i = 0; i < fmLines.length; i++) {
    const line = fmLines[i];
    if (line.trim().length === 0) continue;

    // Reject indented continuations — these indicate an unsupported nested
    // structure regardless of what the parent line looked like.
    if (/^\s+\S/.test(line)) {
      throw new Error(
        'PROJECT.md frontmatter contains an indented (nested) line; ' +
        'nested objects are unsupported by the in-house yaml subset',
      );
    }

    const m = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!m) {
      throw new Error(
        `PROJECT.md frontmatter line is not a recognized scalar/array entry: ${JSON.stringify(line)}`,
      );
    }
    const key = m[1];
    const rawValue = m[2];

    // Bare `key:` with no value AND a subsequent indented line is a nested
    // object — explicitly reject. (A bare `key:` with no indented follow-up
    // would be an empty string, but we treat it as unsupported here to keep
    // the surface area tight.)
    if (rawValue.length === 0) {
      const next = fmLines[i + 1];
      if (next !== undefined && /^\s+\S/.test(next)) {
        throw new Error(
          `PROJECT.md frontmatter key "${key}" appears to introduce a nested object; ` +
          'nested yaml is unsupported by the in-house parser',
        );
      }
      out[key] = '';
      continue;
    }

    out[key] = coerceFrontmatterScalar(rawValue, key);
  }
  return out;
}

function coerceFrontmatterScalar(raw, fieldName) {
  // TASK-036 — Inline object map: {key: value, key: value} used exclusively
  // for the agent_models frontmatter key. Parsing is simple (values are
  // identifiers/model-IDs with no commas or braces), so a naive split is safe.
  // A pair without a colon throws loudly (matching parseFrontmatter's
  // strictness) rather than dropping silently.
  if (fieldName === 'agent_models' && raw.startsWith('{') && raw.endsWith('}')) {
    const inner = raw.slice(1, -1).trim();
    if (inner.length === 0) return {};
    const result = {};
    for (const pair of inner.split(',')) {
      const colonIdx = pair.indexOf(':');
      if (colonIdx === -1) {
        throw new Error(
          `PROJECT.md frontmatter agent_models entry ${JSON.stringify(pair.trim())} ` +
          'is missing a colon — expected the form {agent: model, ...}',
        );
      }
      const k = pair.slice(0, colonIdx).trim();
      const v = pair.slice(colonIdx + 1).trim();
      if (k.length > 0 && v.length > 0) result[k] = v;
    }
    return result;
  }
  // Inline array: [a, b, c] — items may contain escaped commas / backslashes
  // (see encodeArrayItem in the writer). Use the shared splitInlineArray
  // helper so all three call sites (writer, this reader, parseStackValue)
  // agree on the encoding.
  if (raw.startsWith('[') && raw.endsWith(']')) {
    const inner = raw.slice(1, -1).trim();
    if (inner.length === 0) return [];
    return splitInlineArray(inner);
  }
  // Integer/number coercion is now schema-aware (TASK-016 AC2): we only coerce
  // a numeric-looking string when the schema declares the field as integer or
  // number. This avoids silently turning a versioned tag like `version_tag: 1`
  // into Number 1 just because it looks like an int.
  if (/^-?\d+$/.test(raw)) {
    const declared = FRONTMATTER_SCHEMA.properties?.[fieldName]?.type;
    if (declared === 'integer' || declared === 'number') {
      return Number(raw);
    }
  }
  return raw;
}

function parseBodySections(bodyLines) {
  const sections = new Map();
  let current = null;
  let buffer = [];
  for (const line of bodyLines) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) {
      if (current !== null) sections.set(current, trimEdges(buffer));
      current = h[1];
      buffer = [];
      continue;
    }
    if (current !== null) buffer.push(line);
  }
  if (current !== null) sections.set(current, trimEdges(buffer));
  return sections;
}

function trimEdges(lines) {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim().length === 0) start++;
  while (end > start && lines[end - 1].trim().length === 0) end--;
  return lines.slice(start, end);
}

function parseBullets(blockLines) {
  const out = [];
  for (const line of blockLines) {
    const m = line.match(/^-\s+(.*)$/);
    if (m) out.push(m[1].trim());
  }
  return out;
}

function parseStackValue(raw) {
  // String-only handling for non-array Stack values is deliberate: unknown
  // Stack keys have no schema-declared type, so we preserve the raw string
  // form rather than coerce numeric-looking values. This is an intentional
  // asymmetry vs. coerceFrontmatterScalar (which DOES coerce, gated on the
  // schema's declared type). Do not "fix" by adding a Number(...) coercion
  // here — that would silently break stack values like `port: '8080'` that
  // callers store as strings on purpose.
  if (raw.startsWith('[') && raw.endsWith(']')) {
    const inner = raw.slice(1, -1).trim();
    if (inner.length === 0) return [];
    // Honor the same comma/backslash escape scheme as the writer
    // (encodeArrayItem) so array items containing commas round-trip losslessly.
    return splitInlineArray(inner);
  }
  return raw;
}
