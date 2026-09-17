// tests/mirror-pairs-discovery.spec.js
// TASK-237 — WG-H-014/CU5: mirror pairs outside the hand-maintained lock lists were free to
// diverge with a green suite, because nothing INVENTORIED the pair set itself — coverage
// depended entirely on someone remembering to add a new pair to a list (agents-parity.spec.js,
// manifest-skills.spec.js, graphify-skill.spec.js, mcp-server-skill.spec.js,
// orchestrator-routing-skill.spec.js, watch-skill-parity.spec.js each hand-list their own
// pair(s)). The 2026-09-16 wargaming demonstrated this concretely by injecting a rule into
// `.claude/skills/hive-adversarial-improve/SKILL.md` that contradicts CLAUDE.md directly — no
// parity guard and no fast-tier spec noticed.
//
// This sensor walks skills/ vs .claude/skills/ and workflows/ vs .claude/workflows/ BY
// DISCOVERY (readdirSync, not a hardcoded catalog), so:
//   1. any same-named skill dir / workflow file present on BOTH sides is byte-compared HERE,
//      whether or not a dedicated spec already exists for it — redundant coverage for an
//      already-locked pair (e.g. orchestrator-routing) is accepted; the property that matters
//      is that no same-named pair can ever be silently unlocked again by deleting/weakening its
//      dedicated spec, since this one re-derives the pair set fresh from disk every run.
//   2. any dir present on only ONE side must be named in the documented one-sided allowlist
//      below (the TASK-152/153/154 framework-only vs -current-project split — see CLAUDE.md's
//      "Framework-only vs current-project skill variants"), or the test fails naming exactly
//      what showed up unaccounted for. An asymmetric pair can no longer pass by silence, only
//      by an explicit, written decision.
//
// Scope: skills/ and workflows/ are the two plugin-root directory categories that ship a live
// dev mirror under .claude/. agents/ already has its own discovery-shaped guard
// (tests/agents-parity.spec.js's SET comparison). commands/ and hooks/ have no .claude/
// counterpart at all — not a pair, out of scope (see this ticket's PEDIDO, bloque 7).

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from './helpers/repoRoot.js';

/** Sorted immediate subdirectory names of `dir` (skills/-shaped: one dir per skill). */
function listSubdirs(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => statSync(join(dir, n)).isDirectory()).sort();
}

/** Sorted immediate files of `dir` matching `ext` (workflows/-shaped: flat file list). */
function listFiles(dir, ext) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => n.endsWith(ext) && statSync(join(dir, n)).isFile()).sort();
}

// TASK-237 MEDIUM-3: recurse the FULL pair directory (references/, scripts/, any nested file),
// not just SKILL.md. Discovery was previously SKILL.md-only, so a new pair's non-SKILL.md content
// (references/, scripts/) had no discovery-based coverage — only a hand-written dedicated spec
// (today, `mcp-server` and `watch` are the two pairs with such content) caught drift there, which
// is exactly the "remember to register it" gap this whole file exists to close.
/** Sorted list of file paths, relative to `dir`, for every file found anywhere under `dir`. */
function listFilesRecursive(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  const walk = (current, prefix) => {
    for (const name of readdirSync(current).sort()) {
      const full = join(current, name);
      const rel = prefix ? join(prefix, name) : name;
      if (statSync(full).isDirectory()) {
        walk(full, rel);
      } else {
        out.push(rel);
      }
    }
  };
  walk(dir, '');
  return out.sort();
}

// One-sided by design (TASK-152/153/154) — a skill living ONLY here is a written decision,
// not a gap. Adding a genuinely new one-sided skill means adding it here WITH a reason, or
// giving it a mirror; this test fails on anything left off both.
const FRAMEWORK_ONLY_SKILLS = new Set([
  'claude-headless', // framework dev tooling, not shipped to consumers
  'gh-cli-issue-reporting', // framework dev tooling, not shipped to consumers
  'hive-adversarial-improve', // operates on the hivemind repo itself; -current-project ships instead
  'hive-self-improve', // operates on the hivemind repo itself; -current-project ships instead
  'hivemind-assimilate-skill', // vendors INTO the framework; assimilate-current-project ships instead
  'ui-ux-pro-max', // framework dev tooling, not shipped to consumers
]);
const CONSUMER_ONLY_SKILLS = new Set([
  'assimilate-current-project', // consumer entry point; framework variant is hivemind-assimilate-skill
  'claude-code-context-monitor', // consumer-facing; no framework-repo dogfood copy
  'hive-adversarial-improve-current-project', // consumer entry point; framework variant is hive-adversarial-improve
  'hive-self-improve-current-project', // consumer entry point; framework variant is hive-self-improve
]);

const PLUGIN_SKILLS_DIR = join(REPO_ROOT, 'skills');
const DEV_SKILLS_DIR = join(REPO_ROOT, '.claude', 'skills');
const PLUGIN_WORKFLOWS_DIR = join(REPO_ROOT, 'workflows');
const DEV_WORKFLOWS_DIR = join(REPO_ROOT, '.claude', 'workflows');

describe('WG-H-014/CU5 — skill mirror pairs are discovered, not hand-listed', () => {
  const pluginNames = listSubdirs(PLUGIN_SKILLS_DIR);
  const devNames = listSubdirs(DEV_SKILLS_DIR);
  const sharedNames = pluginNames.filter((n) => devNames.includes(n));

  it('every same-named skill dir found in BOTH roots is byte-identical THROUGHOUT (SKILL.md, references/, scripts/, any nested file — TASK-237 MEDIUM-3)', () => {
    // Sanity: this loop must actually exercise at least one pair, or the assertion below is
    // vacuously true forever (e.g. if skills/ or .claude/skills/ went missing/empty).
    expect(sharedNames.length, 'at least one same-named skill dir must exist in both roots').toBeGreaterThan(0);
    for (const name of sharedNames) {
      const pluginDir = join(PLUGIN_SKILLS_DIR, name);
      const devDir = join(DEV_SKILLS_DIR, name);
      const pluginFiles = listFilesRecursive(pluginDir);
      const devFiles = listFilesRecursive(devDir);
      // TASK-237 LOW-2: a mismatched file SET used to be silently skipped file-by-file (`continue`
      // when one side was missing SKILL.md) rather than failing loudly. Harm this prevents: a
      // registered pair whose dev side quietly drops (or gains) a file — e.g. a references/ doc,
      // or a scripts/ helper — passing this discovery-based guard in total silence.
      expect(
        pluginFiles,
        `skills/${name} and .claude/skills/${name} must carry the exact same file set ` +
        '(discovered recursively — a missing/extra file on either side must fail loudly, not be skipped)',
      ).toEqual(devFiles);
      for (const rel of pluginFiles) {
        const pluginBytes = readFileSync(join(pluginDir, rel));
        const devBytes = readFileSync(join(devDir, rel));
        expect(
          pluginBytes.equals(devBytes),
          `skills/${name}/${rel} must be byte-identical to .claude/skills/${name}/${rel} ` +
          '(discovered same-name pair, full recursive compare — WG-H-014: an edited-one-side-only ' +
          'skill, like hive-adversarial-improve diverging from its dogfood copy, is exactly what ' +
          'a SKILL.md-only guard misses for any references/ or scripts/ content)',
        ).toBe(true);
      }
    }
  });

  it('every one-sided skill dir is named in the documented framework-only/consumer-only allowlist', () => {
    const pluginOnly = pluginNames.filter((n) => !devNames.includes(n));
    const devOnly = devNames.filter((n) => !pluginNames.includes(n));
    const unaccountedPluginOnly = pluginOnly.filter((n) => !CONSUMER_ONLY_SKILLS.has(n));
    const unaccountedDevOnly = devOnly.filter((n) => !FRAMEWORK_ONLY_SKILLS.has(n));
    // Harm this prevents: a genuinely new one-sided skill (added to only one tree by mistake,
    // or added deliberately but never recorded) passing the suite in total silence — CU5's
    // "its absence from the lock is reported, not undetected".
    expect(
      unaccountedPluginOnly,
      'skills/ dir(s) with no .claude/skills/ mirror and no entry in CONSUMER_ONLY_SKILLS — ' +
      'add it to that allowlist with a reason, or give it a mirror',
    ).toEqual([]);
    expect(
      unaccountedDevOnly,
      '.claude/skills/ dir(s) with no skills/ mirror and no entry in FRAMEWORK_ONLY_SKILLS — ' +
      'add it to that allowlist with a reason, or give it a mirror',
    ).toEqual([]);
  });
});

describe('WG-H-014 — workflows/ mirrors .claude/workflows/ (previously unlocked pair)', () => {
  it('every workflow file present in both roots is byte-identical', () => {
    const pluginFiles = listFiles(PLUGIN_WORKFLOWS_DIR, '.js');
    const devFiles = listFiles(DEV_WORKFLOWS_DIR, '.js');
    expect(pluginFiles, 'workflows/ must exist with at least one .js file').not.toEqual([]);
    expect(devFiles, '.claude/workflows/ must carry the same file set as workflows/').toEqual(pluginFiles);
    for (const name of pluginFiles) {
      const pluginBytes = readFileSync(join(PLUGIN_WORKFLOWS_DIR, name));
      const devBytes = readFileSync(join(DEV_WORKFLOWS_DIR, name));
      // Harm this prevents: workflows/deep-review.js drives the wargaming/deep-review pass
      // itself — a silent divergence here means the pass that is supposed to be "the real
      // verification" (CLAUDE.md, 2026-09-16) could be running different logic than what the
      // dev session believes it audited.
      expect(
        pluginBytes.equals(devBytes),
        `workflows/${name} must be byte-identical to .claude/workflows/${name} — this pair had no lock at all before TASK-237`,
      ).toBe(true);
    }
  });
});
