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
// Fix round (REQUEST-CHANGES) — HIGH-3: the ORIGINAL manual command,
// `node ${CLAUDE_PLUGIN_ROOT}/context-monitor/repin.mjs`, fails with
// "Cannot find module" when run in a plain shell — CLAUDE_PLUGIN_ROOT is only
// set when Claude Code itself spawns a plugin hook, never in a user's own
// shell (confirmed empirically: `env | grep -i claude` in a plain Bash tool
// shell does not list it). The doc now resolves the real install path from
// ~/.claude/plugins/installed_plugins.json first. This lock guards that the
// doc gives a RESOLVABLE command, not the broken one, as ITS instruction (the
// broken form may still appear in the doc's own explanation of why it's
// broken — the lock below checks for the working replacement, not for the
// absence of the broken string).
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

  it('warns that CLAUDE_PLUGIN_ROOT is unset in a plain shell (why the naive command fails)', () => {
    expect(content).toMatch(/CLAUDE_PLUGIN_ROOT.*(?:is not set|not set|is only set).*(?:shell|hook)/is);
  });

  it('gives a RESOLVABLE manual force-it-now command (installed_plugins.json + node "<installPath>/context-monitor/repin.mjs"), not just the broken ${CLAUDE_PLUGIN_ROOT} form', () => {
    expect(content).toMatch(/installed_plugins\.json/);
    expect(content).toMatch(/node "<installPath>\/context-monitor\/repin\.mjs"/);
  });

  it('still tells the user they do not need to re-run init-project, with the reasoning attached', () => {
    expect(content).toMatch(/do not need to re-run `\/hivemind:init-project`/);
    // The reasoning must now be present alongside the claim (this is the
    // "misleading" part the ticket calls out — the claim alone, with no
    // explanation of what DOES fix stale settings.json paths, is what regressed).
    expect(content).toMatch(/init-project.*would do far more|far more than either of those need/is);
  });
});
