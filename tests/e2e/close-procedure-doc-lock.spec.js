// tests/e2e/close-procedure-doc-lock.spec.js
// TASK-187 fix round (HIGH) — pins the close procedure documented in
// skills/orchestrator-routing/SKILL.md against the REAL mutation-seam guards
// (src/task-store.js's transitionStatus/appendComment/closeTask), instead of
// re-encoding the sequence as a second, independently-drifting description
// here (a second copy of the contract would drift exactly like CLAUDE.md and
// SKILL.md's procedural section drifted from the guards this same round —
// that IS this ticket). Follows the TASK-196 precedent
// (tests/uat-doc-example-lock.spec.js): extract the doc's own worked
// sequence by a stable marker, then DRIVE the real primitives with it. If
// the code's preconditions ever move without the doc moving too, this lock
// fails.
//
// RED-RUN (this fix round): before this round's doc fix landed, SKILL.md's
// procedural close section instructed calling `close_task` alone — no
// `<!-- CLOSE-PROCEDURE:START -->` marker existed at all, so
// extractCloseProcedureSteps()'s own vacuity guard ("markers found, steps
// non-empty") threw loudly for that reason (not a silent zero-selection —
// see CLAUDE.md's Empty-result contract). Driving the OLD single-call
// sequence (close_task straight from a fresh 'todo' task, no in_review hop,
// no reviewer comment) against the real guards also fails for the right
// reason: InvalidPredecessorStateError, replaying this same ticket's own
// original A5 probe. Both captured verbatim in this ticket's hand-off.

import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from '../helpers/repoRoot.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';
import { makeRepoSkeleton } from '../helpers/fixtures.js';
import {
  transitionStatus, appendComment, closeTask,
  InvalidPredecessorStateError, CloseEvidenceError,
} from '../../src/task-store.js';

afterAll(cleanupAll);

const SKILL_PATH = join(REPO_ROOT, 'skills', 'orchestrator-routing', 'SKILL.md');
const START_MARKER = '<!-- CLOSE-PROCEDURE:START -->';
const END_MARKER = '<!-- CLOSE-PROCEDURE:END -->';
const CALL_RE = /`(transition_status|append_comment|close_task)\(\{([^`]*)\}\)`/g;

/**
 * Extract the ordered close-procedure steps published between
 * CLOSE-PROCEDURE markers in SKILL.md — each a `{ fn, ...args }` object
 * derived from the doc's own worked backtick-delimited call, never a
 * spec-local re-encoding of the sequence. Throws (loudly, not an
 * empty-array pass-through) if the markers are missing/malformed OR the
 * extraction yields zero steps — the Empty-result contract (CLAUDE.md) this
 * repo has hit before: an empty extraction must never silently render as
 * "nothing to check" (this exact vacuity shape is what TASK-192/TASK-184
 * closed elsewhere; this lock does not get to reopen it here).
 */
function extractCloseProcedureSteps() {
  const text = readFileSync(SKILL_PATH, 'utf8');
  const startIdx = text.indexOf(START_MARKER);
  const endIdx = text.indexOf(END_MARKER);
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    throw new Error(
      `close-procedure-doc-lock: could not find a well-formed ${START_MARKER} ... `
        + `${END_MARKER} block in ${SKILL_PATH} — the doc no longer publishes the close `
        + 'procedure for this lock to check (or the markers were removed/reordered).',
    );
  }
  const raw = text.slice(startIdx + START_MARKER.length, endIdx);
  const steps = [];
  let m;
  CALL_RE.lastIndex = 0;
  while ((m = CALL_RE.exec(raw))) {
    const [, fn, body] = m;
    if (fn === 'transition_status') {
      const statusMatch = /status:\s*"([^"]+)"/.exec(body);
      steps.push({ fn, status: statusMatch && statusMatch[1] });
    } else if (fn === 'append_comment') {
      const authorMatch = /author:\s*"([^"]+)"/.exec(body);
      steps.push({ fn, author: authorMatch && authorMatch[1] });
    } else {
      steps.push({ fn });
    }
  }
  if (steps.length === 0) {
    throw new Error(
      'close-procedure-doc-lock: the extracted CLOSE-PROCEDURE block yielded zero steps — a doc-lock must '
        + 'never treat an empty extraction as "nothing to check" (see CLAUDE.md\'s Empty-result contract).',
    );
  }
  return steps;
}

function makeTask(key) {
  return {
    key,
    title: `Fixture ${key}`,
    description: 'Fixture task for the TASK-187 close-procedure doc lock.',
    acceptance_criteria: ['covered by this lock'],
    status: 'todo',
    priority: 'medium',
    labels: [],
    assignee: null,
    depends_on: [],
    linked_commits: [],
    linked_prs: [],
    comments: [],
    created_at: '2026-08-04T00:00:00Z',
    updated_at: '2026-08-04T00:00:00Z',
    jira_key: null,
    verification_tier: 'tdd', // requires BOTH a reviewer comment and linked_commits — the strictest tier
  };
}

function readTask(repoDir, key) {
  return JSON.parse(readFileSync(join(repoDir, 'tasks', `${key}.json`), 'utf8'));
}

/** Drive the real primitives through `steps`, in order, against `repoDir`/`key`. */
async function runProcedure(repoDir, key, steps) {
  for (const step of steps) {
    if (step.fn === 'transition_status') {
      await transitionStatus({ repoRoot: repoDir, key, status: step.status });
    } else if (step.fn === 'append_comment') {
      await appendComment({
        repoRoot: repoDir, key, author: step.author, body: 'APPROVE. All acceptance criteria met.',
      });
    } else if (step.fn === 'close_task') {
      await closeTask({
        repoRoot: repoDir,
        key,
        comment: { author: 'orchestrator', body: 'Closing per review.' },
        linked_commits: ['abc1234'],
      });
    } else {
      throw new Error(`close-procedure-doc-lock: unrecognized step fn "${step.fn}"`);
    }
  }
}

describe('TASK-187 fix round — SKILL.md close procedure vs the live mutation-seam guards', () => {
  it('the doc publishes a non-empty, well-formed close procedure (vacuity guard)', () => {
    const steps = extractCloseProcedureSteps();
    expect(steps.length).toBeGreaterThan(0);
    expect(steps.map((s) => s.fn)).toEqual(['transition_status', 'append_comment', 'close_task']);
  });

  it('the documented procedure, driven verbatim against the real guards, succeeds for a tdd ticket from todo', async () => {
    const steps = extractCloseProcedureSteps();
    const repoDir = makeTmpDir('af-close-procedure-doc-lock-happy');
    makeRepoSkeleton(repoDir, { tasks: { 'TASK-971': makeTask('TASK-971') } });
    writeFileSync(
      join(repoDir, 'tasks', 'index.json'),
      JSON.stringify({ generated_at: '2000-01-01T00:00:00Z', tasks: [] }, null, 2),
      'utf8',
    );

    await runProcedure(repoDir, 'TASK-971', steps);

    const after = readTask(repoDir, 'TASK-971');
    expect(after.status).toBe('done');
    expect(after.comments.some((c) => c.author === 'reviewer')).toBe(true);
    expect(after.linked_commits.length).toBeGreaterThan(0);
  });

  // Non-vacuity by mutation (same discipline as tests/uat-doc-example-lock.spec.js):
  // each mutation below proves the lock is actually sensitive to the specific
  // sequence and status/author values the doc publishes, not just "some steps ran".
  describe('non-vacuity-by-mutation — a doc that diverges from the real preconditions is REJECTED', () => {
    it('mutation: step 1 targets "in_progress" instead of "in_review" — real guard rejects with InvalidPredecessorStateError', async () => {
      const steps = extractCloseProcedureSteps();
      const mutated = steps.map((s) => (s.fn === 'transition_status' ? { ...s, status: 'in_progress' } : s));
      expect(mutated).not.toEqual(steps);

      const repoDir = makeTmpDir('af-close-procedure-doc-lock-mutate-status');
      makeRepoSkeleton(repoDir, { tasks: { 'TASK-972': makeTask('TASK-972') } });

      let caught;
      try {
        await runProcedure(repoDir, 'TASK-972', mutated);
      } catch (err) {
        caught = err;
      }
      expect(
        caught,
        'a doc that documented "in_progress" instead of "in_review" as the pre-close state must be caught, '
          + 'not silently accepted',
      ).toBeInstanceOf(InvalidPredecessorStateError);
    });

    it('mutation: the append_comment step is dropped — real guard rejects with CloseEvidenceError', async () => {
      const steps = extractCloseProcedureSteps();
      const mutated = steps.filter((s) => s.fn !== 'append_comment');
      expect(mutated.length).toBeLessThan(steps.length);

      const repoDir = makeTmpDir('af-close-procedure-doc-lock-mutate-drop');
      makeRepoSkeleton(repoDir, { tasks: { 'TASK-973': makeTask('TASK-973') } });

      let caught;
      try {
        await runProcedure(repoDir, 'TASK-973', mutated);
      } catch (err) {
        caught = err;
      }
      expect(
        caught,
        'a doc that omitted the reviewer-comment step must be caught by the real evidence check, not '
          + 'silently accepted',
      ).toBeInstanceOf(CloseEvidenceError);
    });

    it('mutation: append_comment authored "developer" instead of "reviewer" — real guard rejects with CloseEvidenceError', async () => {
      const steps = extractCloseProcedureSteps();
      const mutated = steps.map((s) => (s.fn === 'append_comment' ? { ...s, author: 'developer' } : s));
      expect(mutated).not.toEqual(steps);

      const repoDir = makeTmpDir('af-close-procedure-doc-lock-mutate-author');
      makeRepoSkeleton(repoDir, { tasks: { 'TASK-974': makeTask('TASK-974') } });

      let caught;
      try {
        await runProcedure(repoDir, 'TASK-974', mutated);
      } catch (err) {
        caught = err;
      }
      expect(
        caught,
        'a doc that documented the wrong comment author must be caught by the real evidence check '
          + '(it requires an author:"reviewer" comment specifically), not silently accepted',
      ).toBeInstanceOf(CloseEvidenceError);
    });
  });
});
