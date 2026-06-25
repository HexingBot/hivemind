// tests/skill-catalog.spec.js
// TASK-053 — Fast-tier regression locks for src/skill-catalog.js.
//
// Updated for review fix: commands/*.md are now OPT-IN (panel_safe: true).
// The real repo commands (init-project, apply-workflows, task-status) have no
// panel_safe flag and must NOT appear. A fixture command with panel_safe: true
// MUST appear. The 4 curated entries are always present. De-dup by id covered.
//
// No process spawn, no socket — fast tier.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { REPO_ROOT } from './helpers/repoRoot.js';
import { listSkills, resolveSkillInvocation } from '../src/skill-catalog.js';

// ===========================================================================
// Suite: real repo commands are EXCLUDED (no panel_safe: true in any of them)
// ===========================================================================
describe('TASK-053 — real commands/*.md without panel_safe are excluded', () => {
  it('init-project is NOT in the skill catalog', async () => {
    const skills = await listSkills({ repoRoot: REPO_ROOT });
    const ids = skills.map((s) => s.id);
    expect(
      ids,
      'init-project must not appear — it lacks panel_safe: true',
    ).not.toContain('init-project');
  });

  it('task-status is NOT in the skill catalog', async () => {
    const skills = await listSkills({ repoRoot: REPO_ROOT });
    const ids = skills.map((s) => s.id);
    expect(
      ids,
      'task-status must not appear — it lacks panel_safe: true',
    ).not.toContain('task-status');
  });

  it('apply-workflows is NOT in the skill catalog', async () => {
    const skills = await listSkills({ repoRoot: REPO_ROOT });
    const ids = skills.map((s) => s.id);
    expect(
      ids,
      'apply-workflows must not appear — it lacks panel_safe: true',
    ).not.toContain('apply-workflows');
  });
});

// ===========================================================================
// Suite: the 4 curated entries are always present
// ===========================================================================
describe('TASK-053 — curated safe-actions are always present', () => {
  const CURATED_IDS = ['help', 'status', 'next', 'new-task'];

  for (const id of CURATED_IDS) {
    it(`curated '${id}' entry is present`, async () => {
      const skills = await listSkills({ repoRoot: REPO_ROOT });
      const entry = skills.find((s) => s.id === id);
      expect(entry, `curated '${id}' must be present`).toBeTruthy();
      expect(typeof entry.label).toBe('string');
      expect(entry.label.length).toBeGreaterThan(0);
      expect(typeof entry.description).toBe('string');
      expect(entry.description.length).toBeGreaterThan(0);
      expect(typeof entry.invocation).toBe('string');
      expect(entry.invocation.length).toBeGreaterThan(0);
    });
  }

  it('returns an array', async () => {
    const skills = await listSkills({ repoRoot: REPO_ROOT });
    expect(Array.isArray(skills)).toBe(true);
    expect(skills.length).toBeGreaterThanOrEqual(CURATED_IDS.length);
  });
});

// ===========================================================================
// Suite: opt-in command (panel_safe: true in fixture) DOES appear
// ===========================================================================
describe('TASK-053 — command with panel_safe: true appears in catalog', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'skill-catalog-opt-in-'));
    const commandsDir = join(tmpDir, 'commands');
    mkdirSync(commandsDir, { recursive: true });
    // Opt-in command: has panel_safe: true
    writeFileSync(
      join(commandsDir, 'safe-cmd.md'),
      '---\ndescription: A safe panel command\npanel_safe: true\n---\n\n# /hivemind:safe-cmd\n',
      'utf8',
    );
    // Non-opt-in command: no panel_safe → must be excluded
    writeFileSync(
      join(commandsDir, 'unsafe-cmd.md'),
      '---\ndescription: Not panel safe\n---\n\n# /hivemind:unsafe-cmd\n',
      'utf8',
    );
  });

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it('command with panel_safe: true appears in listSkills', async () => {
    const skills = await listSkills({ repoRoot: tmpDir });
    const entry = skills.find((s) => s.id === 'safe-cmd');
    expect(entry, 'safe-cmd must appear (panel_safe: true)').toBeTruthy();
    expect(entry.description).toBe('A safe panel command');
    expect(entry.invocation).toBe('/hivemind:safe-cmd');
    expect(entry.label).toBe('Safe Cmd');
  });

  it('command WITHOUT panel_safe is excluded from listSkills', async () => {
    const skills = await listSkills({ repoRoot: tmpDir });
    const ids = skills.map((s) => s.id);
    expect(
      ids,
      'unsafe-cmd must not appear — no panel_safe: true',
    ).not.toContain('unsafe-cmd');
  });

  it('opt-in command appears before curated entries', async () => {
    const skills = await listSkills({ repoRoot: tmpDir });
    const safeCmdIdx = skills.findIndex((s) => s.id === 'safe-cmd');
    const helpIdx = skills.findIndex((s) => s.id === 'help');
    expect(safeCmdIdx, 'opt-in command must come before curated entries').toBeLessThan(helpIdx);
  });
});

// ===========================================================================
// Suite: absent commands/ → only curated, no throw
// ===========================================================================
describe('TASK-053 — absent commands/ dir yields only curated entries', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'skill-catalog-absent-'));
  });

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it('does not throw when commands/ is absent', async () => {
    await expect(listSkills({ repoRoot: tmpDir })).resolves.toBeDefined();
  });

  it('still returns curated help when commands/ is absent', async () => {
    const skills = await listSkills({ repoRoot: tmpDir });
    expect(skills.find((s) => s.id === 'help')).toBeTruthy();
  });
});

// ===========================================================================
// Suite: de-dup — curated wins if a panel_safe command shares an id
// ===========================================================================
describe('TASK-053 — de-dup: curated id wins over commands/-derived id', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'skill-catalog-dedup-'));
    const commandsDir = join(tmpDir, 'commands');
    mkdirSync(commandsDir, { recursive: true });
    // A command with panel_safe: true but an id that clashes with a curated id.
    writeFileSync(
      join(commandsDir, 'help.md'),
      '---\ndescription: A conflicting help command\npanel_safe: true\n---\n',
      'utf8',
    );
  });

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it('only one entry for the clashing id (no duplicate)', async () => {
    const skills = await listSkills({ repoRoot: tmpDir });
    const helpEntries = skills.filter((s) => s.id === 'help');
    expect(helpEntries.length, 'must have exactly one help entry').toBe(1);
  });

  it('curated entry wins over the commands/-derived entry', async () => {
    const skills = await listSkills({ repoRoot: tmpDir });
    const helpEntry = skills.find((s) => s.id === 'help');
    // The curated invocation is a plain-English prompt; the command's would be
    // /hivemind:help. Curated wins → invocation must NOT be /hivemind:help.
    expect(helpEntry.invocation).not.toBe('/hivemind:help');
  });
});

// ===========================================================================
// Suite: resolveSkillInvocation
// ===========================================================================
describe('TASK-053 — resolveSkillInvocation', () => {
  it('returns invocation for the curated help id', async () => {
    const inv = await resolveSkillInvocation(REPO_ROOT, 'help');
    expect(typeof inv).toBe('string');
    expect(inv.length).toBeGreaterThan(0);
  });

  it('returns invocation for the curated status id', async () => {
    const inv = await resolveSkillInvocation(REPO_ROOT, 'status');
    expect(typeof inv).toBe('string');
    expect(inv.length).toBeGreaterThan(0);
  });

  it('returns null for an unknown skill id', async () => {
    expect(await resolveSkillInvocation(REPO_ROOT, 'totally-unknown-skill-xyz')).toBeNull();
  });

  it('returns null for a real command id that lacks panel_safe', async () => {
    // init-project exists on disk but must not be resolvable (not in catalog).
    expect(await resolveSkillInvocation(REPO_ROOT, 'init-project')).toBeNull();
  });

  it('returns null for null or empty id', async () => {
    expect(await resolveSkillInvocation(REPO_ROOT, null)).toBeNull();
    expect(await resolveSkillInvocation(REPO_ROOT, '')).toBeNull();
  });
});
