// tests/e2e/init-pack-hook.spec.js
// TASK-128 — wire the TASK-126 registry + TASK-127 collectors into the live
// intake wizard (bin/init.js runWizardAndWriteProjectMd), Phase D-3. Proves
// the two seams (question injection + PROJECT.md field-merge) work
// end-to-end against a FIXTURE pack that reuses the REAL Phase E
// design-profile exports (src/design-profile.js) — NOT the production
// design-power descriptor, which is Phase F (out of scope here; it needs
// real resource pins/origins that are an open decision).
//
// AC1 — with the fixture pack active, a scripted init run asks the
//        design_heavy gate + conditional interview and writes tier +
//        perfil_proyecto to PROJECT.md; those fields round-trip through
//        readProjectMd to exactly the values deriveProfileFields produced
//        for the scripted answers.
// AC2 — with NO active packs, writeProjectMd output is byte-identical to the
//        pre-hook shape (additive, off-by-default) — a deep-equal-of-
//        frontmatter regression lock, plus a byte-identical PROJECT.md
//        comparison between two explicit-opt-out runs. TASK-129 changed what
//        "params omitted" means (bin/init.js now defaults to the built-in
//        design-power pack, src/builtin-packs.js) — that default-loaded
//        behavior is covered by tests/e2e/init-builtin-design-power.spec.js;
//        the zero-packs case here now requires an EXPLICIT
//        packDescriptors:[]/packModules:{} override.
// AC3 — the two seams call ONLY the TASK-127 collectors: proven functionally
//        by asserting the exact pack-attributed error strings from
//        src/pack-hooks.js surface through runInit (a parallel/duplicated
//        implementation would not produce these exact messages), plus a
//        git-diff check that src/question-library.js is byte-unchanged.
// AC4 — dist rebuild + dist-parity gate, covered by tests/e2e/dist-parity.spec.js
//        under `npm run test:all` (not re-asserted here).

import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { PROD } from '../helpers/fixtures.js';
import { REPO_ROOT } from '../helpers/repoRoot.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';
import { makeScriptedPrompter, webSaasAnswers } from '../helpers/scripted-prompter.js';
// TASK-129 — the pack-question prompt signatures + scripted answers moved to
// a shared helper (tests/helpers/design-power-prompter.js) once
// tests/e2e/init-builtin-design-power.spec.js needed the same fixtures for
// the built-in (always-loaded) default pack path.
import {
  makePackAwarePrompter, PACK_ANSWERS, PACK_ANSWERS_COERCED,
} from '../helpers/design-power-prompter.js';

afterAll(cleanupAll);

const FIXED_NOW = '2026-07-08T12:00:00Z';

// ---------------------------------------------------------------------------
// A minimal VALID pack descriptor (state/pack-descriptor.schema.json). Its
// resources/gate_scopes/pipeline are placeholders just sufficient to pass
// validatePackDescriptor — never the production design-power data.
// ---------------------------------------------------------------------------
const FIXTURE_DESCRIPTOR = {
  id: 'design-power-fixture',
  name: 'Design Power (test fixture)',
  version: '0.0.1',
  core_compat: '>=1.0.0',
  trigger: {},
  project_md_contribution: ['perfil_proyecto', 'tier'],
  profile: {},
  resources: [
    {
      id: 'fixture-resource',
      kind: 'skill',
      origin: 'test/fixture',
      pin: '0.0.1',
      scope: 'project',
      required: 'soft',
    },
  ],
  gate_scopes: [],
  pipeline: [],
};

// ===========================================================================
// AC1 — active fixture pack drives real Phase-E scoring end-to-end.
// ===========================================================================
describe('AC1 — active fixture pack: questions asked, fields round-trip', () => {
  it('design_power_fixture_pack_drives_tier_and_perfil_proyecto', async () => {
    const { runInit } = await import(PROD.init);
    const { readProjectMd } = await import(PROD.projectMd);
    const { DESIGN_PROFILE_QUESTIONS, deriveProfileFields } = await import(PROD.designProfile);

    const repoDir = makeTmpDir('af-init-pack-active');
    const prompter = makePackAwarePrompter(webSaasAnswers({
      project_name: 'design-fixture-project',
    }));

    const result = await runInit({
      argv: [],
      prompter,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
      packDescriptors: [FIXTURE_DESCRIPTOR],
      packModules: {
        'design-power-fixture': {
          questions: DESIGN_PROFILE_QUESTIONS,
          deriveProjectMd: deriveProfileFields,
        },
      },
    });

    expect(result.state).toBe('created');

    // Every pack-only question in PACK_ANSWERS was actually asked (the gate
    // plus the full Fase-1 interview, minus the branch we deliberately skip).
    const asked = prompter.askedPackIds();
    for (const id of Object.keys(PACK_ANSWERS)) {
      expect(asked, `expected pack question "${id}" to be asked`).toContain(id);
    }
    // ui_outside_canvas is gated on has_canvas_render === 'yes'; we answered
    // 'no', so it must NOT have been asked — proves the injected questions'
    // forward-only `when` predicates evaluate against the REAL combined
    // answers map, not some stubbed subset.
    expect(asked).not.toContain('ui_outside_canvas');

    const { answers, frontmatter } = await readProjectMd({ repoRoot: repoDir });
    const expected = deriveProfileFields(PACK_ANSWERS_COERCED);

    expect(frontmatter.tier).toBe(expected.tier);
    expect(answers.tier).toBe(expected.tier);
    expect(answers.perfil_proyecto).toEqual(expected.perfil_proyecto);
  });
});

// ===========================================================================
// AC2 — zero active packs: additive, off-by-default.
//
// TASK-129 note: prior to TASK-129, OMITTING packDescriptors/packModules was
// itself the zero-active-packs case (bin/init.js's own defaults were [] / {}).
// TASK-129 changed bin/init.js's defaults to the built-in design-power
// candidate (src/builtin-packs.js) — see
// tests/e2e/init-builtin-design-power.spec.js for that new default-loaded
// behavior end-to-end. The zero-active-packs case below is now reached only
// via an EXPLICIT packDescriptors:[]/packModules:{} override, which still
// fully opts out (including the built-in pack) and remains
// additive/off-by-default exactly as before.
// ===========================================================================
describe('AC2 — zero active packs (explicit opt-out): additive, off-by-default', () => {
  it('explicit_empty_pack_params_produce_no_pack_fields_or_prompts', async () => {
    const { runInit } = await import(PROD.init);
    const { readProjectMd } = await import(PROD.projectMd);

    const repoDir = makeTmpDir('af-init-pack-zero');
    const prompter = makePackAwarePrompter(webSaasAnswers({
      project_name: 'no-pack-project',
    }));

    // Explicit opt-out — TASK-129 made "omitted" default to the built-in
    // design-power pack, so a true zero-pack run now needs [] / {} explicitly.
    const result = await runInit({
      argv: [],
      prompter,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
      packDescriptors: [],
      packModules: {},
    });

    expect(result.state).toBe('created');
    expect(prompter.askedPackIds()).toEqual([]);

    const { answers, frontmatter } = await readProjectMd({ repoRoot: repoDir });
    expect(frontmatter.tier).toBeUndefined();
    expect(answers.tier).toBeUndefined();
    expect(answers.perfil_proyecto).toBeUndefined();

    // Deep-equal regression lock: the frontmatter shape is EXACTLY the
    // pre-hook shape — no tier, no perfil_proyecto, no stray pack keys.
    expect(Object.keys(frontmatter).sort()).toEqual(
      ['created_at', 'name', 'schema_version', 'type'].sort(),
    );
  });

  it('two_explicit_opt_out_runs_with_identical_answers_are_byte_identical', async () => {
    const { runInit } = await import(PROD.init);

    const repoA = makeTmpDir('af-init-pack-explicit-empty-a');
    const repoB = makeTmpDir('af-init-pack-explicit-empty-b');
    const answersOverride = { project_name: 'twin-project' };

    const resultA = await runInit({
      argv: [],
      prompter: makeScriptedPrompter(webSaasAnswers(answersOverride)),
      repoRoot: repoA,
      now: () => FIXED_NOW,
      packDescriptors: [],
      packModules: {},
    });
    const resultB = await runInit({
      argv: [],
      prompter: makeScriptedPrompter(webSaasAnswers(answersOverride)),
      repoRoot: repoB,
      now: () => FIXED_NOW,
      packDescriptors: [],
      packModules: {},
    });

    expect(resultA.state).toBe('created');
    expect(resultB.state).toBe('created');

    const textA = readFileSync(join(repoA, 'PROJECT.md'), 'utf8');
    const textB = readFileSync(join(repoB, 'PROJECT.md'), 'utf8');
    expect(textA).toBe(textB);
  });
});

// ===========================================================================
// AC3 — the two seams call ONLY the TASK-127 collectors (no parallel/
// duplicated control flow), plus src/question-library.js byte-unchanged.
// ===========================================================================
describe('AC3 — seam isolation: wiring routes through the real collectors', () => {
  it('colliding_pack_question_id_throws_the_collectPackQuestions_error', async () => {
    const { runInit } = await import(PROD.init);

    const repoDir = makeTmpDir('af-init-pack-collision');
    // 'project_name' collides with a core question id — collectPackQuestions
    // must throw BEFORE the prompter is ever invoked for the wizard, so a
    // throw-if-called prompter proves this surfaces from the collector, not
    // from some later generic engine throw.
    const throwIfCalled = async (ctx) => {
      throw new Error(`prompter was called unexpectedly with: ${JSON.stringify(ctx)}`);
    };

    await expect(runInit({
      argv: [],
      prompter: throwIfCalled,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
      packDescriptors: [{ ...FIXTURE_DESCRIPTOR, id: 'collision-pack' }],
      packModules: {
        'collision-pack': {
          questions: [{ id: 'project_name', type: 'string', prompt: 'Colliding prompt' }],
        },
      },
    })).rejects.toThrow(/collectPackQuestions: pack "collision-pack" question id "project_name" collides/);
  });

  it('out_of_envelope_derived_key_throws_the_applyProjectMdContributions_error', async () => {
    const { runInit } = await import(PROD.init);

    const repoDir = makeTmpDir('af-init-pack-isolation');
    const prompter = makeScriptedPrompter(webSaasAnswers({
      project_name: 'isolation-project',
    }));

    await expect(runInit({
      argv: [],
      prompter,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
      packDescriptors: [{
        ...FIXTURE_DESCRIPTOR,
        id: 'isolation-pack',
        project_md_contribution: ['perfil_proyecto'], // deliberately excludes 'tier'
      }],
      packModules: {
        'isolation-pack': {
          deriveProjectMd: () => ({ tier: 'LIGERO', perfil_proyecto: { score: '0' } }),
        },
      },
    })).rejects.toThrow(/applyProjectMdContributions: pack "isolation-pack" derived key\(s\) \["tier"\]/);
  });

  it('question_library_is_byte_unchanged', () => {
    const current = readFileSync(join(REPO_ROOT, 'src', 'question-library.js'), 'utf8');
    const head = spawnSync(
      'git',
      ['show', 'HEAD:src/question-library.js'],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    );
    expect(head.status, `git show failed: ${head.stderr}`).toBe(0);
    expect(current).toBe(head.stdout);
  });
});
