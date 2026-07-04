// tests/e2e/agent-permissions-config.spec.js
// TASK-091 — developer Bash allowlist: surgical frontmatter patch, CLI flag,
// idempotent re-apply, parity, and the stdout regression lock. Mirrors the
// structure and rigor of tests/e2e/agent-models-config.spec.js (TASK-036).
//
// AC map:
//   AC1 (patch half) — applyDeveloperPermissions patches ONLY the tools: line
//     in agents/developer.md (byte-stable everywhere else), inserts a tools:
//     line when absent, updates both .claude/agents/ and plugin-root agents/
//     when the parity dir exists, returns the changed-file list, and validates
//     the dev_stack value BEFORE any write.
//   AC2 — bin/init.js --apply-permissions reads PROJECT.md's dev_stack and
//     applies without running the wizard; graceful no-op when PROJECT.md is
//     absent; idempotent (second run = no-op, byte-identical, truthful stdout);
//     invalid/unknown stack values rejected before any write; strict argv
//     discipline (cannot combine with --force / --answers-file).

import { describe, it, expect, afterAll } from 'vitest';
import {
  readFileSync, writeFileSync, existsSync, mkdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { PROD } from '../helpers/fixtures.js';
import { REPO_ROOT } from '../helpers/repoRoot.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';

afterAll(cleanupAll);

const FIXED_NOW = '2026-07-04T12:00:00Z';
const DIST_INIT_CJS = join(REPO_ROOT, 'dist', 'init.cjs');

// ---------------------------------------------------------------------------
// Helpers (same idiom as agent-models-config.spec.js)
// ---------------------------------------------------------------------------

function readAgentFrontmatter(filePath) {
  const text = readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/);
  if (lines[0].trim() !== '---') return '';
  const closeIdx = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (closeIdx === -1) return '';
  return lines.slice(1, closeIdx).join('\n');
}

/** Snapshot every RAW byte except the `tools:` line INSIDE the frontmatter. */
function bytesExceptToolsLine(filePath) {
  const text = readFileSync(filePath, 'utf8');
  const open = text.match(/^---\r?\n/);
  if (!open) return text;
  const fmStart = open[0].length;
  const rest = text.slice(fmStart);
  const close = rest.match(/(^|\r?\n)---(\r?\n|$)/);
  if (!close) return text;
  const innerEnd = fmStart + close.index + close[1].length;
  const inner = text.slice(fmStart, innerEnd);
  const newInner = inner.replace(/^tools:[^\r\n]*\r?\n/m, '');
  return text.slice(0, fmStart) + newInner + text.slice(innerEnd);
}

function throwIfCalled() {
  return async (ctx) => {
    throw new Error(`prompter was called unexpectedly: ${JSON.stringify(ctx)}`);
  };
}

function makeAgentMd(name, extra = '') {
  return [
    '---',
    `name: ${name}`,
    `description: ${name} agent for testing.`,
    'model: sonnet',
    'tools: Read, Write, Edit, Bash, Grep, Glob, mcp__github__*',
    '---',
    '',
    `# ${name}`,
    '',
    extra || 'Agent body text.',
    '',
  ].join('\n');
}

function makeAgentMdNoTools(name, extra = '') {
  return [
    '---',
    `name: ${name}`,
    `description: ${name} agent for testing.`,
    'model: sonnet',
    '---',
    '',
    `# ${name}`,
    '',
    extra || 'Agent body text.',
    '',
  ].join('\n');
}

// ===========================================================================
// AC1 — applyDeveloperPermissions: surgical patch, byte-comparison,
//        parity-write, returns changed list, pre-write validation.
// ===========================================================================
describe('AC1 — applyDeveloperPermissions patches only the tools: line', () => {
  it('apply_patches_tools_line_and_leaves_every_other_byte_identical', async () => {
    const { applyDeveloperPermissions } = await import(PROD.agentGenerator);

    const repoDir = makeTmpDir('af-perm-surgical');
    const agentsDir = join(repoDir, '.claude', 'agents');
    mkdirSync(agentsDir, { recursive: true });

    const agentPath = join(agentsDir, 'developer.md');
    const original = makeAgentMd('developer', 'Original body content.\nLine two.');
    writeFileSync(agentPath, original, 'utf8');

    const beforeExceptTools = bytesExceptToolsLine(agentPath);

    await applyDeveloperPermissions({ repoRoot: repoDir, devStack: ['python'] });

    const after = readFileSync(agentPath, 'utf8');

    expect(/^tools:.*Bash\(python:\*\)/m.test(after)).toBe(true);
    expect(/^tools:.*Bash\(git:\*\)/m.test(after)).toBe(true);
    // Bare "Bash" must be gone.
    expect(after).not.toMatch(/^tools:.*,\s*Bash\s*,/m);

    const afterExceptTools = bytesExceptToolsLine(agentPath);
    expect(afterExceptTools).toBe(beforeExceptTools);
  });

  it('apply_inserts_tools_line_after_model_when_absent', async () => {
    const { applyDeveloperPermissions } = await import(PROD.agentGenerator);

    const repoDir = makeTmpDir('af-perm-insert');
    const agentsDir = join(repoDir, '.claude', 'agents');
    mkdirSync(agentsDir, { recursive: true });

    const agentPath = join(agentsDir, 'developer.md');
    writeFileSync(agentPath, makeAgentMdNoTools('developer', 'Body here.'), 'utf8');

    await applyDeveloperPermissions({ repoRoot: repoDir, devStack: [] });

    const fm = readAgentFrontmatter(agentPath);
    expect(fm).toMatch(/^model: sonnet\ntools: .+$/m);
    expect(readFileSync(agentPath, 'utf8')).toContain('Body here.');
  });

  it('apply_updates_parity_dir_when_agents_parity_dir_exists', async () => {
    const { applyDeveloperPermissions } = await import(PROD.agentGenerator);

    const repoDir = makeTmpDir('af-perm-parity');
    const claudeAgentsDir = join(repoDir, '.claude', 'agents');
    const parityAgentsDir = join(repoDir, 'agents');
    mkdirSync(claudeAgentsDir, { recursive: true });
    mkdirSync(parityAgentsDir, { recursive: true });

    const content = makeAgentMd('developer');
    writeFileSync(join(claudeAgentsDir, 'developer.md'), content, 'utf8');
    writeFileSync(join(parityAgentsDir, 'developer.md'), content, 'utf8');

    await applyDeveloperPermissions({ repoRoot: repoDir, devStack: ['go'] });

    const primaryAfter = readFileSync(join(claudeAgentsDir, 'developer.md'), 'utf8');
    const parityAfter = readFileSync(join(parityAgentsDir, 'developer.md'), 'utf8');
    expect(primaryAfter).toContain('Bash(go:*)');
    expect(parityAfter).toContain('Bash(go:*)');
    expect(primaryAfter).toBe(parityAfter);
  });

  it('apply_does_not_touch_parity_dir_when_absent', async () => {
    const { applyDeveloperPermissions } = await import(PROD.agentGenerator);

    const repoDir = makeTmpDir('af-perm-noparity');
    const claudeAgentsDir = join(repoDir, '.claude', 'agents');
    mkdirSync(claudeAgentsDir, { recursive: true });

    writeFileSync(join(claudeAgentsDir, 'developer.md'), makeAgentMd('developer'), 'utf8');

    await expect(
      applyDeveloperPermissions({ repoRoot: repoDir, devStack: [] }),
    ).resolves.toBeDefined();

    expect(existsSync(join(repoDir, 'agents'))).toBe(false);
  });

  it('apply_returns_the_list_of_changed_files', async () => {
    const { applyDeveloperPermissions } = await import(PROD.agentGenerator);

    const repoDir = makeTmpDir('af-perm-retlist');
    const claudeAgentsDir = join(repoDir, '.claude', 'agents');
    const parityAgentsDir = join(repoDir, 'agents');
    mkdirSync(claudeAgentsDir, { recursive: true });
    mkdirSync(parityAgentsDir, { recursive: true });

    const content = makeAgentMd('developer');
    writeFileSync(join(claudeAgentsDir, 'developer.md'), content, 'utf8');
    writeFileSync(join(parityAgentsDir, 'developer.md'), content, 'utf8');

    const result = await applyDeveloperPermissions({ repoRoot: repoDir, devStack: ['python'] });

    expect(Array.isArray(result)).toBe(true);
    expect(result).toContain(join(claudeAgentsDir, 'developer.md'));
    expect(result).toContain(join(parityAgentsDir, 'developer.md'));
    expect(result).toHaveLength(2);
  });

  it('apply_rejects_unknown_stack_value_before_any_write', async () => {
    const { applyDeveloperPermissions } = await import(PROD.agentGenerator);

    const repoDir = makeTmpDir('af-perm-badstack');
    const agentsDir = join(repoDir, '.claude', 'agents');
    mkdirSync(agentsDir, { recursive: true });

    const agentPath = join(agentsDir, 'developer.md');
    writeFileSync(agentPath, makeAgentMd('developer'), 'utf8');
    const snapshotBefore = readFileSync(agentPath, 'utf8');

    await expect(
      applyDeveloperPermissions({ repoRoot: repoDir, devStack: ['cobol'] }),
    ).rejects.toThrow(/invalid|unknown|cobol/i);

    expect(readFileSync(agentPath, 'utf8')).toBe(snapshotBefore);
  });

  it('apply_second_run_is_a_byte_identical_noop_and_reports_zero_changed', async () => {
    const { applyDeveloperPermissions } = await import(PROD.agentGenerator);

    const repoDir = makeTmpDir('af-perm-idempotent');
    const agentsDir = join(repoDir, '.claude', 'agents');
    mkdirSync(agentsDir, { recursive: true });

    writeFileSync(join(agentsDir, 'developer.md'), makeAgentMd('developer'), 'utf8');

    const first = await applyDeveloperPermissions({ repoRoot: repoDir, devStack: ['python'] });
    expect(first).toHaveLength(1);
    const afterFirst = readFileSync(join(agentsDir, 'developer.md'), 'utf8');

    const second = await applyDeveloperPermissions({ repoRoot: repoDir, devStack: ['python'] });
    expect(second).toEqual([]);
    const afterSecond = readFileSync(join(agentsDir, 'developer.md'), 'utf8');

    expect(afterSecond).toBe(afterFirst);
  });
});

// ===========================================================================
// AC2 — bin/init.js --apply-permissions CLI flag.
// ===========================================================================
describe('AC2 — bin/init.js --apply-permissions reads PROJECT.md and applies', () => {
  it('apply_permissions_flag_applies_without_running_the_wizard', async () => {
    const { runInit } = await import(PROD.init);
    const { writeProjectMd } = await import(PROD.projectMd);

    const repoDir = makeTmpDir('af-perm-flag-apply');
    const agentsDir = join(repoDir, '.claude', 'agents');
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, 'developer.md'), makeAgentMd('developer'), 'utf8');

    await writeProjectMd({
      repoRoot: repoDir,
      answers: { project_name: 'apply-perm-test', project_type: 'cli-tool' },
      now: () => FIXED_NOW,
    });
    // Hand-edit PROJECT.md to add the dev_stack Stack-section bullet — this is
    // the same "edit PROJECT.md by hand, re-run the flag" flow --apply-models
    // supports for agent_models. writeProjectMd omits the ## Stack heading
    // entirely when no Stack-section keys are present, so append it rather
    // than replace a heading that isn't there yet.
    const projectMdPath = join(repoDir, 'PROJECT.md');
    const text = readFileSync(projectMdPath, 'utf8');
    writeFileSync(projectMdPath, `${text}\n## Stack\n- dev_stack: [python]\n`, 'utf8');

    const result = await runInit({
      argv: ['--apply-permissions'],
      prompter: throwIfCalled(),
      repoRoot: repoDir,
      now: () => FIXED_NOW,
    });

    expect(result.state).toBe('applied_permissions');
    const fm = readAgentFrontmatter(join(agentsDir, 'developer.md'));
    expect(fm).toMatch(/Bash\(python:\*\)/);
    expect(fm).toMatch(/Bash\(git:\*\)/);
  });

  it('apply_permissions_no_op_when_project_md_absent', async () => {
    const { runInit } = await import(PROD.init);

    const repoDir = makeTmpDir('af-perm-noprojectmd');

    const result = await runInit({
      argv: ['--apply-permissions'],
      prompter: throwIfCalled(),
      repoRoot: repoDir,
      now: () => FIXED_NOW,
    });

    expect(result.state).toBe('no_op');
  });

  it('apply_permissions_applies_core_only_when_no_dev_stack_declared', async () => {
    // Absence of dev_stack must NOT no-op the whole flag — core git/npm/node/npx
    // scoping is the actual security value and must land even with no declared
    // stack (unlike --apply-models, where an absent map means "keep defaults").
    const { runInit } = await import(PROD.init);
    const { writeProjectMd } = await import(PROD.projectMd);

    const repoDir = makeTmpDir('af-perm-core-only');
    const agentsDir = join(repoDir, '.claude', 'agents');
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, 'developer.md'), makeAgentMd('developer'), 'utf8');

    await writeProjectMd({
      repoRoot: repoDir,
      answers: { project_name: 'core-only-test', project_type: 'other' },
      now: () => FIXED_NOW,
    });

    const result = await runInit({
      argv: ['--apply-permissions'],
      prompter: throwIfCalled(),
      repoRoot: repoDir,
      now: () => FIXED_NOW,
    });

    expect(result.state).toBe('applied_permissions');
    const fm = readAgentFrontmatter(join(agentsDir, 'developer.md'));
    expect(fm).toMatch(/Bash\(git:\*\)/);
    expect(fm).toMatch(/Bash\(npm:\*\)/);
  });

  it('apply_permissions_rejects_unknown_stack_value_before_any_write', async () => {
    const { runInit } = await import(PROD.init);
    const { writeProjectMd } = await import(PROD.projectMd);

    const repoDir = makeTmpDir('af-perm-flag-badstack');
    const agentsDir = join(repoDir, '.claude', 'agents');
    mkdirSync(agentsDir, { recursive: true });
    const agentPath = join(agentsDir, 'developer.md');
    writeFileSync(agentPath, makeAgentMd('developer'), 'utf8');
    const snapshotBefore = readFileSync(agentPath, 'utf8');

    await writeProjectMd({
      repoRoot: repoDir,
      answers: { project_name: 'bad-stack-test', project_type: 'other' },
      now: () => FIXED_NOW,
    });
    const projectMdPath = join(repoDir, 'PROJECT.md');
    const text = readFileSync(projectMdPath, 'utf8');
    writeFileSync(projectMdPath, `${text}\n## Stack\n- dev_stack: [cobol]\n`, 'utf8');

    await expect(
      runInit({
        argv: ['--apply-permissions'],
        prompter: throwIfCalled(),
        repoRoot: repoDir,
        now: () => FIXED_NOW,
      }),
    ).rejects.toThrow(/invalid|unknown|cobol/i);

    expect(readFileSync(agentPath, 'utf8')).toBe(snapshotBefore);
  });

  it('apply_permissions_is_idempotent_second_run_reports_zero_files', async () => {
    const { runInit } = await import(PROD.init);
    const { writeProjectMd } = await import(PROD.projectMd);

    const repoDir = makeTmpDir('af-perm-flag-idempotent');
    const agentsDir = join(repoDir, '.claude', 'agents');
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, 'developer.md'), makeAgentMd('developer'), 'utf8');

    await writeProjectMd({
      repoRoot: repoDir,
      answers: { project_name: 'idempotent-test', project_type: 'other' },
      now: () => FIXED_NOW,
    });

    const r1 = await runInit({
      argv: ['--apply-permissions'],
      prompter: throwIfCalled(),
      repoRoot: repoDir,
      now: () => FIXED_NOW,
    });
    expect(r1.state).toBe('applied_permissions');
    const afterFirst = readFileSync(join(agentsDir, 'developer.md'), 'utf8');

    const r2 = await runInit({
      argv: ['--apply-permissions'],
      prompter: throwIfCalled(),
      repoRoot: repoDir,
      now: () => FIXED_NOW,
    });
    expect(r2.state).toBe('applied_permissions');
    const afterSecond = readFileSync(join(agentsDir, 'developer.md'), 'utf8');

    expect(afterSecond).toBe(afterFirst);
  });

  it('apply_permissions_combined_with_unknown_flag_still_throws', async () => {
    const { runInit } = await import(PROD.init);
    const repoDir = makeTmpDir('af-perm-unknown');

    await expect(
      runInit({
        argv: ['--apply-permissions', '--bogus-extra'],
        prompter: throwIfCalled(),
        repoRoot: repoDir,
        now: () => FIXED_NOW,
      }),
    ).rejects.toThrow(/--bogus-extra/);
  });

  it('apply_permissions_with_force_throws', async () => {
    const { runInit } = await import(PROD.init);
    const repoDir = makeTmpDir('af-perm-comboforce');

    await expect(
      runInit({
        argv: ['--apply-permissions', '--force'],
        prompter: throwIfCalled(),
        repoRoot: repoDir,
        now: () => FIXED_NOW,
      }),
    ).rejects.toThrow(/--apply-permissions/);
  });

  it('apply_permissions_with_answers_file_throws', async () => {
    const { runInit } = await import(PROD.init);
    const repoDir = makeTmpDir('af-perm-comboanswers');

    await expect(
      runInit({
        argv: ['--apply-permissions', '--answers-file', 'answers.json'],
        prompter: throwIfCalled(),
        repoRoot: repoDir,
        now: () => FIXED_NOW,
      }),
    ).rejects.toThrow(/--apply-permissions/);
  });
});

// ===========================================================================
// Stdout regression lock (TASK-044 pattern) — --apply-permissions must NOT
// print the normal-init epilogue (false PROJECT.md-written + null session path).
// ===========================================================================
describe('TASK-091 stdout lock — --apply-permissions suppresses normal-init epilogue', () => {
  it('apply_permissions_stdout_has_summary_line_but_no_false_epilogue', () => {
    expect(existsSync(DIST_INIT_CJS), 'dist/init.cjs must exist').toBe(true);

    const repoDir = makeTmpDir('af-perm-stdout');
    const agentsDir = join(repoDir, '.claude', 'agents');
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, 'developer.md'), makeAgentMd('developer'), 'utf8');
    writeFileSync(
      join(repoDir, 'PROJECT.md'),
      [
        '---',
        'name: stdout-test',
        'type: other',
        `created_at: ${FIXED_NOW}`,
        'schema_version: 1',
        '---',
        '',
        '# stdout-test',
        '',
        '## Stack',
        '- dev_stack: [python]',
        '',
      ].join('\n'),
      'utf8',
    );

    const result = spawnSync(
      process.execPath,
      [DIST_INIT_CJS, '--apply-permissions'],
      {
        cwd: repoDir,
        env: { ...process.env, CLAUDE_PROJECT_DIR: repoDir },
        encoding: 'utf8',
        timeout: 60000,
      },
    );

    const diagnostics = `exit=${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`;

    expect(result.status, `dist/init.cjs --apply-permissions must exit 0. ${diagnostics}`).toBe(0);
    expect(
      result.stdout,
      `stdout must contain the --apply-permissions summary line. ${diagnostics}`,
    ).toMatch(/--apply-permissions: updated \d+ file\(s\)/);
    expect(result.stdout).not.toContain('PROJECT.md written');
    expect(result.stdout).not.toContain('state/sessions/null');
    expect(result.stdout).not.toContain('Session bundle:');
    expect(result.stdout).not.toContain('Next step:');
  });
});
