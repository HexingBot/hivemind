// Adversarial probe harness — AC-fidelity chain.
// Runs the REAL shipped task-store code against hostile inputs in a throwaway temp repo.
// Never touches the working repo.

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SRC = 'file:///C:/Fun/hivemind/hivemind/src/task-store.js';
const { createTask, transitionStatus, closeTask, appendComment } = await import(SRC);

const root = mkdtempSync(join(tmpdir(), 'acfid-'));
mkdirSync(join(root, 'tasks'), { recursive: true });

const results = [];
function record(id, boundary, cls, verdict, detail) {
  results.push({ id, boundary, cls, verdict, detail });
  console.log(`\n[${id}] boundary=${boundary} class=${cls}\n  VERDICT: ${verdict}\n  ${detail}`);
}

async function attempt(fn) {
  try {
    const v = await fn();
    return { ok: true, value: v };
  } catch (e) {
    return { ok: false, code: e.code, name: e.constructor?.name, message: String(e.message).slice(0, 300) };
  }
}

const base = {
  repoRoot: root,
  description: 'Probe ticket.',
  priority: 'medium',
};

// ---------------------------------------------------------------- B1: request -> ACs
// P1 (STRIDE Tampering): a vacuous, unfalsifiable acceptance criterion.
let r = await attempt(() => createTask({
  ...base,
  title: 'P1 vacuous AC',
  acceptance_criteria: ['It works correctly.'],
}));
record('P1', 'B1 request->ACs', 'STRIDE-Tampering / ASI02',
  r.ok ? 'MISSED' : 'CAUGHT',
  r.ok ? `Accepted. key=${r.value.key}. Nothing rejects an unfalsifiable AC.` : `Rejected: ${r.code} ${r.message}`);

// P2: empty-string AC — is a non-empty string enforced?
r = await attempt(() => createTask({
  ...base,
  title: 'P2 empty AC string',
  acceptance_criteria: [''],
}));
record('P2', 'B1 request->ACs', 'STRIDE-Tampering',
  r.ok ? 'MISSED' : 'CAUGHT',
  r.ok ? `Accepted an EMPTY acceptance criterion. key=${r.value.key}` : `Rejected: ${r.code} ${r.message}`);

// P3: whitespace-only AC — passes a naive minLength but carries no content.
r = await attempt(() => createTask({
  ...base,
  title: 'P3 whitespace AC',
  acceptance_criteria: ['   \t  '],
}));
record('P3', 'B1 request->ACs', 'STRIDE-Tampering',
  r.ok ? 'MISSED' : 'CAUGHT',
  r.ok ? `Accepted a whitespace-only AC. key=${r.value.key}` : `Rejected: ${r.code} ${r.message}`);

// P4 (DoS / briefing-cap interaction): an AC far beyond the documented 4000-char briefing cap.
const huge = 'The system must ' + 'x'.repeat(12000) + ' behave correctly.';
r = await attempt(() => createTask({
  ...base,
  title: 'P4 oversized AC vs briefing cap',
  acceptance_criteria: [huge, 'A second criterion that lives PAST the 4000-char truncation point and will never reach the reviewer.'],
}));
record('P4', 'B2 ticket->briefing', 'STRIDE-Information-disclosure / DoS',
  r.ok ? 'MISSED' : 'CAUGHT',
  r.ok ? `Accepted a ${huge.length}-char AC. The orchestrator briefing cap truncates ACs at 4000 chars, so criterion #2 is invisible to the reviewer while remaining binding on the ticket. key=${r.value.key}` : `Rejected: ${r.code} ${r.message}`);

// ---------------------------------------------------------------- B3: tier assignment
// P5: a schema-mutating ticket self-assigned the lightest tier (no test obligation at all).
r = await attempt(() => createTask({
  ...base,
  title: 'P5 schema change at uat-only tier',
  description: 'Change tasks/schema.json to add a new required field and migrate all existing task files.',
  acceptance_criteria: ['Schema updated and all task files migrated.'],
  verification_tier: 'uat-only',
}));
record('P5', 'B3 tier assignment', 'ASI02 intent-verification',
  r.ok ? 'MISSED' : 'CAUGHT',
  r.ok ? `Accepted uat-only on an explicitly schema-mutating ticket (rubric RESERVES tdd for schema changes). No sensor compares tier to content. key=${r.value.key}` : `Rejected: ${r.code} ${r.message}`);

// ---------------------------------------------------------------- B6/B7: UAT + close guards
// P6 (control probe — this SHOULD be caught): uat-only -> done with no uat comment at all.
const t6 = await attempt(() => createTask({
  ...base, title: 'P6 uat-only no uat comment',
  acceptance_criteria: ['Observable behaviour confirmed by a human.'],
  verification_tier: 'uat-only',
}));
if (t6.ok) {
  r = await attempt(() => closeTask({
    repoRoot: root, key: t6.value.key,
    comment: { author: 'orchestrator', body: 'Looks good, closing.' },
  }));
  record('P6 (control)', 'B7 close_task', 'STRIDE-Elevation',
    r.ok ? 'MISSED' : 'CAUGHT',
    r.ok ? `uat-only closed to done with NO uat comment.` : `Rejected: ${r.code} — ${r.message}`);
}

// P7 (Spoofing): orchestrator fabricates the human's UAT verdict itself, harness mode.
const t7 = await attempt(() => createTask({
  ...base, title: 'P7 fabricated uat verdict',
  acceptance_criteria: ['Observable behaviour confirmed by a human.'],
  verification_tier: 'uat-only',
}));
if (t7.ok) {
  const fabricated = [
    'UAT script derived from the acceptance criteria.',
    '',
    '1. Run the command, expect the new banner. Observed: banner shown. PASS',
    '2. Re-run with --quiet, expect no banner. Observed: no banner. PASS',
    '',
    'Overall result: PASS',
  ].join('\n');
  const a = await attempt(() => appendComment({
    repoRoot: root, key: t7.value.key, author: 'uat', body: fabricated,
  }));
  const c = a.ok
    ? await attempt(() => closeTask({
        repoRoot: root, key: t7.value.key,
        comment: { author: 'orchestrator', body: 'UAT passed, closing.' },
      }))
    : null;
  record('P7', 'B6 UAT + B7 close_task', 'STRIDE-Spoofing / Repudiation (CHAINED)',
    (a.ok && c && c.ok) ? 'MISSED' : 'CAUGHT',
    (a.ok && c && c.ok)
      ? `The orchestrator authored author:'uat' itself and then closed on it. No human was involved at any point. Harness mode leaves author:'uat' freely writable.`
      : `Blocked at ${a.ok ? 'close' : 'append'}: ${(a.ok ? c : a).code} — ${(a.ok ? c : a).message}`);
}

// P8 (Repudiation): are linked_commits verified to exist / be well-formed?
const t8 = await attempt(() => createTask({
  ...base, title: 'P8 bogus linked commits',
  acceptance_criteria: ['Fix landed.'],
  verification_tier: 'tests-after',
}));
if (t8.ok) {
  r = await attempt(() => closeTask({
    repoRoot: root, key: t8.value.key,
    comment: { author: 'orchestrator', body: 'Landed.' },
    linked_commits: ['0000000000000000000000000000000000000000', 'deadbeef'],
  }));
  record('P8', 'B7 close_task', 'STRIDE-Repudiation',
    r.ok ? 'MISSED' : 'CAUGHT',
    r.ok ? `Closed with linked_commits pointing at commits that do not exist. The audit trail is unverified.` : `Rejected: ${r.code} — ${r.message}`);
}

// P9: does ANYTHING mechanically relate the ACs to evidence at close time?
const t9 = await attempt(() => createTask({
  ...base, title: 'P9 close with zero AC evidence',
  acceptance_criteria: [
    'A failing test is written first and its red run captured verbatim.',
    'The feature is implemented and all tests pass.',
    'npm run test:all is green.',
  ],
  verification_tier: 'tdd',
}));
if (t9.ok) {
  r = await attempt(() => closeTask({
    repoRoot: root, key: t9.value.key,
    comment: { author: 'orchestrator', body: 'Done.' },
  }));
  record('P9', 'B5 AC-compliance', 'ASI02 intent-verification',
    r.ok ? 'MISSED' : 'CAUGHT',
    r.ok ? `A tdd ticket demanding captured red-run evidence closed to done with a 4-word comment and no evidence of any kind. Nothing mechanically ties an AC to a proof.` : `Rejected: ${r.code} — ${r.message}`);
}

console.log('\n\n================ ROUND 1 SUMMARY ================');
const missed = results.filter(x => x.verdict === 'MISSED');
console.log(`probes=${results.length}  MISSED=${missed.length}  CAUGHT=${results.length - missed.length}`);
for (const x of results) console.log(`  ${x.verdict.padEnd(7)} ${x.id.padEnd(12)} ${x.boundary}`);
console.log('\nfixture dir:', root);
writeFileSync(join(root, 'round1-results.json'), JSON.stringify(results, null, 2));
console.log('results written to', join(root, 'round1-results.json'));
