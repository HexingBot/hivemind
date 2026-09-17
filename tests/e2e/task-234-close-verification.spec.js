// tests/e2e/task-234-close-verification.spec.js
// TASK-234 — regression locks for the seven close-seam breaks the 2026-09-16
// wargaming pass reproduced, one lock per approved use case that broke
// (CU2..CU8 + CU10, with CU9's "never collapses unverifiable into verified"
// asserted inside the CU10 lock, where the same board state proves both).
//
// tests/e2e/ and not the fast tier: every lock below drives the REAL
// closeTask/transitionStatus against a real temp repo on disk, because what
// broke was the WRITE, not a pure predicate — a lock that stubbed the store
// could not have caught WG-H-006 at all.
//
// RED-GREEN PLANTED: each lock was run against the pre-fix code path (by
// reverting its guard in-memory) and observed to fail for its own reason
// before being committed — the re-close lock failed with a second closing
// comment on disk, the delivery-body locks failed by closing on an "OK" body,
// the finding locks failed by closing with an open HIGH, and the sha locks
// failed by accepting an invented sha as evidence.
//
// WG2-234-001/WG2-234-M04 (wargaming 2026-09-17, loop-back round) — two more
// locks appended below for the second wargaming pass's confirmed HIGH/MEDIUM
// findings: the invisible-Unicode filler bypass (WG2-H-01) and the
// transition_status "reaches done with no delivery, indistinguishable from a
// historical close" gap (WG2-M-04). Same red-green discipline: each was run
// against a pre-fix snapshot of src/task-store.js (via `git show HEAD:` into
// a scratch copy, never by reverting the real working tree — see the
// hand-off for why `git stash` was avoided here) and observed to fail for
// its own reason before landing.

import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';
import { makeRepoSkeleton } from '../helpers/fixtures.js';
import { deliveryBody, EMPTY_BLOCKS_BODY, wargamingComment } from '../helpers/deliveryBody.js';
import {
  closeTask, transitionStatus, appendComment,
  DeliveryBodyError, OpenHighFindingError, LinkedCommitNotFoundError,
} from '../../src/task-store.js';
import { auditCloseVerification, CLOSE_VERIFICATION_STATUS } from '../../src/close-verification.js';

afterAll(cleanupAll);

const REVIEWER = { author: 'reviewer', at: '2026-09-16T00:30:00Z', body: 'APPROVE.' };

function makeTask(key, overrides = {}) {
  return {
    key,
    title: `Fixture ${key}`,
    description: 'Fixture for the TASK-234 close-verification locks.',
    acceptance_criteria: ['covered by the TASK-234 locks'],
    status: 'in_review',
    priority: 'medium',
    labels: [],
    assignee: null,
    depends_on: [],
    linked_commits: [],
    linked_prs: [],
    comments: [REVIEWER],
    created_at: '2026-09-16T00:00:00Z',
    updated_at: '2026-09-16T00:00:00Z',
    jira_key: null,
    verification_tier: 'tests-after',
    ...overrides,
  };
}

function seed(label, key, overrides) {
  const repoDir = makeTmpDir(label);
  makeRepoSkeleton(repoDir, { tasks: { [key]: makeTask(key, overrides) } });
  return repoDir;
}

const bytes = (repoDir, key) => readFileSync(join(repoDir, 'tasks', `${key}.json`), 'utf8');
const read = (repoDir, key) => JSON.parse(bytes(repoDir, key));

/** A verifier stub: every sha resolves to `state`, with no git involved. */
const verifierReturning = (state, reason = null) => (_repoRoot, shas) => ({
  checked: state === 'verified' || state === 'not-found',
  reason,
  commits: shas.map((sha) => ({ sha, state, reason })),
});

describe('TASK-234 — the close seam, one lock per approved use case that broke', () => {
  it('CU2 (WG-H-006) — a second close on an already-done ticket writes NOTHING', async () => {
    // HARM: anyone could append an unverified "closing" comment and an
    // arbitrary linked_commit to a ticket that already closed — and the last
    // comment is exactly what a reader and the close census take as THE close.
    const repoDir = seed('af-234-cu2', 'TASK-800');
    await closeTask({
      repoRoot: repoDir,
      key: 'TASK-800',
      comment: { author: 'orchestrator', body: deliveryBody({ ticket: 'TASK-800' }) },
      linked_commits: ['abc1234'],
      commitVerifier: verifierReturning('verified'),
    });
    const afterFirst = bytes(repoDir, 'TASK-800');
    const indexAfterFirst = readFileSync(join(repoDir, 'tasks', 'index.json'), 'utf8');

    await closeTask({
      repoRoot: repoDir,
      key: 'TASK-800',
      comment: { author: 'developer', body: 'Re-closing with whatever I like.' },
      linked_commits: ['dddddddddd'],
      linked_prs: ['https://example.com/pr/fake'],
      now: () => '2099-01-01T00:00:00Z',
      commitVerifier: verifierReturning('verified'),
    });

    expect(bytes(repoDir, 'TASK-800'), 'a re-close must leave the task file byte-identical').toBe(afterFirst);
    expect(readFileSync(join(repoDir, 'tasks', 'index.json'), 'utf8')).toBe(indexAfterFirst);
    const after = read(repoDir, 'TASK-800');
    expect(after.comments.filter((c) => c.author === 'developer')).toHaveLength(0);
    expect(after.linked_commits).toEqual(['abc1234']);
    expect(after.linked_prs).toEqual([]);

    // Same short-circuit on the transitionStatus path.
    await transitionStatus({
      repoRoot: repoDir, key: 'TASK-800', status: 'done', now: () => '2099-01-01T00:00:00Z',
    });
    expect(bytes(repoDir, 'TASK-800')).toBe(afterFirst);
  });

  it('CU3 (WG-H-002) — the four headings with NOTHING under them are rejected, naming each empty block', async () => {
    // HARM: a delivery that looks complete to a grep and says nothing to a
    // reader closes the ticket, and "verified" becomes a shape, not a fact.
    const repoDir = seed('af-234-cu3', 'TASK-801');
    let caught;
    try {
      await closeTask({
        repoRoot: repoDir,
        key: 'TASK-801',
        comment: { author: 'orchestrator', body: EMPTY_BLOCKS_BODY },
        linked_commits: ['abc1234'],
        commitVerifier: verifierReturning('verified'),
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(DeliveryBodyError);
    expect(caught.code).toBe('E_DELIVERY_BODY');
    for (const label of ['1. CASOS DE USO APROBADOS', '2. RESULTADO', '3. WARGAMING', '4. UAT']) {
      expect(caught.message, 'the error must NAME the offending block').toContain(label);
    }
    expect(read(repoDir, 'TASK-801').status).toBe('in_review');
  });

  it('CU4 (WG-H-001) — a closing body of literal "OK" is rejected', async () => {
    // HARM: the measured case — a one-word close that proves nothing passed
    // every guard and left a done ticket indistinguishable from a real one.
    const repoDir = seed('af-234-cu4', 'TASK-802');
    await expect(closeTask({
      repoRoot: repoDir,
      key: 'TASK-802',
      comment: { author: 'orchestrator', body: 'OK' },
      linked_commits: ['abc1234'],
      commitVerifier: verifierReturning('verified'),
    })).rejects.toBeInstanceOf(DeliveryBodyError);
    expect(read(repoDir, 'TASK-802').status).toBe('in_review');
  });

  it('CU5 (WG-H-003) — a wargaming block naming neither case nor path is rejected; a [WARGAMING] comment is an ALTERNATIVE, not a second requirement', async () => {
    // HARM: a wargaming report that does not say what it attacked is not a
    // report — and the wargaming pass is the verification of record.
    const vague = '   - Se ataco todo y anduvo bien.\n   - Veredicto: PASS';
    const repoDir = seed('af-234-cu5', 'TASK-803');
    await expect(closeTask({
      repoRoot: repoDir,
      key: 'TASK-803',
      comment: { author: 'orchestrator', body: deliveryBody({ ticket: 'TASK-803', wargaming: vague }) },
      linked_commits: ['abc1234'],
      commitVerifier: verifierReturning('verified'),
    })).rejects.toBeInstanceOf(DeliveryBodyError);

    // The SAME vague body closes once the ticket carries a real [WARGAMING]
    // record — a legitimate close never needs both.
    await appendComment({
      repoRoot: repoDir, key: 'TASK-803', author: 'orchestrator', body: wargamingComment().body,
    });
    await closeTask({
      repoRoot: repoDir,
      key: 'TASK-803',
      comment: { author: 'orchestrator', body: deliveryBody({ ticket: 'TASK-803', wargaming: vague }) },
      linked_commits: ['abc1234'],
      commitVerifier: verifierReturning('verified'),
    });
    expect(read(repoDir, 'TASK-803').status).toBe('done');
  });

  it('CU6 (WG-H-004) — an open [FINDING-HIGH] on the ticket blocks the close until it is resolved', async () => {
    // HARM: a HIGH finding recorded by the review or the wargaming pass could
    // be closed over silently, which is the one outcome both steps exist to
    // prevent.
    const repoDir = seed('af-234-cu6', 'TASK-804', {
      comments: [REVIEWER, {
        author: 'orchestrator',
        at: '2026-09-16T01:00:00Z',
        body: '[WARGAMING] Atacado CU1 y su path de fallo. [FINDING-HIGH: WG-H-099] el cierre no valida nada.',
      }],
    });
    const close = () => closeTask({
      repoRoot: repoDir,
      key: 'TASK-804',
      comment: { author: 'orchestrator', body: deliveryBody({ ticket: 'TASK-804' }) },
      linked_commits: ['abc1234'],
      commitVerifier: verifierReturning('verified'),
    });

    let caught;
    try { await close(); } catch (err) { caught = err; }
    expect(caught).toBeInstanceOf(OpenHighFindingError);
    expect(caught.message).toContain('WG-H-099');
    expect(read(repoDir, 'TASK-804').status).toBe('in_review');

    await appendComment({
      repoRoot: repoDir, key: 'TASK-804', author: 'orchestrator', body: '[FINDING-RESOLVED: WG-H-099]',
    });
    await close();
    expect(read(repoDir, 'TASK-804').status).toBe('done');
  });

  it('CU7 (WG-H-005) — degrading a HIGH requires a recorded justification, and the trace survives on the ticket', async () => {
    // HARM: a HIGH downgraded to MEDIUM to unblock a close left no trace, so
    // nobody could tell afterwards that the block had been talked away.
    const repoDir = seed('af-234-cu7', 'TASK-805', {
      comments: [REVIEWER, {
        author: 'reviewer',
        at: '2026-09-16T01:00:00Z',
        body: '[WARGAMING] Atacado CU1, path alternativo. [FINDING-HIGH: R-1] evidencia insuficiente.',
      }],
    });
    const close = () => closeTask({
      repoRoot: repoDir,
      key: 'TASK-805',
      comment: { author: 'orchestrator', body: deliveryBody({ ticket: 'TASK-805' }) },
      linked_commits: ['abc1234'],
      commitVerifier: verifierReturning('verified'),
    });

    // A bare degradation marker with no justification text does NOT unblock.
    await appendComment({
      repoRoot: repoDir, key: 'TASK-805', author: 'orchestrator', body: '[FINDING-DEGRADED: R-1 — ]',
    });
    await expect(close()).rejects.toBeInstanceOf(OpenHighFindingError);

    await appendComment({
      repoRoot: repoDir,
      key: 'TASK-805',
      author: 'orchestrator',
      body: '[FINDING-DEGRADED: R-1 — el path afectado no es alcanzable sin permisos de escritura]',
    });
    await close();

    const after = read(repoDir, 'TASK-805');
    expect(after.status).toBe('done');
    const trace = after.comments.filter((c) => c.body.includes('[FINDING-DEGRADED: R-1'));
    expect(trace, 'the degradation stays on the append-only comment trail').toHaveLength(2);
  });

  it('CU8 (WG-H-011) — a sha git resolves as absent blocks the close; one it cannot check does not, and is recorded as unverifiable', async () => {
    // HARM: an invented-but-well-formed sha satisfied the close evidence a
    // reader takes as proof the work landed — and "cannot know" was silently
    // indistinguishable from "verified".
    const notFoundRepo = seed('af-234-cu8-missing', 'TASK-806');
    let caught;
    try {
      await closeTask({
        repoRoot: notFoundRepo,
        key: 'TASK-806',
        comment: { author: 'orchestrator', body: deliveryBody({ ticket: 'TASK-806' }) },
        linked_commits: ['deadbeef'],
        commitVerifier: verifierReturning('not-found'),
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(LinkedCommitNotFoundError);
    expect(caught.code).toBe('E_LINKED_COMMIT_NOT_FOUND');
    expect(read(notFoundRepo, 'TASK-806').status).toBe('in_review');

    const unverifiableRepo = seed('af-234-cu8-unverifiable', 'TASK-807');
    await closeTask({
      repoRoot: unverifiableRepo,
      key: 'TASK-807',
      comment: { author: 'orchestrator', body: deliveryBody({ ticket: 'TASK-807' }) },
      linked_commits: ['abc1234'],
      commitVerifier: verifierReturning('unverifiable', 'git-unavailable'),
    });
    const after = read(unverifiableRepo, 'TASK-807');
    expect(after.status, 'git being unable to answer must NOT block a close').toBe('done');
    expect(after.linked_commits_verification.commits).toEqual([
      { sha: 'abc1234', state: 'unverifiable', reason: 'git-unavailable' },
    ]);
    expect(auditCloseVerification(after).status, '"cannot know" is never reported as verified')
      .toBe(CLOSE_VERIFICATION_STATUS.UNVERIFIABLE);
  });

  it('CU10/CU9 (AC7) — a historical done ticket stays writable and is reported unverifiable, never re-judged', async () => {
    // HARM: retrofitting the new guards onto the ~223 tickets closed before
    // they existed would either make them un-rewritable or brand them as
    // failures — both are a rewrite of history the ticket forbids.
    const repoDir = seed('af-234-cu10', 'TASK-808', {
      status: 'done',
      comments: [{ author: 'orchestrator', at: '2026-01-01T00:00:00Z', body: 'OK' }],
      linked_commits: ['abc1234'],
    });

    // Still writable: a comment lands, and a transition OFF done still writes.
    await appendComment({
      repoRoot: repoDir, key: 'TASK-808', author: 'developer', body: 'late note on an old ticket',
    });
    expect(read(repoDir, 'TASK-808').comments).toHaveLength(2);
    await transitionStatus({ repoRoot: repoDir, key: 'TASK-808', status: 'in_progress' });
    expect(read(repoDir, 'TASK-808').status).toBe('in_progress');

    // And the audit reports it as "cannot know" — not as a failure (CU9).
    const historical = { ...read(repoDir, 'TASK-808'), status: 'done' };
    const verdict = auditCloseVerification(historical);
    expect(verdict.status).toBe(CLOSE_VERIFICATION_STATUS.UNVERIFIABLE);
    expect(verdict.reason).toBe('no-close-verification-record');
  });

  it('WG2-H-01 — an invisible-Unicode filler ("OK" + U+200B under a heading) is rejected, not silently persisted as an empty close', async () => {
    // HARM: a one-word-equivalent close (an invisible character away from the
    // literal "OK" body WG-H-001 exists to reject) closed the ticket, and the
    // PERSISTED comment (post-sanitize) then disagreed with the guard that
    // let it through — a reader running auditCloseVerification on the same
    // close it just approved got 'not-verified', not 'verified'.
    const ZW = '​'; // zero-width space — also proven with U+2060/U+200E/U+E0001 by hand at review time
    const repoDir = seed('af-234-wg2-h01', 'TASK-809');
    const body = [
      'ENTREGA — TASK-809', '',
      `1. CASOS DE USO APROBADOS`, `OK${ZW}`, '',
      `2. RESULTADO`, `OK${ZW}`, '',
      `3. WARGAMING`, `CU1 camino${ZW}`, '',
      `4. UAT`, `OK${ZW} verdict`,
    ].join('\n');

    let caught;
    try {
      await closeTask({
        repoRoot: repoDir,
        key: 'TASK-809',
        comment: { author: 'orchestrator', body },
        linked_commits: ['abc1234'],
        commitVerifier: verifierReturning('verified'),
      });
    } catch (err) {
      caught = err;
    }
    expect(caught, 'invisible-Unicode filler must be rejected exactly like "OK"').toBeInstanceOf(DeliveryBodyError);
    expect(read(repoDir, 'TASK-809').status).toBe('in_review');
  });

  it('WG2-M-04 — transitionStatus reaching done writes a record that makes the close distinguishable from a historical one', async () => {
    // HARM: a close reached via transition_status (no comment body, so no
    // delivery to check) left NO linked_commits_verification at all — exactly
    // what auditCloseVerification reads as "predates TASK-234's guards", so a
    // TODAY close routed this way was mechanically pooled with the ~223
    // historical closes instead of being flagged as incomplete.
    const repoDir = seed('af-234-wg2-m04', 'TASK-810', {
      linked_commits: ['abc1234'],
      comments: [REVIEWER, wargamingComment()],
    });

    await transitionStatus({ repoRoot: repoDir, key: 'TASK-810', status: 'done' });
    const after = read(repoDir, 'TASK-810');
    expect(after.status).toBe('done');
    expect(after.linked_commits_verification, 'a real closure event must leave a record, even an incomplete one')
      .toBeTruthy();
    expect(after.linked_commits_verification.commits).toEqual([]);

    const verdict = auditCloseVerification(after, { repoRoot: process.cwd() });
    expect(verdict.reason, 'must read as incomplete, never pooled with pre-TASK-234 historical closes')
      .not.toBe('no-close-verification-record');
    expect(verdict.status).toBe(CLOSE_VERIFICATION_STATUS.NOT_VERIFIED);
  });
});
