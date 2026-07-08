// tests/e2e/design-profile-round-trip.spec.js
// TASK-125 — AC6 (disk-touching half): deriveProfileFields(answers) output
// round-trips losslessly through the TASK-124 PROJECT.md frontmatter fields
// (writeProjectMd + readProjectMd). The pure-logic half of AC6 (shape +
// comma/brace guard) lives in tests/design-profile.spec.js (fast tier); this
// file is e2e-only because it does real disk I/O via makeTmpDir.

import { describe, it, expect, afterAll } from 'vitest';

import { PROD } from '../helpers/fixtures.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';

afterAll(cleanupAll);

const FIXED_NOW = '2026-07-08T12:00:00Z';

describe('AC6 — deriveProfileFields round-trips through PROJECT.md', () => {
  it('tier_and_every_perfil_proyecto_entry_survive_write_then_read', async () => {
    const { deriveProfileFields } = await import(PROD.designProfile);
    const { writeProjectMd, readProjectMd } = await import(PROD.projectMd);

    const profile = deriveProfileFields({
      design_heavy: 'yes',
      estimated_screens: 15,
      stakes: 'real',
      design_ambition: 'branded',
      ui_framework: 'vue',
      has_canvas_render: 'no',
      motion_required: 'yes',
      motion_layer: 'dom',
      needs_research: 'need-research',
      assets_required: ['icons-custom', 'photography'],
    });

    expect(profile.tier).toBe('COMPLETO');
    expect(Object.keys(profile.perfil_proyecto).length).toBeGreaterThan(0);

    const repoDir = makeTmpDir('af-dp125-rt');
    await writeProjectMd({
      repoRoot: repoDir,
      answers: {
        project_name: 'design-profile-125-demo',
        project_type: 'web-saas',
        tier: profile.tier,
        perfil_proyecto: profile.perfil_proyecto,
      },
      now: () => FIXED_NOW,
    });

    const out = await readProjectMd({ repoRoot: repoDir });

    expect(out.answers.tier).toBe(profile.tier);
    expect(out.answers.perfil_proyecto).toEqual(profile.perfil_proyecto);
  });

  it('a_ligero_no_flags_profile_also_round_trips', async () => {
    const { deriveProfileFields } = await import(PROD.designProfile);
    const { writeProjectMd, readProjectMd } = await import(PROD.projectMd);

    const profile = deriveProfileFields({
      design_heavy: 'yes',
      estimated_screens: 5,
      stakes: 'low',
      design_ambition: 'tidy',
    });
    expect(profile.tier).toBe('LIGERO');

    const repoDir = makeTmpDir('af-dp125-rt-ligero');
    await writeProjectMd({
      repoRoot: repoDir,
      answers: {
        project_name: 'design-profile-125-ligero',
        project_type: 'cli-tool',
        tier: profile.tier,
        perfil_proyecto: profile.perfil_proyecto,
      },
      now: () => FIXED_NOW,
    });

    const out = await readProjectMd({ repoRoot: repoDir });
    expect(out.answers.tier).toBe('LIGERO');
    expect(out.answers.perfil_proyecto).toEqual(profile.perfil_proyecto);
  });

  it('design_heavy_no_profile_round_trips_too', async () => {
    const { deriveProfileFields } = await import(PROD.designProfile);
    const { writeProjectMd, readProjectMd } = await import(PROD.projectMd);

    const profile = deriveProfileFields({ design_heavy: 'no' });
    expect(profile.tier).toBe('LIGERO');

    const repoDir = makeTmpDir('af-dp125-rt-off');
    await writeProjectMd({
      repoRoot: repoDir,
      answers: {
        project_name: 'design-profile-125-off',
        project_type: 'other',
        tier: profile.tier,
        perfil_proyecto: profile.perfil_proyecto,
      },
      now: () => FIXED_NOW,
    });

    const out = await readProjectMd({ repoRoot: repoDir });
    expect(out.answers.tier).toBe('LIGERO');
    expect(out.answers.perfil_proyecto).toEqual(profile.perfil_proyecto);
  });
});
