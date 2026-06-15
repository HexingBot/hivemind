// tests/skill-catalog.spec.js
// TASK-053 — Fast-tier regression locks for src/skill-catalog.js.
//
// Locks:
//   1. listSkills({ repoRoot }) includes one entry per commands/*.md (real repo).
//   2. Each commands-derived entry has id, label, description from frontmatter,
//      and invocation = '/agentic-framework:<id>'.
//   3. Curated 'help' entry is always present regardless of commands/.
//   4. resolveSkillInvocation returns the invocation for a known id.
//   5. resolveSkillInvocation returns null for an unknown id.
//   6. Commands absent (no commands/ dir) → only curated entries, no throw.
//
// No process spawn, no socket — fast tier.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readdirSync } from 'node:fs';

import { REPO_ROOT } from './helpers/repoRoot.js';
import { listSkills, resolveSkillInvocation } from '../src/skill-catalog.js';

// ===========================================================================
// Discover the real commands/*.md files in the repo
// ===========================================================================
function realCommandIds() {
  const commandsDir = join(REPO_ROOT, 'commands');
  let entries;
  try {
    entries = readdirSync(commandsDir);
  } catch {
    return [];
  }
  return entries
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.replace(/\.md$/, ''))
    .sort();
}

// ===========================================================================
// Suite: listSkills with the real repo root
// ===========================================================================
describe('TASK-053 — listSkills with real repo commands/', () => {
  it('returns an array', async () => {
    const skills = await listSkills({ repoRoot: REPO_ROOT });
    expect(Array.isArray(skills)).toBe(true);
  });

  it('includes one entry per commands/*.md with correct shape', async () => {
    const commandIds = realCommandIds();
    const skills = await listSkills({ repoRoot: REPO_ROOT });
    const skillIds = skills.map((s) => s.id);

    for (const id of commandIds) {
      expect(
        skillIds,
        `skill catalog must include an entry for commands/${id}.md`,
      ).toContain(id);

      const entry = skills.find((s) => s.id === id);
      expect(entry, `entry for ${id} must exist`).toBeTruthy();
      expect(typeof entry.id, `${id}.id must be a string`).toBe('string');
      expect(typeof entry.label, `${id}.label must be a string`).toBe('string');
      expect(entry.label.length, `${id}.label must not be empty`).toBeGreaterThan(0);
      expect(typeof entry.description, `${id}.description must be a string`).toBe('string');
      expect(entry.description.length, `${id}.description must not be empty`).toBeGreaterThan(0);
      expect(
        entry.invocation,
        `${id}.invocation must be /agentic-framework:${id}`,
      ).toBe(`/agentic-framework:${id}`);
    }
  });

  it('derives invocation as /agentic-framework:<id> for each commands entry', async () => {
    const commandIds = realCommandIds();
    const skills = await listSkills({ repoRoot: REPO_ROOT });
    for (const id of commandIds) {
      const entry = skills.find((s) => s.id === id);
      if (!entry) continue;
      expect(entry.invocation).toBe(`/agentic-framework:${id}`);
    }
  });

  it('includes the curated help entry', async () => {
    const skills = await listSkills({ repoRoot: REPO_ROOT });
    const helpEntry = skills.find((s) => s.id === 'help');
    expect(helpEntry, 'curated help entry must be present').toBeTruthy();
    expect(helpEntry.label).toBe('Help');
    expect(typeof helpEntry.description).toBe('string');
    expect(helpEntry.description.length).toBeGreaterThan(0);
    // Curated entries use plain text invocations (not /agentic-framework: prefix)
    expect(typeof helpEntry.invocation).toBe('string');
    expect(helpEntry.invocation.length).toBeGreaterThan(0);
  });

  it('commands entries come before curated entries (stable order)', async () => {
    const commandIds = realCommandIds();
    if (commandIds.length === 0) return; // nothing to check without commands

    const skills = await listSkills({ repoRoot: REPO_ROOT });
    const helpIdx = skills.findIndex((s) => s.id === 'help');
    const lastCommandIdx = Math.max(
      ...commandIds.map((id) => skills.findIndex((s) => s.id === id)),
    );
    expect(
      lastCommandIdx,
      'all commands/ entries must appear before the curated help entry',
    ).toBeLessThan(helpIdx);
  });
});

// ===========================================================================
// Suite: listSkills with absent commands/ dir → only curated entries, no throw
// ===========================================================================
describe('TASK-053 — listSkills with absent commands/ dir', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'skill-catalog-spec-'));
  });

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it('does not throw when commands/ dir is absent', async () => {
    // tmpDir has no commands/ subdirectory
    await expect(listSkills({ repoRoot: tmpDir })).resolves.toBeDefined();
  });

  it('returns only curated entries when commands/ is absent', async () => {
    const skills = await listSkills({ repoRoot: tmpDir });
    const helpEntry = skills.find((s) => s.id === 'help');
    expect(helpEntry, 'curated help must still be present without commands/').toBeTruthy();
  });
});

// ===========================================================================
// Suite: resolveSkillInvocation
// ===========================================================================
describe('TASK-053 — resolveSkillInvocation', () => {
  it('returns invocation string for a known command id', async () => {
    const commandIds = realCommandIds();
    if (commandIds.length === 0) {
      // Skip if no commands (already covered by curated below)
      return;
    }
    const id = commandIds[0];
    const inv = await resolveSkillInvocation(REPO_ROOT, id);
    expect(typeof inv).toBe('string');
    expect(inv).toBe(`/agentic-framework:${id}`);
  });

  it('returns invocation string for the curated help id', async () => {
    const inv = await resolveSkillInvocation(REPO_ROOT, 'help');
    expect(typeof inv).toBe('string');
    expect(inv.length).toBeGreaterThan(0);
  });

  it('returns null for an unknown skill id', async () => {
    const result = await resolveSkillInvocation(REPO_ROOT, 'totally-unknown-skill-xyz');
    expect(result).toBeNull();
  });

  it('returns null for a null or empty id', async () => {
    expect(await resolveSkillInvocation(REPO_ROOT, null)).toBeNull();
    expect(await resolveSkillInvocation(REPO_ROOT, '')).toBeNull();
  });
});

// ===========================================================================
// Suite: fixture dir with custom commands
// ===========================================================================
describe('TASK-053 — listSkills with fixture commands/ dir', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'skill-catalog-fixture-'));
    const commandsDir = join(tmpDir, 'commands');
    mkdirSync(commandsDir, { recursive: true });
    // Create a fixture command file with frontmatter description
    writeFileSync(
      join(commandsDir, 'my-command.md'),
      '---\ndescription: A test command for fixtures\n---\n\n# /agentic-framework:my-command\n',
      'utf8',
    );
    // Create a command without frontmatter description (fallback)
    writeFileSync(
      join(commandsDir, 'bare-command.md'),
      '# /agentic-framework:bare-command\n\nNo frontmatter here.\n',
      'utf8',
    );
  });

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reads description from frontmatter for fixture command', async () => {
    const skills = await listSkills({ repoRoot: tmpDir });
    const entry = skills.find((s) => s.id === 'my-command');
    expect(entry, 'my-command entry must be present').toBeTruthy();
    expect(entry.description).toBe('A test command for fixtures');
    expect(entry.invocation).toBe('/agentic-framework:my-command');
    expect(entry.label).toBe('My Command');
  });

  it('falls back to a default description when frontmatter has no description', async () => {
    const skills = await listSkills({ repoRoot: tmpDir });
    const entry = skills.find((s) => s.id === 'bare-command');
    expect(entry, 'bare-command entry must be present').toBeTruthy();
    expect(typeof entry.description).toBe('string');
    expect(entry.description.length).toBeGreaterThan(0);
    expect(entry.invocation).toBe('/agentic-framework:bare-command');
  });

  it('resolveSkillInvocation returns correct invocation for fixture command', async () => {
    const inv = await resolveSkillInvocation(tmpDir, 'my-command');
    expect(inv).toBe('/agentic-framework:my-command');
  });

  it('resolveSkillInvocation returns null for a non-existent id in fixture dir', async () => {
    const inv = await resolveSkillInvocation(tmpDir, 'not-a-real-skill');
    expect(inv).toBeNull();
  });
});
