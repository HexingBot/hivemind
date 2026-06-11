// tests/use-case-policy.spec.js
// TASK-029 — fast-tier policy and meta-spec assertions (no disk I/O beyond
// reading committed files).
//
// AC coverage:
//   AC1 meta-spec — tests/use-cases/USE-CASES.md exists in THIS repo, names
//          every primary flow, and every spec path it references actually exists.
//   AC1 config   — npm run test:use-cases script exists in package.json.
//   AC1 config   — vitest.config.all.js include pattern covers tests/use-cases/.
//   AC3 docs     — CLAUDE.md documents the use-case suite as part of the release
//          gate AND carries the "modify only when a use case changes" rule.
//
// RED reasons (before IMPL):
//   AC1 meta-spec: tests/use-cases/USE-CASES.md does not yet exist → fails.
//   AC1 config (script): package.json has no test:use-cases script → fails.
//   AC1 config (include): vitest.config.all.js include already covers tests/**
//          so this assertion may be green immediately — it is a permanent sensor
//          that blocks future regressions. If IMPL narrows the include, this fails.
//   AC3 docs: CLAUDE.md does not yet carry the use-case suite gate rule → fails.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from './helpers/repoRoot.js';

// ---------------------------------------------------------------------------
// File loaders
// ---------------------------------------------------------------------------
function loadFile(relPath) {
  return readFileSync(join(REPO_ROOT, relPath), 'utf8');
}

function loadJson(relPath) {
  return JSON.parse(loadFile(relPath));
}

// ---------------------------------------------------------------------------
// Section slicer (mirrors verification-policy-docs.spec.js helper)
// ---------------------------------------------------------------------------

/**
 * Slice the text from the first line that starts with `headingText` to the
 * next heading of the same or higher level, or end of string. Returns null
 * when the heading is absent.
 */
function sliceSection(text, headingText) {
  const lines = text.split('\n');
  const startIdx = lines.findIndex((l) => l.startsWith(headingText));
  if (startIdx === -1) return null;
  const level = headingText.match(/^(#+)/)[1].length;
  const closeRe = new RegExp(`^${'#'.repeat(level)}[^#]`);
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (closeRe.test(lines[i])) { endIdx = i; break; }
  }
  return lines.slice(startIdx, endIdx).join('\n');
}

// ---------------------------------------------------------------------------
// AC1 config — npm run test:use-cases script
// ---------------------------------------------------------------------------

describe('AC1 — package.json has test:use-cases script', () => {
  it('package_json_has_test_use_cases_script', () => {
    // AC1: the script must exist. Its value must reference tests/use-cases.
    // RED: no such script in package.json yet.
    const pkg = loadJson('package.json');
    expect(
      typeof pkg.scripts?.['test:use-cases'],
      'package.json must contain a "test:use-cases" script',
    ).toBe('string');

    // The script value must exercise tests/use-cases — not just run test:all.
    const scriptValue = pkg.scripts['test:use-cases'];
    expect(
      scriptValue,
      '"test:use-cases" script must reference tests/use-cases directory',
    ).toMatch(/tests[\\/]use-cases/);
  });
});

// ---------------------------------------------------------------------------
// AC1 config — vitest.config.all.js includes tests/use-cases/**
// ---------------------------------------------------------------------------

describe('AC1 — vitest.config.all.js include pattern covers tests/use-cases/', () => {
  it('all_config_include_covers_use_cases_directory', () => {
    // AC1: npm run test:all must pick up tests/use-cases/**/*.spec.js.
    // The current include is ['tests/**/*.spec.js'] which already covers it.
    // This spec is a PERMANENT SENSOR: if IMPL ever narrows the include to
    // tests/*.spec.js or tests/e2e/**/*.spec.js, this assertion fires.
    const src = loadFile('vitest.config.all.js');

    // The include pattern must be broad enough to cover tests/use-cases/.
    // Accept 'tests/**' (current) or 'tests/use-cases' explicitly.
    const coversBroad = /include\s*:\s*\[[\s\S]*?['"]tests\/\*\*/.test(src);
    const coversExplicit = /include\s*:\s*\[[\s\S]*?['"]tests\/use-cases/.test(src);

    expect(
      coversBroad || coversExplicit,
      'vitest.config.all.js include must cover tests/use-cases/ ' +
        '(either tests/** or an explicit tests/use-cases entry)',
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC3 — CLAUDE.md documents use-case suite gate rule
// ---------------------------------------------------------------------------

describe('AC3 — CLAUDE.md: use-case suite is part of the release gate', () => {
  it('claude_md_mentions_use_case_suite_in_testing_section', () => {
    // AC3: CLAUDE.md Testing section must mention the use-case suite as part of
    // the release gate. RED: no such mention yet.
    const text = loadFile('CLAUDE.md');
    const section = sliceSection(text, '## Testing');
    expect(section, 'CLAUDE.md must contain a "## Testing" section').not.toBeNull();

    // Must name the use-case suite or tests/use-cases in the Testing section.
    expect(
      section,
      'CLAUDE.md Testing section must mention tests/use-cases or the use-case suite',
    ).toMatch(/use.case/i);
  });

  it('claude_md_testing_section_has_modify_only_when_use_case_changes_rule', () => {
    // AC3: the rule "tickets modify the suite only when a use case changes".
    // RED: CLAUDE.md does not yet carry this rule.
    const text = loadFile('CLAUDE.md');
    const section = sliceSection(text, '## Testing');
    expect(section).not.toBeNull();

    // The section must articulate the "modify only when a use case changes" rule.
    // Accept any phrasing that pairs "use case" (or "use-case") with a change
    // constraint word (change/changes/modify/modified/update/updated/alter).
    const ruleRe = /use.case[\s\S]{0,150}(change|modify|update|alter)/i;
    const ruleRe2 = /(change|modify|update|alter)[\s\S]{0,150}use.case/i;
    expect(
      ruleRe.test(section) || ruleRe2.test(section),
      'CLAUDE.md Testing section must document the "modify only when a use case changes" rule',
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC1 meta-spec — THIS repo's USE-CASES.md exists and all referenced specs exist
// ---------------------------------------------------------------------------
// This describe block is the PERMANENT SENSOR: it re-runs on every test:all
// invocation and blocks the gate if the manifest is missing or a reference rots.

describe('AC1 meta-spec — tests/use-cases/USE-CASES.md exists and referenced specs exist', () => {
  it('use_cases_manifest_exists_in_this_repo', () => {
    // AC1/AC4: the repo's own USE-CASES.md must have been authored.
    // RED: the file does not yet exist.
    const manifestFile = join(REPO_ROOT, 'tests', 'use-cases', 'USE-CASES.md');
    expect(
      existsSync(manifestFile),
      'tests/use-cases/USE-CASES.md must exist in this repo (AC4 self-application)',
    ).toBe(true);
  });

  it('use_cases_manifest_names_all_primary_flows', () => {
    // AC4: the manifest must designate all five primary flows:
    //   1. init/intake       2. ticket mint   3. workflow drive (task-store)
    //   4. session resume    5. plugin install
    // RED: file absent → test fails at read (thrown by readFileSync).
    const text = loadFile('tests/use-cases/USE-CASES.md');

    // Each flow must appear by name (case-insensitive substring match).
    const requiredFlows = [
      { label: 'init or intake', re: /\b(init|intake)\b/i },
      { label: 'ticket mint or new task', re: /\b(ticket|mint|new.task)\b/i },
      { label: 'workflow drive or task-store', re: /\b(workflow|task.store|task store)\b/i },
      { label: 'session resume or lifecycle', re: /\b(session|resume|lifecycle)\b/i },
      { label: 'plugin install or e2e-install', re: /\b(plugin|install)\b/i },
    ];

    for (const { label, re } of requiredFlows) {
      expect(
        re.test(text),
        `USE-CASES.md must name the "${label}" flow`,
      ).toBe(true);
    }
  });

  it('every_spec_path_referenced_in_manifest_exists_on_disk', () => {
    // AC1 meta-spec: every spec path listed in USE-CASES.md must exist.
    // This is the permanent sensor that prevents manifest rot.
    // RED: file absent → fails at read.
    const text = loadFile('tests/use-cases/USE-CASES.md');

    // Extract spec paths. The manifest convention is to list them as markdown
    // links or plain text. We extract anything matching the pattern:
    //   tests/... .spec.js
    // from the text (a href in [...](path) or a bare path).
    const specPathRe = /tests\/[\w\-./]+\.spec\.js/g;
    const matches = [...new Set(text.match(specPathRe) ?? [])];

    expect(
      matches.length,
      'USE-CASES.md must reference at least one spec file path',
    ).toBeGreaterThanOrEqual(1);

    for (const relPath of matches) {
      const abs = join(REPO_ROOT, relPath);
      expect(
        existsSync(abs),
        `USE-CASES.md references spec path that does not exist: ${relPath}`,
      ).toBe(true);
    }
  });
});
