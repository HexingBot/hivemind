// tests/helpers/agentInstructionGuardChecks.js
// TASK-237 (second loop-back, WG3-237-002 / evasion (d) of WG3-237-001) — MECHANISM B of two
// complementary sensors.
//
// See tests/helpers/variantPairChecks.js's file-header comment for what the OTHER sensor
// (mechanism A, a fuzzy content-parity diff between a framework/-current-project PAIR) covers.
// The two are deliberately NOT merged into one module:
//   - Mechanism A (variantPairChecks.js) can only ever see a DIFFERENCE between two named files.
//     It is structurally blind to a poison instruction inserted IDENTICALLY on both sides of a
//     pair (WG3-237-001 evasion (d)) — there is nothing for a diff to catch when both copies
//     agree. It is also blind to any file that has no mirror at all — a one-sided allowlisted
//     skill (FRAMEWORK_ONLY_SKILLS / CONSUMER_ONLY_SKILLS in mirror-pairs-discovery.spec.js) or a
//     references/ file with no sibling.
//   - Mechanism B (this file) does not compare two files against each other at all — it scans
//     EVERY instruction-bearing surface independently for a small set of KNOWN-POISONOUS claims
//     that directly contradict this repo's own governing policy (CLAUDE.md). It does not care
//     whether the file has a mirror, and it does not care whether the same poison also appears
//     on a sibling file — each file is judged on its own content. This is what catches WG3-237-002
//     (references/ with no parity lock at all) and the "live name reused" evasion (replacing an
//     ALLOWLISTED one-sided skill's entire content with a poisoned SKILL.md — mechanism A never
//     looks at those files' content, only mechanism B does).
//
// Do not fold these two into a single check: a future maintainer who "simplifies" this into one
// pass would either lose the identical-on-both-sides detection (if they kept only the diff) or
// lose the this-repo's-policy-recall for one-sided files (if they kept only the pattern scan).
//
// Design trade-off (explicit, per this ticket's direction): a keyword/regex scan over free-form
// prose can always be evaded by someone who phrases the same contradiction in genuinely novel
// words the patterns below don't anticipate — this is a FALSE-NEGATIVE risk the scan accepts
// rather than trying to be a full NLP contradiction detector (which is out of reach for a fast,
// deterministic, zero-dependency test). Conversely, every pattern below was checked against this
// repo's ENTIRE current instruction surface (see this ticket's hand-off for the measured run) and
// tuned to zero matches on real, legitimate content — so the accepted trade is a documented
// false-negative gap, never a false positive on today's repo.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** Recursively list every `.md` file under `dir`. */
export function listMarkdownFilesRecursive(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  const walk = (current) => {
    for (const name of readdirSync(current).sort()) {
      const full = join(current, name);
      const st = statSync(full);
      if (st.isDirectory()) {
        walk(full);
      } else if (name.endsWith('.md')) {
        out.push(full);
      }
    }
  };
  walk(dir);
  return out;
}

// Each pattern names the ONE contradicted policy invariant it targets (CLAUDE.md, 2026-09-16
// decision + the pre-existing HIGH-finding-blocks-the-close rule) and was verified, individually,
// to produce ZERO matches against this repo's real instruction surface before being added here —
// see this ticket's hand-off for the exact corpus and command used to verify that.
export const POISON_PATTERNS = [
  {
    id: 'wargaming-optional',
    regex: /\bwargaming\b[^.\n]{0,25}\b(is|son|es)\b[^.\n]{0,10}\b(optional|opcional)\b|\b(optional|opcional)\b[^.\n]{0,25}\bwargaming\b/i,
    contradicts: 'CLAUDE.md Workflow step 6, "Wargaming step": wargaming is mandatory, not optional.',
  },
  {
    id: 'high-finding-does-not-block-en',
    regex: /\bHIGH\b[^.\n]{0,60}\b(does not|doesn't|never)\b[^.\n]{0,30}\bblock/i,
    contradicts: 'CLAUDE.md: "A HIGH-severity wargaming finding blocks the close, exactly like a HIGH review finding."',
  },
  {
    id: 'high-finding-does-not-block-es',
    regex: /\bHIGH\b[^.\n]{0,60}\bno\s+bloquea/i,
    contradicts: 'CLAUDE.md: un hallazgo HIGH bloquea el cierre, igual que un HIGH de review.',
  },
  {
    id: 'dispatch-without-use-case-approval',
    regex: /\b(dispatch(ed|ing)?|despach\w*)\b[^.\n]{0,60}\bwithout\b[^.\n]{0,30}\b(human )?approval\b|\bsin\s+aprobaci[oó]n\s+humana\s+de\s+los\s+casos\s+de\s+uso\b/i,
    contradicts: 'CLAUDE.md Workflow step 2: the human approves the use-case list before implementation is a hard stop.',
  },
  {
    id: 'close-without-review-or-wargaming',
    regex: /\bclose\b[^.\n]{0,40}\bwithout\b[^.\n]{0,30}\b(review|wargaming|approval)\b|\bcerrar\b[^.\n]{0,40}\bsin\b[^.\n]{0,30}\b(revisi[oó]n|wargaming|aprobaci[oó]n)\b/i,
    contradicts: 'CLAUDE.md Workflow step 6/7: a ticket cannot close without a green review and a recorded wargaming pass.',
  },
  {
    id: 'ignore-claude-md',
    regex: /\bignor[ae]\w*\b[^.\n]{0,20}claude\.md/i,
    contradicts: 'CLAUDE.md is the canonical, non-optional source of team-wide guidelines (Knowledge Sharing section).',
  },
];

/**
 * Scan `filePath`'s content for every POISON_PATTERNS entry. Returns an array of
 * `{ id, contradicts, snippet }` for every pattern that matched (empty if clean).
 */
export function scanFileForContradictions(filePath) {
  const text = readFileSync(filePath, 'utf8');
  const hits = [];
  for (const pattern of POISON_PATTERNS) {
    const m = text.match(pattern.regex);
    if (m) hits.push({ id: pattern.id, contradicts: pattern.contradicts, snippet: m[0] });
  }
  return hits;
}

/**
 * Scan every `.md` file across the given surface roots. Returns an array of
 * `{ file, id, contradicts, snippet }` — empty when the whole surface is clean.
 */
export function scanSurfacesForContradictions(surfaceRoots) {
  const findings = [];
  for (const root of surfaceRoots) {
    if (!existsSync(root)) continue;
    // A root may be a single file (e.g. CLAUDE.md) or a directory to recurse.
    const files = statSync(root).isDirectory() ? listMarkdownFilesRecursive(root) : [root];
    for (const file of files) {
      for (const hit of scanFileForContradictions(file)) {
        findings.push({ file, ...hit });
      }
    }
  }
  return findings;
}
