// tests/subagent-stop-hook-shape.spec.js
// TASK-219 AC4 regression lock — hooks/hooks.json must carry a SubagentStop
// entry that:
//   1. exists, in the canonical nested shape (no matcher — SubagentStop must
//      fire unconditionally per the ticket's AC4);
//   2. points at hooks/persist-subagent.mjs via ${CLAUDE_PLUGIN_ROOT};
//   3. leaves the two pre-existing SessionStart entries (repin.mjs,
//      settings-migrate.mjs) untouched.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from './helpers/repoRoot.js';
import { collectFormatViolations } from './helpers/hookShapeViolations.js';

const HOOKS_JSON_PATH = join(REPO_ROOT, 'hooks', 'hooks.json');
const doc = JSON.parse(readFileSync(HOOKS_JSON_PATH, 'utf8'));

describe('hooks/hooks.json SubagentStop entry (TASK-219 AC4)', () => {
  it('is still structurally valid per the canonical nested hooks shape', () => {
    expect(collectFormatViolations(doc)).toEqual([]);
  });

  it('has a SubagentStop key with exactly one entry', () => {
    expect(Array.isArray(doc.hooks.SubagentStop)).toBe(true);
    expect(doc.hooks.SubagentStop).toHaveLength(1);
  });

  it('the SubagentStop entry carries NO matcher (must fire unconditionally)', () => {
    const entry = doc.hooks.SubagentStop[0];
    expect(entry.matcher).toBeUndefined();
  });

  it('the SubagentStop entry runs hooks/persist-subagent.mjs via ${CLAUDE_PLUGIN_ROOT}', () => {
    const entry = doc.hooks.SubagentStop[0];
    expect(entry.hooks).toHaveLength(1);
    expect(entry.hooks[0].type).toBe('command');
    expect(entry.hooks[0].command).toContain('${CLAUDE_PLUGIN_ROOT}/hooks/persist-subagent.mjs');
  });

  it('leaves the two pre-existing SessionStart entries intact', () => {
    expect(Array.isArray(doc.hooks.SessionStart)).toBe(true);
    expect(doc.hooks.SessionStart).toHaveLength(2);
    const commands = doc.hooks.SessionStart.map((e) => e.hooks[0].command);
    expect(commands.some((c) => c.includes('context-monitor/repin.mjs'))).toBe(true);
    expect(commands.some((c) => c.includes('context-monitor/settings-migrate.mjs'))).toBe(true);
    for (const entry of doc.hooks.SessionStart) {
      expect(entry.matcher).toBe('startup|resume|clear|compact');
    }
  });
});
