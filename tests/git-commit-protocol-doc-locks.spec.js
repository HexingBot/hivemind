// tests/git-commit-protocol-doc-locks.spec.js
// TASK-191 fix round — MEDIUM-2: the only sensor touching the new "Git commit
// protocol" prose was tests/agents-parity.spec.js, which merely asserts the
// two `agents/developer.md` copies match EACH OTHER. Deleting the entire
// section from BOTH copies (and the corresponding delegation-protocol
// paragraph from both SKILL.md copies) leaves that check green — a control
// that can be silently removed is not a control. This is a new, dedicated
// doc-lock file, same precedent as tests/agility-doc-locks.spec.js and
// tests/ticket-write-path-doc-locks.spec.js.
//
// Scope decision (developer, TASK-191 fix round): unlike those two precedent
// files — which check only ONE copy of each parity pair, relying on
// tests/agents-parity.spec.js / tests/orchestrator-skill-v2.spec.js to catch
// copy-to-copy drift — this spec checks BOTH copies directly, per the
// reviewer's explicit fix instruction. That is deliberate: MEDIUM-2's threat
// model is the load-bearing prose being deleted from BOTH copies in the same
// commit, which would leave a same-copy-only lock (and the parity spec that
// only compares the two copies to each other) equally green. Checking both
// files here closes that gap independent of the parity spec's continued
// existence.
//
// RED-GREEN PLANT PROTOCOL (reported in the hand-off, not committed): each
// assertion group below was verified able to fail for the right reason by
// temporarily deleting the target sentence from one file at a time, running
// this spec alone to confirm the RIGHT assertion went red naming the missing
// text, then restoring the file and re-running to confirm green — before this
// commit landed. See the hand-off for the exact commands and captured output.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from './helpers/repoRoot.js';

const DEVELOPER_PATHS = [
  join(REPO_ROOT, 'agents', 'developer.md'),
  join(REPO_ROOT, '.claude', 'agents', 'developer.md'),
];

const SKILL_PATHS = [
  join(REPO_ROOT, 'skills', 'orchestrator-routing', 'SKILL.md'),
  join(REPO_ROOT, '.claude', 'skills', 'orchestrator-routing', 'SKILL.md'),
];

function load(path) {
  return readFileSync(path, 'utf8');
}

/** Collapse all whitespace runs (including newlines) to a single space, so a
 * phrase that happens to word-wrap across source lines can still be pinned
 * as one contiguous string (same convention as tests/agility-doc-locks.spec.js). */
function normalize(text) {
  return text.replace(/\s+/g, ' ');
}

describe('TASK-191 — Git commit protocol prose is pinned in both developer.md copies', () => {
  it.each(DEVELOPER_PATHS)('%s carries the pathspec-limited commit instruction', (path) => {
    const text = load(path);
    expect(
      text.includes('git commit -m "..." -- <explicit paths>'),
      `${path} must carry the pathspec-limited commit instruction`,
    ).toBe(true);
  });

  it.each(DEVELOPER_PATHS)('%s carries the mandatory `git show --stat HEAD` sentence', (path) => {
    const text = load(path);
    expect(
      text.includes('Mandatory post-commit verification, every commit, no exceptions'),
      `${path} must carry the mandatory post-commit verification heading`,
    ).toBe(true);
    expect(
      text.includes('git show --stat HEAD'),
      `${path} must carry the \`git show --stat HEAD\` verification command`,
    ).toBe(true);
  });

  it.each(DEVELOPER_PATHS)(
    '%s carries the same-path-collision limitation (MEDIUM-1, TASK-191 fix round)',
    (path) => {
      const text = load(path);
      expect(
        text.includes('same-path collisions are NOT caught by this protocol'),
        `${path} must state that the protocol does not catch same-path collisions`,
      ).toBe(true);
      expect(
        text.includes(
          "the `git show --stat HEAD` check above cannot detect it, because the file list still matches your intent exactly",
        ),
        `${path} must explain why the mandatory post-commit check is blind to a same-path collision`,
      ).toBe(true);
    },
  );
});

describe('TASK-191 — shared-git-index delegation guidance is pinned in both SKILL.md copies', () => {
  it.each(SKILL_PATHS)('%s carries the disjoint-file-surfaces-are-not-safe guidance', (path) => {
    const text = normalize(load(path));
    expect(
      text.includes('Disjoint FILE surfaces do not imply safe concurrent commits'),
      `${path} must carry the "Disjoint FILE surfaces do not imply safe concurrent commits" guidance`,
    ).toBe(true);
  });
});
