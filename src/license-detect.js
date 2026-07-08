// src/license-detect.js
// Skill license detection + classification for the addon-pack assimilate gate
// (docs/design/addon-packs-plan.md §12). Hand-rolled SPDX table and matcher,
// zero new runtime deps: the closed ~20-id set here doesn't justify a lib.
// Add spdx-expression-parse later only if compound expressions beyond a
// simple two-term OR/AND show up in practice. The skill-frontmatter step
// (TASK-120 UAT-bounce addition) DOES use gray-matter for real YAML
// parsing -- not a new dep, already used elsewhere (src/knowledge.js) and
// already bundled by esbuild, and hand-rolling frontmatter-YAML parsing here
// would just be a worse gray-matter.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';

// Permissive allowlist (auto-OK). This is an allowlist for permissive, not a
// denylist for copyleft -- anything not listed here (including copyleft ids
// not yet seen and genuinely novel licenses) classifies as `unknown`.
const PERMISSIVE_IDS = ['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'CC0-1.0', 'Unlicense', '0BSD'];

// GPL/AGPL/LGPL families that gate on a human decision, both modern
// `-only`/`-or-later` suffixed ids and deprecated pre-3.0-license-list aliases
// (folded into this bucket via DEPRECATED_ALIASES below).
const COPYLEFT_IDS = [
  'GPL-2.0-only', 'GPL-2.0-or-later',
  'GPL-3.0-only', 'GPL-3.0-or-later',
  'LGPL-2.1-only', 'LGPL-2.1-or-later',
  'LGPL-3.0-only', 'LGPL-3.0-or-later',
  'AGPL-3.0-only', 'AGPL-3.0-or-later',
];

// Deprecated aliases are ambiguous between -only/-or-later; folding them to
// -only is enough to land them in the copyleft bucket (classification doesn't
// need the only/or-later distinction, just the family).
const DEPRECATED_ALIASES = {
  'gpl-2.0': 'GPL-2.0-only',
  'gpl-3.0': 'GPL-3.0-only',
  'lgpl-2.1': 'LGPL-2.1-only',
  'lgpl-3.0': 'LGPL-3.0-only',
  'agpl-3.0': 'AGPL-3.0-only',
};

// Free-text spellings seen in READMEs, package.json `license` fields, and
// SPDX headers with human-readable names instead of ids.
const TEXT_ALIASES = {
  'mit license': 'MIT',
  'apache 2.0': 'Apache-2.0',
  'apache-2.0': 'Apache-2.0',
  'apache license 2.0': 'Apache-2.0',
  'apache license, version 2.0': 'Apache-2.0',
  'bsd 2-clause license': 'BSD-2-Clause',
  'bsd 3-clause license': 'BSD-3-Clause',
  'isc license': 'ISC',
  'the unlicense': 'Unlicense',
};

// Case-insensitive lookup table: alias/id (lowercased) -> canonical SPDX id.
// Built once so normalizeLicenseString is a single map lookup.
const ALIAS_TABLE = new Map();
for (const id of [...PERMISSIVE_IDS, ...COPYLEFT_IDS]) ALIAS_TABLE.set(id.toLowerCase(), id);
for (const [alias, id] of Object.entries(DEPRECATED_ALIASES)) ALIAS_TABLE.set(alias, id);
for (const [alias, id] of Object.entries(TEXT_ALIASES)) ALIAS_TABLE.set(alias, id);

/**
 * Normalize a raw license string (SPDX id, deprecated alias, or common free-text
 * spelling) to a canonical SPDX id. Unrecognized input is passed through
 * unchanged (trimmed) -- normalization is not a validity check; classifyLicense
 * is where "unknown" gets decided.
 *
 * @param {string|null|undefined} raw
 * @returns {string|null}
 */
export function normalizeLicenseString(raw) {
  if (raw === null || raw === undefined) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  return ALIAS_TABLE.get(trimmed.toLowerCase()) ?? trimmed;
}

// Two-term compound expression split (§12: "no full expression parser").
const COMPOUND_RE = /^(.+?)\s+(OR|AND)\s+(.+)$/i;

/**
 * Classify a (possibly raw) SPDX id or simple two-term compound expression as
 * 'permissive', 'copyleft' (gate), or 'unknown' (gate -- allowlist, not
 * denylist). `null`/unrecognized ids are always 'unknown', never permissive.
 *
 * @param {string|null|undefined} spdxId
 * @returns {'permissive'|'copyleft'|'unknown'}
 */
export function classifyLicense(spdxId) {
  const normalized = normalizeLicenseString(spdxId);
  if (!normalized) return 'unknown';

  const compound = normalized.match(COMPOUND_RE);
  if (compound) {
    const [, left, operator, right] = compound;
    const leftClass = classifyLicense(left);
    const rightClass = classifyLicense(right);
    if (operator.toUpperCase() === 'OR') {
      // OR: permissive if ANY disjunct is permissive.
      if (leftClass === 'permissive' || rightClass === 'permissive') return 'permissive';
      if (leftClass === 'copyleft' || rightClass === 'copyleft') return 'copyleft';
      return 'unknown';
    }
    // AND: permissive only if ALL conjuncts are permissive; a copyleft conjunct gates.
    if (leftClass === 'permissive' && rightClass === 'permissive') return 'permissive';
    if (leftClass === 'copyleft' || rightClass === 'copyleft') return 'copyleft';
    return 'unknown';
  }

  if (PERMISSIVE_IDS.includes(normalized)) return 'permissive';
  if (COPYLEFT_IDS.includes(normalized)) return 'copyleft';
  return 'unknown';
}

// --- detectLicense: 7-step fallback chain (stop at first hit) --------------

const SPDX_HEADER_RE = /SPDX-License-Identifier:\s*([^\r\n]+)/i;
const SKILL_FILENAME = 'SKILL.md';
const LICENSE_FILENAMES = ['LICENSE', 'COPYING', 'LICENSE.md'];
const IGNORED_DIRS = new Set(['node_modules', '.git']);
const MAX_SCANNED_FILE_BYTES = 65536; // SPDX headers live in small text/source files

// Generic signature phrases for full LICENSE-file text / README sections.
// GPL/LGPL/AGPL entries resolve their exact version via resolveGnuFamilyVersion.
const LICENSE_TEXT_SIGNATURES = [
  [/\bMIT License\b/i, 'MIT'],
  [/\bApache License,?\s*Version 2\.0\b/i, 'Apache-2.0'],
  [/\bBSD 2-Clause License\b/i, 'BSD-2-Clause'],
  [/\bBSD 3-Clause License\b/i, 'BSD-3-Clause'],
  [/\bISC License\b/i, 'ISC'],
  [/\bCC0[ -]1\.0\b|\bCreative Commons Zero\b/i, 'CC0-1.0'],
  [/\bThe Unlicense\b|unencumbered software released into the public domain/i, 'Unlicense'],
  [/\b0BSD\b|BSD Zero Clause License/i, '0BSD'],
  [/\bGNU AFFERO GENERAL PUBLIC LICENSE\b/i, 'AGPL'],
  [/\bGNU LESSER GENERAL PUBLIC LICENSE\b/i, 'LGPL'],
  [/\bGNU GENERAL PUBLIC LICENSE\b/i, 'GPL'],
];

function cleanSpdxCapture(raw) {
  return raw.replace(/(\*\/|-->)\s*$/, '').trim();
}

function resolveGnuFamilyVersion(family, text) {
  const versionMatch = text.match(/Version\s+(\d+)(?:\.(\d+))?/i);
  if (!versionMatch) return null;
  const major = versionMatch[1];
  const minor = versionMatch[2] ?? (family === 'LGPL' && major === '2' ? '1' : '0');
  const orLater = /or\s*\(at your option\)\s*any later version/i.test(text);
  return `${family}-${major}.${minor}-${orLater ? 'or-later' : 'only'}`;
}

/** Match a free-text blob (LICENSE file body, README section) to an SPDX id, or null. */
function detectFromFreeText(text) {
  if (!text) return null;
  const direct = ALIAS_TABLE.get(text.trim().toLowerCase());
  if (direct) return direct;

  const header = text.match(SPDX_HEADER_RE);
  if (header) return normalizeLicenseString(cleanSpdxCapture(header[1]));

  for (const [re, id] of LICENSE_TEXT_SIGNATURES) {
    if (re.test(text)) {
      return ['GPL', 'LGPL', 'AGPL'].includes(id) ? resolveGnuFamilyVersion(id, text) : id;
    }
  }
  return null;
}

function walkFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

/** Step 1: scan a directory's own files for an SPDX-License-Identifier header. */
function findSpdxHeaderInDir(dir) {
  if (!dir || !existsSync(dir)) return null;
  for (const file of walkFiles(dir)) {
    let size;
    try {
      size = statSync(file).size;
    } catch {
      continue;
    }
    if (size > MAX_SCANNED_FILE_BYTES) continue;
    let content;
    try {
      content = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const match = content.match(SPDX_HEADER_RE);
    if (match) return { path: file, spdxRaw: cleanSpdxCapture(match[1]) };
  }
  return null;
}

/** Step 3: nearest LICENSE/COPYING/LICENSE.md in a single directory. */
function findLicenseFile(dir) {
  if (!dir || !existsSync(dir)) return null;
  for (const name of LICENSE_FILENAMES) {
    const p = join(dir, name);
    if (existsSync(p) && statSync(p).isFile()) {
      return { path: p, content: readFileSync(p, 'utf8') };
    }
  }
  return null;
}

// Same shape tolerance as extractPackageJsonLicense below (plain string, or
// an npm-style {type: '...'} object) -- a skill's SKILL.md frontmatter is
// author-written YAML, not a validated schema, so both spellings show up.
function extractFrontmatterLicense(data) {
  if (!data) return null;
  if (typeof data.license === 'string') return data.license;
  if (data.license && typeof data.license.type === 'string') return data.license.type;
  return null;
}

/**
 * Step 2: the skill's own SKILL.md frontmatter `license:` field -- the most
 * authoritative skill-native signal, so it's ranked right after the SPDX
 * header and before a repo-wide LICENSE file (a skill's own declared license
 * beats a LICENSE file it doesn't control, e.g. a monorepo's root license).
 * Malformed YAML or a missing/absent frontmatter fence both fall through to
 * `null` -- not every third-party skill author writes valid frontmatter, and
 * this step is an ADDITIONAL signal, never the only one.
 */
function findSkillFrontmatterLicense(skillDir) {
  if (!skillDir) return null;
  const skillPath = join(skillDir, SKILL_FILENAME);
  if (!existsSync(skillPath) || !statSync(skillPath).isFile()) return null;
  let raw;
  try {
    raw = readFileSync(skillPath, 'utf8');
  } catch {
    return null;
  }
  let parsed;
  try {
    parsed = matter(raw);
  } catch {
    return null; // malformed frontmatter YAML -- fall through, don't throw
  }
  const license = extractFrontmatterLicense(parsed.data);
  return license ? { path: skillPath, raw: license } : null;
}

/** Step 4: GitHub Licenses API, via an injected fetcher (undefined => skipped, no network). */
async function detectFromGithubApi(github, fetchGithubLicense) {
  let body;
  try {
    body = await fetchGithubLicense(github.owner, github.repo);
  } catch {
    return null; // network/API failure is treated as no signal, never fatal
  }
  const id = body?.license?.spdx_id;
  if (!id || id === 'NOASSERTION' || id.toLowerCase() === 'other') return null;
  return id;
}

/** Step 5: `license` field in the nearest package.json. */
function extractPackageJsonLicense(pkg) {
  if (!pkg) return null;
  if (typeof pkg.license === 'string') return pkg.license;
  if (pkg.license && typeof pkg.license.type === 'string') return pkg.license.type;
  if (Array.isArray(pkg.licenses) && typeof pkg.licenses[0]?.type === 'string') return pkg.licenses[0].type;
  return null;
}

/** Step 6: the content of a README.md "License" heading's section, or null. */
function extractReadmeLicenseSection(text) {
  const lines = text.split(/\r?\n/);
  const headingRe = /^(#{1,6})\s*license\b/i;
  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(headingRe);
    if (m) {
      start = i + 1;
      level = m[1].length;
      break;
    }
  }
  if (start === -1) return null;
  const section = [];
  for (let i = start; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s/);
    if (m && m[1].length <= level) break;
    section.push(lines[i]);
  }
  return section.join('\n').trim() || null;
}

/**
 * Detect a skill's license via the 7-step fallback chain (stop at first hit):
 *   1. SPDX-License-Identifier header in the skill's own files.
 *   2. `license:` field in the skill's own SKILL.md frontmatter (TASK-120).
 *   3. Nearest LICENSE/COPYING/LICENSE.md (skill subdir before repo root).
 *   4. GitHub Licenses API (only if `github` + `fetchGithubLicense` are given).
 *   5. `license` field in the nearest package.json.
 *   6. "License" section in README.md.
 *   7. None found -- unknown, "all rights reserved", never permissive.
 *
 * @param {object} source
 * @param {string} [source.skillDir] - absolute path to the skill's own subdirectory
 * @param {string} [source.repoRoot] - absolute path to the repo root
 * @param {{owner: string, repo: string}} [source.github] - repo coordinates for step 4
 * @param {(owner: string, repo: string) => Promise<{license: {spdx_id: string}}|null>} [source.fetchGithubLicense]
 *   - injected transport for the GitHub Licenses API; undefined skips the step (no network)
 * @returns {Promise<{spdx_id: string|null, detected_via: string, source_path: string|null, checked_at: string}>}
 */
export async function detectLicense(source = {}) {
  const { skillDir = null, repoRoot = null, github = null, fetchGithubLicense } = source;
  const checked_at = new Date().toISOString();
  const dirs = [skillDir, repoRoot].filter(Boolean);

  // 1. SPDX header in the skill's own files -- wins even over a repo-wide license.
  const headerHit = findSpdxHeaderInDir(skillDir);
  if (headerHit) {
    return { spdx_id: normalizeLicenseString(headerHit.spdxRaw), detected_via: 'spdx-header', source_path: headerHit.path, checked_at };
  }

  // 2. The skill's own SKILL.md frontmatter `license:` field -- skill-native,
  // so it beats a repo-wide LICENSE file (step 3) the skill doesn't control.
  const frontmatterHit = findSkillFrontmatterLicense(skillDir);
  if (frontmatterHit) {
    return { spdx_id: normalizeLicenseString(frontmatterHit.raw), detected_via: 'skill-frontmatter', source_path: frontmatterHit.path, checked_at };
  }

  // 3. Nearest LICENSE/COPYING/LICENSE.md -- skill subdir before repo root.
  for (const dir of dirs) {
    const licenseHit = findLicenseFile(dir);
    if (!licenseHit) continue;
    const id = detectFromFreeText(licenseHit.content);
    if (id) return { spdx_id: normalizeLicenseString(id), detected_via: 'license-file', source_path: licenseHit.path, checked_at };
  }

  // 4. GitHub Licenses API (repo-hosted sources only; skipped without an injected fetcher).
  if (github?.owner && github?.repo && typeof fetchGithubLicense === 'function') {
    const id = await detectFromGithubApi(github, fetchGithubLicense);
    if (id) {
      return {
        spdx_id: normalizeLicenseString(id),
        detected_via: 'github-api',
        source_path: `github:${github.owner}/${github.repo}`,
        checked_at,
      };
    }
  }

  // 5. `license` field in the nearest package.json.
  for (const dir of dirs) {
    const pkgPath = join(dir, 'package.json');
    if (!existsSync(pkgPath)) continue;
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    } catch {
      pkg = null;
    }
    const raw = extractPackageJsonLicense(pkg);
    if (raw) return { spdx_id: normalizeLicenseString(raw), detected_via: 'package.json', source_path: pkgPath, checked_at };
  }

  // 6. "License" section in README.md.
  for (const dir of dirs) {
    const readmePath = join(dir, 'README.md');
    if (!existsSync(readmePath)) continue;
    const section = extractReadmeLicenseSection(readFileSync(readmePath, 'utf8'));
    if (!section) continue;
    const id = detectFromFreeText(section);
    if (id) return { spdx_id: normalizeLicenseString(id), detected_via: 'readme', source_path: readmePath, checked_at };
  }

  // 7. None found -- unknown / all-rights-reserved. Never assume permissive.
  return { spdx_id: null, detected_via: 'none', source_path: null, checked_at };
}
