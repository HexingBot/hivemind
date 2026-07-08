// tests/e2e/design-profile-frontmatter.spec.js
// TASK-124 — PROJECT.md perfil_proyecto + tier frontmatter (design profile
// fields). Phase E foundation for the Diseño Poderoso design pack: this ticket
// adds the CONTAINER + plumbing only (no scoring/question logic).
//
// AC map:
//   AC1 — write/read round-trips tier (scalar enum string) and perfil_proyecto
//         (inline-object map) losslessly.
//   AC2 — covered in tests/project-definition-schema.spec.js (schema shape,
//         fast tier, no disk I/O).
//   AC3 — perfil_proyecto uses the SPECIAL_FRONTMATTER_IDS inline-object
//         treatment exactly like agent_models: single frontmatter line,
//         parsed back into an object, excluded unconditionally from Stack.
//         tier is a plain scalar frontmatter line, also never in Stack.
//   AC4 — a project with NEITHER field emits no new frontmatter lines and
//         round-trips with both keys absent (byte-unchanged legacy behavior).
//   AC5 — covered in tests/project-definition-schema.spec.js.

import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PROD } from '../helpers/fixtures.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';

afterAll(cleanupAll);

const FIXED_NOW = '2026-05-26T12:00:00Z';

// ===========================================================================
// AC1 — round-trip tier + perfil_proyecto losslessly.
// ===========================================================================
describe('AC1 — PROJECT.md round-trips tier + perfil_proyecto', () => {
  it('round_trip_tier_and_perfil_proyecto_lossless', async () => {
    const { writeProjectMd, readProjectMd } = await import(PROD.projectMd);

    const repoDir = makeTmpDir('af-dp-rt');
    const answers = {
      project_name: 'design-profile-demo',
      project_type: 'web-saas',
      tier: 'COMPLETO',
      perfil_proyecto: { functionality: 'high', beauty: 'high', framework: 'vue' },
    };

    await writeProjectMd({ repoRoot: repoDir, answers, now: () => FIXED_NOW });
    const out = await readProjectMd({ repoRoot: repoDir });

    expect(out.answers.tier).toBe('COMPLETO');
    expect(out.answers.perfil_proyecto).toEqual(answers.perfil_proyecto);
  });

  it('round_trip_ligero_and_medio_tier_values', async () => {
    const { writeProjectMd, readProjectMd } = await import(PROD.projectMd);

    for (const tier of ['LIGERO', 'MEDIO']) {
      const repoDir = makeTmpDir(`af-dp-rt-${tier.toLowerCase()}`);
      await writeProjectMd({
        repoRoot: repoDir,
        answers: { project_name: `demo-${tier}`, project_type: 'cli-tool', tier },
        now: () => FIXED_NOW,
      });
      const out = await readProjectMd({ repoRoot: repoDir });
      expect(out.answers.tier).toBe(tier);
    }
  });
});

// ===========================================================================
// AC3 — perfil_proyecto inline-object rendering + unconditional Stack
// exclusion (mirrors agent_models exactly); tier is a plain scalar line.
// ===========================================================================
describe('AC3 — perfil_proyecto inline-object rendering + Stack exclusion', () => {
  it('perfil_proyecto_rendered_on_single_frontmatter_line', async () => {
    const { writeProjectMd } = await import(PROD.projectMd);

    const repoDir = makeTmpDir('af-dp-line');
    const target = join(repoDir, 'PROJECT.md');

    await writeProjectMd({
      repoRoot: repoDir,
      answers: {
        project_name: 'line-demo',
        project_type: 'library',
        perfil_proyecto: { functionality: 'high', beauty: 'medium' },
      },
      now: () => FIXED_NOW,
    });

    const text = readFileSync(target, 'utf8');
    const matches = text.split('\n').filter((l) => l.startsWith('perfil_proyecto:'));
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatch(/^perfil_proyecto: \{.+\}$/);
  });

  it('perfil_proyecto_excluded_from_stack_section_even_with_other_stack_keys', async () => {
    const { writeProjectMd, readProjectMd } = await import(PROD.projectMd);

    const repoDir = makeTmpDir('af-dp-stack');
    const target = join(repoDir, 'PROJECT.md');

    await writeProjectMd({
      repoRoot: repoDir,
      answers: {
        project_name: 'stack-demo',
        project_type: 'library',
        perfil_proyecto: { functionality: 'high' },
        database: 'postgres',
      },
      now: () => FIXED_NOW,
    });

    const text = readFileSync(target, 'utf8');
    expect(text).not.toMatch(/^- perfil_proyecto:/m);
    expect(text).toMatch(/^- database: postgres$/m);

    const out = await readProjectMd({ repoRoot: repoDir });
    expect(out.answers.perfil_proyecto).toEqual({ functionality: 'high' });
    expect(out.answers.database).toBe('postgres');
  });

  it('tier_rendered_as_plain_scalar_frontmatter_line_not_in_stack', async () => {
    const { writeProjectMd } = await import(PROD.projectMd);

    const repoDir = makeTmpDir('af-dp-tier-line');
    const target = join(repoDir, 'PROJECT.md');

    await writeProjectMd({
      repoRoot: repoDir,
      answers: { project_name: 'tier-demo', project_type: 'library', tier: 'MEDIO' },
      now: () => FIXED_NOW,
    });

    const text = readFileSync(target, 'utf8');
    expect(text).toMatch(/^tier: MEDIO$/m);
    expect(text).not.toMatch(/^- tier:/m);
  });
});

// ===========================================================================
// AC4 — neither field present: no new frontmatter lines, both keys absent
// on read-back (byte-unchanged legacy behavior). Every pre-existing
// project-md/PROJECT.schema spec must also still pass unchanged (verified by
// the full test run, not re-asserted here).
// ===========================================================================
describe('AC4 — projects without tier/perfil_proyecto are unaffected', () => {
  it('answers_without_design_fields_emit_no_new_frontmatter_lines', async () => {
    const { writeProjectMd } = await import(PROD.projectMd);

    const repoDir = makeTmpDir('af-dp-legacy');
    const target = join(repoDir, 'PROJECT.md');

    await writeProjectMd({
      repoRoot: repoDir,
      answers: {
        project_name: 'legacy-demo',
        project_type: 'library',
        project_description: 'd',
        target_users: 't',
        success_criteria: 's',
      },
      now: () => FIXED_NOW,
    });

    const text = readFileSync(target, 'utf8');
    expect(text).not.toMatch(/^tier:/m);
    expect(text).not.toMatch(/^perfil_proyecto:/m);
    expect(text).not.toMatch(/^- tier:/m);
    expect(text).not.toMatch(/^- perfil_proyecto:/m);
  });

  it('round_trip_with_no_design_fields_leaves_both_keys_absent', async () => {
    const { writeProjectMd, readProjectMd } = await import(PROD.projectMd);

    const repoDir = makeTmpDir('af-dp-legacy-rt');
    await writeProjectMd({
      repoRoot: repoDir,
      answers: { project_name: 'no-design', project_type: 'other' },
      now: () => FIXED_NOW,
    });
    const out = await readProjectMd({ repoRoot: repoDir });

    expect(out.answers.tier).toBeUndefined();
    expect(out.answers.perfil_proyecto).toBeUndefined();
  });
});
