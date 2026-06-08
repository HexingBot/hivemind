// tests/project-md-hardening.spec.js
// TASK-016 — hardening pass for src/project-md.js. Five acceptance criteria
// from the TASK-011 reviewer audit, all localized to that one module.
//
// Design choice for AC1 (comma-in-array round-trip):
//   We pick the ESCAPE strategy over the REJECT strategy because lossless is
//   strictly better than rejecting plausible inputs (TASK-013, the first
//   non-wizard caller, will emit user-authored tags/labels that may legally
//   contain commas). The impl is REQUIRED to backslash-escape commas (",") as
//   "\," and backslashes ("\") as "\\" inside inline-array items on write,
//   and to unescape them on read. The test asserts the on-disk encoding so
//   the contract is unambiguous for the impl developer.
//
// All other ACs are encoded as either behavioral round-trip / throw tests or
// as source-text assertions (AC3 + AC5 are docs-only ACs).

import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll } from 'vitest';

import { PROD } from '../helpers/fixtures.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';

afterAll(cleanupAll);

const FIXED_NOW = '2026-05-26T12:00:00Z';

// Resolve the production source on disk for the docs-only ACs (AC3, AC5).
const __thisDir = dirname(fileURLToPath(import.meta.url));
const PROJECT_MD_SRC_PATH = join(__thisDir, '..', '..', 'src', 'project-md.js');

// =====================================================================
// AC1 — array items containing commas must round-trip losslessly via an
// escape/unescape scheme. The impl MUST backslash-escape ',' as '\,' and
// '\' as '\\' inside inline-array items on write; the reader must reverse
// the encoding. Two assertions:
//   (a) on-disk file contains the escape sequence (pins the contract);
//   (b) read-back equals the original input (lossless round-trip).
// =====================================================================
describe('project-md hardening — AC1 comma-in-array round-trip', () => {
  it('array_items_with_commas_round_trip_lossless', async () => {
    const { writeProjectMd, readProjectMd } = await import(PROD.projectMd);

    const repoDir = makeTmpDir('af-pmd-h-ac1');
    const target = join(repoDir, 'PROJECT.md');

    const answers = {
      project_name: 'comma-demo',
      project_type: 'library',
      project_description: 'd',
      target_users: 't',
      success_criteria: 's',
      // Stack key that the writer renders as an inline array. The first item
      // contains a comma; that comma MUST survive the round-trip.
      tags: ['hello, world', 'plain'],
    };

    await writeProjectMd({
      repoRoot: repoDir,
      answers,
      now: () => FIXED_NOW,
    });

    // (a) On-disk encoding pins the escape contract. Match an escaped comma
    // ('\,') inside the bracketed tags line so the impl can't accidentally
    // satisfy the round-trip via some other (e.g. percent-encoding) scheme.
    const onDisk = readFileSync(target, 'utf8');
    const tagsLine = onDisk.split('\n').find((l) => l.startsWith('- tags:'));
    expect(tagsLine, 'tags stack line must exist on disk').toBeDefined();
    // The literal backslash-comma sequence must appear inside the brackets.
    expect(tagsLine).toMatch(/\[.*\\,.*\]/);

    // (b) Round-trip must be lossless.
    const out = await readProjectMd({ repoRoot: repoDir });
    expect(Array.isArray(out.answers.tags)).toBe(true);
    expect(out.answers.tags).toEqual(['hello, world', 'plain']);
  });

  it('array_items_with_escaped_backslash_round_trip_lossless', async () => {
    // Backslash itself must also be escapable so the scheme is reversible
    // for the (unlikely but legal) case of an item like 'a\\b'.
    const { writeProjectMd, readProjectMd } = await import(PROD.projectMd);

    const repoDir = makeTmpDir('af-pmd-h-ac1b');
    const answers = {
      project_name: 'bslash-demo',
      project_type: 'library',
      project_description: 'd',
      target_users: 't',
      success_criteria: 's',
      tags: ['a\\b', 'c,d'],
    };

    await writeProjectMd({
      repoRoot: repoDir,
      answers,
      now: () => FIXED_NOW,
    });

    const out = await readProjectMd({ repoRoot: repoDir });
    expect(out.answers.tags).toEqual(['a\\b', 'c,d']);
  });
});

// =====================================================================
// AC2 — schema-aware scalar coercion. The current behavior coerces ANY
// /^-?\d+$/ to Number. The new behavior must only coerce when the schema
// declares the field as integer or number.
//
// state/PROJECT.schema.json today only declares `schema_version: integer`.
// We assert:
//   (a) `schema_version: 1` STILL coerces to Number 1 (positive control);
//   (b) a frontmatter key NOT declared as integer/number in the schema
//       (we use a fresh `version_tag` key whose raw value is "1") is
//       preserved as the STRING "1" — proving the coercion now consults
//       the schema rather than blindly regex-matching.
//
// We exercise this via the reader directly: write a hand-crafted PROJECT.md
// with the field of interest in the frontmatter, then assert the parsed
// type on read. This avoids needing to mutate state/PROJECT.schema.json.
// =====================================================================
describe('project-md hardening — AC2 schema-aware scalar coercion', () => {
  it('coerces_schema_declared_integer_fields_only', async () => {
    const { readProjectMd } = await import(PROD.projectMd);

    const repoDir = makeTmpDir('af-pmd-h-ac2');
    const target = join(repoDir, 'PROJECT.md');

    // A frontmatter that includes both a schema-declared integer field
    // (schema_version) and an UNDECLARED numeric-looking field
    // (version_tag). The reader must coerce only the former.
    const content =
      '---\n' +
      'name: schema-coerce-demo\n' +
      'type: library\n' +
      'created_at: 2026-05-26T12:00:00Z\n' +
      'schema_version: 1\n' +
      'version_tag: 1\n' +
      '---\n' +
      '\n' +
      '# schema-coerce-demo\n';

    writeFileSync(target, content, 'utf8');

    const out = await readProjectMd({ repoRoot: repoDir });

    // (a) schema-declared integer field: still a Number.
    expect(out.frontmatter.schema_version).toBe(1);
    expect(typeof out.frontmatter.schema_version).toBe('number');

    // (b) Undeclared numeric-looking field: preserved as a string. This is
    // the assertion that fails under the current blind-regex coercion.
    expect(out.frontmatter.version_tag).toBe('1');
    expect(typeof out.frontmatter.version_tag).toBe('string');
  });
});

// =====================================================================
// AC3 — `parseStackValue` must carry an inline comment explaining the
// deliberate string-only handling (the asymmetry vs. coerceFrontmatterScalar
// which DOES coerce integers). This is a docs-only AC so we assert against
// the source text.
//
// Regex rationale: search the 500 characters surrounding the function name
// for any of the keywords that a reasonable explanatory comment would use
// ('deliberate' | 'string-only' | 'asymmetry' | 'unknown keys'). 500 chars
// is enough to span a typical multi-line block comment placed directly
// above the function declaration plus a few lines of body. The /i flag
// keeps it forgiving on capitalization.
// =====================================================================
describe('project-md hardening — AC3 parseStackValue documentation', () => {
  it('parseStackValue_function_carries_explanatory_comment', () => {
    const src = readFileSync(PROJECT_MD_SRC_PATH, 'utf8');
    // The function must still exist.
    expect(src).toMatch(/function\s+parseStackValue\s*\(/);
    // And within ~500 chars around its declaration there must be a
    // comment containing one of the marker keywords.
    expect(src).toMatch(
      /parseStackValue[\s\S]{0,500}(deliberate|string-only|asymmetry|unknown keys)/i,
    );
  });
});

// =====================================================================
// AC4 — write-time throws on missing/empty required frontmatter answers.
// Three cases, each must throw an error whose message names the missing
// field (so the bug surfaces at the point of error rather than downstream
// at ajv validation time):
//   (1) answers = {}                                  -> names project_name
//   (2) answers = { project_name: '' }                -> names project_name
//   (3) answers = { project_name: 'x' } (no type)     -> names project_type
// =====================================================================
describe('project-md hardening — AC4 write-time validation', () => {
  it('throws_when_project_name_is_missing', async () => {
    const { writeProjectMd } = await import(PROD.projectMd);
    const repoDir = makeTmpDir('af-pmd-h-ac4a');

    await expect(
      writeProjectMd({
        repoRoot: repoDir,
        answers: {},
        now: () => FIXED_NOW,
      }),
    ).rejects.toThrow(/project_name/);
  });

  it('throws_when_project_name_is_empty_string', async () => {
    const { writeProjectMd } = await import(PROD.projectMd);
    const repoDir = makeTmpDir('af-pmd-h-ac4b');

    await expect(
      writeProjectMd({
        repoRoot: repoDir,
        answers: { project_name: '' },
        now: () => FIXED_NOW,
      }),
    ).rejects.toThrow(/project_name/);
  });

  it('throws_when_project_type_is_missing', async () => {
    const { writeProjectMd } = await import(PROD.projectMd);
    const repoDir = makeTmpDir('af-pmd-h-ac4c');

    await expect(
      writeProjectMd({
        repoRoot: repoDir,
        answers: { project_name: 'x' },
        now: () => FIXED_NOW,
      }),
    ).rejects.toThrow(/project_type/);
  });
});

// =====================================================================
// AC5 — colon-comment accuracy. The current src/project-md.js:107 comment
// reads "// Frontmatter — scalar lines only, no quoting (values may not
// contain ':')." That phrasing is wrong because values DO accept colons
// in body and Stack sections. The new comment must NOT make the
// unconditional claim. We require either:
//   (a) the bare "values may not contain ':'" phrasing be REMOVED, OR
//   (b) the comment explicitly scope the constraint to frontmatter (some
//       phrasing like "in frontmatter" / "frontmatter-only" / "this
//       frontmatter section").
// =====================================================================
describe('project-md hardening — AC5 colon-comment accuracy', () => {
  it('frontmatter_colon_comment_does_not_make_unconditional_claim', () => {
    const src = readFileSync(PROJECT_MD_SRC_PATH, 'utf8');

    // Find every line that mentions the colon-no-quoting constraint. If a
    // line says "values may not contain ':'" it must ALSO scope that to
    // frontmatter (otherwise it's the misleading wording from before).
    const lines = src.split(/\r?\n/);
    for (const line of lines) {
      if (/values may not contain ['"]:['"]/.test(line)) {
        expect(
          /frontmatter/i.test(line),
          `colon-constraint comment must scope to frontmatter, got: ${line}`,
        ).toBe(true);
      }
    }

    // Belt-and-suspenders: the exact original misleading phrasing must be
    // gone outright. The original line is:
    //   // Frontmatter — scalar lines only, no quoting (values may not contain ':').
    // Note the closing ").)" — the parenthesized clause is the bug.
    expect(src).not.toMatch(/no quoting \(values may not contain ['"]:['"]\)\./);
  });
});
