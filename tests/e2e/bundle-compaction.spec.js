// tests/e2e/bundle-compaction.spec.js
// TASK-103 — bundle hygiene: validate-before-write in writeBundleSession +
// compaction/rotation with an enforced size sensor (R11 + R10).
//
// AC1 — writeBundleSession validates the payload against bundleStateSchema
//       BEFORE atomicWriteFile and throws a typed E_BUNDLE_INVALID carrying
//       ajv error paths; existing writers (a schema-valid full payload) stay
//       green.
// AC2 — compaction/rotation: session.json retains required fields + mode/
//       loop_auth/loop_state + the latest handoff_summary + the most recent
//       N decisions/subagent_results; older entries rotate to an append-only
//       archive.jsonl inside the bundle dir with no data loss.
// AC3 — an enforced size sensor (schema maxItems) fails when session.json
//       exceeds the documented caps, red-proven against a synthetic
//       oversized bundle, both via direct writeBundleSession and via the
//       compaction mechanism's own idempotency (no-op once within caps).
//
// Disk I/O / tmpdir -> slow tier: tests/e2e/.

import { describe, it, expect, afterAll } from 'vitest';
import {
  mkdirSync, writeFileSync, readFileSync, existsSync,
} from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';
import { seedActiveBundle, bundlePath } from '../helpers/fixtures.js';
import { REPO_ROOT } from '../helpers/repoRoot.js';

afterAll(cleanupAll);

const __thisDir = dirname(fileURLToPath(import.meta.url));
const __srcDir = join(__thisDir, '..', '..', 'src');
const BUNDLE_URL = pathToFileURL(join(__srcDir, 'bundle.js')).href;
const COMPACTION_URL = pathToFileURL(join(__srcDir, 'bundle-compaction.js')).href;

const SESSION_ID = '20260704T000000Z-cafef00d';

function makeDecision(at, i) {
  return { at, decision: `decision ${i}`, rationale: `rationale ${i}` };
}

function makeSubagentResult(at, i) {
  return { agent: 'developer', at, summary: `summary ${i}` };
}

// ---------------------------------------------------------------------------
// AC1 — writeBundleSession validates before atomicWriteFile.
// ---------------------------------------------------------------------------

describe('AC1 — writeBundleSession validates against bundleStateSchema before writing', () => {
  it('throws E_BUNDLE_INVALID carrying ajv error paths for a payload missing a required field, and does NOT write the file', async () => {
    const { writeBundleSession, bundleSessionPath } = await import(BUNDLE_URL);
    const root = makeTmpDir('af-bundle-invalid');
    const sessionId = SESSION_ID;
    mkdirSync(join(root, 'state', 'sessions', sessionId), { recursive: true });

    const invalidPayload = {
      schema_version: 2,
      session_id: sessionId,
      lifecycle_state: 'active',
      updated_at: new Date().toISOString(),
      active_task: null,
      workflow_step: 'idle',
      // next_action is required by bundleStateSchema — omitted deliberately.
      handoff_summary: 'hi',
    };

    let caughtErr;
    try {
      await writeBundleSession(root, sessionId, invalidPayload);
    } catch (err) {
      caughtErr = err;
    }

    expect(caughtErr, 'must throw on a schema-invalid payload').toBeDefined();
    expect(caughtErr.code).toBe('E_BUNDLE_INVALID');
    expect(caughtErr.code).not.toBe('ENOENT');
    expect(Array.isArray(caughtErr.errors), 'must carry the raw ajv errors array').toBe(true);
    expect(caughtErr.errors.length).toBeGreaterThan(0);
    // ajv error paths (instancePath) must be surfaced in the message so a
    // human/reviewer can see exactly which field failed.
    expect(caughtErr.message).toMatch(/next_action/);

    expect(existsSync(bundleSessionPath(root, sessionId)), 'invalid payload must never reach disk').toBe(false);
  });

  it('throws E_BUNDLE_INVALID for an enum violation (bad workflow_step) and reports the offending path', async () => {
    const { writeBundleSession } = await import(BUNDLE_URL);
    const root = makeTmpDir('af-bundle-invalid-enum');
    const sessionId = SESSION_ID;
    mkdirSync(join(root, 'state', 'sessions', sessionId), { recursive: true });

    const invalidPayload = {
      schema_version: 2,
      session_id: sessionId,
      lifecycle_state: 'active',
      updated_at: new Date().toISOString(),
      active_task: null,
      workflow_step: 'not-a-real-step',
      next_action: null,
      handoff_summary: 'hi',
    };

    let caughtErr;
    try {
      await writeBundleSession(root, sessionId, invalidPayload);
    } catch (err) {
      caughtErr = err;
    }

    expect(caughtErr).toBeDefined();
    expect(caughtErr.code).toBe('E_BUNDLE_INVALID');
    expect(caughtErr.message).toMatch(/workflow_step/);
  });

  it('a schema-valid full payload (mirrors every existing writer) still writes successfully', async () => {
    const { writeBundleSession, readBundleSession } = await import(BUNDLE_URL);
    const root = makeTmpDir('af-bundle-valid');
    const sessionId = SESSION_ID;
    mkdirSync(join(root, 'state', 'sessions', sessionId), { recursive: true });

    const validPayload = {
      schema_version: 2,
      session_id: sessionId,
      lifecycle_state: 'active',
      updated_at: new Date().toISOString(),
      active_task: 'TASK-004',
      workflow_step: 'test',
      next_action: 'continue',
      handoff_summary: 'a short paragraph',
      open_questions: [],
      blockers: [],
      decisions: [makeDecision('2026-07-01T00:00:00Z', 1)],
      subagent_results: [makeSubagentResult('2026-07-01T00:00:00Z', 1)],
      pending_human_confirmation: null,
      mode: 'harness',
    };

    await expect(writeBundleSession(root, sessionId, validPayload)).resolves.toBeUndefined();
    const readBack = readBundleSession(root, sessionId);
    expect(readBack.active_task).toBe('TASK-004');
    expect(readBack.decisions.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// AC2 — compaction/rotation.
// ---------------------------------------------------------------------------

describe('AC2 — compaction rotates older decisions/subagent_results to an archive, no data loss', () => {
  it('partitionMostRecent keeps the N most-recent-by-`at` items (order-independent of input order) and archives the rest, preserving original relative order in each bucket', async () => {
    const { partitionMostRecent } = await import(COMPACTION_URL);

    // Deliberately NOT pre-sorted — mirrors the live bundle's own arrays,
    // which are mostly-but-not-perfectly descending (see hand-off).
    const items = [
      makeDecision('2026-07-01T00:00:00Z', 1),
      makeDecision('2026-06-01T00:00:00Z', 2),
      makeDecision('2026-07-03T00:00:00Z', 3),
      makeDecision('2026-05-01T00:00:00Z', 4),
      makeDecision('2026-07-02T00:00:00Z', 5),
    ];

    const { kept, archived } = partitionMostRecent(items, 3);

    expect(kept.length).toBe(3);
    expect(archived.length).toBe(2);
    // Kept must be exactly the 3 with the latest `at` values: 07-03, 07-02, 07-01.
    expect(kept.map((d) => d.at).sort()).toEqual(
      ['2026-07-01T00:00:00Z', '2026-07-02T00:00:00Z', '2026-07-03T00:00:00Z'].sort(),
    );
    // Original relative order preserved within `kept` (item1 before item3 before item5).
    expect(kept.map((d) => d.decision)).toEqual(['decision 1', 'decision 3', 'decision 5']);
    // Archived preserves original relative order too (item2 before item4).
    expect(archived.map((d) => d.decision)).toEqual(['decision 2', 'decision 4']);
  });

  it('partitionMostRecent is a no-op (all kept, none archived) when the array is already within the cap', async () => {
    const { partitionMostRecent } = await import(COMPACTION_URL);
    const items = [makeDecision('2026-07-01T00:00:00Z', 1), makeDecision('2026-07-02T00:00:00Z', 2)];
    const { kept, archived } = partitionMostRecent(items, 5);
    expect(kept).toEqual(items);
    expect(archived).toEqual([]);
  });

  it('compactBundleSession rotates decisions/subagent_results beyond the cap into archive.jsonl with zero data loss, and preserves required fields + mode/loop_auth/loop_state + the latest handoff_summary', async () => {
    const { compactBundleSession, MAX_DECISIONS, MAX_SUBAGENT_RESULTS } = await import(COMPACTION_URL);
    const { readBundleSession, bundleArchivePath } = await import(BUNDLE_URL);

    const root = makeTmpDir('af-bundle-compact');
    const sessionId = SESSION_ID;
    const bundleDir = bundlePath(root, sessionId);

    const decisionCount = MAX_DECISIONS + 20;
    const subagentCount = MAX_SUBAGENT_RESULTS + 15;
    const decisions = Array.from({ length: decisionCount }, (_, i) =>
      makeDecision(new Date(2026, 0, 1 + i).toISOString(), i));
    const subagent_results = Array.from({ length: subagentCount }, (_, i) =>
      makeSubagentResult(new Date(2026, 0, 1 + i).toISOString(), i));

    seedActiveBundle(bundleDir, {
      session_id: sessionId,
      session_json_extra: {
        decisions,
        subagent_results,
        handoff_summary: 'the current, single, latest handoff paragraph',
        mode: 'loop',
        loop_auth: { auto_close_on_green_review: true },
        loop_state: { current_ticket: 'TASK-103', phase: 'test', iteration: 8 },
      },
    });

    const result = await compactBundleSession({ repoRoot: root, sessionId });

    expect(result.compacted).toBe(true);
    expect(result.archivedDecisions).toBe(decisionCount - MAX_DECISIONS);
    expect(result.archivedSubagentResults).toBe(subagentCount - MAX_SUBAGENT_RESULTS);

    const after = readBundleSession(root, sessionId);
    expect(after.decisions.length).toBe(MAX_DECISIONS);
    expect(after.subagent_results.length).toBe(MAX_SUBAGENT_RESULTS);
    // Required fields + the documented "always retained" set survive verbatim.
    expect(after.schema_version).toBe(2);
    expect(after.session_id).toBe(sessionId);
    expect(after.handoff_summary).toBe('the current, single, latest handoff paragraph');
    expect(after.mode).toBe('loop');
    expect(after.loop_auth).toEqual({ auto_close_on_green_review: true });
    expect(after.loop_state).toEqual({ current_ticket: 'TASK-103', phase: 'test', iteration: 8 });

    // No data loss: every archived entry is recoverable from archive.jsonl.
    const archivePath = bundleArchivePath(root, sessionId);
    expect(existsSync(archivePath), 'archive.jsonl must exist').toBe(true);
    const archiveLines = readFileSync(archivePath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const archivedDecisionLines = archiveLines.filter((l) => l.type === 'decision');
    const archivedSubagentLines = archiveLines.filter((l) => l.type === 'subagent_result');
    expect(archivedDecisionLines.length).toBe(decisionCount - MAX_DECISIONS);
    expect(archivedSubagentLines.length).toBe(subagentCount - MAX_SUBAGENT_RESULTS);

    // Union of kept + archived reconstructs the full original set (by `at`), no loss.
    const allDecisionAtsAfter = new Set([...after.decisions, ...archivedDecisionLines].map((d) => d.at));
    expect(allDecisionAtsAfter.size).toBe(decisionCount);
    const allSubagentAtsAfter = new Set([...after.subagent_results, ...archivedSubagentLines].map((d) => d.at));
    expect(allSubagentAtsAfter.size).toBe(subagentCount);
  });

  it('compactBundleSession is idempotent: a bundle already within both caps is left untouched (no write, no archive)', async () => {
    const { compactBundleSession } = await import(COMPACTION_URL);
    const { bundleArchivePath } = await import(BUNDLE_URL);

    const root = makeTmpDir('af-bundle-compact-noop');
    const sessionId = SESSION_ID;
    const bundleDir = bundlePath(root, sessionId);
    seedActiveBundle(bundleDir, {
      session_id: sessionId,
      session_json_extra: { decisions: [makeDecision('2026-07-01T00:00:00Z', 1)], subagent_results: [] },
    });

    const result = await compactBundleSession({ repoRoot: root, sessionId });

    expect(result.compacted).toBe(false);
    expect(result.archivedDecisions).toBe(0);
    expect(result.archivedSubagentResults).toBe(0);
    expect(existsSync(bundleArchivePath(root, sessionId)), 'archive.jsonl must not be created on a no-op').toBe(false);
  });

  it('running compactBundleSession twice on an oversized bundle accumulates archive entries append-only (second run appends nothing new once caps are met)', async () => {
    const { compactBundleSession, MAX_DECISIONS } = await import(COMPACTION_URL);
    const { bundleArchivePath } = await import(BUNDLE_URL);

    const root = makeTmpDir('af-bundle-compact-twice');
    const sessionId = SESSION_ID;
    const bundleDir = bundlePath(root, sessionId);
    const decisions = Array.from({ length: MAX_DECISIONS + 5 }, (_, i) =>
      makeDecision(new Date(2026, 0, 1 + i).toISOString(), i));
    seedActiveBundle(bundleDir, {
      session_id: sessionId,
      session_json_extra: { decisions, subagent_results: [] },
    });

    const first = await compactBundleSession({ repoRoot: root, sessionId });
    expect(first.archivedDecisions).toBe(5);

    const second = await compactBundleSession({ repoRoot: root, sessionId });
    expect(second.compacted).toBe(false);

    const archiveLines = readFileSync(bundleArchivePath(root, sessionId), 'utf8').trim().split('\n');
    expect(archiveLines.length).toBe(5); // no duplicate/second append
  });
});

// ---------------------------------------------------------------------------
// AC3 — enforced size sensor, red-proven against a synthetic oversized bundle.
// ---------------------------------------------------------------------------

describe('AC3 — schema maxItems enforces the documented caps', () => {
  it('writeBundleSession throws E_BUNDLE_INVALID when decisions exceeds the documented cap (synthetic oversized bundle)', async () => {
    const { writeBundleSession } = await import(BUNDLE_URL);
    const { MAX_DECISIONS } = await import(COMPACTION_URL);
    const root = makeTmpDir('af-bundle-oversized-decisions');
    const sessionId = SESSION_ID;
    mkdirSync(join(root, 'state', 'sessions', sessionId), { recursive: true });

    const oversized = {
      schema_version: 2,
      session_id: sessionId,
      lifecycle_state: 'active',
      updated_at: new Date().toISOString(),
      active_task: null,
      workflow_step: 'idle',
      next_action: null,
      handoff_summary: 'hi',
      decisions: Array.from({ length: MAX_DECISIONS + 1 }, (_, i) => makeDecision('2026-07-01T00:00:00Z', i)),
      subagent_results: [],
    };

    let caughtErr;
    try {
      await writeBundleSession(root, sessionId, oversized);
    } catch (err) {
      caughtErr = err;
    }

    expect(caughtErr, 'must throw for a decisions array beyond the documented cap').toBeDefined();
    expect(caughtErr.code).toBe('E_BUNDLE_INVALID');
    expect(caughtErr.message).toMatch(/decisions/);
  });

  it('writeBundleSession throws E_BUNDLE_INVALID when subagent_results exceeds the documented cap (synthetic oversized bundle)', async () => {
    const { writeBundleSession } = await import(BUNDLE_URL);
    const { MAX_SUBAGENT_RESULTS } = await import(COMPACTION_URL);
    const root = makeTmpDir('af-bundle-oversized-subagent');
    const sessionId = SESSION_ID;
    mkdirSync(join(root, 'state', 'sessions', sessionId), { recursive: true });

    const oversized = {
      schema_version: 2,
      session_id: sessionId,
      lifecycle_state: 'active',
      updated_at: new Date().toISOString(),
      active_task: null,
      workflow_step: 'idle',
      next_action: null,
      handoff_summary: 'hi',
      decisions: [],
      subagent_results: Array.from(
        { length: MAX_SUBAGENT_RESULTS + 1 },
        (_, i) => makeSubagentResult('2026-07-01T00:00:00Z', i),
      ),
    };

    let caughtErr;
    try {
      await writeBundleSession(root, sessionId, oversized);
    } catch (err) {
      caughtErr = err;
    }

    expect(caughtErr).toBeDefined();
    expect(caughtErr.code).toBe('E_BUNDLE_INVALID');
    expect(caughtErr.message).toMatch(/subagent_results/);
  });

  it('the schema maxItems caps stay parity-identical between src/schemas.js and state/bundle.schema.json', async () => {
    const { bundleStateSchema } = await import(pathToFileURL(join(__srcDir, 'schemas.js')).href);
    const jsonSchema = JSON.parse(readFileSync(join(REPO_ROOT, 'state', 'bundle.schema.json'), 'utf8'));

    expect(bundleStateSchema.properties.decisions.maxItems).toBeDefined();
    expect(bundleStateSchema.properties.subagent_results.maxItems).toBeDefined();
    expect(jsonSchema.properties.decisions.maxItems).toBe(bundleStateSchema.properties.decisions.maxItems);
    expect(jsonSchema.properties.subagent_results.maxItems).toBe(bundleStateSchema.properties.subagent_results.maxItems);
  });

  // TASK-110 (R10 one level down) — extends the parity assertion above with the
  // loop_state.beta_findings/note caps rather than duplicating a new test.
  it('the loop_state.beta_findings/note bounds stay parity-identical between src/schemas.js and state/bundle.schema.json', async () => {
    const { bundleStateSchema } = await import(pathToFileURL(join(__srcDir, 'schemas.js')).href);
    const jsonSchema = JSON.parse(readFileSync(join(REPO_ROOT, 'state', 'bundle.schema.json'), 'utf8'));

    expect(bundleStateSchema.properties.loop_state.properties.beta_findings.maxItems).toBeDefined();
    expect(bundleStateSchema.properties.loop_state.properties.note.maxLength).toBeDefined();
    expect(jsonSchema.properties.loop_state.properties.beta_findings.maxItems).toBe(
      bundleStateSchema.properties.loop_state.properties.beta_findings.maxItems,
    );
    expect(jsonSchema.properties.loop_state.properties.note.maxLength).toBe(
      bundleStateSchema.properties.loop_state.properties.note.maxLength,
    );
  });
});

// ---------------------------------------------------------------------------
// TASK-110 (R10 one level down) — loop_state.beta_findings/note enforced
// bound + lossless overflow path, extending the SAME archive.jsonl mechanism
// TASK-103 built for decisions/subagent_results (no second archive).
// ---------------------------------------------------------------------------

describe('TASK-110 AC1 — loop_state.beta_findings/note have an enforced bound (schema cap), red-proven against a synthetic oversized loop_state', () => {
  it('writeBundleSession throws E_BUNDLE_INVALID when loop_state.beta_findings exceeds the documented cap (synthetic oversized array)', async () => {
    const { writeBundleSession } = await import(BUNDLE_URL);
    const { MAX_BETA_FINDINGS } = await import(COMPACTION_URL);
    const root = makeTmpDir('af-bundle-oversized-beta-findings');
    const sessionId = SESSION_ID;
    mkdirSync(join(root, 'state', 'sessions', sessionId), { recursive: true });

    const oversized = {
      schema_version: 2,
      session_id: sessionId,
      lifecycle_state: 'active',
      updated_at: new Date().toISOString(),
      active_task: null,
      workflow_step: 'idle',
      next_action: null,
      handoff_summary: 'hi',
      loop_state: {
        current_ticket: 'TASK-110',
        beta_findings: Array.from({ length: MAX_BETA_FINDINGS + 1 }, (_, i) => `finding ${i}`),
      },
    };

    let caughtErr;
    try {
      await writeBundleSession(root, sessionId, oversized);
    } catch (err) {
      caughtErr = err;
    }

    expect(caughtErr, 'must throw for a beta_findings array beyond the documented cap').toBeDefined();
    expect(caughtErr.code).toBe('E_BUNDLE_INVALID');
    expect(caughtErr.message).toMatch(/beta_findings/);
  });

  it('writeBundleSession throws E_BUNDLE_INVALID when loop_state.note exceeds the documented maxLength (synthetic oversized string)', async () => {
    const { writeBundleSession } = await import(BUNDLE_URL);
    const { MAX_NOTE_LENGTH } = await import(COMPACTION_URL);
    const root = makeTmpDir('af-bundle-oversized-note');
    const sessionId = SESSION_ID;
    mkdirSync(join(root, 'state', 'sessions', sessionId), { recursive: true });

    const oversized = {
      schema_version: 2,
      session_id: sessionId,
      lifecycle_state: 'active',
      updated_at: new Date().toISOString(),
      active_task: null,
      workflow_step: 'idle',
      next_action: null,
      handoff_summary: 'hi',
      loop_state: {
        current_ticket: 'TASK-110',
        note: 'x'.repeat(MAX_NOTE_LENGTH + 1),
      },
    };

    let caughtErr;
    try {
      await writeBundleSession(root, sessionId, oversized);
    } catch (err) {
      caughtErr = err;
    }

    expect(caughtErr, 'must throw for a note string beyond the documented maxLength').toBeDefined();
    expect(caughtErr.code).toBe('E_BUNDLE_INVALID');
    expect(caughtErr.message).toMatch(/note/);
  });

  it('a loop_state within both caps still validates and writes successfully (no false positive)', async () => {
    const { writeBundleSession, readBundleSession } = await import(BUNDLE_URL);
    const root = makeTmpDir('af-bundle-loopstate-valid');
    const sessionId = SESSION_ID;
    mkdirSync(join(root, 'state', 'sessions', sessionId), { recursive: true });

    const validPayload = {
      schema_version: 2,
      session_id: sessionId,
      lifecycle_state: 'active',
      updated_at: new Date().toISOString(),
      active_task: null,
      workflow_step: 'idle',
      next_action: null,
      handoff_summary: 'hi',
      loop_state: {
        current_ticket: 'TASK-110',
        beta_findings: ['one finding', 'another finding'],
        note: 'a short note',
      },
    };

    await expect(writeBundleSession(root, sessionId, validPayload)).resolves.toBeUndefined();
    const readBack = readBundleSession(root, sessionId);
    expect(readBack.loop_state.beta_findings).toEqual(['one finding', 'another finding']);
    expect(readBack.loop_state.note).toBe('a short note');
  });
});

describe('TASK-110 AC2 — compactLoopState/compactBundleSession rotate loop_state overflow into the SAME archive.jsonl, no data loss', () => {
  it('partitionArrayTail keeps the last maxItems entries (append order) and archives the head, preserving relative order in both buckets', async () => {
    const { partitionArrayTail } = await import(COMPACTION_URL);
    const items = ['a', 'b', 'c', 'd', 'e'];
    const { kept, archived } = partitionArrayTail(items, 3);
    expect(kept).toEqual(['c', 'd', 'e']);
    expect(archived).toEqual(['a', 'b']);
  });

  it('partitionArrayTail is a no-op when the array is already within the cap', async () => {
    const { partitionArrayTail } = await import(COMPACTION_URL);
    const items = ['a', 'b'];
    const { kept, archived } = partitionArrayTail(items, 5);
    expect(kept).toEqual(items);
    expect(archived).toEqual([]);
  });

  it('compactBundleSession rotates loop_state.beta_findings beyond the cap into archive.jsonl (type loop_state_beta_finding), no data loss, resume-point fields intact', async () => {
    const { compactBundleSession, MAX_BETA_FINDINGS } = await import(COMPACTION_URL);
    const { readBundleSession, bundleArchivePath } = await import(BUNDLE_URL);

    const root = makeTmpDir('af-bundle-compact-beta-findings');
    const sessionId = SESSION_ID;
    const bundleDir = bundlePath(root, sessionId);

    const betaFindingsCount = MAX_BETA_FINDINGS + 6;
    const betaFindings = Array.from({ length: betaFindingsCount }, (_, i) => `finding number ${i}`);

    seedActiveBundle(bundleDir, {
      session_id: sessionId,
      session_json_extra: {
        loop_state: {
          current_ticket: 'TASK-110',
          phase: 'test',
          iteration: 3,
          completed_this_run: 2,
          run_started_at: '2026-07-01T00:00:00Z',
          beta_findings: betaFindings,
        },
      },
    });

    const result = await compactBundleSession({ repoRoot: root, sessionId });

    expect(result.compacted).toBe(true);
    expect(result.archivedBetaFindings).toBe(betaFindingsCount - MAX_BETA_FINDINGS);

    const after = readBundleSession(root, sessionId);
    expect(after.loop_state.beta_findings.length).toBe(MAX_BETA_FINDINGS);
    // resume-point / get-mode fields untouched by the rotation.
    expect(after.loop_state.current_ticket).toBe('TASK-110');
    expect(after.loop_state.phase).toBe('test');
    expect(after.loop_state.iteration).toBe(3);
    expect(after.loop_state.completed_this_run).toBe(2);
    expect(after.loop_state.run_started_at).toBe('2026-07-01T00:00:00Z');

    const archivePath = bundleArchivePath(root, sessionId);
    expect(existsSync(archivePath)).toBe(true);
    const archiveLines = readFileSync(archivePath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const archivedFindingLines = archiveLines.filter((l) => l.type === 'loop_state_beta_finding');
    expect(archivedFindingLines.length).toBe(betaFindingsCount - MAX_BETA_FINDINGS);

    // Union of kept + archived reconstructs the full original set, no loss.
    const allFindingsAfter = [...archivedFindingLines.map((l) => l.text), ...after.loop_state.beta_findings];
    expect(new Set(allFindingsAfter).size).toBe(betaFindingsCount);
    expect(allFindingsAfter).toEqual(betaFindings); // exact order preserved across the split
  });

  it('compactBundleSession rotates loop_state.note beyond maxLength into archive.jsonl (type loop_state_note), no data loss, live note trimmed', async () => {
    const { compactBundleSession, MAX_NOTE_LENGTH } = await import(COMPACTION_URL);
    const { readBundleSession, bundleArchivePath } = await import(BUNDLE_URL);

    const root = makeTmpDir('af-bundle-compact-note');
    const sessionId = SESSION_ID;
    const bundleDir = bundlePath(root, sessionId);

    const oversizedNote = 'y'.repeat(MAX_NOTE_LENGTH + 500);

    seedActiveBundle(bundleDir, {
      session_id: sessionId,
      session_json_extra: {
        loop_state: {
          current_ticket: 'TASK-110',
          phase: 'update',
          note: oversizedNote,
        },
      },
    });

    const result = await compactBundleSession({ repoRoot: root, sessionId });

    expect(result.compacted).toBe(true);
    expect(result.archivedNote).toBe(true);

    const after = readBundleSession(root, sessionId);
    expect(after.loop_state.note.length).toBeLessThanOrEqual(MAX_NOTE_LENGTH);
    expect(after.loop_state.current_ticket).toBe('TASK-110');
    expect(after.loop_state.phase).toBe('update');

    const archivePath = bundleArchivePath(root, sessionId);
    const archiveLines = readFileSync(archivePath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const archivedNoteLines = archiveLines.filter((l) => l.type === 'loop_state_note');
    expect(archivedNoteLines.length).toBe(1);
    expect(archivedNoteLines[0].text).toBe(oversizedNote); // full original text preserved, no truncation loss
  });

  it('compactBundleSession is idempotent for loop_state: a bundle already within both loop_state caps is left untouched (no write, no archive)', async () => {
    const { compactBundleSession } = await import(COMPACTION_URL);
    const { bundleArchivePath } = await import(BUNDLE_URL);

    const root = makeTmpDir('af-bundle-compact-loopstate-noop');
    const sessionId = SESSION_ID;
    const bundleDir = bundlePath(root, sessionId);
    seedActiveBundle(bundleDir, {
      session_id: sessionId,
      session_json_extra: {
        loop_state: { current_ticket: 'TASK-110', beta_findings: ['fine'], note: 'short' },
      },
    });

    const result = await compactBundleSession({ repoRoot: root, sessionId });

    expect(result.compacted).toBe(false);
    expect(result.archivedBetaFindings).toBe(0);
    expect(result.archivedNote).toBe(false);
    expect(existsSync(bundleArchivePath(root, sessionId))).toBe(false);
  });
});
