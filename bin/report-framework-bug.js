#!/usr/bin/env node
// bin/report-framework-bug.js
// TASK-010 — CLI entrypoint for the framework bug reporter.
//
// Parses argv flags, auto-collects context, builds + scrubs the issue body,
// then calls fileFrameworkBug (gh issue create or local fallback).
//
// Flag schema mirrors the command markdown's Step 2 invocation:
//   --title, --observed, --expected, --steps, --environment, --severity
//   --evidence (optional)
//
// Prints the issue URL (on GitHub success) or the local file path (fallback).

import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

import {
  collectContext,
  buildIssueBody,
  fileFrameworkBug,
} from '../src/framework-bug-report.js';

const SINGLE_FLAGS = new Set([
  '--title',
  '--observed',
  '--expected',
  '--steps',
  '--environment',
  '--severity',
  '--evidence',
  '--plugin-root',
  '--project-dir',
  '--repo',
]);

/**
 * Parse argv into a plain object.  Unknown flags surface as an error so typos
 * are caught fast.
 */
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (!SINGLE_FLAGS.has(flag)) {
      throw new Error(`unknown flag: ${flag}`);
    }
    const value = argv[++i];
    if (value === undefined) throw new Error(`flag ${flag} requires a value`);
    // Normalise kebab-case flags to camelCase keys
    const key = flag.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    out[key] = value;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const {
    title,
    observed,
    expected,
    steps,
    environment,
    severity,
    evidence,
    pluginRoot = process.env.CLAUDE_PLUGIN_ROOT ?? process.cwd(),
    projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd(),
    repo,
  } = args;

  // Validate required fields
  const missing = ['title', 'observed', 'expected', 'steps', 'environment', 'severity']
    .filter((k) => !args[k]);
  if (missing.length > 0) {
    throw new Error(`Missing required flags: ${missing.map((k) => `--${k}`).join(', ')}`);
  }

  // Collect safe context (no secrets)
  const context = collectContext({ pluginRoot, projectDir });

  // Assemble + scrub the full body
  const body = buildIssueBody({
    title,
    observed,
    expected,
    steps,
    environment,
    severity,
    evidence,
    context,
  });

  // File it — gh or local fallback
  const result = await fileFrameworkBug({
    title,
    body,
    pluginRoot,
    projectDir,
    ...(repo ? { repo } : {}),
  });

  if (result.filed === 'github') {
    // eslint-disable-next-line no-console
    console.log(`Filed framework bug on GitHub: ${result.url}`);
  } else {
    // eslint-disable-next-line no-console
    console.log(`Could not file on GitHub (${result.reason}). Bug report saved locally: ${result.path}`);
  }
}

// Only run when invoked as the entry script (not on import from tests).
const __isEntry = import.meta.url
  ? Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href
  : (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module);

if (__isEntry) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err.message);
    process.exit(1);
  });
}
