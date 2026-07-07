// tests/e2e/loop-ctl.spec.js
// TASK-097 — e2e regression locks for bin/loop-ctl.js (built as
// dist/loop-ctl.cjs), the CLI wrapper that lets a plugin-installed project
// (no framework src/ on disk) drive session-lock / operating-mode /
// loop-checkpoint / loop-auth via `${CLAUDE_PLUGIN_ROOT}/dist/loop-ctl.cjs`.
//
// ACs covered:
//   AC1 — every subcommand (acquire/renew/release, get-mode/set-mode,
//         checkpoint/resume-point, grant-unattended) is exercised end to end
//         against the BUILT bundle (dist/loop-ctl.cjs), not the src.
//   AC3 — each subcommand's happy path plus at least one failure path
//         (E_LOCK_HELD surfaces as a non-zero exit with the holder identity
//         on stdout).
//   AC4 — plugin-layout proof: invoking the built CLI with cwd set to a bare
//         temp project (no framework src/, no --repo-root passed) flips the
//         mode and writes a checkpoint into THAT project's state/ bundle.
//
// Disk I/O + process spawn -> slow tier: tests/e2e/.

import { describe, it, expect, afterAll } from 'vitest';
import {
  mkdirSync, writeFileSync, readFileSync, existsSync,
} from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';
import { REPO_ROOT } from '../helpers/repoRoot.js';

afterAll(cleanupAll);

const CLI = join(REPO_ROOT, 'dist', 'loop-ctl.cjs');
const SESSION_ID = '20260706T230000Z-c0ffee00';

function runCli(args, {
  cwd, env, input,
} = {}) {
  const cleanEnv = { ...process.env, ...env };
  delete cleanEnv.CLAUDE_PROJECT_DIR; // force cwd-based resolution unless a test opts in
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: cwd || REPO_ROOT,
    env: cleanEnv,
    encoding: 'utf8',
    input, // piped to the child's stdin — undefined means "no stdin write" (spawnSync default)
  });
  const stdoutLine = (r.stdout || '').trim().split('\n').filter(Boolean).pop() || '';
  let json = null;
  try { json = JSON.parse(stdoutLine); } catch { /* leave null — assertions will surface raw stdout */ }
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', json };
}

/** Bootstrap a minimal pointer + active bundle + one task under a fresh temp
 * project dir — no framework src/, no node_modules. Mirrors the makeRepo
 * pattern in tests/e2e/loop-checkpoint.spec.js / loop-auth.spec.js. */
function makeProject() {
  const root = makeTmpDir('af-loopctl');
  mkdirSync(join(root, 'state', 'sessions', SESSION_ID), { recursive: true });
  mkdirSync(join(root, 'tasks'), { recursive: true });

  writeFileSync(
    join(root, 'state', 'session.json'),
    JSON.stringify({
      schema_version: 2,
      active_session_id: SESSION_ID,
      updated_at: '2026-07-06T23:00:00Z',
    }, null, 2),
    'utf8',
  );

  writeFileSync(
    join(root, 'state', 'sessions', SESSION_ID, 'session.json'),
    JSON.stringify({
      schema_version: 2,
      session_id: SESSION_ID,
      lifecycle_state: 'active',
      updated_at: '2026-07-06T23:00:00Z',
      active_task: 'TASK-100',
      workflow_step: 'fetch',
      next_action: 'work TASK-100',
      handoff_summary: 'in progress',
      open_questions: [],
      blockers: [],
      decisions: [],
      subagent_results: [],
      pending_human_confirmation: null,
      mode: 'harness',
    }, null, 2),
    'utf8',
  );

  writeFileSync(
    join(root, 'tasks', 'TASK-100.json'),
    JSON.stringify({
      key: 'TASK-100', title: 'demo', status: 'in_progress', priority: 'high',
    }, null, 2),
    'utf8',
  );

  return root;
}

function readBundle(root) {
  return JSON.parse(readFileSync(join(root, 'state', 'sessions', SESSION_ID, 'session.json'), 'utf8'));
}

describe('loop-ctl bundle exists and runs standalone', () => {
  it('dist/loop-ctl.cjs is committed', () => {
    expect(existsSync(CLI), 'run `npm run build:plugin` to produce dist/loop-ctl.cjs').toBe(true);
  });

  it('bare invocation with no subcommand exits non-zero with a usage message', () => {
    const { status, json } = runCli([]);
    expect(status).not.toBe(0);
    expect(json.ok).toBe(false);
    expect(json.message).toMatch(/usage: loop-ctl/);
  });
});

describe('lock: acquire / renew / release', () => {
  it('acquire_happy_path_then_release', () => {
    const root = makeProject();
    const acquireResult = runCli(['acquire', '--repo-root', root, '--holder', 'dev-a']);
    expect(acquireResult.status).toBe(0);
    expect(acquireResult.json).toEqual({ ok: true, acquired: true });
    expect(existsSync(join(root, 'state', '.lock'))).toBe(true);

    const renewResult = runCli(['renew', '--repo-root', root, '--holder', 'dev-a']);
    expect(renewResult.status).toBe(0);
    expect(renewResult.json).toEqual({ ok: true, renewed: true });

    const releaseResult = runCli(['release', '--repo-root', root, '--holder', 'dev-a']);
    expect(releaseResult.status).toBe(0);
    expect(releaseResult.json).toEqual({ ok: true });
    expect(existsSync(join(root, 'state', '.lock'))).toBe(false);
  });

  it('acquire_failure_path_E_LOCK_HELD_surfaces_holder_identity_nonzero_exit', () => {
    const root = makeProject();
    const first = runCli(['acquire', '--repo-root', root, '--holder', 'dev-a']);
    expect(first.status).toBe(0);

    const second = runCli(['acquire', '--repo-root', root, '--holder', 'dev-b']);
    expect(second.status).not.toBe(0);
    expect(second.json.ok).toBe(false);
    expect(second.json.code).toBe('E_LOCK_HELD');
    // Holder identity appears on stdout (JSON message) and stderr.
    expect(second.json.message).toContain('dev-a');
    expect(second.stderr).toContain('dev-a');
  });
});

describe('mode: get-mode / set-mode', () => {
  it('get_mode_defaults_to_harness_then_set_mode_flips_to_loop', () => {
    const root = makeProject();
    const before = runCli(['get-mode', '--repo-root', root]);
    expect(before.json).toEqual({ ok: true, mode: 'harness' });

    const set = runCli(['set-mode', '--repo-root', root, '--mode', 'loop']);
    expect(set.status).toBe(0);
    expect(set.json).toEqual({ ok: true, mode: 'loop' });

    const after = runCli(['get-mode', '--repo-root', root]);
    expect(after.json).toEqual({ ok: true, mode: 'loop' });
    expect(readBundle(root).mode).toBe('loop');
  });

  it('set_mode_failure_path_invalid_mode_nonzero_exit', () => {
    const root = makeProject();
    const result = runCli(['set-mode', '--repo-root', root, '--mode', 'bogus']);
    expect(result.status).not.toBe(0);
    expect(result.json.ok).toBe(false);
    expect(result.json.message).toMatch(/Invalid mode/);
  });
});

describe('checkpoint / resume-point', () => {
  it('checkpoint_happy_path_writes_loop_state_and_workflow_step', () => {
    const root = makeProject();
    const result = runCli([
      'checkpoint', '--repo-root', root,
      '--current-ticket', 'TASK-100', '--phase', 'impl',
      '--iteration', '2', '--completed-this-run', '1',
      '--run-started-at', '2026-07-06T23:00:00Z',
    ]);
    expect(result.status).toBe(0);
    expect(result.json).toEqual({ ok: true, written: true });

    const bundle = readBundle(root);
    expect(bundle.workflow_step).toBe('impl');
    expect(bundle.loop_state).toEqual({
      current_ticket: 'TASK-100',
      phase: 'impl',
      iteration: 2,
      completed_this_run: 1,
      run_started_at: '2026-07-06T23:00:00Z',
    });
  });

  it('checkpoint_failure_path_missing_current_ticket_nonzero_exit_and_no_write', () => {
    // --current-ticket has no independent guard inside writeLoopCheckpoint
    // (only --phase does, via LOOP_PHASES) — this is the CLI's OWN required-
    // flag check, proven load-bearing: without it, omitting --current-ticket
    // silently writes a checkpoint with no ticket attribution (verified via a
    // red-green plant during development; see hand-off).
    const root = makeProject();
    const before = readBundle(root);
    const result = runCli(['checkpoint', '--repo-root', root, '--phase', 'impl']);
    expect(result.status).not.toBe(0);
    expect(result.json.ok).toBe(false);
    expect(result.json.message).toMatch(/--current-ticket/);
    expect(readBundle(root)).toEqual(before); // rejected before any I/O
  });

  it('resume_point_reports_resume_after_a_post_commit_checkpoint', () => {
    const root = makeProject();
    const cp = runCli([
      'checkpoint', '--repo-root', root,
      '--current-ticket', 'TASK-100', '--phase', 'impl',
      '--iteration', '2', '--completed-this-run', '1',
      '--run-started-at', '2026-07-06T23:00:00Z',
    ]);
    expect(cp.status).toBe(0);

    const result = runCli(['resume-point', '--repo-root', root]);
    expect(result.status).toBe(0);
    expect(result.json.action).toBe('resume');
    expect(result.json.ticket.key).toBe('TASK-100');
    expect(result.json.phase).toBe('impl');
  });

  it('resume_point_reports_none_with_no_checkpoint_recorded', () => {
    const root = makeProject();
    const result = runCli(['resume-point', '--repo-root', root]);
    expect(result.status).toBe(0);
    expect(result.json.action).toBe('none');
  });
});

// ---------------------------------------------------------------------------
// TASK-100 review M2 — ticketHasLandedCommits (src/loop-checkpoint.js) was
// tree-shaken out of every dist bundle: nothing imported it, so a
// plugin-installed project (no framework src/ on disk) had no way to run the
// reset-protocol's git-log check the docs point it at. This subcommand reads
// the already-captured `git log --oneline` output from stdin (no git spawn
// inside the CLI itself — the caller/orchestrator runs git and pipes the
// output in) and returns whether it references --key, via the same pure
// helper the fast-tier spec locks.
// ---------------------------------------------------------------------------
describe('landed-commits (TASK-100 M2 — ticketHasLandedCommits exposed via CLI)', () => {
  it('landed_commits_happy_path_true_when_stdin_git_log_references_the_key', () => {
    const gitLog = 'a1b2c3d fix(TASK-101): unrelated\ne4f5g6h test(TASK-100): add failing spec\n';
    const result = runCli(['landed-commits', '--key', 'TASK-100'], { input: gitLog });
    expect(result.status).toBe(0);
    expect(result.json).toEqual({ ok: true, hasLandedCommits: true });
  });

  it('landed_commits_happy_path_false_when_stdin_git_log_does_not_reference_the_key', () => {
    const gitLog = 'a1b2c3d fix(TASK-101): unrelated\n';
    const result = runCli(['landed-commits', '--key', 'TASK-100'], { input: gitLog });
    expect(result.status).toBe(0);
    expect(result.json).toEqual({ ok: true, hasLandedCommits: false });
  });

  it('landed_commits_failure_path_missing_key_nonzero_exit', () => {
    const result = runCli(['landed-commits'], { input: 'a1b2c3d fix(TASK-100): x\n' });
    expect(result.status).not.toBe(0);
    expect(result.json.ok).toBe(false);
    expect(result.json.message).toMatch(/--key/);
  });
});

describe('grant-unattended', () => {
  it('grant_unattended_happy_path_sets_preset_plus_optins', () => {
    const root = makeProject();
    const result = runCli(['grant-unattended', '--repo-root', root, '--opt-in', 'auto_push_after_close']);
    expect(result.status).toBe(0);
    expect(result.json).toEqual({
      ok: true, granted: true, optIns: { auto_push_after_close: true },
    });

    const bundle = readBundle(root);
    expect(bundle.loop_auth).toMatchObject({
      auto_close_on_green_review: true,
      uat_delegated_to_orchestrator: true,
      auto_consolidate: true,
      auto_push_after_close: true,
      auto_version_bump_on_milestone: false,
    });
  });

  it('grant_unattended_failure_path_unknown_switch_nonzero_exit', () => {
    const root = makeProject();
    const result = runCli(['grant-unattended', '--repo-root', root, '--opt-in', 'not_a_real_switch']);
    expect(result.status).not.toBe(0);
    expect(result.json.ok).toBe(false);
    expect(result.json.message).toMatch(/Unknown loop-auth switch/);
  });
});

// ===========================================================================
// AC4 — plugin-layout proof: cwd-only resolution (no --repo-root passed), no
// framework src/ present in the temp project, operating on THAT project's
// own state/ bundle.
// ===========================================================================
describe('AC4 — plugin-layout: cwd-resolved repo root, no framework src/ present', () => {
  it('set_mode_and_checkpoint_via_cwd_only_write_into_the_temp_projects_own_bundle', () => {
    const root = makeProject();
    expect(existsSync(join(root, 'src'))).toBe(false); // no framework src/ — a bare plugin-installed project

    const setResult = runCli(['set-mode', '--mode', 'loop'], { cwd: root });
    expect(setResult.status).toBe(0);
    expect(setResult.json).toEqual({ ok: true, mode: 'loop' });
    expect(readBundle(root).mode).toBe('loop');

    const cpResult = runCli([
      'checkpoint',
      '--current-ticket', 'TASK-100', '--phase', 'review',
      '--iteration', '5', '--completed-this-run', '3',
      '--run-started-at', '2026-07-06T23:00:00Z',
    ], { cwd: root });
    expect(cpResult.status).toBe(0);

    const bundle = readBundle(root);
    expect(bundle.workflow_step).toBe('review');
    expect(bundle.loop_state.current_ticket).toBe('TASK-100');
    expect(bundle.loop_state.phase).toBe('review');
  });
});
