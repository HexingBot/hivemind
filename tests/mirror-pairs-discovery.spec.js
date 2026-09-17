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

  it('the one-sided allowlists contain no stale/dead entries (WG2-237-M02)', () => {
    // TASK-237 WG2-237-M02: the allowlists above are exempt from the discovery loop by design
    // (they document a genuine one-sided split), but nothing previously checked that an allowlisted
    // NAME still corresponds to a real dir on disk. Harm this prevents: a removed skill's name stays
    // in the allowlist forever, so a FUTURE skill that reuses the dead name is silently exempted
    // from the byte-identity / section-inventory locks with nothing flagging the reuse — the same
    // failure mode tests/use-case-policy.spec.js closes for USE-CASES.md referencing a spec path
    // that no longer exists on disk.
    const deadFrameworkOnly = [...FRAMEWORK_ONLY_SKILLS].filter((n) => !devNames.includes(n));
    const deadConsumerOnly = [...CONSUMER_ONLY_SKILLS].filter((n) => !pluginNames.includes(n));
    expect(
      deadFrameworkOnly,
      'FRAMEWORK_ONLY_SKILLS name(s) with no matching .claude/skills/ dir on disk — remove the stale entry',
    ).toEqual([]);
    expect(
      deadConsumerOnly,
      'CONSUMER_ONLY_SKILLS name(s) with no matching skills/ dir on disk — remove the stale entry',
    ).toEqual([]);
  });
});

// TASK-237 WG2-237-001 — differently-named framework/-current-project variant pairs (the skills
// listed in FRAMEWORK_ONLY_SKILLS/CONSUMER_ONLY_SKILLS above because their names differ, e.g.
// `hive-adversarial-improve` vs `hive-adversarial-improve-current-project`) never pair up by
// DIRECTORY NAME, so the same-name discovery loop above — and its byte-identical check — never
// runs on them at all; they fall straight into the one-sided allowlists, where only EXISTENCE is
// asserted. The 2026-09-16 wargaming's own reproduction (injecting a CLAUDE.md-contradicting
// "## Override" section into `.claude/skills/hive-adversarial-improve/SKILL.md`) went undetected
// for exactly this reason.
//
// This deliberately does NOT attempt full byte-identity — the three pairs below are retargeted
// per repo ON PURPOSE (different name/description/wording throughout; see e.g.
// tests/assimilate-skill.spec.js's own doc comment) — a full byte-compare would be a false
// positive the moment anyone makes a legitimate per-repo wording edit. What must never silently
// drift is narrower and true today for all three pairs:
//   (a) the ## SECTION INVENTORY — no section can be added to one side and not the other without
//       a written, named exception (`oneSidedHeadings`); an injected extra section (the wargaming
//       attack) shows up as an unaccounted heading and fails loudly.
//   (b) each pair's own load-bearing invariant clause(s), verbatim — content that is already
//       byte-identical between the two files today and must stay that way.
const NAME_PAIRS = [
  {
    label: 'hive-adversarial-improve / hive-adversarial-improve-current-project',
    frameworkFile: join(DEV_SKILLS_DIR, 'hive-adversarial-improve', 'SKILL.md'),
    consumerFile: join(PLUGIN_SKILLS_DIR, 'hive-adversarial-improve-current-project', 'SKILL.md'),
    // "Worked example (reference implementation)" (framework) vs "Worked example" (consumer) is a
    // known, intentional caption difference for the same section — normalize it away.
    normalizeHeading: (h) => h.replace(/\s*\(reference implementation\)\s*$/, ''),
    oneSidedHeadings: [],
    lockedClauses: [
      '**Every gap becomes a `tests-after` ticket, with the probe input as a replayable test fixture.**',
    ],
  },
  {
    label: 'hive-self-improve / hive-self-improve-current-project',
    frameworkFile: join(DEV_SKILLS_DIR, 'hive-self-improve', 'SKILL.md'),
    consumerFile: join(PLUGIN_SKILLS_DIR, 'hive-self-improve-current-project', 'SKILL.md'),
    normalizeHeading: (h) => h,
    // "Runs on Fable end to end" documents which model THIS FRAMEWORK REPO's PROJECT.md pins for
    // the orchestrator running this skill — meaningless for a consumer project, which has its own
    // PROJECT.md/agent_models map. Deliberately one-sided, not a drift.
    oneSidedHeadings: ['Runs on Fable end to end'],
    lockedClauses: [
      '**Every finding is grounded in the REAL code actually run — never speculation.**',
    ],
  },
  {
    label: 'hivemind-assimilate-skill / assimilate-current-project',
    frameworkFile: join(DEV_SKILLS_DIR, 'hivemind-assimilate-skill', 'SKILL.md'),
    consumerFile: join(PLUGIN_SKILLS_DIR, 'assimilate-current-project', 'SKILL.md'),
    // The "invariants, first" heading's parenthetical cross-references the OTHER file by name on
    // each side (different repo, different pointer) — normalize the parenthetical away, not the
    // heading itself.
    normalizeHeading: (h) => h.replace(/\s*\(retargeted per repo[\s\S]*\)$/, ' (retargeted per repo)'),
    oneSidedHeadings: [],
    // Already locked at clause level by tests/assimilate-skill.spec.js's LEAD_GUARANTEES check —
    // no duplicate clause lock needed here, the section-inventory check above still applies.
    lockedClauses: [],
  },
];

function headingsOf(text) {
  return [...text.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1].trim());
}

describe('WG2-237-001 — differently-named framework/-current-project variant pairs stay locked', () => {
  for (const pair of NAME_PAIRS) {
    describe(pair.label, () => {
      const frameworkExists = existsSync(pair.frameworkFile);
      const consumerExists = existsSync(pair.consumerFile);

      it('both variant files exist on disk', () => {
        expect(frameworkExists, `${pair.frameworkFile} must exist`).toBe(true);
        expect(consumerExists, `${pair.consumerFile} must exist`).toBe(true);
      });

      if (!frameworkExists || !consumerExists) return;

      const frameworkBody = readFileSync(pair.frameworkFile, 'utf8');
      const consumerBody = readFileSync(pair.consumerFile, 'utf8');

      it('carries the same ## section inventory on both sides, modulo the documented one-sided headings', () => {
        // Harm this prevents: a section can be ADDED to one side (an injected override block that
        // contradicts CLAUDE.md, exactly the 2026-09-16 wargaming reproduction) or silently DROPPED
        // from one side, with nothing catching it — differently-named pairs never enter the
        // same-name discovery loop above, so this is the only inventory check they get.
        const frameworkHeadings = headingsOf(frameworkBody).map(pair.normalizeHeading);
        const consumerHeadings = headingsOf(consumerBody).map(pair.normalizeHeading);
        const missingFromConsumer = frameworkHeadings.filter(
          (h) => !consumerHeadings.includes(h) && !pair.oneSidedHeadings.includes(h),
        );
        const missingFromFramework = consumerHeadings.filter(
          (h) => !frameworkHeadings.includes(h) && !pair.oneSidedHeadings.includes(h),
        );
        expect(
          missingFromConsumer,
          'section(s) present in the framework variant but not the consumer variant, and not in ' +
          `oneSidedHeadings: ${JSON.stringify(missingFromConsumer)}`,
        ).toEqual([]);
        expect(
          missingFromFramework,
          'section(s) present in the consumer variant but not the framework variant, and not in ' +
          `oneSidedHeadings: ${JSON.stringify(missingFromFramework)}`,
        ).toEqual([]);
      });

      if (pair.lockedClauses.length > 0) {
        it('carries its load-bearing invariant clause(s) verbatim on both sides', () => {
          for (const clause of pair.lockedClauses) {
            // Harm this prevents: the rule text itself silently weakening or flipping in only one
            // variant (e.g. "every gap becomes a ticket" quietly dropped from the consumer copy)
            // without any heading changing, which the section-inventory check above would not catch.
            expect(
              frameworkBody.includes(clause),
              `framework copy (${pair.frameworkFile}) must contain verbatim: "${clause}"`,
            ).toBe(true);
            expect(
              consumerBody.includes(clause),
              `consumer copy (${pair.consumerFile}) must contain verbatim: "${clause}"`,
            ).toBe(true);
          }
        });
      }
    });
  }
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
