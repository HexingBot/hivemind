#!/usr/bin/env node
// verify-manifests — read a project's implementation/ manifests (+ context/ scope/estimation/gaps
// when present), run the deterministic coverage checks (src/manifest-verify.js), write the matrix
// to reviews/VERIFY.md, and exit non-zero on any FAIL. Zero-dep beyond the module. Run via
// `npm run check:manifests`. This is the objective spec gate; the reviewer is the judgement leg.

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { runChecks, summarize, buildMatrix } from '../src/manifest-verify.js';

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null);
const ctx = (f) => read(join(ROOT, 'context', f));
const impl = (f) => read(join(ROOT, 'implementation', f));

const docs = {
  scope: ctx('scope.md'),
  estimation: ctx('estimation.md'),
  gaps: ctx('gaps.md'),
  screens: impl('SCREEN_SPECS.md'),
  contracts: impl('API_CONTRACTS.md'),
  states: impl('STATE_SCHEMAS.md'),
  blockTasks: impl('BLOCK_TASKS.md'),
  componentCatalog: impl('COMPONENT_CATALOG.md'),
  projectStructure: impl('PROJECT_STRUCTURE.md'),
  verifyDoc: read(join(ROOT, 'reviews', 'VERIFY.md')) || '',
};

const hasAny = docs.scope || docs.estimation || docs.screens || docs.contracts || docs.states || docs.blockTasks;
if (!hasAny) {
  console.log('verify-manifests: no implementation/ manifests (or context/) found — nothing to verify.');
  console.log('Generate manifests first (the impl-* skills), then re-run.');
  process.exit(0);
}

const checks = runChecks(docs);
const matrix = buildMatrix(checks, { now: new Date().toISOString().slice(0, 10) });

const reviewsDir = join(ROOT, 'reviews');
mkdirSync(reviewsDir, { recursive: true });
writeFileSync(join(reviewsDir, 'VERIFY.md'), matrix);

console.log('\nVerification Matrix\n===================');
for (const c of checks) console.log(`[${c.pass ? 'PASS' : 'FAIL'}] ${c.name} — ${c.details}`);
const { ok, failed } = summarize(checks);
console.log('===================');
console.log(ok ? 'RESULT: PASS' : `RESULT: FAIL (${failed.length} check(s)) — see reviews/VERIFY.md`);
process.exit(ok ? 0 : 1);
