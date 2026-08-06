// tests/update-md-repin-doc-lock.spec.js
// TASK-209 AC3/AC7 — commands/update.md previously left the post-update
// procedure silent on stale context-monitor paths (statusline/hook commands
// pointing at a plugin version directory removed by /plugin update), and
// told the user "you do not need to re-run init-project" with no mention of
// what DOES fix it. This lock guards the corrected content: the doc must
// name the self-heal mechanism (repin.mjs) and the manual force-it-now
// command, so a future edit can't silently drop the fix back to the
// misleading state.
//
// commands/ has no dev-repo/plugin-root parity split (unlike agents/skills —
// confirmed: no .claude/commands/ directory exists), so there is exactly one
// copy to lock, not two.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from './helpers/repoRoot.js';

const UPDATE_MD_PATH = join(REPO_ROOT, 'commands', 'update.md');
const content = readFileSync(UPDATE_MD_PATH, 'utf8');

describe('commands/update.md documents the context-monitor self-heal path (TASK-209)', () => {
  it('there is no .claude/commands/ parity copy to keep in sync', () => {
    expect(existsSync(join(REPO_ROOT, '.claude', 'commands', 'update.md'))).toBe(false);
  });

  it('names the self-heal mechanism (repin.mjs)', () => {
    expect(content).toMatch(/repin\.mjs/);
  });

  it('explains why the path goes stale (CLAUDE_PLUGIN_ROOT is not expanded in project settings.json)', () => {
    expect(content).toMatch(/not.*expanded.*settings\.json|settings\.json.*not.*expanded/is);
  });

  it('gives the manual force-it-now command', () => {
    expect(content).toMatch(/node \$\{CLAUDE_PLUGIN_ROOT\}\/context-monitor\/repin\.mjs/);
  });

  it('still tells the user they do not need to re-run init-project, with the reasoning attached', () => {
    expect(content).toMatch(/do not need to re-run `\/hivemind:init-project`/);
    // The reasoning must now be present alongside the claim (this is the
    // "misleading" part the ticket calls out — the claim alone, with no
    // explanation of what DOES fix stale settings.json paths, is what regressed).
    expect(content).toMatch(/init-project.*would do far more|far more than either of those need/is);
  });
});
