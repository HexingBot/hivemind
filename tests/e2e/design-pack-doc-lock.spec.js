// tests/e2e/design-pack-doc-lock.spec.js
// TASK-184 AC3 — commands/design-pack.md Step 4 must document every
// top-level field reconcile-apply's REAL output carries (ok,
// planned_install_count, installed_count, source_root, plan, packs — and, on
// a failure run, code + message). Derived from ACTUAL reconcile-apply runs
// via bin/pack-ctl.js's exported `run` (never a hand-copied field list), so a
// new top-level field silently added to the CLI's output and left
// undocumented fails this lock.
//
// TASK-184 fix round (2 HIGH findings from the first review pass):
//
//   HIGH-2.1 — success-path-only blind spot. `code`/`message` are spread into
//   reconcile-apply's output ONLY when `ok === false` (bin/pack-ctl.js's
//   `run()`), so a lock derived exclusively from a SUCCESSFUL fixture run can
//   never see them, no matter how good the string-match predicate is. Fixed
//   by adding a second fixture that forces a real failure (HIVEMIND_OWNED_
//   SOURCE_ROOT pointed at a nonexistent directory — the same override
//   tests/e2e/pack-ctl.spec.js and tests/e2e/pack-ctl-consumer-source.spec.js
//   already use to force the identical soft-failure path) and asserting the
//   doc covers ITS field set too.
//
//   HIGH-2.2 — vacuous substring predicate. `doc.includes(field)` passes for
//   `field: 'code'` even when the doc never documents `code` as an output
//   field at all, because the string "code" already occurs as a substring of
//   "hardcoded"/"hardcode" elsewhere in commands/design-pack.md (Step 6a).
//   Hardened to a word-boundary regex match (`assertFieldsDocumented` below)
//   so a coincidental substring inside an unrelated word can never satisfy
//   the check. See the "predicate hardening" describe block for the mutation
//   proof of both the old predicate's vacuity and the new predicate's
//   correctness, reproduced verbatim in the TASK-184 fix-round hand-off.
//
// Non-vacuity (mutation proof, synthetic-field flavor): the second test in
// each describe block below reuses the exact same assertion helper against
// the real field set PLUS one synthetic, undocumented field name, and asserts
// that throws. Also confirmed manually during development by temporarily
// removing the `expect(...).toThrow(...)` wrapper (so the raw throw surfaced
// as a real spec failure) before restoring it — see the TASK-184 hand-off(s)
// for the captured red runs.
//
// Real disk I/O (writes a fixture PROJECT.md; reconcile-apply reads/writes
// under the tmp repoRoot) -> slow tier.

import {
  describe, it, expect, afterAll, afterEach,
} from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';
import { REPO_ROOT } from '../helpers/repoRoot.js';
import { writeProjectMd } from '../../src/project-md.js';
import { run } from '../../bin/pack-ctl.js';

afterAll(cleanupAll);

const DOC_PATH = join(REPO_ROOT, 'commands', 'design-pack.md');
const ENV_OVERRIDE = 'HIVEMIND_OWNED_SOURCE_ROOT';

async function makeFixtureProject(label) {
  const root = await makeTmpDir(label);
  // Minimal fixture: only the two answers writeProjectMd requires. No
  // tier/perfil_proyecto means profileResultFromFrontmatter falls back to a
  // non-design-heavy default — irrelevant here, since the `watch` pack's
  // skill activates unconditionally (`activate_when: "always"`), so every
  // fixture built this way still has at least one planned install regardless
  // of what the resolved design profile desires.
  await writeProjectMd({
    repoRoot: root,
    answers: { project_name: 'fixture', project_type: 'web-saas' },
  });
  return root;
}

/** Escape a field name for safe interpolation into a RegExp source. Field
 * names are plain snake_case identifiers today, but this guards against any
 * future field name containing a regex metacharacter. */
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Throws naming the first undocumented field — mirrors how a Reviewer would
 * read the failure. Shared by every test below so all of them exercise the
 * identical predicate.
 *
 * HIGH-2.2 fix: word-boundary match, not `doc.includes(field)`. A bare
 * substring check is vacuous for a short/common field name — `'code'` is a
 * substring of "hardcoded" and "hardcode", both already present in
 * commands/design-pack.md's Step 6a, so `doc.includes('code')` was already
 * `true` before this doc ever documented `code` as an output field. `\b`
 * anchors the match to whole-word boundaries, so "hardcoded" no longer
 * satisfies a check for the word "code". See the "predicate hardening"
 * describe block below for the mutation proof. */
function assertFieldsDocumented(fields, doc) {
  for (const field of fields) {
    const pattern = new RegExp(`\\b${escapeRegExp(field)}\\b`);
    if (!pattern.test(doc)) {
      throw new Error(`commands/design-pack.md Step 4 does not mention output field "${field}"`);
    }
  }
}

describe('AC3 — commands/design-pack.md documents every real reconcile-apply top-level field (success path)', () => {
  it('every top-level key the CLI actually returns from a SUCCESSFUL reconcile-apply appears in the doc', async () => {
    const root = await makeFixtureProject('design-pack-doc-lock');
    const result = await run('reconcile-apply', { repoRoot: root });
    const doc = readFileSync(DOC_PATH, 'utf8');

    expect(result.ok).toBe(true);
    const fields = Object.keys(result);
    // Floor guard: if this ever collapsed to zero keys, the loop below would
    // vacuously pass without checking anything real.
    expect(fields.length).toBeGreaterThanOrEqual(6);
    assertFieldsDocumented(fields, doc);
  });

  it('is non-vacuous: a synthetic undocumented field fails the same check (mutation proof)', async () => {
    const root = await makeFixtureProject('design-pack-doc-lock');
    const result = await run('reconcile-apply', { repoRoot: root });
    const doc = readFileSync(DOC_PATH, 'utf8');

    const mutatedFields = [...Object.keys(result), 'totally_fake_field_xyz_not_in_doc'];
    expect(() => assertFieldsDocumented(mutatedFields, doc)).toThrow(
      /totally_fake_field_xyz_not_in_doc/,
    );
  });
});

describe('AC3 — commands/design-pack.md documents every real reconcile-apply top-level field (failure path, HIGH-2.1)', () => {
  afterEach(() => {
    delete process.env[ENV_OVERRIDE];
  });

  it('every top-level key a FAILED reconcile-apply returns (including code + message) appears in the doc', async () => {
    const root = await makeFixtureProject('design-pack-doc-lock-fail');
    // Force a real, unqualified soft-materialize failure: an owned-source
    // root that provably does not exist. Identical technique to
    // tests/e2e/pack-ctl.spec.js's "a_soft_skill_missing_its_owned_source_..."
    // test and tests/e2e/pack-ctl-consumer-source.spec.js — the override is
    // returned verbatim, never existence-checked, by src/plugin-root.js.
    process.env[ENV_OVERRIDE] = join(root, 'definitely-not-here');

    const result = await run('reconcile-apply', { repoRoot: root });
    const doc = readFileSync(DOC_PATH, 'utf8');

    // Sanity: this really did fail, and really does carry the two fields
    // that only ever appear on the ok:false branch — otherwise this test
    // would silently degrade back into the success-path fixture above.
    expect(result.ok).toBe(false);
    expect(result.code).toMatch(/^E_PACK_APPLY_.+_FAILURE$/);
    expect(typeof result.message).toBe('string');
    expect(result.message.length).toBeGreaterThan(0);

    const fields = Object.keys(result);
    expect(fields).toContain('code');
    expect(fields).toContain('message');
    assertFieldsDocumented(fields, doc);
  });
});

describe('AC3 predicate hardening (HIGH-2.2) — word-boundary match is not fooled by a substring coincidence', () => {
  // A doc fixture that never documents `code` as a field, but DOES contain
  // "hardcoded"/"hardcode" — reproducing the exact shape of
  // commands/design-pack.md's real Step 6a text that made the old
  // `doc.includes('code')` predicate vacuously true.
  const DOC_WITHOUT_A_REAL_CODE_FIELD = [
    '`src/design-profile.js#resourceActivations` — a hardcoded map, not a descriptor key, so adding a',
    'descriptor field would not gate them either — never hardcode that list; re-derive it every run.',
  ].join('\n');

  it('(a) the hardened word-boundary predicate correctly FAILS: "code" is not documented as a field here', () => {
    expect(() => assertFieldsDocumented(['code'], DOC_WITHOUT_A_REAL_CODE_FIELD)).toThrow(
      /does not mention output field "code"/,
    );
  });

  it('(b) proves the OLD substring predicate would have wrongly PASSED the identical doc state', () => {
    function oldVacuousPredicate(fields, doc) {
      for (const field of fields) {
        if (!doc.includes(field)) {
          throw new Error(`commands/design-pack.md Step 4 does not mention output field "${field}"`);
        }
      }
    }
    // Same fixture, same field — the OLD predicate does not throw, because
    // `doc.includes('code')` is satisfied by "hardcoded"/"hardcode".
    expect(() => oldVacuousPredicate(['code'], DOC_WITHOUT_A_REAL_CODE_FIELD)).not.toThrow();
    expect(DOC_WITHOUT_A_REAL_CODE_FIELD.includes('code')).toBe(true);
  });
});
