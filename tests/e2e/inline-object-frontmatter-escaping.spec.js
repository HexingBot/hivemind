// tests/e2e/inline-object-frontmatter-escaping.spec.js
// TASK-162 — src/project-md.js#coerceFrontmatterScalar (the SPECIAL_FRONTMATTER_IDS
// inline-object reader) and renderProjectMd (the matching writer) both did a
// NAIVE split on ',' then ':' with no escaping. A perfil_proyecto/agent_models
// map value (or key) containing a literal comma or brace passes the TASK-161
// control-char guard and writes fine, but readProjectMd then either throws
// ("... entry ... is missing a colon") or silently mis-parses into extra
// pairs, because the comma/brace is indistinguishable from real map syntax.
//
// Fix direction: escape-on-write / unescape-on-read (encodeMapEntry/
// decodeMapEntry/splitInlineMapPairs), symmetric with the pre-existing
// inline-ARRAY escaping scheme (encodeArrayItem/decodeArrayItem) already in
// this module. A comma-bearing (and brace-bearing) perfil_proyecto value must
// now round-trip losslessly through writeProjectMd -> readProjectMd.

import { describe, it, expect, afterAll } from 'vitest';

import { PROD } from '../helpers/fixtures.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';

afterAll(cleanupAll);

const FIXED_NOW = '2026-07-14T12:00:00Z';

describe('TASK-162 — inline-object frontmatter map values containing commas/braces round-trip losslessly', () => {
  it('perfil_proyecto_value_with_a_literal_comma_round_trips_losslessly', async () => {
    const { writeProjectMd, readProjectMd } = await import(PROD.projectMd);

    const repoDir = makeTmpDir('af-tk162-comma');
    const answers = {
      project_name: 'comma-value-demo',
      project_type: 'web-saas',
      perfil_proyecto: { estilo: 'bold, sleek' },
    };

    await writeProjectMd({ repoRoot: repoDir, answers, now: () => FIXED_NOW });
    // Pre-fix: this throws `perfil_proyecto entry "sleek" is missing a colon`
    // because the reader naively split "bold, sleek" on ',' into two "pairs".
    const out = await readProjectMd({ repoRoot: repoDir });

    expect(out.answers.perfil_proyecto).toEqual({ estilo: 'bold, sleek' });
  });

  it('perfil_proyecto_value_with_a_literal_brace_round_trips_losslessly', async () => {
    const { writeProjectMd, readProjectMd } = await import(PROD.projectMd);

    const repoDir = makeTmpDir('af-tk162-brace');
    const answers = {
      project_name: 'brace-value-demo',
      project_type: 'web-saas',
      perfil_proyecto: { estilo: 'edgy {v2}' },
    };

    await writeProjectMd({ repoRoot: repoDir, answers, now: () => FIXED_NOW });
    const out = await readProjectMd({ repoRoot: repoDir });

    expect(out.answers.perfil_proyecto).toEqual({ estilo: 'edgy {v2}' });
  });

  it('perfil_proyecto_map_with_multiple_entries_including_comma_and_brace_values_all_survive_distinctly', async () => {
    // Guards against silent mis-parse into extra/merged pairs: two entries,
    // one comma-bearing and one brace-bearing, must both come back as
    // EXACTLY two keys with their exact original values — not three-plus
    // pairs from a naive split, and not values bleeding into each other.
    const { writeProjectMd, readProjectMd } = await import(PROD.projectMd);

    const repoDir = makeTmpDir('af-tk162-multi');
    const answers = {
      project_name: 'multi-entry-demo',
      project_type: 'web-saas',
      perfil_proyecto: { estilo: 'bold, sleek', layout: '{grid}' },
    };

    await writeProjectMd({ repoRoot: repoDir, answers, now: () => FIXED_NOW });
    const out = await readProjectMd({ repoRoot: repoDir });

    expect(Object.keys(out.answers.perfil_proyecto)).toHaveLength(2);
    expect(out.answers.perfil_proyecto).toEqual({
      estilo: 'bold, sleek',
      layout: '{grid}',
    });
  });
});
