// tests/e2e/dist-init-workflows.spec.js
// TASK-039 M4 — bundled __dirname resolution path is sensor-covered.
//
// AC4: one e2e spec executes `node dist/init.cjs` (answers-file mode) in a tmp
// project dir and asserts `.claude/workflows/deep-review.js` is materialized.
//
// This tests the CJS bundle's __dirname fallback:
//   dist/init.cjs resolves workflows/ relative to __dirname (the dist/ directory),
//   so the source dir is <pluginRoot>/workflows/ one level up from dist/.
// A mis-resolved or missing path silently no-ops via the existsSync guard in
// materializeWorkflows — this spec catches that silent failure.
//
// The spec runs dist/init.cjs in --answers-file mode (same path as the
// /init-project slash command) so the process exits without prompting.

import { describe, it, expect, afterAll } from 'vitest';
import { existsSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

import { REPO_ROOT } from '../helpers/repoRoot.js';

// The committed bundle under test.
const DIST_INIT_CJS = join(REPO_ROOT, 'dist', 'init.cjs');

// ---- tmp-dir bookkeeping ---------------------------------------------------
const __tmpDirs = [];
function makeTmp(label) {
  const p = mkdtempSync(join(tmpdir(), `${label}-`));
  __tmpDirs.push(p);
  return p;
}
afterAll(() => {
  for (const p of __tmpDirs) {
    try { rmSync(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* AV/EBUSY on win */ }
  }
});

// ---------------------------------------------------------------------------
// AC4 — dist/init.cjs materializes .claude/workflows/deep-review.js
// ---------------------------------------------------------------------------

describe('AC4 (TASK-039 M4) — dist/init.cjs materializes workflow scripts', () => {
  it('dist_init_cjs_exists_as_a_committed_bundle', () => {
    expect(
      existsSync(DIST_INIT_CJS),
      'dist/init.cjs must exist as a committed bundle',
    ).toBe(true);
  });

  it('dist_init_cjs_answers_file_mode_materializes_deep_review_workflow', () => {
    expect(existsSync(DIST_INIT_CJS), 'dist/init.cjs must exist').toBe(true);

    // Create a fresh tmp project dir (no PROJECT.md — clean slate).
    const projectDir = makeTmp('af-dist-wf');

    // Write a minimal answers file for --answers-file mode.
    // Must include the two required keys: project_name and project_type.
    const answersFile = join(makeTmp('af-dist-wf-answers'), 'answers.json');
    writeFileSync(answersFile, JSON.stringify({
      project_name: 'dist-wf-test',
      project_type: 'web-saas',
      project_description: 'dist workflow materializer test',
      target_users: 'testers',
      primary_use_cases: 'automation',
      success_criteria: 'deep-review.js lands',
      frontend_framework: 'react',
      backend_framework: 'node-express',
      database: 'postgres',
      web_deployment_target: 'fly-io',
    }, null, 2), 'utf8');

    // Run the committed bundle with --answers-file pointing at our answers.
    // The bundle runs against projectDir as the "repo root" via resolveRepoRoot,
    // which reads CLAUDE_PROJECT_DIR or falls back to cwd.
    const result = spawnSync(
      process.execPath,
      [DIST_INIT_CJS, '--answers-file', answersFile],
      {
        cwd: projectDir,
        env: {
          ...process.env,
          // Override the repo-root resolution to the tmp project dir.
          CLAUDE_PROJECT_DIR: projectDir,
        },
        encoding: 'utf8',
        timeout: 60000,
      },
    );

    // Must not crash (exit 0). If it exits non-zero, surface stdout/stderr.
    const diagnostics = `exit=${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`;
    expect(
      result.status,
      `dist/init.cjs must exit 0 in answers-file mode. ${diagnostics}`,
    ).toBe(0);

    // The key assertion: .claude/workflows/deep-review.js must exist in the
    // tmp project dir. This proves the bundled __dirname resolution worked —
    // the CJS bundle found the plugin-root workflows/ dir relative to dist/
    // and copied it into the target project.
    const destWorkflow = join(projectDir, '.claude', 'workflows', 'deep-review.js');
    expect(
      existsSync(destWorkflow),
      `.claude/workflows/deep-review.js must be materialized by dist/init.cjs in ${projectDir}. ${diagnostics}`,
    ).toBe(true);
  });
});
