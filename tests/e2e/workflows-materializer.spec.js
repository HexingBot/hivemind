// tests/e2e/workflows-materializer.spec.js
// TASK-037 (tests-after) — regression locks for the workflow materializer and
// the deep-review.js static shape.
// TASK-039 (tests-after) — hardening: non-vacuous already_initialized spec (M3),
// whole-body parse lock + directory-wide parity (M5).
// TASK-038 (uat-only, AC3/AC5) — generalize static-shape + materializer specs
// to iterate over all workflow files so deep-research.js (and any future files)
// are automatically covered without duplicating tests.
//
// AC5 scope (no extras — every spec here encodes an AC or a real regression):
//   - Static shape (all files): every workflow file in workflows/ exists in both
//     locations, meta block parses with required name/description fields, and the
//     full body syntax-checks via AsyncFunction construction.
//   - Whole-body parse lock: as above, now applied to every file in the directory.
//   - Parity (directory-wide): workflows/ and .claude/workflows/ have identical
//     file sets and every file is byte-identical.
//   - Materializer copy: created/forced/resumed branches write ALL workflow files
//     from workflows/ into the target project's .claude/workflows/.
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

// Directories (for directory-wide parity check — M5).
const PLUGIN_WORKFLOWS_DIR = join(REPO_ROOT, 'workflows');
const DEV_WORKFLOWS_DIR    = join(REPO_ROOT, '.claude', 'workflows');

// Enumerate all workflow files at spec-load time.
// The static-shape specs iterate over this list so any future workflow file
// (e.g., deep-research.js added by TASK-038) is automatically covered.
const ALL_WORKFLOW_FILES = readdirSync(PLUGIN_WORKFLOWS_DIR)
  .filter((n) => !n.startsWith('.') && n.endsWith('.js'))
  .sort();

// ---------------------------------------------------------------------------
// Static shape — file existence, meta block validity, and whole-body parse lock
// applied to EVERY workflow file in workflows/.
// ---------------------------------------------------------------------------

describe('AC1/AC3/AC5 — all workflow scripts static shape', () => {
  it('plugin_workflows_dir_contains_required_workflow_files', () => {
    // Non-vacuity guard: pin both known file names so a silent rename or
    // mis-filtered enumeration fails here rather than producing a green-but-inert
    // loop. Names are the load-bearing assertion; a count-only guard would pass
    // even if both files were renamed to something else.
    expect(
      ALL_WORKFLOW_FILES,
      `workflows/ must contain deep-review.js and deep-research.js; found: ${ALL_WORKFLOW_FILES.join(', ')}`,
    ).toEqual(expect.arrayContaining(['deep-review.js', 'deep-research.js']));
  });

  for (const fileName of ALL_WORKFLOW_FILES) {
    const pluginPath = join(PLUGIN_WORKFLOWS_DIR, fileName);
    const devPath    = join(DEV_WORKFLOWS_DIR, fileName);
    const slug       = fileName.replace(/\.js$/, '').replace(/[^a-z0-9]/g, '_');

    it(`${slug}__plugin_root_file_exists`, () => {
      expect(
        existsSync(pluginPath),
        `workflows/${fileName} must exist at the plugin root`,
      ).toBe(true);
    });

    it(`${slug}__dotclause_parity_copy_exists`, () => {
      expect(
        existsSync(devPath),
        `.claude/workflows/${fileName} must exist as the dogfood parity copy`,
      ).toBe(true);
    });

    it(`${slug}__meta_block_parses_with_required_name_and_description`, () => {
      const src = readFileSync(pluginPath, 'utf8');

      // Extract the export const meta = { ... }; literal block.
      // The spec requires meta to be a pure literal (no variables/calls/spreads).
      const metaMatch = src.match(/export\s+const\s+meta\s*=\s*(\{[\s\S]*?\n\});/);
      expect(
        metaMatch,
        `${fileName}: must contain export const meta = { ... }; as a top-level pure literal`,
      ).not.toBeNull();

      // Evaluate the literal in isolation — safe because it is a pure object literal.
      // eslint-disable-next-line no-new-func
      const meta = new Function(`return ${metaMatch[1]}`)();

      expect(typeof meta.name, `${fileName}: meta.name must be a string`).toBe('string');
      expect(meta.name.length, `${fileName}: meta.name must be non-empty`).toBeGreaterThan(0);

      expect(typeof meta.description, `${fileName}: meta.description must be a string`).toBe('string');
      expect(meta.description.length, `${fileName}: meta.description must be non-empty`).toBeGreaterThan(0);

      // The file name must match the meta.name (e.g., deep-review.js → 'deep-review').
      const expectedName = fileName.replace(/\.js$/, '');
      expect(
        meta.name,
        `${fileName}: meta.name must equal '${expectedName}'`,
      ).toBe(expectedName);
    });

    // M5 (TASK-039) — whole-body parse lock, now generalized to all workflow files.
    // Construct (never invoke) an AsyncFunction over the entire script body so any
    // syntax error below the meta block fails the suite.
    it(`${slug}__whole_body_syntax_check_via_AsyncFunction_construction`, () => {
      const src = readFileSync(pluginPath, 'utf8');

      const metaStart = src.indexOf('export const meta =');
      expect(metaStart, `${fileName}: export const meta = must exist`).toBeGreaterThanOrEqual(0);

      const metaEndToken = '\n};';
      const metaEndIdx = src.indexOf(metaEndToken, metaStart);
      expect(metaEndIdx, `${fileName}: meta block closing }; must be findable`).toBeGreaterThanOrEqual(0);

      const body = src.slice(metaEndIdx + metaEndToken.length);
      expect(body.length, `${fileName}: body after meta block must be non-empty`).toBeGreaterThan(0);

      // eslint-disable-next-line no-new-func
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

      expect(
        () => new AsyncFunction(
          'args', 'phase', 'log', 'pipeline', 'agent', 'parallel', 'budget', 'workflow',
          body,
        ),
        `${fileName}: whole-body AsyncFunction construction must not throw`,
      ).not.toThrow();
    });
  }
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
// Materializer — created branch copies ALL workflows/ files into the target
// project. The test iterates over ALL_WORKFLOW_FILES so TASK-038's
// deep-research.js (and any future file) is automatically covered with zero
// materializer code changes (proving AC3 of TASK-038).
// ---------------------------------------------------------------------------

describe('AC2/AC3 — materializer: created branch copies all workflow scripts', () => {
  it('created_branch_writes_all_workflows_to_target_project', async () => {
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

    // Assert every file in the plugin-root workflows/ directory lands in the
    // target project's .claude/workflows/ with byte-identical content.
    for (const fileName of ALL_WORKFLOW_FILES) {
      const destWorkflow   = join(repoDir, '.claude', 'workflows', fileName);
      const sourceWorkflow = join(PLUGIN_WORKFLOWS_DIR, fileName);

      expect(
        existsSync(destWorkflow),
        `.claude/workflows/${fileName} must be materialized in the target project`,
      ).toBe(true);

      const destBytes   = readFileSync(destWorkflow);
      const sourceBytes = readFileSync(sourceWorkflow);
      expect(
        destBytes.equals(sourceBytes),
        `materialized ${fileName} must match the plugin-root source`,
      ).toBe(true);
    }
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
    // is not trivially vacuous. Use deep-review.js as the reference source.
    const sourceContent = readFileSync(join(PLUGIN_WORKFLOWS_DIR, 'deep-review.js'), 'utf8');
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
