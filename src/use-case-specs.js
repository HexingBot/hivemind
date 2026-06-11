// src/use-case-specs.js
// TASK-029 — generate the use-case regression suite for a user project.
//
// Entrypoint: generateUseCaseSuite({ repoRoot, answers, now })
//
// Behaviour:
//   - ALWAYS writes tests/use-cases/USE-CASES.md (manifest) via atomicWriteFile;
//     the directory is mkdir-ed first (self-bootstrap, like createTask does
//     post-TASK-009).
//   - JS/JavaScript-ecosystem stack detection (predicate per review ruling):
//     a stack counts as JS when ANY of the five stack-answer keys
//     (cli_language, backend_framework, library_language, frontend_framework,
//     processing_framework) has a string value that matches
//     /^(node|javascript|typescript)/i OR contains the substring 'node'
//     (covers 'node-express'), OR when frontend_framework is one of
//     {react, vue, svelte, angular} — all vitest-compatible JS ecosystems.
//     'other' does NOT count as a JS signal.
//   - JS/node stack → additionally writes tests/use-cases/<slug>.spec.js per
//     primary use case: one describe(useCase) block + it.todo skeletons.
//   - Non-JS stack → manifest only, no .spec.js files.
//   - IDEMPOTENT: if tests/use-cases/USE-CASES.md already exists, the manifest
//     is not overwritten; similarly each skeleton spec is skipped if the file
//     exists. A second run with a different `now` value produces no changes.

import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { atomicWriteFile } from './atomic-write.js';

// Stack-answer keys we inspect for the JS-language signal.
const STACK_ANSWER_KEYS = [
  'cli_language',
  'backend_framework',
  'library_language',
  'frontend_framework',
  'processing_framework',
];

// JS-language signal on any stack key: starts with node/javascript/typescript,
// case-insensitive.
const JS_LANGUAGE_RE = /^(node|javascript|typescript)/i;

// Frontend frameworks that imply a JS ecosystem (all vitest-compatible).
// 'other' deliberately does NOT count.
const JS_FRONTEND_FRAMEWORKS = new Set(['react', 'vue', 'svelte', 'angular']);

/**
 * Return true when the project's answers indicate a JS/JavaScript-ecosystem
 * stack (review ruling, TASK-029 fix loop). A project is treated as JS when:
 *   - any STACK_ANSWER_KEYS value matches /^(node|javascript|typescript)/i, OR
 *   - any STACK_ANSWER_KEYS value contains the substring 'node'
 *     (case-insensitive; covers values like 'node-express'), OR
 *   - frontend_framework is one of {react, vue, svelte, angular}.
 *
 * @param {object} answers
 * @returns {boolean}
 */
function isJsStack(answers) {
  if (!answers || typeof answers !== 'object') return false;
  for (const key of STACK_ANSWER_KEYS) {
    const val = answers[key];
    if (typeof val !== 'string' || val.length === 0) continue;
    if (JS_LANGUAGE_RE.test(val.trim())) return true;
    if (val.toLowerCase().includes('node')) return true;
  }
  const fe = answers.frontend_framework;
  if (
    typeof fe === 'string' &&
    JS_FRONTEND_FRAMEWORKS.has(fe.trim().toLowerCase())
  ) {
    return true;
  }
  return false;
}

/**
 * Convert a use-case name into a file-system-safe slug.
 * Lowercase, replace non-alphanumeric characters with hyphens,
 * collapse consecutive hyphens, strip leading/trailing hyphens.
 *
 * @param {string} name
 * @returns {string}
 */
function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Normalize answers.primary_use_cases to an array of strings (mirrors the
 * same helper inside backlog-seeder.js).
 *
 * @param {*} raw
 * @returns {string[]}
 */
function normalizeUseCases(raw) {
  if (Array.isArray(raw)) {
    return raw.filter((v) => typeof v === 'string' && v.length > 0);
  }
  if (typeof raw === 'string' && raw.length > 0) {
    if (raw.includes(',')) {
      return raw
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    }
    return [raw];
  }
  return [];
}

/**
 * Build the content for the USE-CASES.md manifest.
 *
 * @param {object} opts
 * @param {string} opts.projectName
 * @param {string[]} opts.useCases
 * @param {string} opts.generatedAt
 * @param {boolean} opts.isJs
 * @returns {string}
 */
function buildManifest({ projectName, useCases, generatedAt, isJs }) {
  const lines = [
    '# Use-Case Suite',
    '',
    `**Project:** ${projectName}`,
    `**Generated:** ${generatedAt}`,
    '',
    '## Primary Use Cases',
    '',
    'This manifest designates the primary use cases for this project.',
    'Each use case is covered by one or more spec files listed below.',
    'Tickets must only modify this suite when a primary use case changes',
    '(new, changed, or removed use case) — never one spec per ticket.',
    '',
  ];

  if (useCases.length === 0) {
    lines.push('_No primary use cases specified._', '');
  } else {
    for (const uc of useCases) {
      const slug = slugify(uc);
      lines.push(`### ${uc}`, '');
      if (isJs) {
        lines.push(`- tests/use-cases/${slug}.spec.js`, '');
      } else {
        // Only emitted when isJsStack() is genuinely false (see predicate above).
        lines.push(
          '_No JS-ecosystem stack detected: no skeleton spec files generated._',
          '_Add your own test runner entries here._',
          '',
        );
      }
    }
  }

  return lines.join('\n');
}

/**
 * Build a skeleton spec file for one use case (JS/node projects only).
 *
 * @param {string} useCase
 * @returns {string}
 */
function buildSkeletonSpec(useCase) {
  // Embed user-supplied strings via JSON.stringify: it produces a valid
  // double-quoted JS string literal with quotes, backslashes, and newlines
  // escaped, so a use case like "user's\nflow" cannot break out of the
  // generated source (codegen-injection fix, TASK-029 review).
  const nameLit = JSON.stringify(useCase);
  const happyLit = JSON.stringify(`${useCase}: end-to-end happy path`);
  const edgeLit = JSON.stringify(`${useCase}: error / edge cases`);
  return [
    `// tests/use-cases/${slugify(useCase)}.spec.js`,
    `// Use-case regression skeleton for: ${nameLit}`,
    '// Generated by generateUseCaseSuite (src/use-case-specs.js).',
    '// Modify ONLY when the primary use case definition changes.',
    '',
    "import { describe, it } from 'vitest';",
    '',
    `describe(${nameLit}, () => {`,
    `  it.todo(${happyLit});`,
    `  it.todo(${edgeLit});`,
    '});',
    '',
  ].join('\n');
}

/**
 * Generate the use-case suite for a project.
 *
 * @param {object} opts
 * @param {string} opts.repoRoot - absolute path to the target repo root
 * @param {object} opts.answers  - intake answers (same shape as bin/init.js produces)
 * @param {() => string} [opts.now] - returns an ISO timestamp (injectable for tests)
 * @returns {Promise<{manifestPath: string, specPaths: string[]}>}
 */
export async function generateUseCaseSuite({
  repoRoot,
  answers,
  now = () => new Date().toISOString(),
}) {
  const useCasesDir = join(repoRoot, 'tests', 'use-cases');

  // Self-bootstrap: ensure the directory exists before we write into it.
  await mkdir(useCasesDir, { recursive: true });

  const useCases = normalizeUseCases(answers && answers.primary_use_cases);
  const projectName =
    (answers && typeof answers.project_name === 'string'
      ? answers.project_name
      : null) || 'unnamed-project';
  const js = isJsStack(answers);
  const generatedAt = now();

  // --- Manifest (always written; idempotent) ---
  const manifestPath = join(useCasesDir, 'USE-CASES.md');
  if (!existsSync(manifestPath)) {
    const content = buildManifest({ projectName, useCases, generatedAt, isJs: js });
    await atomicWriteFile(manifestPath, content);
  }

  // --- Skeleton spec files (JS/node only; idempotent per file) ---
  const specPaths = [];
  if (js) {
    // Deduplicate use-case slugs in case the caller passed duplicates.
    const seen = new Set();
    for (const uc of useCases) {
      const slug = slugify(uc);
      if (seen.has(slug)) continue;
      seen.add(slug);
      const specPath = join(useCasesDir, `${slug}.spec.js`);
      if (!existsSync(specPath)) {
        const content = buildSkeletonSpec(uc);
        await atomicWriteFile(specPath, content);
      }
      specPaths.push(specPath);
    }
  }

  return { manifestPath, specPaths };
}
