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
import { existsSync, readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

// TASK-237 — WG-H-013: project-context.md is the ONLY file this guard's SET/byte-identity
// checks never touch, and it is exactly the live briefing every subagent is told to read
// before starting work (src/agent-generator.js's generateProjectContext).
//
// Why the SET-comparison exemption above is legitimate and stays: project-context.md is
// generated PER PROJECT, written ONLY to `.claude/agents/project-context.md`
// (PROJECT_CONTEXT_REL in src/agent-generator.js) — no template or copy is ever shipped at
// the plugin-root `agents/`. So its being present on the .claude/ side and absent on the
// plugin-root side is the correct, universal, every-consumer-project state, not drift; folding
// it into the mandatory file-SET equality check above would make the guard permanently red on
// every real project.
//
// What was actually missing: nothing stopped a SECOND copy from being created at the
// plugin-root side with DIFFERENT content — the 2026-09-16 wargaming attack (WG-H-013) did
// exactly that (`agents/project-context.md` saying wargaming is optional while
// `.claude/agents/project-context.md` said it blocks the close) and every parity spec, this one
// included, stayed green. The check below closes that hole without fighting the legitimate
// one-sided case above: it only fires when BOTH copies exist, in which case they describe the
// SAME project and must never be allowed to silently disagree.
const DEV_PROJECT_CONTEXT = join(DEV_AGENTS_DIR, 'project-context.md');
const PLUGIN_PROJECT_CONTEXT = join(PLUGIN_AGENTS_DIR, 'project-context.md');

// TASK-237 MEDIUM-1: root-parameterized so the comparison logic itself can be exercised (and
// planted RED) against a disposable sandbox, independent of whether the CURRENT repo happens to
// have a plugin-root project-context.md to compare against. Before this extraction the real
// assertion below was vacuous in this tree (neither copy exists yet) and nothing else exercised
// the comparison, so the red-green plant that landed it was only ever a /tmp reproduction of
// `Buffer.equals`, never the spec itself going red.
//
// Returns `{ compared: false }` when either side lacks project-context.md (the common, legitimate
// one-sided case — nothing to compare). Returns `{ compared: true, identical }` when both exist.
function compareProjectContext(devAgentsDir, pluginAgentsDir) {
  const devPath = join(devAgentsDir, 'project-context.md');
  const pluginPath = join(pluginAgentsDir, 'project-context.md');
  if (!existsSync(devPath) || !existsSync(pluginPath)) return { compared: false };
  const devBytes = readFileSync(devPath);
  const pluginBytes = readFileSync(pluginPath);
  return { compared: true, identical: pluginBytes.equals(devBytes) };
}

describe('WG-H-013 — project-context.md is not silently exempt from coherence', () => {
  it('when project-context.md exists on both sides, the two copies must not contradict each other', () => {
    const result = compareProjectContext(DEV_AGENTS_DIR, PLUGIN_AGENTS_DIR);
    // The common, legitimate case (see comment above): only .claude/agents/project-context.md
    // exists, plugin-root has none. Nothing to compare — that is correct, not a gap.
    if (!result.compared) return;

    // Harm this prevents: two contradictory project briefings governing every subagent (one
    // saying wargaming is optional, the other saying it blocks the close) coexisting with a
    // green suite — the exact WG-H-013 reproduction.
    expect(
      result.identical,
      'agents/project-context.md must be byte-identical to .claude/agents/project-context.md ' +
      'when both exist — a plugin-root copy is never generated by tooling, so its mere presence ' +
      'alongside a diverging .claude copy is already the WG-H-013 attack shape',
    ).toBe(true);
  });

  // TASK-237 MEDIUM-1: exercises the SAME `compareProjectContext` helper the real check above
  // uses, against a disposable sandbox pair, so this behavior is verified regardless of whether
  // the live repo currently has a plugin-root project-context.md to compare. This is what makes
  // the WG-H-013 lock plantable RED again: flip `identical` to `true` in the assertion below (or
  // make the two fixture files match) and this test fails for the right reason.
  it('helper: detects two diverging project-context.md copies (plantable independent of repo state)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'agents-parity-wgh013-'));
    try {
      const devDir = join(tmp, 'dev-agents');
      const pluginDir = join(tmp, 'plugin-agents');
      mkdirSync(devDir);
      mkdirSync(pluginDir);
      writeFileSync(join(devDir, 'project-context.md'), 'Wargaming BLOCKS the close.\n');
      writeFileSync(join(pluginDir, 'project-context.md'), 'Wargaming is optional.\n');

      // Harm this prevents: the exact WG-H-013 attack shape (two contradictory project briefings
      // governing every subagent) going undetected because the comparison was never exercised —
      // this sandbox proves the comparison logic itself catches the divergence, independent of
      // whether the current tree happens to have a plugin-root copy at all.
      const result = compareProjectContext(devDir, pluginDir);
      expect(result.compared).toBe(true);
      expect(result.identical).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  // TASK-237 MEDIUM-2: the SET/byte-identity checks below never touch project-context.md (by
  // design — see the comment above), which means a LONE plugin-root copy (no .claude copy at
  // all) previously passed both the exemption above (nothing to compare) AND the SET check
  // (which excludes this file), shipping an unreviewed briefing to every consumer with a fully
  // green framework suite. This closes that hole directly.
  it('a plugin-root project-context.md must never exist without a .claude/agents copy alongside it', () => {
    // Harm this prevents: a plugin-root-only project-context.md — never generated by tooling,
    // never reviewed as a dev-source briefing — shipping to every consumer install while every
    // other check in this file stays green (both the divergence check above and the SET check
    // below are exempt from this file by design).
    expect(
      !existsSync(PLUGIN_PROJECT_CONTEXT) || existsSync(DEV_PROJECT_CONTEXT),
      'agents/project-context.md must not exist unless .claude/agents/project-context.md also ' +
      'exists — a lone plugin-root copy is never generated by tooling and is the WG-H-013 attack ' +
      'shape the SET/byte-identity checks below are exempt from by design',
    ).toBe(true);
  });
});

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
