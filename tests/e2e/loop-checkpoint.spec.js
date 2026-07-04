// tests/e2e/loop-checkpoint.spec.js
// TASK-084 — e2e/bundle-touching tests for src/loop-checkpoint.js
// (slow tier — real tmpdir + pointer + bundle on disk).
//
// ACs covered:
//   AC1 — writeLoopCheckpoint validates phase before I/O (bundle file byte-
//         identical after a rejected call, mirroring tests/e2e/loop-auth.spec.js);
//         writes loop_state + workflow_step + updated_at atomically to the
//         active bundle; absent bundle surfaces a clear error.
//   AC1/AC3 — persisted bundle stays valid against state/bundle.schema.json,
//         proving the phase→workflow_step mapping always yields a legal
//         workflow_step enum value on disk (TASK-071 core, e2e leg).
//   AC2 — writeLoopCheckpoint touches nothing else in the bundle besides
//         loop_state, workflow_step, and updated_at.
//
// All tests MUST FAIL until src/loop-checkpoint.js is created.
//
// Disk I/O / tmpdir -> slow tier: tests/e2e/.

import { describe, it, expect, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';
import { REPO_ROOT } from '../helpers/repoRoot.js';

afterAll(cleanupAll);

const __thisDir = dirname(fileURLToPath(import.meta.url));
const __srcDir = join(__thisDir, '..', '..', 'src');
const CHECKPOINT_URL = pathToFileURL(join(__srcDir, 'loop-checkpoint.js')).href;

// ---------------------------------------------------------------------------
// Helpers — mirrors tests/e2e/loop-auth.spec.js makeRepo pattern.
// ---------------------------------------------------------------------------

function makeRepo({
  sessionId, bundleExtra = {}, noPointer = false, nullActiveSession = false, missingBundleDir = false,
} = {}) {
  const id = sessionId || '20260701T090000Z-c0ffee00';
  const root = makeTmpDir('af-lc');

  mkdirSync(join(root, 'state'), { recursive: true });

  if (!noPointer) {
    writeFileSync(
      join(root, 'state', 'session.json'),
      JSON.stringify({
        schema_version: 2,
        active_session_id: nullActiveSession ? null : id,
        updated_at: '2026-07-01T09:00:00Z',
      }, null, 2),
      'utf8',
    );
  }

  // missingBundleDir (TASK-092 AC2, mirrors TASK-088 AC2 in loop-auth): pointer
  // names a real session id, but no bundle directory/session.json exists at
  // all — distinct from nullActiveSession (pointer's active_session_id itself
  // is null).
  if (!nullActiveSession && !missingBundleDir) {
    const bundleDir = join(root, 'state', 'sessions', id);
    mkdirSync(bundleDir, { recursive: true });
    writeFileSync(
      join(bundleDir, 'session.json'),
      JSON.stringify({
        schema_version: 2,
        session_id: id,
        lifecycle_state: 'active',
        updated_at: '2026-07-01T09:00:00Z',
        active_task: 'TASK-100',
        workflow_step: 'fetch',
        next_action: 'work TASK-100',
        handoff_summary: 'in progress',
        open_questions: [],
        blockers: [],
        decisions: [],
        subagent_results: [],
        pending_human_confirmation: null,
        mode: 'loop',
        loop_state: {
          goal: { label: 'goal-loop-checkpoint' },
          iteration: 1,
          consecutiveNoProgress: 0,
          maxIterations: 20,
          maxNoProgress: 3,
          maxReviewerRetries: 2,
        },
        ...bundleExtra,
      }, null, 2),
      'utf8',
    );
  }

  return { root, id };
}

function readBundleFile(root, id) {
  return readFileSync(join(root, 'state', 'sessions', id, 'session.json'), 'utf8');
}

const CHECKPOINT = {
  current_ticket: 'TASK-100',
  phase: 'impl',
  iteration: 3,
  completed_this_run: 1,
  run_started_at: '2026-07-01T08:00:00Z',
};

// ---------------------------------------------------------------------------
// AC1 — writeLoopCheckpoint persists loop_state + workflow_step atomically.
// ---------------------------------------------------------------------------

describe('AC1 — writeLoopCheckpoint writes the checkpoint to the bundle', () => {
  it('writeLoopCheckpoint_persists_loop_state_fields_and_maps_phase_to_workflow_step', async () => {
    const { writeLoopCheckpoint } = await import(CHECKPOINT_URL);
    const { root, id } = makeRepo();

    await writeLoopCheckpoint({ repoRoot: root, checkpoint: CHECKPOINT });

    const onDisk = JSON.parse(readBundleFile(root, id));
    expect(onDisk.loop_state.current_ticket).toBe('TASK-100');
    expect(onDisk.loop_state.phase).toBe('impl');
    expect(onDisk.loop_state.iteration).toBe(3);
    expect(onDisk.loop_state.completed_this_run).toBe(1);
    expect(onDisk.loop_state.run_started_at).toBe('2026-07-01T08:00:00Z');
    // impl phase maps onto the 'impl' workflow_step enum value.
    expect(onDisk.workflow_step).toBe('impl');
  });

  it('writeLoopCheckpoint_maps_every_phase_to_a_legal_workflow_step_value_on_disk', async () => {
    const { writeLoopCheckpoint, LOOP_PHASES } = await import(CHECKPOINT_URL);
    const WORKFLOW_STEP_ENUM = ['idle', 'fetch', 'research', 'test', 'impl', 'review', 'update'];

    for (const phase of Object.keys(LOOP_PHASES)) {
      const { root, id } = makeRepo({ sessionId: `20260701T09${String(Object.keys(LOOP_PHASES).indexOf(phase)).padStart(2, '0')}00Z-c0ffee0${Object.keys(LOOP_PHASES).indexOf(phase)}` });
      await writeLoopCheckpoint({
        repoRoot: root,
        checkpoint: { ...CHECKPOINT, phase },
      });
      const onDisk = JSON.parse(readBundleFile(root, id));
      expect(WORKFLOW_STEP_ENUM.includes(onDisk.workflow_step), `phase '${phase}' must map onto a legal workflow_step`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// AC1 — unknown phase rejected before any I/O.
// ---------------------------------------------------------------------------

describe('AC1 — writeLoopCheckpoint rejects an unknown phase without touching the bundle', () => {
  it('writeLoopCheckpoint_unknown_phase_leaves_bundle_file_byte_identical', async () => {
    const { writeLoopCheckpoint } = await import(CHECKPOINT_URL);
    const { root, id } = makeRepo();
    const before = readBundleFile(root, id);

    await expect(
      writeLoopCheckpoint({
        repoRoot: root,
        checkpoint: { ...CHECKPOINT, phase: 'not_a_real_phase' },
      }),
    ).rejects.toThrow(/unknown|invalid/i);

    const after = readBundleFile(root, id);
    expect(after).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// AC1 — absent bundle surfaces a clear error.
// ---------------------------------------------------------------------------

describe('AC1 — writeLoopCheckpoint surfaces a clear error when there is no active session', () => {
  it('writeLoopCheckpoint_no_pointer_file_rejects_clearly', async () => {
    const { writeLoopCheckpoint } = await import(CHECKPOINT_URL);
    const { root } = makeRepo({ noPointer: true });

    await expect(
      writeLoopCheckpoint({ repoRoot: root, checkpoint: CHECKPOINT }),
    ).rejects.toThrow();
  });

  it('writeLoopCheckpoint_null_active_session_id_rejects_clearly', async () => {
    const { writeLoopCheckpoint } = await import(CHECKPOINT_URL);
    const { root } = makeRepo({ nullActiveSession: true });

    await expect(
      writeLoopCheckpoint({ repoRoot: root, checkpoint: CHECKPOINT }),
    ).rejects.toThrow(/no active session|active session/i);
  });
});

// ---------------------------------------------------------------------------
// TASK-092 AC2 — the pointer names a session whose bundle directory is
// missing (deleted or moved out from under it). Before the fix this surfaced
// a raw ENOENT from readBundleSession (via the shared bundle.js helper); the
// tailored error must name the session id, the expected session.json path,
// and the calling function ('writeLoopCheckpoint') for symptom attribution.
// ---------------------------------------------------------------------------

describe('TASK-092 AC2 — writeLoopCheckpoint tailors the missing-bundle-dir error', () => {
  it('writeLoopCheckpoint_missing_bundle_dir_throws_typed_error_with_session_id_and_path', async () => {
    const { writeLoopCheckpoint } = await import(CHECKPOINT_URL);
    const { root, id } = makeRepo({ missingBundleDir: true });

    let caughtErr;
    try {
      await writeLoopCheckpoint({ repoRoot: root, checkpoint: CHECKPOINT });
    } catch (err) {
      caughtErr = err;
    }

    expect(caughtErr, 'writeLoopCheckpoint must reject when the bundle dir is missing').toBeDefined();
    expect(caughtErr.code, 'must be the tailored code, not a raw ENOENT').toBe('E_BUNDLE_MISSING');
    expect(caughtErr.code).not.toBe('ENOENT');
    expect(caughtErr.message).toContain(id);
    expect(caughtErr.message).toContain(join(root, 'state', 'sessions', id, 'session.json'));
    expect(caughtErr.message).toContain('writeLoopCheckpoint');
  });
});

// ---------------------------------------------------------------------------
// AC1/AC3 — persisted bundle stays schema-valid.
// ---------------------------------------------------------------------------

describe('AC1/AC3 — bundle stays schema-valid after a checkpoint write', () => {
  it('writeLoopCheckpoint_result_validates_against_bundle_schema_json', async () => {
    const { writeLoopCheckpoint } = await import(CHECKPOINT_URL);
    const { root, id } = makeRepo();

    await writeLoopCheckpoint({ repoRoot: root, checkpoint: CHECKPOINT });

    const onDisk = JSON.parse(readBundleFile(root, id));
    const schemaPath = join(REPO_ROOT, 'state', 'bundle.schema.json');
    expect(existsSync(schemaPath), 'state/bundle.schema.json must exist').toBe(true);
    const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));

    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    const ok = validate(onDisk);
    expect(ok, 'persisted bundle failed schema: ' + JSON.stringify(validate.errors, null, 2)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC2 — writeLoopCheckpoint only touches loop_state, workflow_step, updated_at.
// ---------------------------------------------------------------------------

describe('AC2 — writeLoopCheckpoint touches only loop_state, workflow_step, and updated_at', () => {
  it('writeLoopCheckpoint_does_not_modify_any_other_bundle_field', async () => {
    const { writeLoopCheckpoint } = await import(CHECKPOINT_URL);
    const { root, id } = makeRepo();
    const before = JSON.parse(readBundleFile(root, id));

    await writeLoopCheckpoint({ repoRoot: root, checkpoint: CHECKPOINT });

    const after = JSON.parse(readBundleFile(root, id));
    const beforeRest = { ...before };
    const afterRest = { ...after };
    for (const field of ['loop_state', 'workflow_step', 'updated_at']) {
      delete beforeRest[field];
      delete afterRest[field];
    }
    expect(afterRest).toEqual(beforeRest);
  });

  it('writeLoopCheckpoint_preserves_other_loop_state_keys_like_goal_and_backstop_ceilings', async () => {
    const { writeLoopCheckpoint } = await import(CHECKPOINT_URL);
    const { root, id } = makeRepo();

    await writeLoopCheckpoint({ repoRoot: root, checkpoint: CHECKPOINT });

    const onDisk = JSON.parse(readBundleFile(root, id));
    expect(onDisk.loop_state.goal).toEqual({ label: 'goal-loop-checkpoint' });
    expect(onDisk.loop_state.maxIterations).toBe(20);
    expect(onDisk.loop_state.maxNoProgress).toBe(3);
    expect(onDisk.loop_state.maxReviewerRetries).toBe(2);
  });
});
