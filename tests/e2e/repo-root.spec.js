// tests/repo-root.spec.js
// TASK-022 — Plugin chain P2: repoRoot retargeting.
//
// When the framework ships as a plugin, its code lives in an immutable cache
// dir, but all project I/O must target the USER's project root, never the
// plugin's own location. Per TASK-020 research §B the blast radius is small:
// only the bin/ CLI shells bind a project root (they currently hard-code
// `process.cwd()`); every src/ function already takes an explicit `repoRoot`.
//
// EMPIRICAL FINDING (orchestrator sensor, recorded in TASK-022 comment
// 2026-05-28T23:00): `CLAUDE_PROJECT_DIR` is UNSET in a Bash-tool subprocess
// on this machine/version, but `process.cwd()` of a Bash-tool call DOES equal
// the project root. Therefore the binding must be
//   process.env.CLAUDE_PROJECT_DIR ?? process.cwd()
// where the cwd branch is the load-bearing one in practice, and the env branch
// is the robustness path for hook/MCP-style subprocesses that do receive it.
//
// The fix factors the resolution into a pure, injectable helper
// `resolveRepoRoot(env, cwd)` in src/repo-root.js so both branches are
// unit-testable without manipulating the real process environment. The bin/
// shells then call the helper instead of bare `process.cwd()`.
//
// This suite is TESTS-FIRST: src/repo-root.js does not exist yet and the bin/
// shells still bind bare process.cwd(), so these specs MUST fail for the right
// reasons (module-not-found / wiring absent), not on typos or import errors in
// the test itself.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { PROD, makeRepoSkeleton } from '../helpers/fixtures.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';
import { afterAll } from 'vitest';

afterAll(cleanupAll);

// ===========================================================================
// AC1 — the resolveRepoRoot helper contract (env-set / env-absent / env-empty).
// Pure function: (env, cwd) => string. No process.env / process.cwd reads
// inside, so both branches are deterministic and side-effect-free.
// ===========================================================================
describe('AC1 — resolveRepoRoot helper contract', () => {
  it('env_set_nonempty_wins_over_cwd', async () => {
    const { resolveRepoRoot } = await import(PROD.repoRoot);
    expect(
      resolveRepoRoot({ CLAUDE_PROJECT_DIR: '/some/project' }, '/cwd'),
    ).toBe('/some/project');
  });

  it('env_absent_falls_back_to_cwd', async () => {
    // This is the load-bearing branch in practice: the empirical finding is
    // that CLAUDE_PROJECT_DIR is UNSET in a Bash-tool subprocess, while the
    // subprocess cwd equals the project root. (AC2 — absent env tolerated.)
    const { resolveRepoRoot } = await import(PROD.repoRoot);
    expect(resolveRepoRoot({}, '/cwd')).toBe('/cwd');
  });

  it('env_empty_string_falls_back_to_cwd', async () => {
    // An empty CLAUDE_PROJECT_DIR is not a valid root — `??` alone would treat
    // '' as set, so the helper must guard emptiness explicitly and fall back.
    const { resolveRepoRoot } = await import(PROD.repoRoot);
    expect(resolveRepoRoot({ CLAUDE_PROJECT_DIR: '' }, '/cwd')).toBe('/cwd');
  });

  it('env_whitespace_only_falls_back_to_cwd', async () => {
    // Whitespace-only is likewise not a usable path; treat it as absent.
    const { resolveRepoRoot } = await import(PROD.repoRoot);
    expect(resolveRepoRoot({ CLAUDE_PROJECT_DIR: '   ' }, '/cwd')).toBe('/cwd');
  });
});

// ===========================================================================
// AC1 — wiring: the bin/ shells use the helper, not bare process.cwd().
//
// The entry-script block (`if (process.argv[1] && import.meta.url === ...)`)
// only runs when the file is invoked as `node bin/init.js`, so it cannot be
// driven from a unit test. The testable representation chosen here is a
// SOURCE-LEVEL assertion (mirroring the existing TASK-015 AC5 source-hygiene
// tests in tests/new-task-cli.spec.js):
//   (a) the shell imports `resolveRepoRoot` from ../src/repo-root.js, and
//   (b) the run* invocation binds `repoRoot: resolveRepoRoot(...)` rather than
//       the bare `repoRoot: process.cwd()`.
// This makes the wiring concrete and falsifiable without a TTY/subprocess.
// ===========================================================================
describe('AC1 — bin/ shells wire repoRoot through resolveRepoRoot', () => {
  const cases = [
    { name: 'bin/init.js', url: PROD.init },
    { name: 'bin/new-task.js', url: PROD.newTaskCli },
  ];

  for (const { name, url } of cases) {
    it(`${name}_imports_resolveRepoRoot_from_repo_root_module`, () => {
      const src = readFileSync(fileURLToPath(url), 'utf8');
      expect(
        src.includes('resolveRepoRoot'),
        `${name} must import and use resolveRepoRoot (the shared helper)`,
      ).toBe(true);
      expect(
        /from\s+['"][^'"]*repo-root\.js['"]/.test(src),
        `${name} must import from src/repo-root.js`,
      ).toBe(true);
    });

    it(`${name}_does_not_bind_bare_process_cwd_as_repoRoot`, () => {
      const src = readFileSync(fileURLToPath(url), 'utf8');
      // The pre-fix code binds `repoRoot: process.cwd()`. After the retarget
      // the value must flow through resolveRepoRoot, so the bare binding must
      // be gone. Tolerate arbitrary whitespace between the key and value.
      expect(
        /repoRoot\s*:\s*process\.cwd\(\)/.test(src),
        `${name} must not bind repoRoot directly to process.cwd() — ` +
          `route it through resolveRepoRoot(process.env, process.cwd())`,
      ).toBe(false);
    });

    it(`${name}_binds_repoRoot_via_resolveRepoRoot_call`, () => {
      const src = readFileSync(fileURLToPath(url), 'utf8');
      // The entry-script binding must read `repoRoot: resolveRepoRoot(...)`.
      expect(
        /repoRoot\s*:\s*resolveRepoRoot\s*\(/.test(src),
        `${name} entry-script block must bind repoRoot: resolveRepoRoot(...)`,
      ).toBe(true);
    });
  }
});

// ===========================================================================
// AC4 (ticket AC3) — framework-asset reads survive the retarget.
//
// src/task-store.js eagerly loads tasks/schema.json and src/project-md.js
// eagerly loads state/PROJECT.schema.json — both via paths resolved from
// `import.meta.url` (the module's own location), NOT from any project root.
// The retarget only changes what repoRoot the bin/ shells pass for PROJECT
// I/O; these intra-package asset reads must remain resolvable regardless.
//
// Importing the modules already exercises the eager reads (a broken path
// throws at module init). We additionally drive createTask, which runs the
// loaded ajv validator, to prove the schema actually loaded (not silently
// swallowed). These may PASS today — they are guard rails confirming the
// retarget does not regress asset resolution.
// ===========================================================================
describe('AC3 — framework-asset reads resolve from their src/ modules', () => {
  it('task_store_module_imports_without_throwing', async () => {
    // tasks/schema.json is JSON.parse'd at module init; a bad path throws here.
    await expect(import(PROD.taskStore)).resolves.toBeDefined();
  });

  it('project_md_module_imports_without_throwing', async () => {
    // state/PROJECT.schema.json is read at module init.
    await expect(import(PROD.projectMd)).resolves.toBeDefined();
  });

  it('createTask_runs_the_loaded_schema_validator', async () => {
    const { createTask } = await import(PROD.taskStore);
    const repoDir = makeTmpDir('af-rr-assets');
    makeRepoSkeleton(repoDir, {});

    // A successful createTask means the ajv validator compiled from the
    // bundled tasks/schema.json ran against the payload without a load error.
    const { key } = await createTask({
      repoRoot: repoDir,
      title: 'Asset-read guard',
      description: 'proves schema resolution survives retarget',
      acceptance_criteria: ['schema loaded'],
      priority: 'low',
      now: () => '2026-05-28T00:00:00Z',
    });
    expect(key).toBe('TASK-001');
  });
});
