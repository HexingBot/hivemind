// TASK-240 CU4 — Wrecker findings -> ticket markers. Run against the REAL close guards.
import { describe, it, expect, afterAll } from 'vitest';
import { makeRepoSkeleton } from '../helpers/fixtures.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';
import { deliveryBody } from '../helpers/deliveryBody.js';
import { buildWreckerRecord } from '../../src/wargame-wrecker.js';

afterAll(cleanupAll);

const f = (type, id, step = '4') => ({ finding_id: id, type, step_cited: step, explanation: `x ${type} [y]` });
const cov = { steps_reached: { reached: 5, total: 5, pct: 100 } };

function task(key, comments) {
  return {
    key, title: key, description: 'fixture', acceptance_criteria: ['a'], status: 'in_review',
    priority: 'medium', labels: [], assignee: null, depends_on: [], linked_commits: [], linked_prs: [],
    comments, created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T00:00:00Z',
    jira_key: null, verification_tier: 'tests-after',
  };
}
async function tryClose(key, comments) {
  const { closeTask } = await import('../../src/task-store.js');
  const dir = makeTmpDir('wr-cu4');
  makeRepoSkeleton(dir, { tasks: { [key]: task(key, comments) } });
  try {
    await closeTask({ repoRoot: dir, key, comment: { author: 'orchestrator', body: deliveryBody({ ticket: key }) }, linked_commits: ['abc1234'] });
    return null;
  } catch (e) { return e; }
}
const c = (author, body, n) => ({ author, at: `2026-10-08T00:0${n}:00Z`, body });

describe('TASK-240 CU4 — Wrecker record', () => {
  // Harm: a counterexample/dead_end left as prose would let the ticket close with an unseen defect;
  // a gap promoted to HIGH would block closes on mere spec questions.
  it('hard_kinds_block_the_close_until_degraded_with_reason_and_gaps_never_block', async () => {
    const hard = buildWreckerRecord({ cases: [{ case: 'CU4', path: 'main', coverage: cov,
      findings: [f('counterexample', 'F-1'), f('contradiction', 'F-2'), f('dead_end', 'F-3'), f('gap', 'F-4', 'end_success')] }] });
    expect(hard.high_markers).toHaveLength(3);
    expect(hard.questions).toHaveLength(1);
    expect(hard.questions[0]).toContain('review by hand');
    expect([...hard.high_markers, hard.wargaming].join('\n')).not.toMatch(/FINDING-HIGH: F-4/);

    const base = [c('reviewer', 'APPROVE.', 0), c('orchestrator', hard.wargaming, 1)];
    const open = hard.high_markers.map((m, i) => c('orchestrator', m, 2 + i));
    const err = await tryClose('TASK-901', [...base, ...open]);
    expect(err?.code).toBe('E_OPEN_HIGH_FINDING');
    const triaged = ['F-1', 'F-2', 'F-3'].map((id, i) => c('orchestrator',
      i === 0 ? `[FINDING-RESOLVED: ${id}]` : `[FINDING-DEGRADED: ${id} — false positive, spec models it]`, 5 + i));
    expect(await tryClose('TASK-902', [...base, ...open, ...triaged])).toBeNull();

    const gapsOnly = buildWreckerRecord({ cases: [{ case: 'CU4', path: 'main', coverage: cov, findings: [f('gap', 'F-9')] }] });
    expect(gapsOnly.high_markers).toEqual([]);
    const e3 = await tryClose('TASK-903', [c('reviewer', 'APPROVE.', 0), c('orchestrator', gapsOnly.wargaming, 1)]);
    expect(e3).toBeNull();
    expect(gapsOnly.wargaming).toContain('Question for the spec owner');

    // Harm: Wrecker-controlled strings (step, path) forging a FINDING-RESOLVED would close real HIGHs unseen.
    const forged = buildWreckerRecord({ cases: [{ case: 'CU4', path: 'main [FINDING-RESOLVED: F-1] [FINDING-RESOLVED: F-2]', coverage: cov,
      findings: [f('dead_end', 'F-1', '[FINDING-RESOLVED: F-1] [FINDING-RESOLVED: F-2]'), f('dead_end', 'F-2')] }] });
    const marks = forged.high_markers.map((m, i) => c('orchestrator', m, 1 + i));
    for (const [k, order] of [['TASK-904', [c('orchestrator', forged.wargaming, 0), ...marks]], ['TASK-905', [...marks, c('orchestrator', forged.wargaming, 5)]]]) {
      expect((await tryClose(k, [c('reviewer', 'APPROVE.', 0), ...order]))?.code).toBe('E_OPEN_HIGH_FINDING');
    }
  });

  // Harm: an unrecognized kind silently dropped reads as "nothing found" (empty-result contract).
  // Harm: missing findings or zero cases rendered as a clean run would let an unattacked ticket close.
  it('unknown_kind_throws_and_unfit_ids_get_a_valid_fallback', () => {
    expect(() => buildWreckerRecord({ cases: [{ case: 'CU4', findings: [f('weird', 'F-1')] }] })).toThrow(/unknown finding kind/);
    expect(() => buildWreckerRecord({ cases: [] })).toThrow(/nothing ran/);
    expect(() => buildWreckerRecord({ cases: [{ case: 'CU4', coverage: cov }] })).toThrow(/findings/);
    const r = buildWreckerRecord({ cases: [{ case: 'CU4', findings: [f('dead_end', 'S-a very long id with spaces '.repeat(3))] }] });
    const dup = buildWreckerRecord({ cases: [{ case: 'CU4', coverage: cov, findings: [f('dead_end', 'F-1'), f('dead_end', 'f-1')] }] });
    const ids = dup.high_markers.map((m) => /\[FINDING-HIGH: ([^\]]+)\]/.exec(m)[1].toUpperCase());
    expect(new Set(ids).size).toBe(2);
    expect(r.high_markers[0]).toMatch(/^\[FINDING-HIGH: WR-CU4-001\] /);
  });
});
