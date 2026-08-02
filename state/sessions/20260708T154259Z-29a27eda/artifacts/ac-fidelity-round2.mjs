// Round 2 — ADAPTATION. The only gate that caught in round 1 was UAT_GUARD_REQUIRED.
// Question: does it check that a UAT verdict is GENUINE, or only that a comment exists?
// Plus: is workflow ORDER enforced at all (todo -> done without ever being reviewed)?

import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { createTask, transitionStatus, closeTask, appendComment } =
  await import('file:///C:/Fun/hivemind/hivemind/src/task-store.js');

const root = mkdtempSync(join(tmpdir(), 'acfid2-'));
mkdirSync(join(root, 'tasks'), { recursive: true });

const results = [];
function record(id, adaptation, verdict, detail) {
  results.push({ id, adaptation, verdict, detail });
  console.log(`\n[${id}] ${adaptation}\n  VERDICT: ${verdict}\n  ${detail}`);
}
async function attempt(fn) {
  try { return { ok: true, value: await fn() }; }
  catch (e) { return { ok: false, code: e.code, message: String(e.message).slice(0, 240) }; }
}
const base = { repoRoot: root, description: 'Probe.', priority: 'medium' };

async function uatProbe(id, adaptation, body, expectMeaning) {
  const t = await attempt(() => createTask({
    ...base, title: id, acceptance_criteria: ['Human confirms the behaviour.'],
    verification_tier: 'uat-only',
  }));
  if (!t.ok) return record(id, adaptation, 'ERROR', `createTask failed: ${t.message}`);
  const a = await attempt(() => appendComment({ repoRoot: root, key: t.value.key, author: 'uat', body }));
  if (!a.ok) return record(id, adaptation, 'CAUGHT', `append blocked: ${a.code} — ${a.message}`);
  const c = await attempt(() => closeTask({
    repoRoot: root, key: t.value.key,
    comment: { author: 'orchestrator', body: 'Closing.' },
  }));
  record(id, adaptation, c.ok ? 'MISSED' : 'CAUGHT',
    c.ok ? expectMeaning : `close blocked: ${c.code} — ${c.message}`);
}

// A1 — the UAT verdict explicitly says the work FAILED.
await uatProbe('A1', 'uat comment states an explicit FAIL verdict',
  ['1. Run it, expect the banner. Observed: crash. FAIL',
   '', 'Overall result: FAIL'].join('\n'),
  'Closed to done on a uat comment whose own verdict is FAIL. In harness mode the guard checks PRESENCE of an author:uat comment, not its verdict.');

// A2 — empty UAT body.
await uatProbe('A2', 'uat comment with an EMPTY body', '',
  'Closed to done on an empty uat comment. Presence of the author tag alone satisfies the gate.');

// A3 — uat comment with entirely unrelated content.
await uatProbe('A3', 'uat comment with unrelated content',
  'Reminder: order sandwiches for the Thursday planning session.',
  'Closed to done on a uat comment containing no verdict, no steps, and no relation to the ACs.');

// A4 — bypass closeTask entirely: transition straight to done.
{
  const t = await attempt(() => createTask({
    ...base, title: 'A4', acceptance_criteria: ['Human confirms.'], verification_tier: 'uat-only',
  }));
  const a = await attempt(() => appendComment({
    repoRoot: root, key: t.value.key, author: 'uat', body: 'Overall result: FAIL',
  }));
  const c = await attempt(() => transitionStatus({ repoRoot: root, key: t.value.key, status: 'done' }));
  record('A4', 'transition_status straight to done, FAIL verdict on record',
    c.ok ? 'MISSED' : 'CAUGHT',
    c.ok ? 'transition_status flipped a uat-only ticket to done while its recorded UAT verdict is FAIL.'
         : `blocked: ${c.code} — ${c.message}`);
}

// A5 — workflow ORDER: todo straight to done, never in_progress, never in_review.
{
  const t = await attempt(() => createTask({
    ...base, title: 'A5', acceptance_criteria: ['Something substantial ships.'],
    verification_tier: 'tdd',
  }));
  const c = await attempt(() => closeTask({
    repoRoot: root, key: t.value.key, comment: { author: 'orchestrator', body: 'Done.' },
  }));
  const finalStatus = c.ok ? 'done' : 'blocked';
  record('A5', 'todo -> done in one hop (no in_progress, no in_review, no review at all)',
    c.ok ? 'MISSED' : 'CAUGHT',
    c.ok ? `A tdd ticket went straight from todo to ${finalStatus}. No state machine enforces that a review ever happened.`
         : `blocked: ${c.code} — ${c.message}`);
}

// A6 — can a ticket be closed against ACs that were emptied after creation?
{
  const t = await attempt(() => createTask({
    ...base, title: 'A6', acceptance_criteria: ['The hard thing is done properly.'],
    verification_tier: 'tests-after',
  }));
  const c = await attempt(() => closeTask({
    repoRoot: root, key: t.value.key,
    comment: { author: 'reviewer', body: 'APPROVE. All acceptance criteria met.' },
  }));
  record('A6', "close_task accepts author:'reviewer' from any caller",
    c.ok ? 'MISSED' : 'CAUGHT',
    c.ok ? "The orchestrator authored the REVIEWER's approval itself. Nothing binds an author:'reviewer' comment to an actual reviewer subagent having run."
         : `blocked: ${c.code} — ${c.message}`);
}

console.log('\n\n============ ROUND 2 (ADAPTATION) SUMMARY ============');
const missed = results.filter(x => x.verdict === 'MISSED');
console.log(`probes=${results.length}  MISSED=${missed.length}  CAUGHT=${results.length - missed.length}`);
for (const x of results) console.log(`  ${x.verdict.padEnd(7)} ${x.id.padEnd(4)} ${x.adaptation}`);
console.log('\nfixture dir:', root);
