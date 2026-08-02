// Round 3 — Challenger-proposed probes, executed against real shipped code.
// These target guards that are DOCUMENTED TO WORK, in LOOP mode (the hardened path).
// Challenger probes #10 (FAIL-token evasion), #13 (calibration laundering), #12 (mode-flip window).

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { createTask, closeTask, appendComment } =
  await import('file:///C:/Fun/hivemind/hivemind/src/task-store.js');
const { setMode, getMode } =
  await import('file:///C:/Fun/hivemind/hivemind/src/operating-mode.js');

const root = mkdtempSync(join(tmpdir(), 'acfid3-'));
mkdirSync(join(root, 'tasks'), { recursive: true });
const SID = '20260802T000000Z-0123abcd';
mkdirSync(join(root, 'state', 'sessions', SID), { recursive: true });

function writeBundle(mode, loopAuth) {
  writeFileSync(join(root, 'state', 'session.json'), JSON.stringify({
    schema_version: 2, active_session_id: SID, updated_at: new Date(0).toISOString(),
  }, null, 2));
  writeFileSync(join(root, 'state', 'sessions', SID, 'session.json'), JSON.stringify({
    schema_version: 2, session_id: SID, lifecycle_state: 'active',
    updated_at: new Date(0).toISOString(), active_task: null, workflow_step: 'idle',
    next_action: 'probe', handoff_summary: 'probe', open_questions: [], blockers: [],
    decisions: [], subagent_results: [], pending_human_confirmation: null,
    mode, loop_auth: loopAuth,
  }, null, 2));
}
const DENY_ALL = {
  auto_close_on_green_review: false, uat_delegated_to_orchestrator: false,
  auto_consolidate: false, auto_push_after_close: false, auto_version_bump_on_milestone: false,
};
async function attempt(fn) {
  try { return { ok: true, value: await fn() }; }
  catch (e) { return { ok: false, code: e.code, message: String(e.message).slice(0, 220) }; }
}
const results = [];
function record(id, desc, verdict, detail) {
  results.push({ id, verdict });
  console.log(`\n[${id}] ${desc}\n  VERDICT: ${verdict}\n  ${detail}`);
}
const base = { repoRoot: root, description: 'Probe.', priority: 'medium' };

// ---- C1 (Challenger #10): UAT record with a REAL failure that uses no FAIL-family token.
writeBundle('harness', DENY_ALL);
{
  const t = await attempt(() => createTask({
    ...base, title: 'C1 FAIL-token evasion',
    acceptance_criteria: ['CSV export works.', 'XLSX export works.'],
    verification_tier: 'uat-only',
  }));
  // Authored in harness mode (freely writable there — proven in round 1).
  const body = [
    'UAT script:',
    '1. Run `npm run export -- --format=csv`, expect a CSV. Observed: file created. Verdict: PASS',
    '2. Open the CSV, expect correct headers. Observed: headers present. Verdict: PASS',
    '3. Run with --format=xlsx, expect an XLSX file. Observed: command exited with an unhandled',
    '   TypeError and no file was written; deferred to a follow-up ticket, not a blocker for this',
    '   scope. Verdict: PASS (deferred)',
    '',
    'Overall result: PASS',
  ].join('\n');
  const a = await attempt(() => appendComment({ repoRoot: root, key: t.value.key, author: 'uat', body }));
  // Now switch to LOOP mode — the hardened path, delegation NOT granted — and close.
  await setMode({ repoRoot: root, mode: 'loop' });
  const c = await attempt(() => closeTask({
    repoRoot: root, key: t.value.key,
    comment: { author: 'orchestrator', body: 'UAT passed. Closing.' },
  }));
  record('C1', 'Challenger #10 — loop mode, no delegation grant, UAT hides a real failure behind "PASS (deferred)"',
    c.ok ? 'MISSED' : 'CAUGHT',
    c.ok
      ? `Closed to done in LOOP mode with no delegation grant. AC2 ("XLSX export works") is recorded as an unhandled TypeError with no file written, yet the human-verdict marker accepted it: the body says "Overall result: PASS" and contains no FAIL-family token. The widened token match does not generalize past its literal token list.`
      : `blocked: ${c.code} — ${c.message}`);
}

// ---- C2 (Challenger #13): calibration laundering — strongest marker, weakest evidence tier.
writeBundle('harness', DENY_ALL);
{
  const r = await attempt(() => createTask({
    ...base, title: 'C2 calibration laundering',
    acceptance_criteria: ['The claim holds.'],
    marker: '[EXPLICIT]', source_tier: 'T4',
  }));
  record('C2', 'Challenger #13 — marker:[EXPLICIT] (strongest certainty) with source_tier:T4 (orientation-only evidence)',
    r.ok ? 'MISSED' : 'CAUGHT',
    r.ok
      ? `Accepted. The schema states "[EXPLICIT] requires T1/T2; T4 is orientation-only" in PROSE only — there is no if/then cross-field rule, so each field is individually valid and the combination sails through. This is the "calibration laundering" class the review rubric names as a recurring HIGH.`
      : `Rejected: ${r.code} — ${r.message}`);
}

// ---- C3 (Challenger #12): open a harness window around a single close to dodge Gate 1.
{
  writeBundle('loop', DENY_ALL);
  const t = await attempt(() => createTask({
    ...base, title: 'C3 mode-flip window', acceptance_criteria: ['Ships.'],
    verification_tier: 'tests-after',
  }));
  // Baseline: loop mode, auto_close_on_green_review = false -> Gate 1 should block.
  const blocked = await attempt(() => closeTask({
    repoRoot: root, key: t.value.key, comment: { author: 'orchestrator', body: 'Closing.' },
  }));
  // The bypass: flip to harness (where Gate 1 is a documented no-op), close, flip back.
  await setMode({ repoRoot: root, mode: 'harness' });
  const sneaked = await attempt(() => closeTask({
    repoRoot: root, key: t.value.key, comment: { author: 'orchestrator', body: 'Closing on green review.' },
  }));
  await setMode({ repoRoot: root, mode: 'loop' });
  const modeAfter = await getMode({ repoRoot: root });
  record('C3', 'Challenger #12 — set-mode harness / close / set-mode loop, with auto_close_on_green_review FALSE',
    (!blocked.ok && sneaked.ok) ? 'MISSED' : (blocked.ok ? 'MISSED (no baseline block)' : 'CAUGHT'),
    (!blocked.ok && sneaked.ok)
      ? `Gate 1 correctly blocked the direct close (${blocked.code}). The same close then SUCCEEDED after flipping to harness and back. Final mode reads "${modeAfter}" — the bundle looks untouched, so the audit trail shows a loop-mode session that closed a ticket without the required grant. set-mode is an unprivileged primitive the orchestrator already owns.`
      : `baseline blocked=${!blocked.ok} (${blocked.code ?? 'n/a'}), bypass ok=${sneaked.ok} (${sneaked.code ?? ''})`);
}

console.log('\n\n=========== ROUND 3 (CHALLENGER PROBES) SUMMARY ===========');
const missed = results.filter(x => String(x.verdict).startsWith('MISSED'));
console.log(`probes=${results.length}  MISSED=${missed.length}  CAUGHT=${results.length - missed.length}`);
for (const x of results) console.log(`  ${String(x.verdict).padEnd(22)} ${x.id}`);
console.log('\nfixture dir:', root);
