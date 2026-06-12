// tests/e2e/apply-workflows.spec.js
// TASK-040 — regression locks for the --apply-workflows flag.
//
// AC map:
//   AC1 — already-initialized project: missing workflow file added, existing
//          workflow file untouched (sentinel preserved), PROJECT.md byte-identical
//          pre/post, no session bundle minted.
//   AC2 — not-yet-initialized project: workflows materialized, wizard never
//          invoked (throwIfCalled prompter), no PROJECT.md created, no session
//          bundle minted.
//   AC5 — CLI parse errors: --apply-workflows combined with --force or
//          --answers-file rejects with a clear message before any filesystem write.
//
// VACUITY RULE: each lock was confirmed red before implementation (perturb → RED →
// restore → GREEN). Red-green confirmation recorded in the commit message.

import { describe, it, expect, afterAll } from 'vitest';
import {
  existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync,
} from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from '../helpers/repoRoot.js';
import { PROD } from '../helpers/fixtures.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';
import { makeScriptedPrompter, webSaasAnswers } from '../helpers/scripted-prompter.js';

afterAll(cleanupAll);

const FIXED_NOW = '2026-06-12T12:00:00Z';

const PLUGIN_WORKFLOWS_DIR = join(REPO_ROOT, 'workflows');

// Enumerate all workflow files from the plugin root so this spec stays current
// as new workflow files are added in the future.
const ALL_WORKFLOW_FILES = readdirSync(PLUGIN_WORKFLOWS_DIR)
  .filter((n) => !n.startsWith('.') && n.endsWith('.js'))
  .sort();

/** A prompter that throws if invoked — proves --apply-workflows never calls the wizard. */
function throwIfCalled() {
  return async (ctx) => {
    throw new Error(`prompter must not be called by --apply-workflows: ${JSON.stringify(ctx)}`);
  };
}

// ---------------------------------------------------------------------------
// AC1 — retrofit on an already-initialized project
// ---------------------------------------------------------------------------

describe('AC1 — --apply-workflows on already-initialized project', () => {
  it('adds_missing_workflow_file_and_leaves_existing_sentinel_untouched', async () => {
    const { runInit } = await import(PROD.init);

    const repoDir = makeTmpDir('af-aw-retrofit');

    // Phase 1: full wizard init to initialize the project.
    const prompter = makeScriptedPrompter(webSaasAnswers({ project_name: 'aw-retrofit' }));
    const initResult = await runInit({
      argv: [],
      prompter,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
    });
    expect(['created', 'forced']).toContain(initResult.state);

    // Verify PROJECT.md exists and capture its exact bytes for the byte-identity check.
    const projectMdPath = join(repoDir, 'PROJECT.md');
    expect(existsSync(projectMdPath), 'PROJECT.md must exist after init').toBe(true);
    const projectMdBefore = readFileSync(projectMdPath, 'utf8');

    // Verify all workflow files were materialized by the first init.
    const workflowsDir = join(repoDir, '.claude', 'workflows');
    for (const fileName of ALL_WORKFLOW_FILES) {
      expect(
        existsSync(join(workflowsDir, fileName)),
        `${fileName} must exist after first init`,
      ).toBe(true);
    }

    // Phase 2: simulate a "newly-shipped" workflow by deleting one file and
    // placing a sentinel in another. This is the retrofit scenario:
    //   - The deleted file represents a workflow that was not present at init time.
    //   - The sentinel-bearing file represents an existing workflow that --apply-workflows
    //     must never overwrite.
    //
    // Use the first and second files in the sorted list (deep-research.js, deep-review.js).
    const [fileToDelete, fileToSentinel] = ALL_WORKFLOW_FILES;

    const deletedPath = join(workflowsDir, fileToDelete);
    const { rmSync } = await import('node:fs');
    rmSync(deletedPath);
    expect(existsSync(deletedPath), 'deleted file must be gone before --apply-workflows').toBe(false);

    const sentinelPath = join(workflowsDir, fileToSentinel);
    const sentinel = '// TASK-040 sentinel — must survive --apply-workflows\n';
    writeFileSync(sentinelPath, sentinel, 'utf8');

    // Count session bundles before the apply-workflows run.
    const sessionsDir = join(repoDir, 'state', 'sessions');
    const sessionsBefore = existsSync(sessionsDir) ? readdirSync(sessionsDir).sort() : [];

    // Phase 3: run --apply-workflows on the already-initialized project.
    // The wizard must NOT be called (use throwIfCalled to enforce).
    const applyResult = await runInit({
      argv: ['--apply-workflows'],
      prompter: throwIfCalled(),
      repoRoot: repoDir,
      now: () => '2099-01-01T00:00:00Z',
    });

    expect(applyResult.state).toBe('applied_workflows');

    // (a) Deleted file must be restored.
    expect(
      existsSync(deletedPath),
      `${fileToDelete} must be restored by --apply-workflows`,
    ).toBe(true);

    // Verify restored file matches the plugin-root source.
    const restoredBytes = readFileSync(deletedPath);
    const sourceBytes = readFileSync(join(PLUGIN_WORKFLOWS_DIR, fileToDelete));
    expect(
      restoredBytes.equals(sourceBytes),
      `restored ${fileToDelete} must match plugin-root source`,
    ).toBe(true);

    // (b) Sentinel-bearing file must be untouched (never-overwrite contract).
    const sentinelAfter = readFileSync(sentinelPath, 'utf8');
    expect(
      sentinelAfter,
      `${fileToSentinel} sentinel must survive --apply-workflows (never-overwrite)`,
    ).toBe(sentinel);

    // (c) PROJECT.md must be byte-identical pre/post (--apply-workflows must not
    //     touch PROJECT.md regardless of project init state).
    const projectMdAfter = readFileSync(projectMdPath, 'utf8');
    expect(
      projectMdAfter,
      'PROJECT.md must be byte-identical before and after --apply-workflows',
    ).toBe(projectMdBefore);

    // (d) No new session bundle was minted by the --apply-workflows run.
    const sessionsAfter = existsSync(sessionsDir) ? readdirSync(sessionsDir).sort() : [];
    expect(
      sessionsAfter,
      '--apply-workflows must not mint a new session bundle',
    ).toEqual(sessionsBefore);
  });
});

// ---------------------------------------------------------------------------
// AC2 — not-yet-initialized project (no PROJECT.md, no wizard, no bundle)
// ---------------------------------------------------------------------------

describe('AC2 — --apply-workflows on not-yet-initialized project', () => {
  it('materializes_workflows_without_wizard_and_without_creating_project_md_or_session', async () => {
    const { runInit } = await import(PROD.init);

    // Fresh tmp dir — no PROJECT.md, no state/, nothing.
    const repoDir = makeTmpDir('af-aw-notinit');

    // PROJECT.md must not exist before the run.
    const projectMdPath = join(repoDir, 'PROJECT.md');
    expect(existsSync(projectMdPath), 'PROJECT.md must not exist before the run').toBe(false);

    // The throwIfCalled prompter proves the wizard was never invoked.
    const applyResult = await runInit({
      argv: ['--apply-workflows'],
      prompter: throwIfCalled(),
      repoRoot: repoDir,
      now: () => FIXED_NOW,
    });

    expect(applyResult.state).toBe('applied_workflows');

    // (a) Workflow files were materialized.
    const workflowsDir = join(repoDir, '.claude', 'workflows');
    expect(
      existsSync(workflowsDir),
      '.claude/workflows/ must be created by --apply-workflows',
    ).toBe(true);

    // Non-vacuity guard: ensure we have at least the known files.
    expect(
      ALL_WORKFLOW_FILES,
      'ALL_WORKFLOW_FILES must include deep-review.js and deep-research.js',
    ).toEqual(expect.arrayContaining(['deep-review.js', 'deep-research.js']));

    for (const fileName of ALL_WORKFLOW_FILES) {
      expect(
        existsSync(join(workflowsDir, fileName)),
        `${fileName} must be materialized by --apply-workflows on uninitialized project`,
      ).toBe(true);
    }

    // (b) PROJECT.md was NOT created (the wizard was never run).
    expect(
      existsSync(projectMdPath),
      '--apply-workflows must not create PROJECT.md on an uninitialized project',
    ).toBe(false);

    // (c) No session bundle was minted.
    const sessionsDir = join(repoDir, 'state', 'sessions');
    const sessionsBefore = existsSync(sessionsDir) ? readdirSync(sessionsDir) : [];
    // The pointer file (state/session.json) must not exist either.
    expect(
      existsSync(join(repoDir, 'state', 'session.json')),
      '--apply-workflows must not mint a session pointer',
    ).toBe(false);
    expect(
      sessionsBefore,
      '--apply-workflows must not mint any session bundle',
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// AC5 — CLI parse errors: conflicting flags rejected before any filesystem write
// ---------------------------------------------------------------------------

describe('AC5 — --apply-workflows exclusivity: conflicting flag combinations throw', () => {
  it('apply_workflows_with_force_throws_before_any_write', async () => {
    const { runInit } = await import(PROD.init);
    const repoDir = makeTmpDir('af-aw-force-combo');

    // Must throw (no filesystem write occurs before parseArgs validates).
    await expect(
      runInit({
        argv: ['--apply-workflows', '--force'],
        prompter: throwIfCalled(),
        repoRoot: repoDir,
        now: () => FIXED_NOW,
      }),
    ).rejects.toThrow(/--apply-workflows/);

    // No workflow directory was created (error fired before any I/O).
    expect(
      existsSync(join(repoDir, '.claude', 'workflows')),
      'no workflows dir must be created when parseArgs rejects the combination',
    ).toBe(false);
  });

  it('apply_workflows_with_answers_file_throws_before_any_write', async () => {
    const { runInit } = await import(PROD.init);
    const repoDir = makeTmpDir('af-aw-answersfile-combo');

    await expect(
      runInit({
        argv: ['--apply-workflows', '--answers-file', 'answers.json'],
        prompter: throwIfCalled(),
        repoRoot: repoDir,
        now: () => FIXED_NOW,
      }),
    ).rejects.toThrow(/--apply-workflows/);

    expect(
      existsSync(join(repoDir, '.claude', 'workflows')),
      'no workflows dir must be created when parseArgs rejects the combination',
    ).toBe(false);
  });
});
