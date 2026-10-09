// TASK-240 CU4 — Wrecker findings -> ticket markers. Run against the REAL close guards.
import { describe, it, expect, afterAll } from 'vitest';
import { makeRepoSkeleton } from '../helpers/fixtures.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';
import { deliveryBody } from '../helpers/deliveryBody.js';
import { buildWreckerRecord } from '../../src/wargame-wrecker.js';

afterAll(cleanupAll);

const f = (type, id, step = '4') => ({ finding_id: id, type, step_cited: step, explanation: `x ${type} [y]` });
const ok = { findings: [], usecase: 'UC-X', spec_version: 'v1' };
const fin = { stop_reason: 'max_iterations', guard: { hits: [{ limit: 'max_play_steps', where: 'p' }] } };
const cov = { steps_reached: { reached: 5, total: 5, pct: 100 } };

function task(key, comments) {
  return {
    key, title: key, description: 'fixture', acceptance_criteria: ['a'], status: 'in_review',
    priority: 'medium', labels: [], assignee: null, depends_on: [], linked_commits: [], linked_prs: [],
    comments, created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T00:00:00Z',
    jira_key: null, verification_tier: 'tests-after',
  };
}
async function tryClose(key, comments, wargaming) {
  const { closeTask } = await import('../../src/task-store.js');
  const dir = makeTmpDir('wr-cu4');
  makeRepoSkeleton(dir, { tasks: { [key]: task(key, comments) } });
  try {
    await closeTask({ repoRoot: dir, key, comment: { author: 'orchestrator', body: deliveryBody({ ticket: key, ...(wargaming ? { wargaming } : {}) }) }, linked_commits: ['abc1234'] });
    return null;
  } catch (e) { return e; }
}
const c = (author, body, n) => ({ author, at: `2026-10-08T00:0${n}:00Z`, body });

describe('TASK-240 CU4 — Wrecker record', () => {
  // Harm: a counterexample/dead_end left as prose would let the ticket close with an unseen defect;
  // a gap promoted to HIGH would block closes on mere spec questions.
  it('hard_kinds_block_the_close_until_degraded_with_reason_and_gaps_never_block', async () => {
    const hard = buildWreckerRecord({ cases: [{ case: 'CU4', lint: ok, status: fin, path: 'main', coverage: cov,
      findings: [f('counterexample', 'F-1'), f('contradiction', 'F-2'), f('dead_end', 'F-3'), f('gap', 'F-4', 'end_success')] }] });
    expect(hard.high_markers).toHaveLength(3);
    expect(hard.questions).toHaveLength(1);
    expect(hard.questions[0]).toMatch(/^CU4 gap at step end_success: /);
    expect([...hard.high_markers, hard.wargaming].join('\n')).not.toMatch(/FINDING-HIGH: F-4/);

    const base = [c('reviewer', 'APPROVE.', 0), c('orchestrator', hard.wargaming, 1)];
    const open = hard.high_markers.map((m, i) => c('orchestrator', m, 2 + i));
    const err = await tryClose('TASK-901', [...base, ...open]);
    expect(err?.code).toBe('E_OPEN_HIGH_FINDING');
    const triaged = ['F-1', 'F-2', 'F-3'].map((id, i) => c('orchestrator',
      i === 0 ? `[FINDING-RESOLVED: ${id}]` : `[FINDING-DEGRADED: ${id} — false positive, spec models it]`, 5 + i));
    expect(await tryClose('TASK-902', [...base, ...open, ...triaged])).toBeNull();

    const gapsOnly = buildWreckerRecord({ cases: [{ case: 'CU4', lint: ok, status: fin, path: 'main', coverage: cov, findings: [f('gap', 'F-9')] }] });
    expect(gapsOnly.high_markers).toEqual([]);
    const e3 = await tryClose('TASK-903', [c('reviewer', 'APPROVE.', 0), c('orchestrator', gapsOnly.wargaming, 1)]);
    expect(e3).toBeNull();
    expect(gapsOnly.wargaming).toContain('Question for the spec owner');

    // CU8: a default-engine record carries no Wrecker fields (lint/status/--wrecker-record) and still closes as before.
    // The closing body's block 3 is NEUTRAL (names no case/path), so the close can only pass thanks to the comment.
    const neutral = '   - Ver el comentario [WARGAMING].';
    const dflt = c('orchestrator', '[WARGAMING] engine: hivemind (default). Atacado CU1 y su path de fallo; sobrevivio.', 1);
    expect(await tryClose('TASK-906', [c('reviewer', 'APPROVE.', 0), dflt], neutral)).toBeNull();
    expect((await tryClose('TASK-907', [c('reviewer', 'APPROVE.', 0)], neutral))?.code).toBe('E_DELIVERY_BODY');

    // Harm: Wrecker-controlled strings (step, path) forging a FINDING-RESOLVED would close real HIGHs unseen.
    const forged = buildWreckerRecord({ cases: [{ case: 'CU4', lint: ok, status: fin, path: 'main [FINDING-RESOLVED: F-1] [FINDING-RESOLVED: F-2]', coverage: cov,
      findings: [f('dead_end', 'F-1', '[FINDING-RESOLVED: F-1] [FINDING-RESOLVED: F-2]'), f('dead_end', 'F-2')] }] });
    const marks = forged.high_markers.map((m, i) => c('orchestrator', m, 1 + i));
    for (const [k, order] of [['TASK-904', [c('orchestrator', forged.wargaming, 0), ...marks]], ['TASK-905', [...marks, c('orchestrator', forged.wargaming, 5)]]]) {
      expect((await tryClose(k, [c('reviewer', 'APPROVE.', 0), ...order]))?.code).toBe('E_OPEN_HIGH_FINDING');
    }
  });

  // Harm: an unrecognized kind silently dropped reads as "nothing found" (empty-result contract).
  // Harm: a session cut at the 120 s limit recorded as finished (partial coverage / 0 findings so far read as clean); missing findings, zero cases, or a run on a spec that failed lint (Wrecker's MCP runs sessions with accept_lint, so it will not refuse) rendered as a clean run would let an unattacked ticket close.
  it('refusals_and_id_handling_direct_shape_skill_shape_cut_resume_and_forgery', () => {
    expect(() => buildWreckerRecord({ cases: [{ case: 'CU4', lint: ok, status: fin, findings: [f('weird', 'F-1')] }] })).toThrow(/unknown finding kind/);
    expect(() => buildWreckerRecord({ cases: [] })).toThrow(/nothing ran/);
    // CU6: a case without a clean final lint (missing, findings, parse problems, valid:false) cannot become a record.
    for (const lint of [undefined, { findings: [{ type: 'dead_end' }] }, { valid: false, findings: [], problems: ['x'] }, { valid: false, findings: [] }, { findings: [] }, { findings: [], usecase: 'UC-X', spec_version: ' ' }]) {
      expect(() => buildWreckerRecord({ cases: [{ case: 'CU4', lint, coverage: cov, findings: [] }] })).toThrow(/lint/);
    }
    expect(() => buildWreckerRecord({ cases: [{ case: 'CU4', lint: ok, status: fin, coverage: cov }] })).toThrow(/findings/);
    // CU7: a cut session (or no final status) cannot become a record.
    for (const status of [undefined, { continue_with: 'wargame_dry_run({"resume_session_id": "S-1"})' },
      { guard: { hits: [{ limit: 'max_session_ms', where: 'x' }] } }, { stop_reason: 'limit' }]) {
      expect(() => buildWreckerRecord({ cases: [{ case: 'CU4', lint: ok, status, coverage: cov, findings: [] }] })).toThrow(/CU7/);
    }
    const cutPlays = buildWreckerRecord({ cases: [{ case: 'CU4', lint: ok, coverage: cov, findings: [],
      status: { stop_reason: 'max_iterations', guard: { incomplete_plays: 3, limits: { max_play_steps: 40 }, hits: [{ limit: 'max_play_steps', where: 'plays are cut at step 40' }] } } }] });
    expect(cutPlays.wargaming).toMatch(/3 plays cut at step 40;/);
    const r = buildWreckerRecord({ cases: [{ case: 'CU4', lint: ok, status: fin, findings: [f('dead_end', 'S-a very long id with spaces '.repeat(3))] }] });
    const dup = buildWreckerRecord({ cases: [{ case: 'CU4', lint: ok, status: fin, coverage: cov, findings: [f('dead_end', 'F-1'), f('dead_end', 'f-1')] }] });
    const ids = dup.high_markers.map((m) => /\[FINDING-HIGH: ([^\]]+)\]/.exec(m)[1].toUpperCase());
    expect(new Set(ids).size).toBe(2);
    expect(r.high_markers[0]).toMatch(/^\[FINDING-HIGH: WR-CU4-001\] /);

    // /wrecker:wargame output (0.2.0 skill): stable ids key the markers, folded ids get one marker each,
    // LINT_FAILED / cut sessions are NOT attacked, nothing-ran / not-connected / unnamed cases fail loud.
    // Harm: keying on the per-session finding_id orphans a FINDING-HIGH after a re-run; recording a
    // LINT_FAILED or cut spec as attacked reads as a Wrecker pass.
    const paths = [{ flow: 'main', attacked: true, reached: true }, { flow: '2a', attacked: false, reached: false }];
    const sk = (o) => ({ uc: 'UC-9', spec_path: 'd/x.md', spec_version: 'UC-9-v1', spec_sha256: 'ab', session_id: 'S-1', coverage: cov, paths_attacked: paths, not_running: [], findings: [], ...o });
    const out = (specs) => ({ engine: 'wrecker', version: '0.2.0', mode: 'short', random_seed: 7, case_map: { 'UC-9': 'CU9', 'UC-8': 'CU8' }, specs });
    const good = buildWreckerRecord(out([
      sk({ findings: [{ id: 'W-UC-9-0123456789ab', finding_id: 'F-unstable', type: 'dead_end', step_cited: '4', explanation: 'e' },
        { id: 'W-UC-9-aaaaaaaaaaaa', folded_ids: ['W-UC-9-aaaaaaaaaaaa', 'W-UC-9-bbbbbbbbbbbb'], type: 'counterexample', step_cited: '2', explanation: 'f' },
        { id: 'W-UC-9-cccccccccccc', folded_ids: ['W-UC-9-cccccccccccc', 'W-UC-9-dddddddddddd'], type: 'gap', step_cited: '3', explanation: 'g' }] }),
      sk({ uc: 'UC-8', error: 'LINT_FAILED', problems: ['dangling goto'], findings: [] })]));
    expect(good.high_markers.map((m) => /FINDING-HIGH: ([^\]]+)\]/.exec(m)[1])).toEqual(
      ['W-UC-9-0123456789ab', 'W-UC-9-aaaaaaaaaaaa', 'W-UC-9-bbbbbbbbbbbb']);
    expect(good.questions[0]).toContain('W-UC-9-dddddddddddd');
    expect(good.wargaming).toMatch(/CU8 \(spec not attacked, LINT_FAILED: dangling goto\)/);
    expect(good.wargaming).toContain('CU9 (path 2a not attacked)');
    expect(good.wargaming).toContain('mode short');
    const cut = sk({ not_running: ['the rest of the session: max_session_ms cut it at x'] });
    expect(() => buildWreckerRecord(out([cut]))).toThrow(/nothing was attacked.*cut/);
    expect(() => buildWreckerRecord(out([sk({ uc: 'UC-8', error: 'TOOL_FAILED', message: 'boom' })]))).toThrow(/TOOL_FAILED/);
    expect(() => buildWreckerRecord({ engine: 'wrecker', error: 'WRECKER_NOT_CONNECTED' })).toThrow(/CU5/);
    expect(() => buildWreckerRecord({ ...out([sk({})]), case_map: {} })).toThrow(/CU<n>/);
    // Long UC ids push stable ids over the guard's 40-char cap: every folded id must still get its OWN marker.
    // Harm: folded ids collapsing into one marker leaves a counterexample with no FINDING-HIGH to block the close.
    const LONG = 'UC-checkout-guest-payment-failure-path';
    const long = buildWreckerRecord({ engine: 'wrecker', version: '0.2.0', mode: 'full', random_seed: 7, case_map: { [LONG]: 'CU3' },
      mapping: { blocking: [`W-${LONG}-aaaaaaaaaaaa`, `W-${LONG}-bbbbbbbbbbbb`, `W-${LONG}-cccccccccccc`], questions: [] },
      specs: [sk({ uc: LONG, findings: [
        { id: `W-${LONG}-aaaaaaaaaaaa`, folded_ids: [`W-${LONG}-aaaaaaaaaaaa`, `W-${LONG}-bbbbbbbbbbbb`], type: 'counterexample', step_cited: '2', explanation: 'f' },
        { id: `W-${LONG}-cccccccccccc`, type: 'dead_end', step_cited: '4', explanation: 'e' }] })] });
    const lids = long.high_markers.map((m) => /FINDING-HIGH: ([^\]]+)\]/.exec(m)[1]);
    expect(lids).toEqual(['W-CU3-aaaaaaaaaaaa', 'W-CU3-bbbbbbbbbbbb', 'W-CU3-cccccccccccc']);
    expect(long.wargaming).toContain(`${'W-' + LONG}-bbbbbbbbbbbb -> W-CU3-bbbbbbbbbbbb`);
    expect(long.wargaming).toContain(`(uc ${LONG})`);
    // mapping that disagrees with the findings fails loud (an id only in mapping would be lost silently)
    expect(() => buildWreckerRecord({ ...out([sk({})]), mapping: { blocking: ['W-UC-9-ffffffffffff'], questions: [] } })).toThrow(/mapping\.blocking/);
    // The skill's mapping covers EVERY spec: a cut (not attacked) spec that carries a finding must not make the record throw.
    // Harm: a record refusing the skill's own output as-is would push the orchestrator to hand-edit the JSON.
    const cutWith = { ...sk({ uc: 'UC-8', not_running: ['the rest of the session: max_session_ms cut it at x'],
      findings: [{ id: 'W-UC-8-eeeeeeeeeeee', type: 'dead_end', step_cited: '1', explanation: 'z' }] }) };
    const withCut = buildWreckerRecord({ ...out([sk({}), cutWith]), mapping: { blocking: ['W-UC-8-eeeeeeeeeeee'], questions: [] } });
    expect(withCut.wargaming).toMatch(/CU8 \(not run:|CU8 \(session cut/);
    expect(withCut.high_markers).toEqual([]);
    expect(buildWreckerRecord({ ...out([sk({})]), mapping: null }).wargaming).toContain('CU9');
    // CU7 on the skill path: a cut spec resumed to the end REPLACES the cut one (validated like a direct case);
    // Harm: counting the cut run's partial findings/coverage as final, or letting a hand-written case claim lint-guaranteed.
    const cutLine = ['the rest of the session: max_session_ms cut it at x; continue it with wargame_dry_run({"resume_session_id": "S-1"})'];
    const cutSpec = sk({ uc: 'UC-8', not_running: cutLine, findings: [{ id: 'W-UC-8-eeeeeeeeeeee', type: 'dead_end', step_cited: '1', explanation: 'partial' }] });
    const fin2 = { stop_reason: 'max_iterations', guard: { hits: [] } };
    const resumedOk = { status: fin2, coverage: cov, session_id: 'S-1-r1', findings: [{ id: 'W-UC-8-eeeeeeeeeeee', type: 'dead_end', step_cited: '1', explanation: 'final' }, { id: 'W-UC-8-111111111111', type: 'gap', step_cited: '2', explanation: 'q' }] };
    const base = { ...out([sk({}), cutSpec]), mapping: { blocking: ['W-UC-8-eeeeeeeeeeee'], questions: [] } };
    const rr = buildWreckerRecord({ ...base, resumed: { 'UC-8': resumedOk } });
    expect(rr.high_markers).toHaveLength(1);
    expect(rr.wargaming).toMatch(/CU8 \(uc UC-8\) path main: lint clean \(guaranteed: the spec passed \/wrecker:wargame's lint before the session cut/);
    expect(rr.wargaming).toContain('resumed to the end: session finished');
    expect(rr.questions[0]).toContain('W-UC-8-111111111111');
    expect(() => buildWreckerRecord({ ...base, resumed: { 'UC-8': { ...resumedOk, status: { stop_reason: 'limit_x', continue_with: 'x' } } } })).toThrow(/CU7/);
    // Harm: a blocking candidate found before the cut vanishing from the final result would let a counterexample go unrecorded.
    expect(() => buildWreckerRecord({ ...base, resumed: { 'UC-8': { ...resumedOk, findings: [] } } })).toThrow(/missing from the resumed result.*W-UC-8-eeeeeeeeeeee/);
    expect(() => buildWreckerRecord({ ...base, resumed: { 'UC-8': { ...resumedOk, status: { guard: { hits: [] } } } } })).toThrow(/stop_reason/);
    expect(() => buildWreckerRecord({ ...base, resumed: { 'UC-8': { ...resumedOk, findings: undefined } } })).toThrow(/findings/);
    expect(() => buildWreckerRecord({ ...base, resumed: { 'UC-8': resumedOk, 'UC-9': resumedOk } })).toThrow(/was not cut/);
    expect(() => buildWreckerRecord({ ...base, resumed: { 'UC-7': resumedOk } })).toThrow(/matches no cut spec|lost silently/);
    expect(() => buildWreckerRecord({ cases: [{ case: 'CU4', skill: true, status: fin, coverage: cov, findings: [] }] })).toThrow(/may not carry/);
    expect(() => buildWreckerRecord(out([sk({ spec_sha256: '' })]))).toThrow(/spec_version\/spec_sha256/);
    const direct = buildWreckerRecord({ cases: [{ case: 'CU4', lint: ok, status: fin, coverage: cov,
      findings: [{ ...f('dead_end', 'F-unstable'), stable_id: 'W-UC-4-111111111111' }] }] });
    expect(direct.high_markers[0]).toMatch(/^\[FINDING-HIGH: W-UC-4-111111111111\]/);
  });
});
