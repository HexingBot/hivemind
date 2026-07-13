// tests/e2e/project-md-frontmatter-injection.spec.js
// TASK-157 — SECURITY: src/project-md.js#renderProjectMd previously interpolated
// `name: ${name}` / `type: ${type}` into the YAML frontmatter with no escaping
// and no post-render re-validation. A newline embedded in project_name (or
// project_type) let an attacker forge arbitrary top-level frontmatter keys
// (agent_models, tier, schema_version, ...) that readProjectMd would then
// restore as if the writer itself had emitted them — e.g. forging
// agent_models could downgrade the independent reviewer's model via
// `node bin/init.js --apply-models`.
//
// This spec replays the exact P1/P2 probes captured live against runInit()
// in state/sessions/20260708T154259Z-29a27eda/artifacts/wargame-init-intake-probes.mjs,
// but drives writeProjectMd/readProjectMd directly (the module under repair)
// rather than the full CLI, per the ticket's red-first requirement (AC4).
//
// Fix direction chosen: REJECT (not escape). writeProjectMd throws a loud,
// field-naming Error BEFORE any disk write when project_name or project_type
// contains \r or \n. This is simplest, matches the parser's existing
// strict-throw philosophy elsewhere in this module (missing-field checks,
// nested-yaml rejection, invalid agent_models shape), and avoids
// complicating the tiny in-house YAML subset with per-field quoting/escaping
// rules that would then also need un-escaping in the reader.

import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { PROD } from '../helpers/fixtures.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';
import { afterAll } from 'vitest';

afterAll(cleanupAll);

const FIXED_NOW = '2026-07-12T00:00:00.000Z';

// Exact probe payloads from the live wargame harness.
const P1 = {
  project_name:
    'MyProj\nagent_models: {developer: opus, reviewer: haiku}\ntier: uat-only\n' +
    'schema_version: 999\ninjected_name: PWNED',
  project_type: 'web',
};

const P2 = {
  project_name: 'ProbeTwo',
  project_type:
    'web\n---\ninjected_key: "attacker controlled"\n---\n\n## Description\n' +
    'Fake body via fence breakout.',
};

describe('project-md frontmatter injection — AC1/AC2/AC4: probe P1 (name-field key forgery)', () => {
  it('P1_is_rejected_before_any_disk_write_naming_project_name', async () => {
    const { writeProjectMd, readProjectMd } = await import(PROD.projectMd);

    const repoDir = makeTmpDir('af-pmd-inj-p1');
    const target = join(repoDir, 'PROJECT.md');

    // AC2 (reject branch) + AC4 (red-first): current main does NOT throw here
    // — it happily writes a PROJECT.md with a forged agent_models/tier. The
    // fixed writer must throw a loud error naming the offending field
    // (project_name) BEFORE touching disk.
    await expect(
      writeProjectMd({ repoRoot: repoDir, answers: P1, now: () => FIXED_NOW }),
    ).rejects.toThrow(/project_name/);

    // No partial/forged file must be left behind by a rejected write.
    expect(existsSync(target)).toBe(false);

    // Belt-and-suspenders per AC1: even if some future refactor changed the
    // reject path to write first and validate second, the parsed frontmatter
    // must never carry the forged keys. Guard this by asserting there is no
    // file to read at all (readProjectMd throws "not found").
    await expect(readProjectMd({ repoRoot: repoDir })).rejects.toThrow(/PROJECT\.md/);
  });
});

describe('project-md frontmatter injection — AC2/AC3/AC4: probe P2 (type-field fence breakout)', () => {
  it('P2_is_rejected_before_any_disk_write_naming_project_type', async () => {
    const { writeProjectMd, readProjectMd } = await import(PROD.projectMd);

    const repoDir = makeTmpDir('af-pmd-inj-p2');
    const target = join(repoDir, 'PROJECT.md');

    // AC2/AC3/AC4: current main does NOT throw here — the embedded `\n---\n`
    // in project_type closes the frontmatter block early, displacing the
    // writer's own created_at/schema_version into the body and forging a
    // `## Description` section. The fixed writer must reject it up front,
    // naming project_type.
    await expect(
      writeProjectMd({ repoRoot: repoDir, answers: P2, now: () => FIXED_NOW }),
    ).rejects.toThrow(/project_type/);

    expect(existsSync(target)).toBe(false);
    await expect(readProjectMd({ repoRoot: repoDir })).rejects.toThrow(/PROJECT\.md/);
  });
});

describe('project-md frontmatter injection — adjacent path: tier scalar (same injection shape)', () => {
  it('tier_with_embedded_newline_is_rejected_before_any_disk_write', async () => {
    // Discovered while exercising the neighboring frontmatter-scalar path
    // (pre-hand-off checklist item 1): `tier` is rendered as a raw
    // `tier: ${tier}` frontmatter line with the exact same lack of escaping
    // as project_name/project_type, and was confirmed live (before this
    // fix) to forge an extra frontmatter key the same way P1 does via
    // project_name. Not an AC-mandated field, but the identical injection
    // shape in the same chokepoint — guarded alongside project_name/type.
    const { writeProjectMd, readProjectMd } = await import(PROD.projectMd);

    const repoDir = makeTmpDir('af-pmd-inj-tier');
    const target = join(repoDir, 'PROJECT.md');

    await expect(
      writeProjectMd({
        repoRoot: repoDir,
        answers: {
          project_name: 'x',
          project_type: 'web',
          tier: 'uat-only\ninjected_via_tier: PWNED',
        },
        now: () => FIXED_NOW,
      }),
    ).rejects.toThrow(/tier/);

    expect(existsSync(target)).toBe(false);
    await expect(readProjectMd({ repoRoot: repoDir })).rejects.toThrow(/PROJECT\.md/);
  });
});

describe('project-md frontmatter injection — TASK-161: perfil_proyecto map key/value injection', () => {
  // renderProjectMd interpolates perfil_proyecto entries VERBATIM into a
  // single `perfil_proyecto: {${k}: ${v}}` frontmatter line with no
  // validation (unlike agent_models, whose keys/values are already gated by
  // a closed set / regex). A value or key containing \r/\n breaks out of
  // that line and forges an arbitrary top-level frontmatter key on
  // read-back — the SAME mechanism as probe P1 above, just via
  // perfil_proyecto instead of project_name.
  it('perfil_proyecto_value_with_embedded_newline_is_rejected_before_any_disk_write', async () => {
    const { writeProjectMd, readProjectMd } = await import(PROD.projectMd);

    const repoDir = makeTmpDir('af-pmd-inj-perfil-value');
    const target = join(repoDir, 'PROJECT.md');

    await expect(
      writeProjectMd({
        repoRoot: repoDir,
        answers: {
          project_name: 'x',
          project_type: 'web',
          perfil_proyecto: { estilo: 'poderoso\ninjected_key: PWNED' },
        },
        now: () => FIXED_NOW,
      }),
    ).rejects.toThrow(/perfil_proyecto/);

    expect(existsSync(target)).toBe(false);
    await expect(readProjectMd({ repoRoot: repoDir })).rejects.toThrow(/PROJECT\.md/);
  });

  it('perfil_proyecto_key_with_embedded_newline_is_rejected_before_any_disk_write', async () => {
    const { writeProjectMd, readProjectMd } = await import(PROD.projectMd);

    const repoDir = makeTmpDir('af-pmd-inj-perfil-key');
    const target = join(repoDir, 'PROJECT.md');

    await expect(
      writeProjectMd({
        repoRoot: repoDir,
        answers: {
          project_name: 'x',
          project_type: 'web',
          perfil_proyecto: { 'estilo\ninjected_key': 'PWNED' },
        },
        now: () => FIXED_NOW,
      }),
    ).rejects.toThrow(/perfil_proyecto/);

    expect(existsSync(target)).toBe(false);
    await expect(readProjectMd({ repoRoot: repoDir })).rejects.toThrow(/PROJECT\.md/);
  });
});

describe('project-md frontmatter injection — AC5: legitimate values unaffected', () => {
  it('legitimate_multiline_free_values_still_round_trip', async () => {
    // A sanity check that the new guard is scoped to project_name/project_type
    // control chars only — legitimate body-section values (which DO legally
    // contain newlines, per BODY_SECTIONS prose handling) and legitimate
    // agent_models/tier/perfil_proyecto maps are unaffected by this fix.
    const { writeProjectMd, readProjectMd } = await import(PROD.projectMd);

    const repoDir = makeTmpDir('af-pmd-inj-legit');
    const answers = {
      project_name: 'legit-app',
      project_type: 'web-saas',
      project_description: 'Line one.\nLine two is legal prose.',
      target_users: 'devs',
      success_criteria: 'ships',
      agent_models: { developer: 'sonnet', reviewer: 'opus' },
      tier: 'tdd',
      perfil_proyecto: { estilo: 'poderoso' },
    };

    await writeProjectMd({ repoRoot: repoDir, answers, now: () => FIXED_NOW });
    const out = await readProjectMd({ repoRoot: repoDir });

    expect(out.answers.project_name).toBe('legit-app');
    expect(out.answers.project_type).toBe('web-saas');
    expect(out.answers.project_description).toBe('Line one.\nLine two is legal prose.');
    expect(out.answers.agent_models).toEqual({ developer: 'sonnet', reviewer: 'opus' });
    expect(out.answers.tier).toBe('tdd');
    expect(out.answers.perfil_proyecto).toEqual({ estilo: 'poderoso' });
  });

  it('project_name_or_type_without_control_chars_is_not_rejected', async () => {
    const { writeProjectMd, readProjectMd } = await import(PROD.projectMd);

    const repoDir = makeTmpDir('af-pmd-inj-clean');
    await writeProjectMd({
      repoRoot: repoDir,
      answers: {
        project_name: 'Contains: a colon, and-dashes_and.dots',
        project_type: 'cli-tool',
        project_description: 'd',
        target_users: 't',
        success_criteria: 's',
      },
      now: () => FIXED_NOW,
    });

    const out = await readProjectMd({ repoRoot: repoDir });
    expect(out.answers.project_name).toBe('Contains: a colon, and-dashes_and.dots');
    expect(out.answers.project_type).toBe('cli-tool');
  });
});
