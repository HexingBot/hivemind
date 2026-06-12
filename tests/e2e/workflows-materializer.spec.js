// tests/e2e/workflows-materializer.spec.js
// TASK-037 (tests-after) — regression locks for the workflow materializer and
// the deep-review.js static shape.
// TASK-039 (tests-after) — hardening: non-vacuous already_initialized spec (M3),
// whole-body parse lock + directory-wide parity (M5).
//
// AC5 scope (no extras — every spec here encodes an AC or a real regression):
//   - Static shape: deep-review.js exists in both locations, meta block parses
//     with required name/description fields.
//   - Whole-body parse lock: full script body syntax-checks via new Function
//     (constructed, never invoked) — catches syntax errors below the meta block.
//   - Parity (directory-wide): workflows/ and .claude/workflows/ have identical
//     file sets and every file is byte-identical (guards TASK-038 adding a
//     second workflow file).
//   - Materializer copy: created/forced/resumed branches write .claude/workflows/
//     into the target project.
//   - Materializer no-overwrite: an existing destination file is never clobbered.
//   - Materializer idempotency: a second init run with already_initialized is a
//     no-op; spec is non-vacuous — destination is perturbed with a sentinel AFTER
//     the first init, the sentinel must survive the second run, and the full
//     directory listing must be identical pre/post.

import { describe, it, expect, afterAll } from 'vitest';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from '../helpers/repoRoot.js';
import { PROD } from '../helpers/fixtures.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';
import { makeScriptedPrompter, webSaasAnswers } from '../helpers/scripted-prompter.js';

afterAll(cleanupAll);

const FIXED_NOW = '2026-06-12T12:00:00Z';

// Locations of the canonical workflow script.
const PLUGIN_ROOT_WORKFLOW = join(REPO_ROOT, 'workflows', 'deep-review.js');
const DEV_WORKFLOW         = join(REPO_ROOT, '.claude', 'workflows', 'deep-review.js');
// Directories (for directory-wide parity check — M5).
const PLUGIN_WORKFLOWS_DIR = join(REPO_ROOT, 'workflows');
const DEV_WORKFLOWS_DIR    = join(REPO_ROOT, '.claude', 'workflows');

// ---------------------------------------------------------------------------
// Static shape — file existence and meta block validity
// ---------------------------------------------------------------------------

describe('AC1/AC3 — deep-review.js static shape', () => {
  it('plugin_root_workflows_deep_review_exists', () => {
    expect(
      existsSync(PLUGIN_ROOT_WORKFLOW),
      'workflows/deep-review.js must exist at the plugin root',
    ).toBe(true);
  });

  it('dotclause_workflows_deep_review_exists', () => {
    expect(
      existsSync(DEV_WORKFLOW),
      '.claude/workflows/deep-review.js must exist as the dogfood parity copy',
    ).toBe(true);
  });

  it('meta_block_parses_with_required_name_and_description', () => {
    const src = readFileSync(PLUGIN_ROOT_WORKFLOW, 'utf8');

    // Extract the export const meta = { ... }; literal block.
    // The spec requires meta to be a pure literal (no variables/calls/spreads).
    // We slice the object literal and evaluate it via new Function to parse it.
    const metaMatch = src.match(/export\s+const\s+meta\s*=\s*(\{[\s\S]*?\n\});/);
    expect(
      metaMatch,
      'workflow script must contain export const meta = { ... }; as a top-level pure literal',
    ).not.toBeNull();

    // Evaluate the literal in isolation — safe because it is a pure object literal.
    // eslint-disable-next-line no-new-func
    const meta = new Function(`return ${metaMatch[1]}`)();

    expect(typeof meta.name, 'meta.name must be a string').toBe('string');
    expect(meta.name.length, 'meta.name must be non-empty').toBeGreaterThan(0);

    expect(typeof meta.description, 'meta.description must be a string').toBe('string');
    expect(meta.description.length, 'meta.description must be non-empty').toBeGreaterThan(0);

    expect(meta.name).toBe('deep-review');
  });

  // M5 (TASK-039) — whole-body parse lock. Construct (never invoke) an async
  // Function over the entire script body so any syntax error below the meta
  // block fails the suite. The body is extracted by stripping the export const
  // meta block (which is not valid inside a function body due to `export`).
  //
  // AsyncFunction is required (not plain Function) because the workflow body
  // contains top-level `await pipeline(...)`. Plain `new Function` produces a
  // sync function where `await` is a SyntaxError; AsyncFunction produces an
  // async function where `await` is valid — matching the Claude Code harness.
  //
  // Top-level `return` in the workflow body is also legal inside any function
  // body (sync or async), so AsyncFunction handles both constructs correctly.
  //
  // AsyncFunction constructor is obtained via:
  //   Object.getPrototypeOf(async function(){}).constructor
  // This is the standard way to access AsyncFunction without a bare reference.
  it('whole_body_syntax_check_via_AsyncFunction_construction', () => {
    const src = readFileSync(PLUGIN_ROOT_WORKFLOW, 'utf8');

    // Strip the export const meta = { ... }; block so only the executable body
    // remains. The meta block is bounded by 'export const meta = {' and the
    // closing '\n};' line. We slice: find the meta declaration, then the first
    // '\n};' that terminates it, then take everything after that.
    const metaStart = src.indexOf('export const meta =');
    expect(metaStart, 'export const meta = must exist in the source').toBeGreaterThanOrEqual(0);

    const metaEndToken = '\n};';
    const metaEndIdx = src.indexOf(metaEndToken, metaStart);
    expect(metaEndIdx, 'meta block closing }; must be findable').toBeGreaterThanOrEqual(0);

    // Body = everything after the '\n};' terminator of the meta block.
    const body = src.slice(metaEndIdx + metaEndToken.length);
    expect(body.length, 'body after meta block must be non-empty').toBeGreaterThan(0);

    // Obtain the AsyncFunction constructor (standard, no non-standard globals).
    // eslint-disable-next-line no-new-func
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

    // Construct (NEVER invoke) AsyncFunction to parse-check the full body.
    // Parameters mirror the workflow runtime's injected globals.
    // The second argument to expect() is the failure message; toThrow() takes
    // NO argument so any thrown error (including SyntaxError) causes failure.
    expect(
      () => new AsyncFunction(
        'args', 'phase', 'log', 'pipeline', 'agent', 'parallel', 'budget', 'workflow',
        body,
      ),
      'whole-body AsyncFunction construction must not throw — any throw indicates a syntax error in the workflow body',
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// M5 (TASK-039) — Directory-wide parity lock
// workflows/ and .claude/workflows/ must have identical file sets + byte content.
// Upgrading from single-file check to directory enumeration so TASK-038 adding
// deep-research.js is automatically covered.
// ---------------------------------------------------------------------------

describe('AC1/AC3 — directory-wide parity: workflows/ vs .claude/workflows/', () => {
  it('both_workflow_directories_have_identical_file_sets', () => {
    expect(existsSync(PLUGIN_WORKFLOWS_DIR), 'workflows/ directory must exist').toBe(true);
    expect(existsSync(DEV_WORKFLOWS_DIR), '.claude/workflows/ directory must exist').toBe(true);

    const pluginFiles = readdirSync(PLUGIN_WORKFLOWS_DIR)
      .filter((n) => !n.startsWith('.'))
      .sort();
    const devFiles = readdirSync(DEV_WORKFLOWS_DIR)
      .filter((n) => !n.startsWith('.'))
      .sort();

    expect(
      pluginFiles,
      'file set in workflows/ and .claude/workflows/ must be identical',
    ).toEqual(devFiles);
  });

  it('all_workflow_files_are_byte_identical_between_directories', () => {
    const pluginFiles = readdirSync(PLUGIN_WORKFLOWS_DIR)
      .filter((n) => !n.startsWith('.'))
      .sort();

    for (const name of pluginFiles) {
      const pluginBytes = readFileSync(join(PLUGIN_WORKFLOWS_DIR, name));
      const devPath     = join(DEV_WORKFLOWS_DIR, name);
      expect(
        existsSync(devPath),
        `.claude/workflows/${name} must exist as a parity copy`,
      ).toBe(true);
      const devBytes = readFileSync(devPath);
      expect(
        pluginBytes.equals(devBytes),
        `workflows/${name} and .claude/workflows/${name} must be byte-identical`,
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Materializer — created branch copies workflows/ into the target project
// ---------------------------------------------------------------------------

describe('AC2 — materializer: created branch copies workflow scripts', () => {
  it('created_branch_writes_workflows_to_target_project', async () => {
    const { runInit } = await import(PROD.init);
    const repoDir = makeTmpDir('af-wf-mat-created');

    const prompter = makeScriptedPrompter(webSaasAnswers({ project_name: 'wf-created' }));
    const result = await runInit({
      argv: [],
      prompter,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
    });

    expect(['created', 'forced']).toContain(result.state);

    const destWorkflow = join(repoDir, '.claude', 'workflows', 'deep-review.js');
    expect(
      existsSync(destWorkflow),
      '.claude/workflows/deep-review.js must be materialized in the target project',
    ).toBe(true);

    // Content should match the plugin-root source.
    const destBytes   = readFileSync(destWorkflow);
    const sourceBytes = readFileSync(PLUGIN_ROOT_WORKFLOW);
    expect(
      destBytes.equals(sourceBytes),
      'materialized file must match the plugin-root source',
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Materializer — no-overwrite: existing destination file is never clobbered
// ---------------------------------------------------------------------------

describe('AC2 — materializer: existing destination file is never overwritten', () => {
  it('no_overwrite_existing_destination_workflow', async () => {
    const { runInit } = await import(PROD.init);
    const repoDir = makeTmpDir('af-wf-mat-nooverwrite');

    // Pre-write a sentinel to the destination path BEFORE init runs.
    const destDir      = join(repoDir, '.claude', 'workflows');
    const destWorkflow = join(destDir, 'deep-review.js');

    // We need the directory to exist first so we can write the sentinel.
    const { mkdirSync } = await import('node:fs');
    mkdirSync(destDir, { recursive: true });
    const sentinel = '// sentinel — must not be overwritten\n';
    writeFileSync(destWorkflow, sentinel, 'utf8');

    const prompter = makeScriptedPrompter(webSaasAnswers({ project_name: 'wf-nooverwrite' }));
    await runInit({
      argv: [],
      prompter,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
    });

    // The sentinel must be untouched.
    const after = readFileSync(destWorkflow, 'utf8');
    expect(
      after,
      'materializer must not overwrite an existing destination file',
    ).toBe(sentinel);
  });
});

// ---------------------------------------------------------------------------
// Materializer — idempotency (M3, TASK-039): second run (already_initialized)
// is a non-vacuous no-op.
//
// Previous version compared contentBefore vs contentAfter from the SAME source
// file — that test was vacuous because identical-bytes-from-the-same-source
// would pass even if the already_initialized branch had regressed to overwriting.
//
// This version:
//   1. Runs the first init (materializes deep-review.js from source).
//   2. Captures the directory listing after first init.
//   3. PERTURBS the destination file with a sentinel value (different from source).
//   4. Runs a second init (should hit already_initialized branch).
//   5. Asserts the sentinel is STILL present (not overwritten by source).
//   6. Asserts the directory listing is identical pre/post-second-run (no new files).
// ---------------------------------------------------------------------------

describe('AC2 — materializer: idempotency — already_initialized branch is non-vacuous no-op', () => {
  it('already_initialized_does_not_alter_existing_workflows', async () => {
    const { runInit } = await import(PROD.init);
    const repoDir = makeTmpDir('af-wf-mat-idemp');

    // First run: full created branch — materializes the workflow.
    const prompter = makeScriptedPrompter(webSaasAnswers({ project_name: 'wf-idemp' }));
    const first = await runInit({
      argv: [],
      prompter,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
    });
    expect(['created', 'forced']).toContain(first.state);

    const destWorkflowDir = join(repoDir, '.claude', 'workflows');
    const destWorkflow = join(destWorkflowDir, 'deep-review.js');
    expect(existsSync(destWorkflow), 'workflow must be materialized on first run').toBe(true);

    // Capture the directory listing after the first init (pre-second-run baseline).
    const dirListingBeforeSecondRun = readdirSync(destWorkflowDir).sort();

    // PERTURB: overwrite the destination with a distinct sentinel that cannot
    // accidentally match the source. This makes the test non-vacuous:
    // if the already_initialized branch somehow re-copies the source, the
    // sentinel will be gone and the assertion below will catch it.
    const sentinel = '// TASK-039 sentinel — must survive already_initialized branch\n';
    writeFileSync(destWorkflow, sentinel, 'utf8');

    // Verify the sentinel is actually different from the source so the test
    // is not trivially vacuous.
    const sourceContent = readFileSync(PLUGIN_ROOT_WORKFLOW, 'utf8');
    expect(
      sentinel,
      'sentinel must differ from the plugin-root source (otherwise the test is still vacuous)',
    ).not.toBe(sourceContent);

    // Second run: already_initialized branch — must not touch workflows.
    const second = await runInit({
      argv: [],
      prompter: async () => { throw new Error('prompter must not be called in already_initialized'); },
      repoRoot: repoDir,
      now: () => '2099-01-01T00:00:00Z',
    });
    expect(second.state).toBe('already_initialized');

    // The sentinel must still be present — the already_initialized branch must
    // NOT have re-copied the source over it.
    const contentAfterSecondRun = readFileSync(destWorkflow, 'utf8');
    expect(
      contentAfterSecondRun,
      'already_initialized branch must not overwrite the perturbed destination file — sentinel must survive',
    ).toBe(sentinel);

    // The directory listing must be identical (no new files added by the second run).
    const dirListingAfterSecondRun = readdirSync(destWorkflowDir).sort();
    expect(
      dirListingAfterSecondRun,
      'already_initialized branch must not add or remove files in .claude/workflows/',
    ).toEqual(dirListingBeforeSecondRun);
  });
});
