// Round 3b — CORRECTED. Round 3 called closeTask() directly with no closeGuard,
// so the loop-mode guards never ran. This composes them exactly as src/mcp-server.js does.

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { createTask, closeTask, appendComment } =
  await import('file:///C:/Fun/hivemind/hivemind/src/task-store.js');
const { loopModeCloseGuard, loopModeUatCommentGuard } =
  await import('file:///C:/Fun/hivemind/hivemind/src/close-guard.js');

const SID = '20260802T000000Z-0123abcd';
function makeRepo(mode, loopAuth) {
  const root = mkdtempSync(join(tmpdir(), 'acfid3b-'));
  mkdirSync(join(root, 'tasks'), { recursive: true });
  mkdirSync(join(root, 'state', 'sessions', SID), { recursive: true });
  writeFileSync(join(root, 'state', 'session.json'), JSON.stringify({
    schema_version: 2, active_session_id: SID, updated_at: new Date(0).toISOString() }, null, 2));
  writeFileSync(join(root, 'state', 'sessions', SID, 'session.json'), JSON.stringify({
    schema_version: 2, session_id: SID, lifecycle_state: 'active',
    updated_at: new Date(0).toISOString(), active_task: null, workflow_step: 'idle',
    next_action: 'p', handoff_summary: 'p', open_questions: [], blockers: [],
    decisions: [], subagent_results: [], pending_human_confirmation: null,
    mode, loop_auth: loopAuth }, null, 2));
  return root;
}
const DENY = { auto_close_on_green_review: false, uat_delegated_to_orchestrator: false,
  auto_consolidate: false, auto_push_after_close: false, auto_version_bump_on_milestone: false };
const GRANT_CLOSE = { ...DENY, auto_close_on_green_review: true };

async function attempt(fn) {
  try { return { ok: true, value: await fn() }; }
  catch (e) { return { ok: false, code: e.code, message: String(e.message).slice(0, 200) }; }
}
// Exactly the mcp-server close_task composition.
async function mcpCloseTask({ repoRoot, key, comment, linked_commits = [] }) {
  await loopModeUatCommentGuard({ repoRoot, author: comment.author });
  return closeTask({ repoRoot, key, comment, linked_commits, closeGuard: loopModeCloseGuard });
}
async function mcpAppendComment({ repoRoot, key, author, body }) {
  await loopModeUatCommentGuard({ repoRoot, author });
  return appendComment({ repoRoot, key, author, body });
}
const results = [];
function record(id, desc, verdict, detail) {
  results.push({ id, verdict });
  console.log(`\n[${id}] ${desc}\n  VERDICT: ${verdict}\n  ${detail}`);
}

// ---- V0 (control): Gate 1 through the real composition. MUST block.
{
  const root = makeRepo('loop', DENY);
  const t = await createTask({ repoRoot: root, title: 'V0', description: 'd', priority: 'medium',
    acceptance_criteria: ['ships'], verification_tier: 'tests-after' });
  const c = await attempt(() => mcpCloseTask({ repoRoot: root, key: t.key,
    comment: { author: 'orchestrator', body: 'Closing.' } }));
  record('V0 (control)', 'Gate 1 via real MCP composition, auto_close_on_green_review FALSE',
    c.ok ? 'MISSED' : 'CAUGHT',
    c.ok ? 'Gate 1 did not fire even when composed.' : `blocked: ${c.code} — ${c.message}`);
}

// ---- V1 (Challenger #10, corrected): FAIL-token evasion against the REAL Gate 2 marker check.
{
  const root = makeRepo('harness', DENY);            // author the uat comment in harness mode
  const t = await createTask({ repoRoot: root, title: 'V1', description: 'd', priority: 'medium',
    acceptance_criteria: ['CSV export works.', 'XLSX export works.'], verification_tier: 'uat-only' });
  const body = [
    'UAT script:',
    '1. Run `npm run export -- --format=csv`, expect a CSV. Observed: file created. Verdict: PASS',
    '2. Open the CSV, expect correct headers. Observed: headers present. Verdict: PASS',
    '3. Run with --format=xlsx, expect an XLSX file. Observed: command exited with an unhandled',
    '   TypeError and no file was written; deferred to a follow-up ticket, not a blocker for this',
    '   scope. Verdict: PASS (deferred)',
    '', 'Overall result: PASS',
  ].join('\n');
  const a = await attempt(() => mcpAppendComment({ repoRoot: root, key: t.key, author: 'uat', body }));
  // flip the bundle to loop mode WITHOUT the delegation grant, then close via real composition
  writeFileSync(join(root, 'state', 'sessions', SID, 'session.json'), JSON.stringify({
    schema_version: 2, session_id: SID, lifecycle_state: 'active',
    updated_at: new Date(0).toISOString(), active_task: null, workflow_step: 'idle',
    next_action: 'p', handoff_summary: 'p', open_questions: [], blockers: [],
    decisions: [], subagent_results: [], pending_human_confirmation: null,
    mode: 'loop', loop_auth: GRANT_CLOSE }, null, 2));   // Gate 1 granted, Gate 2 delegation NOT
  const c = await attempt(() => mcpCloseTask({ repoRoot: root, key: t.key,
    comment: { author: 'orchestrator', body: 'UAT passed. Closing.' } }));
  record('V1', 'Challenger #10 — Gate 2 human-verdict marker vs a real failure written as "PASS (deferred)"',
    c.ok ? 'MISSED' : 'CAUGHT',
    c.ok
      ? `Closed in LOOP mode with uat_delegated_to_orchestrator FALSE. Gate 2 accepted the body as a genuine human PASS: it says "Overall result: PASS" and contains no FAIL-family token — yet step 3 records AC2 as an unhandled TypeError with no file written. The marker check is a token scan, so a failure phrased without the tokens reads as success. (append author:'uat' in harness = ${a.ok ? 'allowed' : 'blocked'}.)`
      : `blocked: ${c.code} — ${c.message}`);
}

// ---- V2: does Gate 2's marker check catch the LITERAL token form it was built for?
{
  const root = makeRepo('harness', DENY);
  const t = await createTask({ repoRoot: root, title: 'V2', description: 'd', priority: 'medium',
    acceptance_criteria: ['Works.'], verification_tier: 'uat-only' });
  await attempt(() => mcpAppendComment({ repoRoot: root, key: t.key, author: 'uat',
    body: '1. Step one. Observed: broken. FAILED\n\nOverall result: PASS' }));
  writeFileSync(join(root, 'state', 'sessions', SID, 'session.json'), JSON.stringify({
    schema_version: 2, session_id: SID, lifecycle_state: 'active',
    updated_at: new Date(0).toISOString(), active_task: null, workflow_step: 'idle',
    next_action: 'p', handoff_summary: 'p', open_questions: [], blockers: [],
    decisions: [], subagent_results: [], pending_human_confirmation: null,
    mode: 'loop', loop_auth: GRANT_CLOSE }, null, 2));
  const c = await attempt(() => mcpCloseTask({ repoRoot: root, key: t.key,
    comment: { author: 'orchestrator', body: 'Closing.' } }));
  record('V2 (control)', 'Gate 2 vs the literal "FAILED ... Overall result: PASS" form TASK-108 widened for',
    c.ok ? 'MISSED' : 'CAUGHT',
    c.ok ? 'Even the literal token form slipped through.' : `blocked: ${c.code} — ${c.message}`);
}

console.log('\n\n=========== ROUND 3b (CORRECTED) SUMMARY ===========');
for (const x of results) console.log(`  ${String(x.verdict).padEnd(8)} ${x.id}`);
