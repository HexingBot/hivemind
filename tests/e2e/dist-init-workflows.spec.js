// tests/e2e/dist-init-workflows.spec.js
// TASK-039 M4 — bundled __dirname resolution path is sensor-covered.
// TASK-038 AC3 — extended to assert deep-research.js also lands via dist/init.cjs.
//
// AC4: one e2e spec executes `node dist/init.cjs` (answers-file mode) in a tmp
// project dir and asserts ALL workflow files (deep-review.js, deep-research.js,
// and any future files) are materialized.
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
import { existsSync, readdirSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

import { REPO_ROOT } from '../helpers/repoRoot.js';

// Enumerate the canonical set of workflow files from the plugin root.
const PLUGIN_WORKFLOWS_DIR = join(REPO_ROOT, 'workflows');
const EXPECTED_WORKFLOW_FILES = readdirSync(PLUGIN_WORKFLOWS_DIR)
  .filter((n) => !n.startsWith('.') && n.endsWith('.js'))
  .sort();

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

    // Non-vacuity guard: if the readdirSync filter silently yielded zero entries,
    // the for-loop below would run zero iterations and the test would pass on
    // exit-0 alone — missing the materialization entirely. Pin both known files
    // by name so an empty or mis-filtered enumeration fails here rather than
    // producing a green-but-inert loop.
    expect(
      EXPECTED_WORKFLOW_FILES,
      'EXPECTED_WORKFLOW_FILES must include both deep-review.js and deep-research.js',
    ).toEqual(expect.arrayContaining(['deep-review.js', 'deep-research.js']));

    // The key assertion: every workflow file must exist in the tmp project dir.
    // This proves the bundled __dirname resolution worked — the CJS bundle found
    // the plugin-root workflows/ dir relative to dist/ and copied all files into
    // the target project.
    for (const fileName of EXPECTED_WORKFLOW_FILES) {
      const destWorkflow = join(projectDir, '.claude', 'workflows', fileName);
      expect(
        existsSync(destWorkflow),
        `.claude/workflows/${fileName} must be materialized by dist/init.cjs in ${projectDir}. ${diagnostics}`,
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// TASK-040 stdout regression lock — --apply-workflows must NOT print the
// normal-init epilogue (false PROJECT.md-written + literal null session path).
// ---------------------------------------------------------------------------
//
// This spec is the regression lock for the UAT-FAIL found in TASK-040:
//   printFriendlyOutcome had no case for 'applied_workflows' state and fell
//   through to the normal-init epilogue, printing three false lines after the
//   correct summary.
//
// VACUITY CONFIRMATION (red-green):
//   RED:   ran this spec against a build from bin/init.js WITHOUT the fix
//          (state === 'already_initialized' only guard) — spec failed with
//          "stdout must not contain 'PROJECT.md written'" because the false line
//          was present.
//   GREEN: ran again after adding `|| state === 'applied_workflows'` to the
//          guard in printFriendlyOutcome + rebuilding dist/ — spec passes.

describe('TASK-040 stdout lock — --apply-workflows suppresses normal-init epilogue', () => {
  it('apply_workflows_stdout_has_summary_line_but_no_false_epilogue', () => {
    expect(existsSync(DIST_INIT_CJS), 'dist/init.cjs must exist').toBe(true);

    // Create a tmp project that already has .claude/workflows/ with at least
    // one workflow file present — this is the retrofit scenario (initialized
    // project, missing one workflow file).
    const projectDir = makeTmp('af-aw-stdout');
    const workflowsDir = join(projectDir, '.claude', 'workflows');

    // Pre-populate the workflows dir with the first known workflow file so the
    // materializer has at least one file to skip and (if a second exists) one to add.
    // This avoids a zero-added / zero-skipped edge case in the summary line regex.
    // mkdirSync and writeFileSync are imported at the top of this module.
    mkdirSync(workflowsDir, { recursive: true });
    // Write a sentinel for the first workflow file.
    const [firstFile] = EXPECTED_WORKFLOW_FILES;
    writeFileSync(join(workflowsDir, firstFile), '// sentinel\n', 'utf8');

    const result = spawnSync(
      process.execPath,
      [DIST_INIT_CJS, '--apply-workflows'],
      {
        cwd: projectDir,
        env: {
          ...process.env,
          CLAUDE_PROJECT_DIR: projectDir,
        },
        encoding: 'utf8',
        timeout: 60000,
      },
    );

    const diagnostics = `exit=${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`;

    // Must exit cleanly.
    expect(
      result.status,
      `dist/init.cjs --apply-workflows must exit 0. ${diagnostics}`,
    ).toBe(0);

    // MUST contain the --apply-workflows summary line.
    expect(
      result.stdout,
      `stdout must contain the --apply-workflows summary line. ${diagnostics}`,
    ).toMatch(/--apply-workflows: \d+ file\(s\) added/);

    // Must NOT contain false "PROJECT.md written" line.
    expect(
      result.stdout,
      `stdout must NOT contain 'PROJECT.md written' (no PROJECT.md was written). ${diagnostics}`,
    ).not.toContain('PROJECT.md written');

    // Must NOT contain the literal "state/sessions/null" path (null sessionId).
    expect(
      result.stdout,
      `stdout must NOT contain 'state/sessions/null' (no session was minted). ${diagnostics}`,
    ).not.toContain('state/sessions/null');

    // Must NOT contain the "Session bundle:" line at all.
    expect(
      result.stdout,
      `stdout must NOT contain 'Session bundle:' line. ${diagnostics}`,
    ).not.toContain('Session bundle:');

    // Must NOT contain the "Next step:" line.
    expect(
      result.stdout,
      `stdout must NOT contain 'Next step:' line. ${diagnostics}`,
    ).not.toContain('Next step:');
  });
});

// ---------------------------------------------------------------------------
// TASK-044 stdout regression lock — --apply-models must NOT print the
// normal-init epilogue (false PROJECT.md-written + literal null session path).
// ---------------------------------------------------------------------------
//
// This spec is the regression lock for the defect found in TASK-044:
//   printFriendlyOutcome had no case for 'applied_models' or 'no_op' states
//   and fell through to the normal-init epilogue, printing three false lines
//   after the correct summary line emitted inside runInit.
//
// The fix introduces SELF_SUMMARIZING_STATES (a Set) in bin/init.js so any
// future apply-* state can be registered in one place.
//
// VACUITY CONFIRMATION (red-green):
//   RED:   ran this spec against dist/init.cjs built from bin/init.js BEFORE
//          the fix (SELF_SUMMARIZING_STATES set absent; only 'already_initialized'
//          and 'applied_workflows' guarded) — spec failed because stdout contained
//          'PROJECT.md written', 'state/sessions/null', and 'Next step:'.
//   GREEN: ran again after adding 'applied_models' + 'no_op' to
//          SELF_SUMMARIZING_STATES and rebuilding dist/ — spec passes.

describe('TASK-044 stdout lock — --apply-models suppresses normal-init epilogue', () => {
  it('apply_models_stdout_has_summary_line_but_no_false_epilogue', () => {
    expect(existsSync(DIST_INIT_CJS), 'dist/init.cjs must exist').toBe(true);

    // Create a tmp project with a PROJECT.md that carries an agent_models map
    // AND a matching .claude/agents/developer.md so the applier has a file to patch.
    const projectDir = makeTmp('af-am-stdout');

    // Write a minimal PROJECT.md with a valid agent_models frontmatter map.
    // The inline-map format ({key: value}) matches what writeProjectMd emits.
    const projectMdContent = [
      '---',
      'name: am-stdout-test',
      'type: cli-tool',
      'created_at: 2026-06-15T00:00:00Z',
      'schema_version: 1',
      'agent_models: {developer: haiku}',
      '---',
      '',
      '# am-stdout-test',
      '',
      '## Stack',
      '- project_type: cli-tool',
      '',
    ].join('\n');
    writeFileSync(join(projectDir, 'PROJECT.md'), projectMdContent, 'utf8');

    // Write a minimal developer agent file so applyAgentModels has a target.
    const agentsDir = join(projectDir, '.claude', 'agents');
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(
      join(agentsDir, 'developer.md'),
      [
        '---',
        'name: developer',
        'description: Developer subagent.',
        'model: sonnet',
        '---',
        '',
        '# developer',
        '',
        'Agent body.',
        '',
      ].join('\n'),
      'utf8',
    );

    const result = spawnSync(
      process.execPath,
      [DIST_INIT_CJS, '--apply-models'],
      {
        cwd: projectDir,
        env: {
          ...process.env,
          CLAUDE_PROJECT_DIR: projectDir,
        },
        encoding: 'utf8',
        timeout: 60000,
      },
    );

    const diagnostics = `exit=${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`;

    // Must exit cleanly.
    expect(
      result.status,
      `dist/init.cjs --apply-models must exit 0. ${diagnostics}`,
    ).toBe(0);

    // MUST contain the --apply-models summary line.
    expect(
      result.stdout,
      `stdout must contain the --apply-models summary line. ${diagnostics}`,
    ).toMatch(/--apply-models: updated \d+ file\(s\)/);

    // Must NOT contain false "PROJECT.md written" line.
    expect(
      result.stdout,
      `stdout must NOT contain 'PROJECT.md written' (no PROJECT.md was written by --apply-models). ${diagnostics}`,
    ).not.toContain('PROJECT.md written');

    // Must NOT contain the literal "state/sessions/null" path (null sessionId).
    expect(
      result.stdout,
      `stdout must NOT contain 'state/sessions/null' (no session was minted). ${diagnostics}`,
    ).not.toContain('state/sessions/null');

    // Must NOT contain the "Next step:" line.
    expect(
      result.stdout,
      `stdout must NOT contain 'Next step:' line. ${diagnostics}`,
    ).not.toContain('Next step:');
  });

  it('apply_models_no_op_stdout_has_summary_line_but_no_false_epilogue', () => {
    expect(existsSync(DIST_INIT_CJS), 'dist/init.cjs must exist').toBe(true);

    // PROJECT.md WITHOUT agent_models — triggers the no_op branch.
    const projectDir = makeTmp('af-am-noop-stdout');
    const projectMdContent = [
      '---',
      'name: am-noop-test',
      'type: other',
      'created_at: 2026-06-15T00:00:00Z',
      'schema_version: 1',
      '---',
      '',
      '# am-noop-test',
      '',
    ].join('\n');
    writeFileSync(join(projectDir, 'PROJECT.md'), projectMdContent, 'utf8');

    const result = spawnSync(
      process.execPath,
      [DIST_INIT_CJS, '--apply-models'],
      {
        cwd: projectDir,
        env: {
          ...process.env,
          CLAUDE_PROJECT_DIR: projectDir,
        },
        encoding: 'utf8',
        timeout: 60000,
      },
    );

    const diagnostics = `exit=${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`;

    expect(
      result.status,
      `dist/init.cjs --apply-models (no_op) must exit 0. ${diagnostics}`,
    ).toBe(0);

    // MUST contain the no-op summary line.
    expect(
      result.stdout,
      `stdout must contain the no-op summary line. ${diagnostics}`,
    ).toMatch(/--apply-models: no agent_models map/);

    // Must NOT print the false epilogue lines.
    expect(
      result.stdout,
      `stdout must NOT contain 'PROJECT.md written'. ${diagnostics}`,
    ).not.toContain('PROJECT.md written');

    expect(
      result.stdout,
      `stdout must NOT contain 'state/sessions/null'. ${diagnostics}`,
    ).not.toContain('state/sessions/null');

    expect(
      result.stdout,
      `stdout must NOT contain 'Next step:'. ${diagnostics}`,
    ).not.toContain('Next step:');
  });
});
