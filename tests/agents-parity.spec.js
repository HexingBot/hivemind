// tests/agents-parity.spec.js
// TASK-021 — drift guard for the "keep both" agent relocation strategy (AC5).
//
// Locked decision (human, recorded in the ticket): the framework is BOTH its own
// dev environment and the plugin source. We do NOT delete `.claude/agents/`
// (the live dev source of truth this very session spawns subagents from);
// instead the plugin ships byte-identical COPIES at the plugin-root `agents/`.
// This spec FAILS whenever the two directories diverge — either the *set* of
// agent files differs, or any pair of same-named files is not byte-identical.
//
// TASK-032 — orchestrator.md removed: the Orchestrator is the main session
// thread, not a spawnable subagent. The agent-file set was three files:
// developer, researcher, reviewer. Coverage preserved — the parity guard still
// enforces byte-identical copies between .claude/agents/ and plugin-root agents/
// for every specialist subagent.
//
// TASK-144 — security-reviewer.md added: a first-class, read-only subagent
// spawned by hivemind-assimilate-skill Step 4 to judge a fetched third-party
// skill's *instruction text* for prompt-injection / secret-exfiltration /
// guardrail-disable / user-impersonation risk (see that file's own header). A
// new agent must be COVERED by this drift guard, not exempt from it — the set
// is now four files.
//
// AC map (TASK-021):
//   AC5 — keep-both + drift-guard: `.claude/agents/` stays; plugin-root
//         `agents/` holds byte-identical copies; this test fails on divergence;
//         `.claude/agents/` is NOT deleted.

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from './helpers/repoRoot.js';

// The repo-local specialist subagents. The Orchestrator is the main session
// thread (TASK-032) and no longer ships as an agent file. The global
// gsd-*/vue/etc. skills/agents are NOT repo-local and are intentionally out of
// scope here.
const AGENT_FILES = ['developer.md', 'researcher.md', 'reviewer.md', 'security-reviewer.md'];

const DEV_AGENTS_DIR = join(REPO_ROOT, '.claude', 'agents');
const PLUGIN_AGENTS_DIR = join(REPO_ROOT, 'agents');

/** List only the *.md agent files in a dir (ignore project-context.md and dirs). */
function listAgentMd(dir) {
  if (!existsSync(dir)) return null;
  return readdirSync(dir)
    .filter((n) => n.endsWith('.md') && n !== 'project-context.md')
    .sort();
}

describe('AC5 — .claude/agents stays as the live dev source of truth', () => {
  it('dev_agents_dir_still_holds_exactly_the_specialist_agents', () => {
    // Safety guard: the relocation must NOT delete the dev source. This passes
    // today and must keep passing after the impl lands. The Orchestrator is the
    // main thread (TASK-032) so only the specialist agents remain (TASK-144:
    // developer, researcher, reviewer, security-reviewer).
    const entries = listAgentMd(DEV_AGENTS_DIR);
    expect(entries, '.claude/agents/ must still exist').not.toBeNull();
    expect(entries).toEqual([...AGENT_FILES].sort());
  });
});

describe('AC5 — plugin-root agents/ mirrors .claude/agents/ (drift guard)', () => {
  it('plugin_agents_dir_exists_with_the_same_file_set', () => {
    const devSet = listAgentMd(DEV_AGENTS_DIR);
    const pluginSet = listAgentMd(PLUGIN_AGENTS_DIR);

    expect(pluginSet, 'plugin-root agents/ must exist').not.toBeNull();
    // Identical SET of agent files (drift on the file set fails the build).
    expect(pluginSet).toEqual(devSet);
    expect(pluginSet).toEqual([...AGENT_FILES].sort());
  });

  it('each_agent_pair_is_byte_identical', () => {
    expect(existsSync(PLUGIN_AGENTS_DIR), 'plugin-root agents/ must exist').toBe(true);
    for (const name of AGENT_FILES) {
      const devPath = join(DEV_AGENTS_DIR, name);
      const pluginPath = join(PLUGIN_AGENTS_DIR, name);

      expect(existsSync(devPath), `.claude/agents/${name} must exist`).toBe(true);
      expect(existsSync(pluginPath), `agents/${name} must exist`).toBe(true);

      const devBytes = readFileSync(devPath);
      const pluginBytes = readFileSync(pluginPath);
      // Byte-identical: differing contents fail the drift guard.
      expect(
        pluginBytes.equals(devBytes),
        `agents/${name} must be byte-identical to .claude/agents/${name}`,
      ).toBe(true);
    }
  });
});
