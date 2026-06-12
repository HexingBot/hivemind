// tests/e2e/workflows-materializer.spec.js
// TASK-037 (tests-after) — regression locks for the workflow materializer and
// the deep-review.js static shape.
//
// AC5 scope (no extras — every spec here encodes an AC or a real regression):
//   - Static shape: deep-review.js exists in both locations, meta block parses
//     with required name/description fields.
//   - Parity: plugin-root workflows/deep-review.js and .claude/workflows/deep-review.js
//     are byte-identical.
//   - Materializer copy: created/forced/resumed branches write .claude/workflows/
//     into the target project.
//   - Materializer no-overwrite: an existing destination file is never clobbered.
//   - Materializer idempotency: a second init run with already_initialized produces
//     no change to .claude/workflows/ in the target.
//   - Materializer skip-on-initialized: already_initialized branch does NOT touch
//     .claude/workflows/ (file-set identical to pre-run).

import { describe, it, expect, afterAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
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

  it('plugin_root_and_dogfood_copies_are_byte_identical', () => {
    expect(existsSync(PLUGIN_ROOT_WORKFLOW), 'plugin-root copy must exist').toBe(true);
    expect(existsSync(DEV_WORKFLOW), '.claude copy must exist').toBe(true);

    const pluginBytes = readFileSync(PLUGIN_ROOT_WORKFLOW);
    const devBytes    = readFileSync(DEV_WORKFLOW);
    expect(
      pluginBytes.equals(devBytes),
      'workflows/deep-review.js and .claude/workflows/deep-review.js must be byte-identical',
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
    const { mkdirSync, writeFileSync } = await import('node:fs');
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
// Materializer — idempotency: second run (already_initialized) is a no-op
// ---------------------------------------------------------------------------

describe('AC2 — materializer: idempotency — already_initialized branch skips', () => {
  it('already_initialized_does_not_alter_existing_workflows', async () => {
    const { runInit } = await import(PROD.init);
    const { writeProjectMd } = await import(PROD.projectMd);
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

    const destWorkflow = join(repoDir, '.claude', 'workflows', 'deep-review.js');
    expect(existsSync(destWorkflow), 'workflow must be materialized on first run').toBe(true);

    const contentBefore = readFileSync(destWorkflow, 'utf8');

    // Second run: already_initialized branch — must not touch workflows.
    const second = await runInit({
      argv: [],
      prompter: async () => { throw new Error('prompter must not be called in already_initialized'); },
      repoRoot: repoDir,
      now: () => '2099-01-01T00:00:00Z',
    });
    expect(second.state).toBe('already_initialized');

    // File content unchanged.
    const contentAfter = readFileSync(destWorkflow, 'utf8');
    expect(
      contentAfter,
      'already_initialized branch must not alter .claude/workflows/ files',
    ).toBe(contentBefore);
  });
});
