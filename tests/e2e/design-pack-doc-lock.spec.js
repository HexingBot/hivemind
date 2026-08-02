// tests/e2e/design-pack-doc-lock.spec.js
// TASK-184 AC3 — commands/design-pack.md Step 4 must document every
// top-level field reconcile-apply's REAL output carries (ok,
// planned_install_count, installed_count, source_root, plan, packs).
// Derived from an ACTUAL reconcile-apply run via bin/pack-ctl.js's exported
// `run` (never a hand-copied field list), so a new top-level field silently
// added to the CLI's output and left undocumented fails this lock.
//
// Non-vacuity (mutation proof): the second test below reuses the exact same
// assertion helper against the real field set PLUS one synthetic,
// undocumented field name, and asserts that throws. This was also confirmed
// manually during development by temporarily removing the `expect(...).
// toThrow(...)` wrapper (so the raw throw surfaced as a real spec failure)
// before restoring it — see the TASK-184 hand-off for the captured red run.
//
// Real disk I/O (writes a fixture PROJECT.md; reconcile-apply reads/writes
// under the tmp repoRoot) -> slow tier.

import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';
import { REPO_ROOT } from '../helpers/repoRoot.js';
import { writeProjectMd } from '../../src/project-md.js';
import { run } from '../../bin/pack-ctl.js';

afterAll(cleanupAll);

const DOC_PATH = join(REPO_ROOT, 'commands', 'design-pack.md');

async function makeFixtureProject() {
  const root = await makeTmpDir('design-pack-doc-lock');
  // Minimal fixture: only the two answers writeProjectMd requires. No
  // tier/perfil_proyecto means profileResultFromFrontmatter falls back to a
  // non-design-heavy default — irrelevant here, since every top-level
  // reconcile-apply field (ok, planned_install_count, installed_count,
  // source_root, plan, packs) is present regardless of what the resolved
  // profile desires.
  await writeProjectMd({
    repoRoot: root,
    answers: { project_name: 'fixture', project_type: 'web-saas' },
  });
  return root;
}

/** Throws naming the first undocumented field — mirrors how a Reviewer would
 * read the failure. Shared by the real-fields test and the mutation proof so
 * both exercise the identical predicate. */
function assertFieldsDocumented(fields, doc) {
  for (const field of fields) {
    if (!doc.includes(field)) {
      throw new Error(`commands/design-pack.md Step 4 does not mention output field "${field}"`);
    }
  }
}

describe('AC3 — commands/design-pack.md documents every real reconcile-apply top-level field', () => {
  it('every top-level key the CLI actually returns from reconcile-apply appears in the doc', async () => {
    const root = await makeFixtureProject();
    const result = await run('reconcile-apply', { repoRoot: root });
    const doc = readFileSync(DOC_PATH, 'utf8');

    const fields = Object.keys(result);
    // Floor guard: if this ever collapsed to zero keys, the loop below would
    // vacuously pass without checking anything real.
    expect(fields.length).toBeGreaterThanOrEqual(6);
    assertFieldsDocumented(fields, doc);
  });

  it('is non-vacuous: a synthetic undocumented field fails the same check (mutation proof)', async () => {
    const root = await makeFixtureProject();
    const result = await run('reconcile-apply', { repoRoot: root });
    const doc = readFileSync(DOC_PATH, 'utf8');

    const mutatedFields = [...Object.keys(result), 'totally_fake_field_xyz_not_in_doc'];
    expect(() => assertFieldsDocumented(mutatedFields, doc)).toThrow(
      /totally_fake_field_xyz_not_in_doc/,
    );
  });
});
