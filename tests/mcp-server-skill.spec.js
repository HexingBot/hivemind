// tests/mcp-server-skill.spec.js
// TASK-026 — Plugin chain P6: the `mcp-server` training skill ships in BOTH
// locations, byte-identical (the established skills-parity mirror pattern).
//
// The researcher authored the mcp-server skill for this ticket and placed it in
// BOTH skills/mcp-server/ (plugin root) and .claude/skills/mcp-server/ (live
// dev), with byte-identical SKILL.md (mirroring tech-training-template and the
// TASK-025 orchestrator-routing backstop). This spec is the drift-guard,
// mirroring tests/orchestrator-routing-skill.spec.js's parity assertion.
//
// UNLIKE the other TASK-026 specs, this one PASSES NOW: both skill copies already
// exist on disk (the researcher committed them). It is a REGRESSION LOCK — it
// fails only if a future change lets the two copies drift, or deletes one.

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from './helpers/repoRoot.js';

const SKILL_REL = join('mcp-server', 'SKILL.md');
const PLUGIN_SKILL = join(REPO_ROOT, 'skills', SKILL_REL);
const DEV_SKILL = join(REPO_ROOT, '.claude', 'skills', SKILL_REL);

const REFERENCES_REL = join('mcp-server', 'references');
const PLUGIN_REFERENCES_DIR = join(REPO_ROOT, 'skills', REFERENCES_REL);
const DEV_REFERENCES_DIR = join(REPO_ROOT, '.claude', 'skills', REFERENCES_REL);

/** Parse the frontmatter block (text between the first two `---` fences). */
function frontmatterOf(mdText) {
  const m = mdText.match(/^---\s*\n([\s\S]*?)\n---\s*(\n|$)/);
  return m ? m[1] : '';
}

describe('TASK-026 — mcp-server skill ships at the plugin root', () => {
  it('plugin_skill_file_exists', () => {
    expect(
      existsSync(PLUGIN_SKILL),
      'skills/mcp-server/SKILL.md must exist (the plugin-root copy)',
    ).toBe(true);
  });

  it('skill_opens_with_frontmatter_carrying_name_and_description', () => {
    expect(existsSync(PLUGIN_SKILL)).toBe(true);
    const fm = frontmatterOf(readFileSync(PLUGIN_SKILL, 'utf8'));
    expect(fm.length, 'skill must open with a --- frontmatter block').toBeGreaterThan(0);
    expect(/^name:\s*mcp-server\b/m.test(fm), 'frontmatter name: must be mcp-server').toBe(true);
    expect(
      /^description:\s*\S+/m.test(fm),
      'frontmatter must carry a non-empty description:',
    ).toBe(true);
  });
});

describe('TASK-026 — mcp-server skill is mirrored into .claude/skills (parity)', () => {
  it('dev_copy_exists', () => {
    expect(
      existsSync(DEV_SKILL),
      '.claude/skills/mcp-server/SKILL.md must mirror the plugin copy',
    ).toBe(true);
  });

  it('plugin_and_dev_skill_md_are_byte_identical', () => {
    expect(existsSync(PLUGIN_SKILL), 'plugin skill must exist').toBe(true);
    expect(existsSync(DEV_SKILL), 'dev skill must exist').toBe(true);
    const pluginBytes = readFileSync(PLUGIN_SKILL);
    const devBytes = readFileSync(DEV_SKILL);
    expect(
      pluginBytes.equals(devBytes),
      'skills/mcp-server/SKILL.md must be byte-identical to the .claude/skills copy',
    ).toBe(true);
  });
});

// TASK-093 — the SKILL.md-only sensor above left skills/mcp-server/references/
// (tool-contract.md, esbuild-and-mcp-json.md, in-memory-test-harness.md) drift
// only manually checked. This extends the same parity guarantee to every file
// under references/, deriving the file list from a directory listing (rather
// than hardcoding names) so a future reference file added to either side is
// automatically covered without touching this spec.
describe('TASK-093 — mcp-server references/ files are mirrored in parity', () => {
  it('both_references_dirs_exist', () => {
    expect(
      existsSync(PLUGIN_REFERENCES_DIR),
      'skills/mcp-server/references/ must exist',
    ).toBe(true);
    expect(
      existsSync(DEV_REFERENCES_DIR),
      '.claude/skills/mcp-server/references/ must exist',
    ).toBe(true);
  });

  it('both_sides_list_the_same_set_of_reference_files', () => {
    const pluginFiles = readdirSync(PLUGIN_REFERENCES_DIR).sort();
    const devFiles = readdirSync(DEV_REFERENCES_DIR).sort();
    expect(
      devFiles,
      '.claude/skills/mcp-server/references/ must list the same files as the plugin copy',
    ).toEqual(pluginFiles);
  });

  it('every_reference_file_is_byte_identical_between_copies', () => {
    const files = readdirSync(PLUGIN_REFERENCES_DIR);
    for (const file of files) {
      const pluginPath = join(PLUGIN_REFERENCES_DIR, file);
      const devPath = join(DEV_REFERENCES_DIR, file);
      expect(existsSync(devPath), `.claude copy of references/${file} must exist`).toBe(true);
      const pluginBytes = readFileSync(pluginPath);
      const devBytes = readFileSync(devPath);
      expect(
        pluginBytes.equals(devBytes),
        `skills/mcp-server/references/${file} must be byte-identical to the .claude/skills copy`,
      ).toBe(true);
    }
  });
});

// TASK-107 (N2) — ground-truth doc-lock: tool-contract.md's "Result shaping"
// section previously said BOTH `list_todos` and `list_ready` wrap
// `listTodos({ repoRoot })`, but src/mcp-server.js's `list_ready` tool handler
// actually wraps `listReady({ repoRoot })` (see src/mcp-server.js's
// `server.registerTool('list_ready', ..., async () => ok(await
// listReady({ repoRoot })))`). This is a doc-drift regression lock (not just
// byte-parity — parity alone would happily keep both copies wrong together):
// it fails if either copy regresses back to claiming list_ready wraps
// listTodos, independent of whether the two copies still match each other.
describe('TASK-107 (N2) — tool-contract.md list_ready ground truth', () => {
  const TOOL_CONTRACT_REL = join(REFERENCES_REL, 'tool-contract.md');
  const PLUGIN_TOOL_CONTRACT = join(REPO_ROOT, 'skills', TOOL_CONTRACT_REL);
  const DEV_TOOL_CONTRACT = join(REPO_ROOT, '.claude', 'skills', TOOL_CONTRACT_REL);

  it.each([
    ['plugin-root copy', PLUGIN_TOOL_CONTRACT],
    ['.claude parity copy', DEV_TOOL_CONTRACT],
  ])('%s documents list_ready as wrapping listReady, not listTodos', (_label, path) => {
    const text = readFileSync(path, 'utf8');
    expect(
      /list_ready.*→.*ok\(await listReady\(\{ repoRoot \}\)\)/.test(text),
      `${path} must document list_ready as wrapping listReady({ repoRoot }) `
      + '(ground truth: src/mcp-server.js registers list_ready against listReady)',
    ).toBe(true);
    expect(
      /list_todos \/ list_ready.*→.*listTodos/.test(text),
      `${path} must NOT claim list_ready wraps listTodos (stale doc drift)`,
    ).toBe(false);
  });
});
