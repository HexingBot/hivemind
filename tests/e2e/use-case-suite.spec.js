// tests/e2e/use-case-suite.spec.js
// TASK-029 — generator behaviour for src/use-case-specs.js.
//
// AC coverage:
//   AC1 — USE-CASES.md manifest is ALWAYS written (even for non-JS stacks).
//   AC2 — JS/node stack produces skeleton spec files (describe + it.todo) in
//          tests/use-cases/ for each primary use case.
//   AC2 — Non-JS/non-node stack produces manifest only (no .spec.js files).
//   AC2 — Idempotent: re-run never clobbers existing manifest or spec files.
//   AC2 — Idempotent: already_initialized branch in bin/init.js does NOT call
//          the generator.
//
// Closest analog: tests/e2e/backlog-seeder.spec.js (same {repoRoot, answers, now}
// contract, same idempotency pattern, same init-wiring assertions).

import { describe, it, expect, afterAll } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { PROD, makeRepoSkeleton } from '../helpers/fixtures.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';
import { makeScriptedPrompter, webSaasAnswers } from '../helpers/scripted-prompter.js';

afterAll(cleanupAll);

const FIXED_NOW = '2026-05-30T12:00:00Z';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return the absolute path the generator should write USE-CASES.md to. */
function manifestPath(repoRoot) {
  return join(repoRoot, 'tests', 'use-cases', 'USE-CASES.md');
}

/** List all .spec.js files under tests/use-cases/ in the given repoRoot. */
function listUseCaseSpecs(repoRoot) {
  const dir = join(repoRoot, 'tests', 'use-cases');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => n.endsWith('.spec.js')).sort();
}

/** Read a file as text; return null if absent. */
function tryRead(p) {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// AC1 — generateUseCaseSuite module shape
// ---------------------------------------------------------------------------
// RED reason: src/use-case-specs.js does not yet exist → dynamic import throws
// "Cannot find module" (module-not-found failure, not a test-logic failure).

describe('AC1 — generateUseCaseSuite module exports', () => {
  it('module_exports_generateUseCaseSuite_function', async () => {
    // AC1: the module must export a callable generateUseCaseSuite.
    const { generateUseCaseSuite } = await import(
      // Resolve via pathToFileURL so Vitest treats it as a real module path.
      new URL('../../src/use-case-specs.js', import.meta.url).href
    );
    expect(typeof generateUseCaseSuite).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// AC1 — USE-CASES.md manifest always written (JS stack)
// ---------------------------------------------------------------------------

describe('AC1 — manifest written for JS/node stack', () => {
  it('manifest_is_written_for_js_node_stack', async () => {
    // AC1: manifest always generated regardless of primary_use_cases.
    const { generateUseCaseSuite } = await import(
      new URL('../../src/use-case-specs.js', import.meta.url).href
    );
    const repoRoot = makeTmpDir('af-ucs-manifest-js');
    makeRepoSkeleton(repoRoot);

    await generateUseCaseSuite({
      repoRoot,
      answers: {
        project_name: 'my-js-app',
        project_type: 'cli-tool',
        cli_language: 'node',
        primary_use_cases: ['automation'],
      },
      now: () => FIXED_NOW,
    });

    expect(
      existsSync(manifestPath(repoRoot)),
      'USE-CASES.md must be written for a JS/node project',
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC1 — USE-CASES.md manifest always written (non-JS stack)
// ---------------------------------------------------------------------------

describe('AC1 — manifest written for non-JS stack', () => {
  it('manifest_is_written_for_non_js_stack', async () => {
    // AC1: manifest written even when stack is Python (no .spec.js files).
    const { generateUseCaseSuite } = await import(
      new URL('../../src/use-case-specs.js', import.meta.url).href
    );
    const repoRoot = makeTmpDir('af-ucs-manifest-py');
    makeRepoSkeleton(repoRoot);

    await generateUseCaseSuite({
      repoRoot,
      answers: {
        project_name: 'my-python-app',
        project_type: 'data-pipeline',
        // No cli_language / no node signal → non-JS
        primary_use_cases: ['integration'],
      },
      now: () => FIXED_NOW,
    });

    expect(
      existsSync(manifestPath(repoRoot)),
      'USE-CASES.md must be written even for a non-JS project',
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC2 — JS/node stack emits skeleton .spec.js files
// ---------------------------------------------------------------------------

describe('AC2 — JS/node stack: skeleton spec files written', () => {
  it('js_node_stack_writes_spec_skeletons_for_each_use_case', async () => {
    // AC2: one describe+it.todo skeleton per primary_use_case when stack is JS/node.
    const { generateUseCaseSuite } = await import(
      new URL('../../src/use-case-specs.js', import.meta.url).href
    );
    const repoRoot = makeTmpDir('af-ucs-skeletons');
    makeRepoSkeleton(repoRoot);

    const useCases = ['automation', 'reporting'];

    await generateUseCaseSuite({
      repoRoot,
      answers: {
        project_name: 'my-js-app',
        project_type: 'web-saas',
        backend_framework: 'node-express',
        primary_use_cases: useCases,
      },
      now: () => FIXED_NOW,
    });

    const specs = listUseCaseSpecs(repoRoot);

    // At least one spec file per use case must exist.
    expect(
      specs.length,
      `expected at least ${useCases.length} spec file(s) under tests/use-cases/`,
    ).toBeGreaterThanOrEqual(useCases.length);

    // Each generated spec must contain both a describe block and it.todo.
    for (const specFile of specs) {
      const src = readFileSync(join(repoRoot, 'tests', 'use-cases', specFile), 'utf8');
      expect(src, `${specFile} must contain a describe block`).toMatch(/\bdescribe\s*\(/);
      expect(src, `${specFile} must contain it.todo`).toMatch(/\bit\.todo\s*\(/);
    }
  });
});

// ---------------------------------------------------------------------------
// AC2 — Non-JS stack: manifest only, no skeleton .spec.js files
// ---------------------------------------------------------------------------

describe('AC2 — non-JS stack: manifest only, no spec skeletons', () => {
  it('non_js_stack_writes_manifest_but_not_spec_files', async () => {
    // AC2: a Python/go/other stack gets a manifest but NO .spec.js skeletons.
    const { generateUseCaseSuite } = await import(
      new URL('../../src/use-case-specs.js', import.meta.url).href
    );
    const repoRoot = makeTmpDir('af-ucs-nospec');
    makeRepoSkeleton(repoRoot);

    await generateUseCaseSuite({
      repoRoot,
      answers: {
        project_name: 'my-go-service',
        project_type: 'data-pipeline',
        processing_framework: 'spark',
        primary_use_cases: ['automation'],
      },
      now: () => FIXED_NOW,
    });

    // Manifest must exist.
    expect(existsSync(manifestPath(repoRoot))).toBe(true);

    // No .spec.js files.
    const specs = listUseCaseSpecs(repoRoot);
    expect(
      specs.length,
      'non-JS stack must produce zero .spec.js skeleton files',
    ).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AC2 — Idempotency: re-run never clobbers existing files
// ---------------------------------------------------------------------------

describe('AC2 — idempotency: re-run does not clobber existing files', () => {
  it('second_run_leaves_existing_manifest_and_specs_unchanged', async () => {
    // AC2: mirroring the backlog-seeder idempotency pattern — if the target
    // files already exist, the generator must leave them untouched.
    const { generateUseCaseSuite } = await import(
      new URL('../../src/use-case-specs.js', import.meta.url).href
    );
    const repoRoot = makeTmpDir('af-ucs-idemp');
    makeRepoSkeleton(repoRoot);

    const answers = {
      project_name: 'my-js-app',
      project_type: 'cli-tool',
      cli_language: 'node',
      primary_use_cases: ['automation'],
    };

    // First run.
    await generateUseCaseSuite({ repoRoot, answers, now: () => FIXED_NOW });

    const manifestBefore = tryRead(manifestPath(repoRoot));
    const specsBefore = listUseCaseSpecs(repoRoot).map((f) =>
      tryRead(join(repoRoot, 'tests', 'use-cases', f)),
    );

    // Second run with same answers.
    await generateUseCaseSuite({ repoRoot, answers, now: () => '2099-01-01T00:00:00Z' });

    const manifestAfter = tryRead(manifestPath(repoRoot));
    const specsAfter = listUseCaseSpecs(repoRoot).map((f) =>
      tryRead(join(repoRoot, 'tests', 'use-cases', f)),
    );

    expect(
      manifestAfter,
      'second run must not modify the existing USE-CASES.md manifest',
    ).toBe(manifestBefore);

    expect(
      specsAfter,
      'second run must not modify existing skeleton spec files',
    ).toEqual(specsBefore);
  });
});

// ---------------------------------------------------------------------------
// AC2 — Init wiring: created branch invokes generateUseCaseSuite
// ---------------------------------------------------------------------------

describe('AC2 — init wiring: created branch invokes generator', () => {
  it('init_created_branch_writes_use_cases_manifest', async () => {
    // AC2: bin/init.js wires generateUseCaseSuite after seedBacklog in the
    // created branch. Verify by checking the manifest lands on disk.
    const { runInit } = await import(PROD.init);

    const repoRoot = makeTmpDir('af-ucs-init-created');

    // Use node-based answers so we exercise the full path.
    const prompter = makeScriptedPrompter(
      webSaasAnswers({ primary_use_cases: 'automation' }),
    );

    const result = await runInit({
      argv: [],
      prompter,
      repoRoot,
      now: () => FIXED_NOW,
    });

    expect(result.state).toBe('created');

    expect(
      existsSync(manifestPath(repoRoot)),
      'bin/init.js created branch must write tests/use-cases/USE-CASES.md',
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC2 — Init wiring: already_initialized branch skips generator
// ---------------------------------------------------------------------------

describe('AC2 — init wiring: already_initialized branch skips generator', () => {
  it('init_already_initialized_does_not_call_generator', async () => {
    // AC2: already_initialized must NOT invoke the generator. Mirror the
    // backlog-seeder's corresponding test (backlog-seeder.spec.js AC6).
    const { runInit } = await import(PROD.init);
    const { writeProjectMd } = await import(PROD.projectMd);

    const repoRoot = makeTmpDir('af-ucs-init-existing');

    // Pre-seed PROJECT.md so init takes the already_initialized branch.
    await writeProjectMd({
      repoRoot,
      answers: {
        project_name: 'preexisting',
        project_type: 'cli-tool',
        project_description: 'd',
        target_users: 't',
        success_criteria: 's',
      },
      now: () => FIXED_NOW,
    });

    const result = await runInit({
      argv: [],
      prompter: async () => {
        throw new Error('prompter should not be called in already_initialized branch');
      },
      repoRoot,
      now: () => FIXED_NOW,
    });

    expect(result.state).toBe('already_initialized');

    // The manifest must NOT have been written (generator was not called).
    expect(
      existsSync(manifestPath(repoRoot)),
      'already_initialized branch must NOT invoke generateUseCaseSuite',
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// REVIEW FIX (HIGH) — JS-stack predicate covers typescript/javascript/react
// ---------------------------------------------------------------------------
// Ruling: a stack counts as JS when any of the five stack keys matches
// /^(node|javascript|typescript)/i OR contains 'node', OR frontend_framework
// is one of {react, vue, svelte, angular}. These pin the corrected behavior.

describe('REVIEW FIX — JS-stack predicate: TS/JS/react signals produce skeletons', () => {
  it.each([
    ['library_language_typescript', { library_language: 'typescript' }],
    ['library_language_javascript', { library_language: 'javascript' }],
    ['frontend_framework_react_only', { frontend_framework: 'react' }],
  ])('%s_yields_skeleton_specs', async (_label, stackAnswers) => {
    const { generateUseCaseSuite } = await import(
      new URL('../../src/use-case-specs.js', import.meta.url).href
    );
    const repoRoot = makeTmpDir('af-ucs-predicate');
    makeRepoSkeleton(repoRoot);

    await generateUseCaseSuite({
      repoRoot,
      answers: {
        project_name: 'predicate-probe',
        project_type: 'library',
        ...stackAnswers,
        primary_use_cases: ['automation'],
      },
      now: () => FIXED_NOW,
    });

    const specs = listUseCaseSpecs(repoRoot);
    expect(
      specs.length,
      `stack ${JSON.stringify(stackAnswers)} must be detected as JS and produce skeletons`,
    ).toBeGreaterThanOrEqual(1);
  });

  it('pure_python_go_stack_yields_manifest_only', async () => {
    const { generateUseCaseSuite } = await import(
      new URL('../../src/use-case-specs.js', import.meta.url).href
    );
    const repoRoot = makeTmpDir('af-ucs-predicate-nonjs');
    makeRepoSkeleton(repoRoot);

    await generateUseCaseSuite({
      repoRoot,
      answers: {
        project_name: 'py-go-service',
        project_type: 'data-pipeline',
        cli_language: 'python',
        library_language: 'go',
        processing_framework: 'spark',
        primary_use_cases: ['automation'],
      },
      now: () => FIXED_NOW,
    });

    expect(existsSync(manifestPath(repoRoot))).toBe(true);
    expect(
      listUseCaseSpecs(repoRoot).length,
      'pure python/go stack must produce zero .spec.js skeletons',
    ).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// REVIEW FIX (MEDIUM) — generator failure propagates out of runInit
// ---------------------------------------------------------------------------
// Ruling: align with seedBacklog — warn then RETHROW. We force the failure by
// pre-creating a regular FILE at <repoRoot>/tests so the generator's
// mkdir('tests/use-cases', {recursive:true}) throws.

describe('REVIEW FIX — init wiring: generator failure propagates', () => {
  it('generator_failure_rejects_run_init', async () => {
    const { runInit } = await import(PROD.init);
    const { writeFileSync } = await import('node:fs');

    const repoRoot = makeTmpDir('af-ucs-init-genfail');
    // A regular file where the generator needs a directory → mkdir throws.
    writeFileSync(join(repoRoot, 'tests'), 'not a directory', 'utf8');

    const prompter = makeScriptedPrompter(
      webSaasAnswers({ primary_use_cases: 'automation' }),
    );

    await expect(
      runInit({ argv: [], prompter, repoRoot, now: () => FIXED_NOW }),
      'a generateUseCaseSuite failure must propagate out of runInit (warn then rethrow)',
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// REVIEW FIX (MEDIUM) — codegen injection: use-case strings are escaped
// ---------------------------------------------------------------------------
// Ruling: embed use-case strings via JSON.stringify (covers quotes,
// backslashes, newlines). The generated skeleton must carry the
// double-quoted-escaped literal, not the raw string.

describe('REVIEW FIX — codegen escaping: hostile use-case strings', () => {
  it('use_case_with_apostrophe_and_newline_is_escaped', async () => {
    const { generateUseCaseSuite } = await import(
      new URL('../../src/use-case-specs.js', import.meta.url).href
    );
    const repoRoot = makeTmpDir('af-ucs-escape');
    makeRepoSkeleton(repoRoot);

    const hostile = "user's\nworkflow";

    await generateUseCaseSuite({
      repoRoot,
      answers: {
        project_name: 'escape-probe',
        project_type: 'cli-tool',
        cli_language: 'node',
        primary_use_cases: [hostile],
      },
      now: () => FIXED_NOW,
    });

    const specs = listUseCaseSpecs(repoRoot);
    expect(specs.length, 'hostile use case must still yield one skeleton').toBe(1);

    const src = readFileSync(join(repoRoot, 'tests', 'use-cases', specs[0]), 'utf8');

    // The describe/it.todo literals must be the JSON.stringify round-trip of
    // the raw string: double-quoted, with \n escaped and the apostrophe safe.
    expect(
      src,
      'skeleton must embed the use case as a JSON.stringify-escaped literal',
    ).toContain(JSON.stringify(hostile));

    // No raw (unescaped) newline may appear inside any string literal: the
    // describe( line must be a single source line ending in ', () => {'.
    const describeLine = src
      .split('\n')
      .find((l) => l.trimStart().startsWith('describe('));
    expect(
      describeLine,
      'describe( must open and close its name literal on one source line',
    ).toMatch(/^describe\(".*", \(\) => \{$/);
  });
});
