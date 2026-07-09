// tests/e2e/init-builtin-design-power.spec.js
// TASK-129 — design-power becomes an ALWAYS-LOADED first-party pack candidate
// (discovery Option C): bin/init.js now defaults packDescriptors/packModules
// to src/builtin-packs.js's BUILTIN_PACK_DESCRIPTORS/BUILTIN_PACK_MODULES
// instead of [] / {} (TASK-128 left that default an unfed no-op). This spec
// proves the built-in pack end-to-end WITHOUT the caller supplying any
// packDescriptors/packModules — the true default path a real
// `node bin/init.js` run takes.
//
// AC1 — design_heavy=yes + the full conditional interview writes tier +
//        perfil_proyecto to PROJECT.md, round-tripping through readProjectMd
//        to exactly the values the REAL deriveProfileFields produces for the
//        scripted answers.
// AC2 — design_heavy=no (and a non-interactive/no-design-answer run) writes
//        NO tier/perfil_proyecto, and every non-design field is byte-identical
//        to a true opt-out run (packDescriptors:[], packModules:{}) modulo the
//        one recorded `- design_heavy: no` Stack line — a genuine
//        off-by-default regression lock proving the always-loaded gate does
//        not leak design fields into non-design projects.
// AC3 — covered at the unit level by tests/builtin-packs.spec.js (isolation
//        allowlist + real-export binding); re-affirmed here end-to-end since a
//        reimplementation drifting from deriveProfileFields would fail AC1's
//        exact-value comparison.
// AC4 — dist rebuild + dist-parity, covered by tests/e2e/dist-parity.spec.js
//        under `npm run test:all` (not re-asserted here).

import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PROD } from '../helpers/fixtures.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';
import { makeScriptedPrompter, webSaasAnswers } from '../helpers/scripted-prompter.js';
import { makePackAwarePrompter, PACK_ANSWERS, PACK_ANSWERS_COERCED } from '../helpers/design-power-prompter.js';

afterAll(cleanupAll);

const FIXED_NOW = '2026-07-08T12:00:00Z';

// ===========================================================================
// AC1 — default path, design_heavy=yes: real Phase-E scoring end-to-end.
// ===========================================================================
describe('AC1 — default (no packDescriptors/packModules supplied): design_heavy=yes drives tier + perfil_proyecto', () => {
  it('builtin_design_power_pack_drives_tier_and_perfil_proyecto_by_default', async () => {
    const { runInit } = await import(PROD.init);
    const { readProjectMd } = await import(PROD.projectMd);
    const { deriveProfileFields } = await import(PROD.designProfile);

    const repoDir = makeTmpDir('af-init-builtin-yes');
    const prompter = makePackAwarePrompter(webSaasAnswers({
      project_name: 'builtin-design-project',
    }));

    // No packDescriptors/packModules supplied — the DEFAULT path.
    const result = await runInit({
      argv: [],
      prompter,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
    });

    expect(result.state).toBe('created');

    // The gate + the full Fase-1 interview were asked BY DEFAULT (no fixture
    // pack supplied) — proves design-power is truly always-loaded.
    const asked = prompter.askedPackIds();
    for (const id of Object.keys(PACK_ANSWERS)) {
      expect(asked, `expected pack question "${id}" to be asked by default`).toContain(id);
    }
    // ui_outside_canvas is gated on has_canvas_render === 'yes'; we answered
    // 'no', so it must NOT have been asked.
    expect(asked).not.toContain('ui_outside_canvas');

    const { answers, frontmatter } = await readProjectMd({ repoRoot: repoDir });
    const expected = deriveProfileFields(PACK_ANSWERS_COERCED);

    expect(frontmatter.tier).toBe(expected.tier);
    expect(answers.tier).toBe(expected.tier);
    expect(answers.perfil_proyecto).toEqual(expected.perfil_proyecto);
  });
});

// ===========================================================================
// AC2 — default path, design_heavy=no (or absent): off-by-default regression
// lock. Proves the always-loaded gate never leaks design fields into a
// non-design project.
// ===========================================================================
describe('AC2 — design_heavy=no by default: no tier/perfil_proyecto, non-design fields unchanged', () => {
  it('default_design_heavy_no_writes_no_design_fields_and_matches_explicit_opt_out', async () => {
    const { runInit } = await import(PROD.init);
    const { readProjectMd } = await import(PROD.projectMd);

    const repoDefault = makeTmpDir('af-init-builtin-no-default');
    const repoOptOut = makeTmpDir('af-init-builtin-no-optout');
    const answersOverride = { project_name: 'non-design-project' };

    // Default path: the design_heavy gate IS asked (built-in pack is always
    // loaded); answer 'no'.
    const defaultPrompter = makePackAwarePrompter(
      webSaasAnswers(answersOverride),
      { design_heavy: 'no' },
    );
    const resultDefault = await runInit({
      argv: [],
      prompter: defaultPrompter,
      repoRoot: repoDefault,
      now: () => FIXED_NOW,
    });

    // True opt-out (explicit empty pack params): zero active packs, so
    // design_heavy is never asked at all — the pre-TASK-129 baseline.
    const resultOptOut = await runInit({
      argv: [],
      prompter: makeScriptedPrompter(webSaasAnswers(answersOverride)),
      repoRoot: repoOptOut,
      now: () => FIXED_NOW,
      packDescriptors: [],
      packModules: {},
    });

    expect(resultDefault.state).toBe('created');
    expect(resultOptOut.state).toBe('created');

    // The gate WAS asked by default (unlike the opt-out run), answered 'no'.
    expect(defaultPrompter.askedPackIds()).toEqual(['design_heavy']);

    const { answers: answersDefault, frontmatter: fmDefault } =
      await readProjectMd({ repoRoot: repoDefault });
    expect(fmDefault.tier).toBeUndefined();
    expect(answersDefault.tier).toBeUndefined();
    expect(answersDefault.perfil_proyecto).toBeUndefined();

    // Byte-identical to the true opt-out run once the ONE recorded gate
    // answer (`- design_heavy: no`) is stripped out — proves no other field
    // leaked, shifted, or otherwise changed as a side effect of the
    // always-loaded gate question being asked and answered.
    const textDefault = readFileSync(join(repoDefault, 'PROJECT.md'), 'utf8');
    const textOptOut = readFileSync(join(repoOptOut, 'PROJECT.md'), 'utf8');
    const strippedDefault = textDefault
      .split('\n')
      .filter((line) => line !== '- design_heavy: no')
      .join('\n');
    expect(strippedDefault).toBe(textOptOut);
  });

  it('non_interactive_answers_mode_without_design_heavy_writes_no_design_fields', async () => {
    // Non-design / non-interactive project: suppliedAnswers never includes
    // design_heavy at all — the interactive question is never reached in
    // answers-mode (bin/init.js's suppliedAnswers branch bypasses
    // runQuestionnaire/collectPackQuestions entirely). The gated
    // deriveProjectMd must treat an absent design_heavy exactly like 'no'.
    const { runInit } = await import(PROD.init);
    const { readProjectMd } = await import(PROD.projectMd);

    const repoDir = makeTmpDir('af-init-builtin-answers-mode');
    const throwIfCalled = async (ctx) => {
      throw new Error(`prompter was called unexpectedly with: ${JSON.stringify(ctx)}`);
    };

    const result = await runInit({
      argv: [],
      answers: webSaasAnswers({ project_name: 'answers-mode-project' }),
      prompter: throwIfCalled,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
    });

    expect(result.state).toBe('created');

    const { answers, frontmatter } = await readProjectMd({ repoRoot: repoDir });
    expect(frontmatter.tier).toBeUndefined();
    expect(answers.tier).toBeUndefined();
    expect(answers.perfil_proyecto).toBeUndefined();
  });
});
